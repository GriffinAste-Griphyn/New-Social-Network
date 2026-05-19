import CryptoKit
import Foundation
import UIKit

enum APIClientError: LocalizedError {
    case invalidBaseURL
    case invalidResponse
    case server(String, Int)
    case missingAuth

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL:
            return "The API URL is invalid."
        case .invalidResponse:
            return "The server did not return a valid response."
        case .server(let message, _):
            return message
        case .missingAuth:
            return "Sign in before continuing."
        }
    }
}

private struct BlobUploadErrorEnvelope: Decodable {
    struct BlobError: Decodable {
        let code: String?
        let message: String?
    }

    let error: BlobError?
}

@MainActor
final class APIClient: ObservableObject {
    @Published var baseURLString: String {
        didSet {
            UserDefaults.standard.set(baseURLString, forKey: Self.baseURLKey)
        }
    }

    var authToken: String? {
        didSet {
            guard oldValue != authToken else {
                return
            }
            storyStackCache.removeAll()
            storyStackFetches.removeAll()
            storyStackRefreshedAt.removeAll()
        }
    }

    private static let baseURLKey = "ubeye.ios.apiBaseUrl"
    private static let deviceIdKey = "ubeye.ios.deviceId"
    private static let productionBaseURL = "https://www.ubeye.ai"
    private static let vercelBlobApiVersion = "12"
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder
    private let responseCache = MobileResponseDiskCache()
    private var storyStackCache: [String: StoryStackResponse] = [:]
    private var storyStackFetches: [String: Task<StoryStackResponse, Error>] = [:]
    private var storyStackRefreshedAt: [String: Date] = [:]
    private let feedDiskCacheMaxAge: TimeInterval = 30 * 60
    private let storyStackDiskCacheMaxAge: TimeInterval = 30 * 60
    private let storyStackRefreshCooldown: TimeInterval = 60

    init(session: URLSession = .shared) {
        MediaPreheater.configureURLCache()
        self.session = session
        let storedBaseURL = UserDefaults.standard.string(forKey: Self.baseURLKey)
        baseURLString = Self.usableBaseURL(from: storedBaseURL)
        decoder = JSONDecoder()
        encoder = JSONEncoder()
    }

    var baseURL: URL? {
        URL(string: baseURLString.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    func get<T: Decodable>(_ path: String, queryItems: [URLQueryItem] = []) async throws -> T {
        try await request(path, method: "GET", queryItems: queryItems, body: Optional<Data>.none)
    }

    func post<T: Decodable, Body: Encodable>(_ path: String, body: Body) async throws -> T {
        let data = try encoder.encode(body)
        return try await request(path, method: "POST", body: data)
    }

    func delete<T: Decodable, Body: Encodable>(_ path: String, body: Body) async throws -> T {
        let data = try encoder.encode(body)
        return try await request(path, method: "DELETE", body: data)
    }

    func postEmpty<T: Decodable>(_ path: String) async throws -> T {
        try await request(path, method: "POST", body: Data("{}".utf8))
    }

    func cachedMobileFeed(allowExpired: Bool = false) async -> MobileFeedResponse? {
        guard let cacheNamespace else {
            return nil
        }

        guard let response = await responseCache.read(
            MobileFeedResponse.self,
            namespace: cacheNamespace,
            key: "feed",
            maxAge: feedDiskCacheMaxAge,
            allowExpired: allowExpired
        ) else {
            MediaPerformance.mark("feed_disk_cache_miss")
            return nil
        }

        MediaPerformance.mark(allowExpired ? "feed_disk_cache_restore" : "feed_disk_cache_hit")
        return response
    }

    func mobileFeed() async throws -> MobileFeedResponse {
        let response: MobileFeedResponse = try await postEmpty("/api/mobile/feed")
        await saveFeedToDisk(response)
        return response
    }

    func invalidateMobileFeedCache() {
        guard let cacheNamespace else {
            return
        }

        Task {
            await responseCache.remove(namespace: cacheNamespace, key: "feed")
        }
        MediaPerformance.mark("feed_disk_cache_clear")
    }

    func storyStack(storyId: String) async throws -> StoryStackResponse {
        if let cached = storyStackCache[storyId] {
            MediaPerformance.mark("story_stack_cache_hit id=\(storyId)")
            return cached
        }

        if let diskCached = await cachedStoryStack(storyId: storyId) {
            storyStackCache[storyId] = diskCached
            return diskCached
        }

        if let fetch = storyStackFetches[storyId] {
            MediaPerformance.mark("story_stack_fetch_join id=\(storyId)")
            return try await fetch.value
        }

        MediaPerformance.mark("story_stack_cache_miss id=\(storyId)")
        return try await fetchStoryStackFromNetwork(storyId: storyId)
    }

    func cachedStoryStackForDisplay(storyId: String) async -> StoryStackResponse? {
        if let cached = storyStackCache[storyId] {
            MediaPerformance.mark("story_stack_display_cache_hit id=\(storyId)")
            return cached
        }

        guard let diskCached = await cachedStoryStack(storyId: storyId) else {
            return nil
        }

        storyStackCache[storyId] = diskCached
        MediaPreheater.preheat(stack: diskCached.story)
        return diskCached
    }

    func prefetchStoryStacks(ids: [String], refresh: Bool = false, limit: Int = 6) {
        let resolvedLimit = min(limit, NetworkQualityMonitor.shared.stackPreheatLimit)
        var seen = Set<String>()
        let uniqueIds = ids
            .filter { !$0.isEmpty }
            .filter { seen.insert($0).inserted }
            .prefix(resolvedLimit)

        for id in uniqueIds {
            if storyStackFetches[id] != nil {
                continue
            }

            if !refresh, storyStackCache[id] != nil {
                continue
            }

            if refresh,
               let refreshedAt = storyStackRefreshedAt[id],
               Date().timeIntervalSince(refreshedAt) < storyStackRefreshCooldown {
                continue
            }

            storyStackFetches[id] = Task { @MainActor [weak self] in
                guard let self else {
                    throw APIClientError.invalidResponse
                }

                let startedAt = Date()
                MediaPerformance.mark("story_stack_prefetch_start id=\(id)")
                defer {
                    MediaPerformance.measure("story_stack_prefetch_end id=\(id)", since: startedAt)
                    self.storyStackFetches[id] = nil
                }

                return try await self.fetchStoryStackFromNetwork(storyId: id)
            }
        }
    }

    func restoreCachedStoryStacks(ids: [String], limit: Int = 6) async -> Int {
        let resolvedLimit = min(limit, NetworkQualityMonitor.shared.stackPreheatLimit)
        var seen = Set<String>()
        let uniqueIds = ids
            .filter { !$0.isEmpty }
            .filter { seen.insert($0).inserted }
            .prefix(resolvedLimit)
        var restoredCount = 0

        for id in uniqueIds where storyStackCache[id] == nil {
            if let cached = await cachedStoryStack(storyId: id) {
                storyStackCache[id] = cached
                MediaPreheater.preheat(stack: cached.story)
                restoredCount += 1
            }
        }

        if restoredCount > 0 {
            MediaPerformance.mark("story_stack_disk_restore count=\(restoredCount)")
        }

        return restoredCount
    }

    func invalidateStoryStacks(ids: [String] = []) {
        if ids.isEmpty {
            storyStackCache.removeAll()
            storyStackFetches.removeAll()
            storyStackRefreshedAt.removeAll()
            if let cacheNamespace {
                Task {
                    await responseCache.removeNamespace(cacheNamespace)
                }
            }
            MediaPerformance.mark("story_stack_cache_clear all")
            return
        }

        ids.forEach { id in
            storyStackCache.removeValue(forKey: id)
            storyStackFetches.removeValue(forKey: id)
            storyStackRefreshedAt.removeValue(forKey: id)
            if let cacheNamespace {
                Task {
                    await responseCache.remove(namespace: cacheNamespace, key: storyStackCacheKey(id))
                }
            }
            MediaPerformance.mark("story_stack_cache_clear id=\(id)")
        }
    }

    func clearCurrentUserMediaCache() {
        guard let cacheNamespace else {
            return
        }

        storyStackCache.removeAll()
        storyStackFetches.removeAll()
        storyStackRefreshedAt.removeAll()
        Task {
            await responseCache.removeNamespace(cacheNamespace)
        }
        MediaPerformance.mark("media_disk_cache_clear current_user")
    }

    func registerAPNsDeviceToken(_ token: String, environment: String) async throws {
        struct Body: Encodable {
            let apnsDeviceToken: String
            let apnsEnvironment: String
            let platform: String
        }

        let _: BasicOkResponse = try await post(
            "/api/mobile/push-tokens",
            body: Body(
                apnsDeviceToken: token,
                apnsEnvironment: environment,
                platform: "ios"
            )
        )
    }

    func uploadImageStory(
        image: UIImage,
        caption: String,
        brandTags: String,
        textOverlay: String,
        textOverlayPositionX: Double,
        textOverlayPositionY: Double,
        linkLabel: String,
        linkUrl: String,
        linkOverlayPositionX: Double,
        linkOverlayPositionY: Double
    ) async throws -> StoryUploadResponse {
        guard let imageData = image.jpegData(compressionQuality: 0.88) else {
            throw APIClientError.invalidResponse
        }

        let boundary = "Boundary-\(UUID().uuidString)"
        var body = Data()
        appendField("caption", caption, boundary: boundary, to: &body)
        appendField("brandTags", brandTags, boundary: boundary, to: &body)
        appendField("stickers", "", boundary: boundary, to: &body)
        appendField("textOverlays", textOverlay, boundary: boundary, to: &body)
        appendField("textOverlayPositionX", String(format: "%.2f", textOverlayPositionX), boundary: boundary, to: &body)
        appendField("textOverlayPositionY", String(format: "%.2f", textOverlayPositionY), boundary: boundary, to: &body)
        appendField("linkLabel", linkLabel, boundary: boundary, to: &body)
        appendField("linkUrl", linkUrl, boundary: boundary, to: &body)
        appendField("linkOverlayPositionX", String(format: "%.2f", linkOverlayPositionX), boundary: boundary, to: &body)
        appendField("linkOverlayPositionY", String(format: "%.2f", linkOverlayPositionY), boundary: boundary, to: &body)
        appendFile(
            fieldName: "media",
            fileName: "story.jpg",
            mimeType: "image/jpeg",
            data: imageData,
            boundary: boundary,
            to: &body
        )
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        var request = try makeRequest(path: "/api/mobile/stories", method: "POST")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        return try await send(request)
    }

    func uploadAvatar(image: UIImage) async throws -> AvatarUploadResponse {
        guard let imageData = image.jpegData(compressionQuality: 0.9) else {
            throw APIClientError.invalidResponse
        }

        let boundary = "Boundary-\(UUID().uuidString)"
        var body = Data()
        appendFile(
            fieldName: "avatar",
            fileName: "avatar.jpg",
            mimeType: "image/jpeg",
            data: imageData,
            boundary: boundary,
            to: &body
        )
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        var request = try makeRequest(path: "/api/mobile/account/avatar", method: "POST")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        return try await send(request)
    }

    func getAvatarSource() async throws -> AvatarSourceResponse {
        try await get("/api/mobile/account/avatar/source")
    }

    func repositionAvatar(crop: AvatarCrop) async throws -> AvatarUploadResponse {
        struct Body: Encodable {
            let crop: AvatarCrop
        }

        return try await post(
            "/api/mobile/account/avatar/reposition",
            body: Body(crop: crop)
        )
    }

    func sendStoryReply(storyId: String, body: String?, reaction: String?) async throws -> StoryInteractionResponse {
        struct Payload: Encodable {
            let kind: String
            let body: String?
            let reaction: String?
        }

        return try await post(
            "/api/mobile/stories/\(storyId)/interactions",
            body: Payload(kind: reaction == nil ? "reply" : "reaction", body: body, reaction: reaction)
        )
    }

    func recordStoryImpression(storyId: String, viewedMs: Int, completed: Bool) async throws {
        struct Payload: Encodable {
            let viewedMs: Int
            let completed: Bool
        }

        let _: StoryImpressionResponse = try await post(
            "/api/mobile/stories/\(storyId)/impressions",
            body: Payload(viewedMs: viewedMs, completed: completed)
        )
    }

    func submitReport(targetKind: String, targetId: String, reason: String, details: String?) async throws -> SafetyReportResponse {
        struct Payload: Encodable {
            let targetKind: String
            let targetId: String
            let reason: String
            let details: String?
        }

        return try await post(
            "/api/mobile/reports",
            body: Payload(targetKind: targetKind, targetId: targetId, reason: reason, details: details)
        )
    }

    func blockUser(userId: String, reason: String?) async throws {
        struct Payload: Encodable {
            let userId: String
            let reason: String?
        }

        let _: BasicOkResponse = try await post("/api/mobile/blocks", body: Payload(userId: userId, reason: reason))
    }

    func listBlockedProfiles() async throws -> BlockedProfilesResponse {
        try await get("/api/mobile/blocks")
    }

    func unblockUser(userId: String) async throws {
        struct Payload: Encodable {
            let userId: String
        }

        let _: BasicOkResponse = try await delete("/api/mobile/blocks", body: Payload(userId: userId))
    }

    func deleteAccount() async throws {
        struct Empty: Encodable {}
        let _: BasicOkResponse = try await delete("/api/mobile/account", body: Empty())
    }

    func prepareVideoUpload(fileName: String, byteSize: Int64?, maxDurationSeconds: Int) async throws -> VideoUploadResponse {
        struct Body: Encodable {
            let fileName: String
            let byteSize: Int64?
            let maxDurationSeconds: Int
        }

        return try await post(
            "/api/mobile/stories/video-upload",
            body: Body(fileName: fileName, byteSize: byteSize, maxDurationSeconds: maxDurationSeconds)
        )
    }

    func prepareOriginalQualityVideoUpload(fileName: String, fileURL: URL) async throws -> OriginalVideoUploadResponse {
        struct Body: Encodable {
            let fileName: String
            let byteSize: Int64
            let contentType: String
        }

        let byteSize = try videoFileSize(fileURL)

        return try await post(
            "/api/mobile/stories/video-original-upload",
            body: Body(fileName: fileName, byteSize: byteSize, contentType: videoMimeType(for: fileURL))
        )
    }

    func uploadOriginalQualityVideoFile(fileURL: URL, upload: OriginalVideoUploadResponse) async throws -> OriginalVideoBlobUploadResult {
        let byteSize = try videoFileSize(fileURL)
        var request = URLRequest(url: upload.uploadUrl)
        request.httpMethod = "PUT"
        request.setValue("Bearer \(upload.clientToken)", forHTTPHeaderField: "Authorization")
        request.setValue("private", forHTTPHeaderField: "x-vercel-blob-access")
        request.setValue(upload.contentType, forHTTPHeaderField: "x-content-type")
        request.setValue(Self.vercelBlobApiVersion, forHTTPHeaderField: "x-api-version")
        request.setValue(blobRequestId(clientToken: upload.clientToken), forHTTPHeaderField: "x-api-blob-request-id")
        request.setValue("0", forHTTPHeaderField: "x-api-blob-request-attempt")
        request.setValue(String(byteSize), forHTTPHeaderField: "x-content-length")

        let (data, response) = try await session.upload(for: request, fromFile: fileURL)
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            let envelope = try? decoder.decode(BlobUploadErrorEnvelope.self, from: data)
            let detail = envelope?.error?.message ?? envelope?.error?.code
            throw APIClientError.server(detail ?? "Original video upload failed.", statusCode)
        }

        return try decoder.decode(OriginalVideoBlobUploadResult.self, from: data)
    }

    func uploadOriginalQualityVideoThumbnail(data: Data, upload: OriginalVideoUploadResponse) async throws {
        guard data.count > 0, Int64(data.count) <= upload.maxThumbnailSizeBytes else {
            throw APIClientError.invalidResponse
        }

        var request = URLRequest(url: upload.thumbnailUploadUrl)
        request.httpMethod = "PUT"
        request.setValue("Bearer \(upload.thumbnailClientToken)", forHTTPHeaderField: "Authorization")
        request.setValue("private", forHTTPHeaderField: "x-vercel-blob-access")
        request.setValue(upload.thumbnailContentType, forHTTPHeaderField: "x-content-type")
        request.setValue(Self.vercelBlobApiVersion, forHTTPHeaderField: "x-api-version")
        request.setValue(blobRequestId(clientToken: upload.thumbnailClientToken), forHTTPHeaderField: "x-api-blob-request-id")
        request.setValue("0", forHTTPHeaderField: "x-api-blob-request-attempt")
        request.setValue(String(data.count), forHTTPHeaderField: "x-content-length")

        let (responseData, response) = try await session.upload(for: request, from: data)
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            let envelope = try? decoder.decode(BlobUploadErrorEnvelope.self, from: responseData)
            let detail = envelope?.error?.message ?? envelope?.error?.code
            throw APIClientError.server(detail ?? "Video thumbnail upload failed.", statusCode)
        }
    }

    func uploadVideoThumbnail(data: Data, upload: VideoUploadResponse) async throws {
        guard let thumbnailUploadUrl = upload.thumbnailUploadUrl,
              let thumbnailClientToken = upload.thumbnailClientToken,
              let thumbnailContentType = upload.thumbnailContentType,
              let maxThumbnailSizeBytes = upload.maxThumbnailSizeBytes,
              data.count > 0,
              Int64(data.count) <= maxThumbnailSizeBytes else {
            throw APIClientError.invalidResponse
        }

        var request = URLRequest(url: thumbnailUploadUrl)
        request.httpMethod = "PUT"
        request.setValue("Bearer \(thumbnailClientToken)", forHTTPHeaderField: "Authorization")
        request.setValue("private", forHTTPHeaderField: "x-vercel-blob-access")
        request.setValue(thumbnailContentType, forHTTPHeaderField: "x-content-type")
        request.setValue(Self.vercelBlobApiVersion, forHTTPHeaderField: "x-api-version")
        request.setValue(blobRequestId(clientToken: thumbnailClientToken), forHTTPHeaderField: "x-api-blob-request-id")
        request.setValue("0", forHTTPHeaderField: "x-api-blob-request-attempt")
        request.setValue(String(data.count), forHTTPHeaderField: "x-content-length")

        let (responseData, response) = try await session.upload(for: request, from: data)
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            let envelope = try? decoder.decode(BlobUploadErrorEnvelope.self, from: responseData)
            let detail = envelope?.error?.message ?? envelope?.error?.code
            throw APIClientError.server(detail ?? "Video thumbnail upload failed.", statusCode)
        }
    }

    func uploadVideoFile(fileURL: URL, upload: VideoUploadResponse) async throws {
        if upload.uploadProtocol == "tus" {
            var request = URLRequest(url: upload.uploadUrl)
            request.httpMethod = "PATCH"
            request.setValue("1.0.0", forHTTPHeaderField: "Tus-Resumable")
            request.setValue("0", forHTTPHeaderField: "Upload-Offset")
            request.setValue("application/offset+octet-stream", forHTTPHeaderField: "Content-Type")
            let (_, response) = try await session.upload(for: request, fromFile: fileURL)
            guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
                throw APIClientError.server("Video upload failed.", (response as? HTTPURLResponse)?.statusCode ?? 0)
            }
            return
        }

        let boundary = "Boundary-\(UUID().uuidString)"
        var body = Data()
        let videoData = try Data(contentsOf: fileURL)
        appendFile(
            fieldName: "file",
            fileName: fileURL.lastPathComponent.isEmpty ? "story-video.mp4" : fileURL.lastPathComponent,
            mimeType: videoMimeType(for: fileURL),
            data: videoData,
            boundary: boundary,
            to: &body
        )
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        var request = URLRequest(url: upload.uploadUrl)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
            throw APIClientError.server("Video upload failed.", (response as? HTTPURLResponse)?.statusCode ?? 0)
        }
    }

    func completeOriginalQualityVideoStory(
        upload: OriginalVideoUploadResponse,
        fileURL: URL,
        caption: String,
        brandTags: String,
        textOverlay: String,
        textOverlayPositionX: Double,
        textOverlayPositionY: Double,
        linkLabel: String,
        linkUrl: String,
        linkOverlayPositionX: Double,
        linkOverlayPositionY: Double,
        durationMs: Int?,
        thumbnailData: Data?
    ) async throws -> StoryUploadResponse {
        struct Body: Encodable {
            let pathname: String
            let contentType: String
            let byteSize: Int64
            let checksum: String
            let thumbnailPathname: String?
            let thumbnailContentType: String?
            let thumbnailByteSize: Int?
            let thumbnailChecksum: String?
            let durationMs: Int?
            let caption: String
            let brandTags: String
            let stickers: String
            let textOverlays: String
            let textOverlayPositionX: String
            let textOverlayPositionY: String
            let linkLabel: String
            let linkUrl: String
            let linkOverlayPositionX: String
            let linkOverlayPositionY: String
        }

        let byteSize = try videoFileSize(fileURL)

        return try await post(
            "/api/mobile/stories/video-original-complete",
            body: Body(
                pathname: upload.pathname,
                contentType: videoMimeType(for: fileURL),
                byteSize: byteSize,
                checksum: try fileSHA256Hex(fileURL),
                thumbnailPathname: thumbnailData == nil ? nil : upload.thumbnailPathname,
                thumbnailContentType: thumbnailData == nil ? nil : upload.thumbnailContentType,
                thumbnailByteSize: thumbnailData?.count,
                thumbnailChecksum: thumbnailData.map(dataSHA256Hex),
                durationMs: durationMs,
                caption: caption,
                brandTags: brandTags,
                stickers: "",
                textOverlays: textOverlay,
                textOverlayPositionX: String(format: "%.2f", textOverlayPositionX),
                textOverlayPositionY: String(format: "%.2f", textOverlayPositionY),
                linkLabel: linkLabel,
                linkUrl: linkUrl,
                linkOverlayPositionX: String(format: "%.2f", linkOverlayPositionX),
                linkOverlayPositionY: String(format: "%.2f", linkOverlayPositionY)
            )
        )
    }

    func completeVideoStory(
        upload: VideoUploadResponse,
        fileURL: URL,
        caption: String,
        brandTags: String,
        textOverlay: String,
        textOverlayPositionX: Double,
        textOverlayPositionY: Double,
        linkLabel: String,
        linkUrl: String,
        linkOverlayPositionX: Double,
        linkOverlayPositionY: Double,
        durationMs: Int?,
        thumbnailData: Data?
    ) async throws -> StoryUploadResponse {
        struct Body: Encodable {
            let uid: String
            let contentType: String
            let byteSize: Int64
            let durationMs: Int?
            let thumbnailPathname: String?
            let thumbnailContentType: String?
            let thumbnailByteSize: Int?
            let thumbnailChecksum: String?
            let caption: String
            let brandTags: String
            let stickers: String
            let textOverlays: String
            let textOverlayPositionX: String
            let textOverlayPositionY: String
            let linkLabel: String
            let linkUrl: String
            let linkOverlayPositionX: String
            let linkOverlayPositionY: String
        }

        let byteSize = try videoFileSize(fileURL)
        return try await post(
            "/api/mobile/stories/video-complete",
            body: Body(
                uid: upload.uid,
                contentType: videoMimeType(for: fileURL),
                byteSize: byteSize,
                durationMs: durationMs,
                thumbnailPathname: thumbnailData == nil ? nil : upload.thumbnailPathname,
                thumbnailContentType: thumbnailData == nil ? nil : upload.thumbnailContentType,
                thumbnailByteSize: thumbnailData?.count,
                thumbnailChecksum: thumbnailData.map(dataSHA256Hex),
                caption: caption,
                brandTags: brandTags,
                stickers: "",
                textOverlays: textOverlay,
                textOverlayPositionX: String(format: "%.2f", textOverlayPositionX),
                textOverlayPositionY: String(format: "%.2f", textOverlayPositionY),
                linkLabel: linkLabel,
                linkUrl: linkUrl,
                linkOverlayPositionX: String(format: "%.2f", linkOverlayPositionX),
                linkOverlayPositionY: String(format: "%.2f", linkOverlayPositionY)
            )
        )
    }

    private func videoMimeType(for fileURL: URL) -> String {
        switch fileURL.pathExtension.lowercased() {
        case "mov", "qt":
            return "video/quicktime"
        case "m4v":
            return "video/x-m4v"
        case "mp4":
            return "video/mp4"
        default:
            return "video/mp4"
        }
    }

    private func fileSHA256Hex(_ fileURL: URL) throws -> String {
        let data = try Data(contentsOf: fileURL)
        return dataSHA256Hex(data)
    }

    private func dataSHA256Hex(_ data: Data) -> String {
        let digest = SHA256.hash(data: data)

        return digest.map { String(format: "%02x", $0) }.joined()
    }

    private func videoFileSize(_ fileURL: URL) throws -> Int64 {
        guard let size = try FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? NSNumber,
              size.int64Value > 0 else {
            throw APIClientError.invalidResponse
        }

        return size.int64Value
    }

    private func blobRequestId(clientToken: String) -> String {
        let segments = clientToken.split(separator: "_")
        let storeId = segments.count > 3 ? String(segments[3]) : "ios"
        let milliseconds = Int(Date().timeIntervalSince1970 * 1_000)
        let suffix = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()

        return "\(storeId):\(milliseconds):\(suffix)"
    }

    func waitForStoryLive(storyId: String) async -> Bool {
        for attempt in 0..<72 {
            let status: StoryStatusResponse? = try? await get("/api/mobile/stories/\(storyId)/status")
            if status?.story.isLive == true {
                return true
            }

            let delay: Duration = attempt < 24 ? .seconds(1) : .seconds(2.5)
            try? await Task.sleep(for: delay)
        }
        return false
    }

    private func fetchStoryStackFromNetwork(storyId: String) async throws -> StoryStackResponse {
        let startedAt = Date()
        let response: StoryStackResponse = try await get("/api/mobile/stories/\(storyId)")
        storyStackCache[storyId] = response
        storyStackRefreshedAt[storyId] = Date()
        await saveStoryStackToDisk(response, storyId: storyId)
        MediaPerformance.measure("story_stack_network id=\(storyId)", since: startedAt)
        return response
    }

    private func cachedStoryStack(storyId: String) async -> StoryStackResponse? {
        guard let cacheNamespace else {
            return nil
        }

        guard let response = await responseCache.read(
            StoryStackResponse.self,
            namespace: cacheNamespace,
            key: storyStackCacheKey(storyId),
            maxAge: storyStackDiskCacheMaxAge
        ) else {
            MediaPerformance.mark("story_stack_disk_cache_miss id=\(storyId)")
            return nil
        }

        MediaPerformance.mark("story_stack_disk_cache_hit id=\(storyId)")
        return response
    }

    private func saveFeedToDisk(_ response: MobileFeedResponse) async {
        guard let cacheNamespace else {
            return
        }

        await responseCache.write(response, namespace: cacheNamespace, key: "feed")
        MediaPerformance.mark("feed_disk_cache_write")
    }

    private func saveStoryStackToDisk(_ response: StoryStackResponse, storyId: String) async {
        guard let cacheNamespace else {
            return
        }

        await responseCache.write(response, namespace: cacheNamespace, key: storyStackCacheKey(storyId))
        MediaPerformance.mark("story_stack_disk_cache_write id=\(storyId)")
    }

    private func request<T: Decodable>(_ path: String, method: String, queryItems: [URLQueryItem] = [], body: Data?) async throws -> T {
        var request = try makeRequest(path: path, method: method, queryItems: queryItems)
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        return try await send(request)
    }

    private func makeRequest(path: String, method: String, queryItems: [URLQueryItem] = []) throws -> URLRequest {
        guard let baseURL else {
            throw APIClientError.invalidBaseURL
        }

        var components = URLComponents(url: baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))), resolvingAgainstBaseURL: false)
        components?.queryItems = queryItems.isEmpty ? nil : queryItems

        guard let url = components?.url else {
            throw APIClientError.invalidBaseURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(deviceId(), forHTTPHeaderField: "X-Device-Id")
        if let authToken {
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }

        if !(200..<300).contains(http.statusCode) {
            let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data)
            throw APIClientError.server(envelope?.error ?? "The server did not respond.", http.statusCode)
        }

        return try decoder.decode(T.self, from: data)
    }

    private func deviceId() -> String {
        if let stored = UserDefaults.standard.string(forKey: Self.deviceIdKey) {
            return stored
        }

        let next = "ios-\(UUID().uuidString.lowercased())"
        UserDefaults.standard.set(next, forKey: Self.deviceIdKey)
        return next
    }

    private func appendField(_ name: String, _ value: String, boundary: String, to body: inout Data) {
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".data(using: .utf8)!)
        body.append("\(value)\r\n".data(using: .utf8)!)
    }

    private func appendFile(fieldName: String, fileName: String, mimeType: String, data: Data, boundary: String, to body: inout Data) {
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"\(fieldName)\"; filename=\"\(fileName)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n".data(using: .utf8)!)
    }

    private static func usableBaseURL(from storedBaseURL: String?) -> String {
        let trimmed = storedBaseURL?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let lowercased = trimmed.lowercased()

        if trimmed.isEmpty ||
            lowercased == "http://127.0.0.1:3000" ||
            lowercased == "http://localhost:3000" {
            return productionBaseURL
        }

        return trimmed
    }

    private var cacheNamespace: String? {
        guard let authToken, !authToken.isEmpty else {
            return nil
        }

        let seed = "\(baseURLString)|\(authToken)"
        let digest = SHA256.hash(data: Data(seed.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    private func storyStackCacheKey(_ storyId: String) -> String {
        "story-stack-\(storyId)"
    }
}

private struct DiskCacheEnvelope<Value: Codable>: Codable {
    let cachedAt: Date
    let value: Value
}

private actor MobileResponseDiskCache {
    private let rootURL: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private let fileManager = FileManager.default

    init() {
        rootURL = fileManager
            .urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("UBEYE", isDirectory: true)
            .appendingPathComponent("response-cache", isDirectory: true)

        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601

        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
    }

    func read<Value: Codable>(
        _ type: Value.Type,
        namespace: String,
        key: String,
        maxAge: TimeInterval,
        allowExpired: Bool = false
    ) -> Value? {
        let url = fileURL(namespace: namespace, key: key)

        do {
            let data = try Data(contentsOf: url)
            let envelope = try decoder.decode(DiskCacheEnvelope<Value>.self, from: data)
            guard allowExpired || Date().timeIntervalSince(envelope.cachedAt) <= maxAge else {
                try? fileManager.removeItem(at: url)
                return nil
            }
            return envelope.value
        } catch {
            return nil
        }
    }

    func write<Value: Codable>(_ value: Value, namespace: String, key: String) {
        let url = fileURL(namespace: namespace, key: key)

        do {
            try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let data = try encoder.encode(DiskCacheEnvelope(cachedAt: Date(), value: value))
            try data.write(to: url, options: .atomic)
        } catch {
            MediaPerformance.mark("media_disk_cache_write_failed key=\(key)")
        }
    }

    func remove(namespace: String, key: String) {
        try? fileManager.removeItem(at: fileURL(namespace: namespace, key: key))
    }

    func removeNamespace(_ namespace: String) {
        try? fileManager.removeItem(at: rootURL.appendingPathComponent(sanitized(namespace), isDirectory: true))
    }

    private func fileURL(namespace: String, key: String) -> URL {
        rootURL
            .appendingPathComponent(sanitized(namespace), isDirectory: true)
            .appendingPathComponent("\(sanitized(key)).json", isDirectory: false)
    }

    private func sanitized(_ value: String) -> String {
        value.unicodeScalars.map { scalar in
            CharacterSet.alphanumerics.contains(scalar) ? String(scalar) : "-"
        }
        .joined()
    }
}
