import CryptoKit
import Foundation
import ImageIO
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

    var statusCode: Int? {
        switch self {
        case .server(_, let statusCode):
            return statusCode
        default:
            return nil
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

private struct BlobMultipartPart: Codable, Hashable {
    let partNumber: Int
    let etag: String
}

private struct BlobMultipartUploadState: Codable {
    let pathname: String
    let sourceByteSize: Int64
    let uploadId: String
    let key: String
    var completedParts: [BlobMultipartPart]
}

private struct BlobMultipartCreateResponse: Decodable {
    let uploadId: String
    let key: String
}

private struct BlobMultipartPartResponse: Decodable {
    let etag: String
}

private struct BlobMultipartCompleteResponse: Decodable {}

@MainActor
final class APIClient: ObservableObject {
    typealias TusChunkUploader = (URLRequest, URL) async throws -> (Data, URLResponse)

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
    private static let mediaPipelineVersion = "hls-v2"
    private static let largeVideoUploadTimeout: TimeInterval = 10 * 60
    private static let blobMultipartThresholdBytes: Int64 = 16 * 1024 * 1024
    private static let blobMultipartPartBytes: Int64 = 8 * 1024 * 1024
    private static let blobMultipartConcurrency = 2
    private let session: URLSession
    private let tusChunkUploader: TusChunkUploader
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder
    private let responseCache = MobileResponseDiskCache()
    private var storyStackCache: [String: StoryStackResponse] = [:]
    private var storyStackFetches: [String: Task<StoryStackResponse, Error>] = [:]
    private var storyStackRefreshedAt: [String: Date] = [:]
    private let feedDiskCacheMaxAge: TimeInterval = 30 * 60
    private let storyStackDiskCacheMaxAge: TimeInterval = 30 * 60
    private let storyStackRefreshCooldown: TimeInterval = 60
    private let mediaConfigRefreshCooldown: TimeInterval = 5 * 60
    private var mediaConfigRefreshedAt: Date?

    init(
        session: URLSession = .shared,
        tusChunkUploader: TusChunkUploader? = nil
    ) {
        MediaPreheater.configureURLCache()
        self.session = session
        self.tusChunkUploader = tusChunkUploader ?? { request, bodyFileURL in
            try await BackgroundTusUploadTransport.shared.upload(
                request: request,
                bodyFileURL: bodyFileURL
            )
        }
        #if DEBUG
        let storedBaseURL = UserDefaults.standard.string(forKey: Self.baseURLKey)
        baseURLString = Self.usableBaseURL(from: storedBaseURL)
        #else
        UserDefaults.standard.removeObject(forKey: Self.baseURLKey)
        baseURLString = Self.productionBaseURL
        #endif
        decoder = JSONDecoder()
        encoder = JSONEncoder()
        MediaPerformance.configureUpload { [weak self] events in
            guard let self else {
                return
            }

            try await self.uploadPerformanceEvents(events)
        }
    }

    var baseURL: URL? {
        #if DEBUG
        URL(string: baseURLString.trimmingCharacters(in: .whitespacesAndNewlines))
        #else
        URL(string: Self.productionBaseURL)
        #endif
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

    func deleteEmpty<T: Decodable>(_ path: String) async throws -> T {
        try await request(path, method: "DELETE", body: Optional<Data>.none)
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
        cacheInitialStoryStacks(response.initialStoryStacks, source: allowExpired ? "feed_disk_restore" : "feed_disk")
        return response
    }

    func mobileFeed(cursor: String? = nil, limit: Int = 20) async throws -> MobileFeedResponse {
        Task { @MainActor [weak self] in
            await self?.refreshMediaConfigIfNeeded()
        }

        var queryItems = [URLQueryItem(name: "limit", value: String(min(max(limit, 1), 50)))]
        if let cursor, !cursor.isEmpty {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }
        let response: MobileFeedResponse = try await get(
            "/api/mobile/feed",
            queryItems: queryItems
        )
        cacheInitialStoryStacks(response.initialStoryStacks, source: "feed_network")

        Task { @MainActor [weak self] in
            guard let self else {
                return
            }

            if cursor == nil {
                await saveFeedToDisk(response)
                await saveInitialStoryStacksToDisk(response.initialStoryStacks)
            }
        }

        return response
    }

    func refreshMediaConfigIfNeeded(force: Bool = false) async {
        if !force,
           let mediaConfigRefreshedAt,
           Date().timeIntervalSince(mediaConfigRefreshedAt) < mediaConfigRefreshCooldown {
            return
        }

        do {
            let response: MobileMediaConfigResponse = try await get("/api/mobile/media-config")
            MediaControlConfig.shared.apply(response.media)
            mediaConfigRefreshedAt = Date()
        } catch {
            mediaConfigRefreshedAt = Date()
        }
    }

    func deleteStoryInteraction(id: String) async throws {
        let _: BasicOkResponse = try await deleteEmpty("/api/mobile/stories/interactions/\(id)")
    }

    func storyViewers(
        storyId: String,
        cursor: String? = nil,
        limit: Int = 50
    ) async throws -> StoryViewersResponse {
        var queryItems = [
            URLQueryItem(
                name: "limit",
                value: String(min(max(limit, 1), 100))
            ),
        ]
        if let cursor, !cursor.isEmpty {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }

        return try await get(
            "/api/mobile/stories/\(storyId)/viewers",
            queryItems: queryItems
        )
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

    func storyStack(storyId: String, refresh: Bool = false) async throws -> StoryStackResponse {
        if !refresh, let cached = storyStackCache[storyId] {
            MediaPerformance.mark("story_stack_cache_hit id=\(storyId)")
            return cached
        }

        if !refresh, let diskCached = await cachedStoryStack(storyId: storyId) {
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
        MediaPreheater.preheat(stack: diskCached.story, preheatVideoAssets: false)
        return diskCached
    }

    func warmStoryOpening(storyId: String, adjacentIds: [String] = []) {
        var seen = Set<String>()
        let ids = ([storyId] + adjacentIds)
            .filter { !$0.isEmpty }
            .filter { seen.insert($0).inserted }

        guard !ids.isEmpty else {
            return
        }

        Task { @MainActor [weak self] in
            guard let self else {
                return
            }

            let restoredCount = await self.restoreCachedStoryStacks(ids: ids, limit: 4)
            MediaPerformance.mark("story_open_warm id=\(storyId) restored=\(restoredCount) candidates=\(ids.count)")
            self.prefetchStoryStacks(ids: ids, refresh: false, limit: 4)
        }
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

                let prefetchInterval = MediaPerformance.beginInterval("story_stack_prefetch_end id=\(id)")
                MediaPerformance.mark("story_stack_prefetch_start id=\(id)")
                defer {
                    MediaPerformance.endInterval(prefetchInterval, event: "story_stack_prefetch_end id=\(id)")
                    self.storyStackFetches[id] = nil
                }

                let response = try await self.fetchStoryStackFromNetwork(storyId: id)
                MediaPreheater.preheat(stack: response.story, preheatVideoAssets: false)
                return response
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
                MediaPreheater.preheat(stack: cached.story, preheatVideoAssets: false)
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

    func notificationPreferences() async throws -> NotificationPreferencesResponse {
        try await get("/api/mobile/notification-preferences")
    }

    func updateNotificationPreferences(_ preferences: [NotificationPreference]) async throws -> NotificationPreferencesResponse {
        struct PreferenceUpdate: Encodable {
            let type: NotificationPreferenceType
            let enabled: Bool
        }

        struct Body: Encodable {
            let preferences: [PreferenceUpdate]
        }

        return try await post(
            "/api/mobile/notification-preferences",
            body: Body(
                preferences: preferences.map { preference in
                    PreferenceUpdate(type: preference.type, enabled: preference.enabled)
                }
            )
        )
    }

    func dailyStatus() async throws -> DailyStatusResponse {
        try await get("/api/mobile/daily")
    }

    func startDaily() async throws -> DailyStatusResponse {
        struct Body: Encodable {
            let eligibilityAccepted: Bool
        }

        return try await post(
            "/api/mobile/daily/start",
            body: Body(eligibilityAccepted: true)
        )
    }

    func recordDailyProgress(
        sessionId: String,
        position: Int,
        positionMs: Int,
        durationMs: Int?,
        event: String
    ) async throws -> DailyStatusResponse {
        struct Body: Encodable {
            let sessionId: String
            let position: Int
            let positionMs: Int
            let durationMs: Int?
            let event: String
        }

        return try await post(
            "/api/mobile/daily/progress",
            body: Body(
                sessionId: sessionId,
                position: position,
                positionMs: positionMs,
                durationMs: durationMs,
                event: event
            )
        )
    }

    func recordDailyClick(
        sessionId: String,
        position: Int,
        positionMs: Int
    ) async throws -> DailyClickResponse {
        struct Body: Encodable {
            let sessionId: String
            let position: Int
            let positionMs: Int
        }

        return try await post(
            "/api/mobile/daily/click",
            body: Body(
                sessionId: sessionId,
                position: position,
                positionMs: positionMs
            )
        )
    }

    func uploadImageStory(
        upload: StoryImageUpload,
        caption: String,
        brandTags: String,
        textOverlay: String,
        textOverlayPositionX: Double,
        textOverlayPositionY: Double,
        linkLabel: String,
        linkUrl: String,
        linkOverlayPositionX: Double,
        linkOverlayPositionY: Double,
        quoteReplyId: String,
        quoteReplyPositionX: Double,
        quoteReplyPositionY: Double
    ) async throws -> StoryUploadResponse {
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
        appendField("quoteReplyId", quoteReplyId, boundary: boundary, to: &body)
        appendField("quoteReplyPositionX", String(format: "%.2f", quoteReplyPositionX), boundary: boundary, to: &body)
        appendField("quoteReplyPositionY", String(format: "%.2f", quoteReplyPositionY), boundary: boundary, to: &body)
        appendFile(
            fieldName: "media",
            fileName: upload.fileName,
            mimeType: upload.mimeType,
            data: upload.data,
            boundary: boundary,
            to: &body
        )
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        var request = try makeRequest(path: "/api/mobile/stories", method: "POST")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        return try await send(request)
    }

    func prepareImageStoryUpload(fileName: String, contentType: String, byteSize: Int64, displayContentType: String) async throws -> ImageUploadResponse {
        struct Body: Encodable {
            let fileName: String
            let contentType: String
            let byteSize: Int64
            let displayContentType: String
        }

        return try await post(
            "/api/mobile/stories/image-upload",
            body: Body(fileName: fileName, contentType: contentType, byteSize: byteSize, displayContentType: displayContentType)
        )
    }

    @discardableResult
    func uploadImageData(_ data: Data, part: ImageUploadPart) async throws -> BlobUploadResult {
        var request = URLRequest(url: part.uploadUrl)
        request.httpMethod = "PUT"
        request.setValue("Bearer \(part.clientToken)", forHTTPHeaderField: "Authorization")
        request.setValue(part.access ?? "private", forHTTPHeaderField: "x-vercel-blob-access")
        request.setValue(part.contentType, forHTTPHeaderField: "x-content-type")
        request.setValue(Self.vercelBlobApiVersion, forHTTPHeaderField: "x-api-version")
        request.setValue(blobRequestId(clientToken: part.clientToken), forHTTPHeaderField: "x-api-blob-request-id")
        request.setValue("0", forHTTPHeaderField: "x-api-blob-request-attempt")
        request.setValue(String(data.count), forHTTPHeaderField: "x-content-length")

        let (responseData, response) = try await session.upload(for: request, from: data)
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            let envelope = try? decoder.decode(BlobUploadErrorEnvelope.self, from: responseData)
            let detail = envelope?.error?.message ?? envelope?.error?.code
            throw APIClientError.server(detail ?? "Image derivative upload failed.", statusCode)
        }

        return try decoder.decode(BlobUploadResult.self, from: responseData)
    }

    func completeImageStory(
        upload: ImageUploadResponse,
        displayDerivative: PreparedImageDerivativeUpload,
        thumbnailDerivative: PreparedImageDerivativeUpload,
        thumbHash: String,
        caption: String,
        brandTags: String,
        textOverlay: String,
        textOverlayPositionX: Double,
        textOverlayPositionY: Double,
        linkLabel: String,
        linkUrl: String,
        linkOverlayPositionX: Double,
        linkOverlayPositionY: Double,
        quoteReplyId: String,
        quoteReplyPositionX: Double,
        quoteReplyPositionY: Double
    ) async throws -> StoryUploadResponse {
        struct Body: Encodable {
            let basePathname: String
            let displayDerivative: PreparedImageDerivativeUpload
            let thumbnailDerivative: PreparedImageDerivativeUpload
            let thumbHash: String
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
            let quoteReplyId: String
            let quoteReplyPositionX: String
            let quoteReplyPositionY: String
        }

        return try await post(
            "/api/mobile/stories/image-complete",
            body: Body(
                basePathname: upload.basePathname,
                displayDerivative: displayDerivative,
                thumbnailDerivative: thumbnailDerivative,
                thumbHash: thumbHash,
                caption: caption,
                brandTags: brandTags,
                stickers: "",
                textOverlays: textOverlay,
                textOverlayPositionX: String(format: "%.2f", textOverlayPositionX),
                textOverlayPositionY: String(format: "%.2f", textOverlayPositionY),
                linkLabel: linkLabel,
                linkUrl: linkUrl,
                linkOverlayPositionX: String(format: "%.2f", linkOverlayPositionX),
                linkOverlayPositionY: String(format: "%.2f", linkOverlayPositionY),
                quoteReplyId: quoteReplyId,
                quoteReplyPositionX: String(format: "%.2f", quoteReplyPositionX),
                quoteReplyPositionY: String(format: "%.2f", quoteReplyPositionY)
            )
        )
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

    func uploadPerformanceEvents(_ events: [MobilePerformanceEventUpload]) async throws {
        struct Payload: Encodable {
            let events: [MobilePerformanceEventUpload]
        }

        guard !events.isEmpty else {
            return
        }
        guard authToken != nil else {
            throw APIClientError.missingAuth
        }

        let _: BasicOkResponse = try await post(
            "/api/mobile/performance-events",
            body: Payload(events: events)
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

    func prepareVideoUpload(
        fileName: String,
        byteSize: Int64,
        maxDurationSeconds: Int,
        clientUploadId: String? = nil,
        replaceUploadSessionId: String? = nil
    ) async throws -> VideoUploadResponse {
        struct Body: Encodable {
            let fileName: String
            let contentType: String
            let byteSize: Int64
            let maxDurationSeconds: Int
            let clientUploadId: String?
            let replaceUploadSessionId: String?
        }

        return try await post(
            "/api/mobile/stories/video-upload",
            body: Body(
                fileName: fileName,
                contentType: videoMimeType(forPathExtension: (fileName as NSString).pathExtension),
                byteSize: byteSize,
                maxDurationSeconds: maxDurationSeconds,
                clientUploadId: clientUploadId,
                replaceUploadSessionId: replaceUploadSessionId
            )
        )
    }

    func uploadVideoFile(
        fileURL: URL,
        upload: VideoUploadResponse,
        onRetry: ((String) -> Void)? = nil,
        maxChunkBytes: Int64 = 50 * 1024 * 1024,
        onProgress: ((Double) -> Void)? = nil
    ) async throws {
        if upload.uploadProtocol == "vercel-blob" {
            guard let source = upload.source else {
                throw APIClientError.server("The media service did not provide a private upload target.", 0)
            }
            try await uploadBlobVideoFile(
                fileURL: fileURL,
                source: source,
                onRetry: onRetry,
                onProgress: onProgress
            )
            return
        }

        guard upload.uploadProtocol == "tus" else {
            throw APIClientError.server("The media service did not provide a supported upload.", 0)
        }

        try await uploadTusVideoFile(
            fileURL: fileURL,
            uploadURL: upload.uploadUrl,
            onRetry: onRetry,
            maxChunkBytes: maxChunkBytes,
            onProgress: onProgress
        )
    }

    private func uploadBlobVideoFile(
        fileURL: URL,
        source: ImageUploadPart,
        onRetry: ((String) -> Void)?,
        onProgress: ((Double) -> Void)?
    ) async throws {
        let byteSize = try await StoryUploadFileIO.fileSize(at: fileURL)
        guard byteSize > 0, byteSize <= source.maxSizeBytes else {
            throw APIClientError.server("The prepared video does not match the upload target.", 0)
        }

        if byteSize >= Self.blobMultipartThresholdBytes {
            try await uploadBlobVideoFileMultipart(
                fileURL: fileURL,
                byteSize: byteSize,
                source: source,
                onRetry: onRetry,
                onProgress: onProgress
            )
            return
        }

        var lastError: Error?
        onProgress?(0)
        for attempt in 1...4 {
            try Task.checkCancellation()
            do {
                var request = URLRequest(url: source.uploadUrl)
                request.httpMethod = "PUT"
                request.timeoutInterval = Self.largeVideoUploadTimeout
                request.setValue("Bearer \(source.clientToken)", forHTTPHeaderField: "Authorization")
                request.setValue(source.access ?? "private", forHTTPHeaderField: "x-vercel-blob-access")
                request.setValue(source.contentType, forHTTPHeaderField: "x-content-type")
                request.setValue(Self.vercelBlobApiVersion, forHTTPHeaderField: "x-api-version")
                request.setValue(blobRequestId(clientToken: source.clientToken), forHTTPHeaderField: "x-api-blob-request-id")
                request.setValue(String(attempt - 1), forHTTPHeaderField: "x-api-blob-request-attempt")
                request.setValue(String(byteSize), forHTTPHeaderField: "x-content-length")

                // Background upload transport owns and removes its body file when
                // the request completes. Give it a disposable path so the pending
                // story's only durable source remains available for completion and
                // for any subsequent retry.
                let stagedFileURL = try await Self.stageBlobUploadFile(fileURL)
                defer { try? FileManager.default.removeItem(at: stagedFileURL) }
                let (data, response) = try await tusChunkUploader(request, stagedFileURL)
                guard let http = response as? HTTPURLResponse,
                      200..<300 ~= http.statusCode else {
                    throw uploadError(data: data, response: response)
                }
                onProgress?(1)
                return
            } catch {
                lastError = error
                guard attempt < 4 else { break }
                onRetry?("blob_attempt_\(attempt)")
                try await Task.sleep(for: .milliseconds(700 * attempt))
            }
        }

        throw lastError ?? APIClientError.server("Video upload failed.", 0)
    }

    private func uploadBlobVideoFileMultipart(
        fileURL: URL,
        byteSize: Int64,
        source: ImageUploadPart,
        onRetry: ((String) -> Void)?,
        onProgress: ((Double) -> Void)?
    ) async throws {
        var state: BlobMultipartUploadState
        if let persistedState = try await Self.loadBlobMultipartState(
            pathname: source.pathname,
            sourceByteSize: byteSize
        ) {
            state = persistedState
        } else {
            state = try await createBlobMultipartUploadState(
                pathname: source.pathname,
                sourceByteSize: byteSize,
                source: source
            )
        }
        try await Self.saveBlobMultipartState(state)

        let partCount = Int((byteSize + Self.blobMultipartPartBytes - 1) / Self.blobMultipartPartBytes)
        var completedParts = Dictionary(
            uniqueKeysWithValues: state.completedParts.map { ($0.partNumber, $0) }
        )
        let completedByteCount = completedParts.keys.reduce(Int64(0)) { total, partNumber in
            total + Self.blobMultipartByteCount(
                partNumber: partNumber,
                totalByteSize: byteSize
            )
        }
        var uploadedBytes = completedByteCount
        onProgress?(Double(uploadedBytes) / Double(byteSize))
        if uploadedBytes > 0 {
            onRetry?("blob_multipart_resume_\(completedParts.count)_of_\(partCount)")
        }

        let missingPartNumbers = (1...partCount).filter { completedParts[$0] == nil }
        for batchStart in stride(
            from: 0,
            to: missingPartNumbers.count,
            by: Self.blobMultipartConcurrency
        ) {
            try Task.checkCancellation()
            let batch = Array(
                missingPartNumbers[
                    batchStart..<min(
                        batchStart + Self.blobMultipartConcurrency,
                        missingPartNumbers.count
                    )
                ]
            )
            let batchState = state
            try await withThrowingTaskGroup(
                of: BlobMultipartPart.self
            ) { group in
                for partNumber in batch {
                    group.addTask { @MainActor in
                        try await self.uploadBlobMultipartPart(
                            fileURL: fileURL,
                            byteSize: byteSize,
                            source: source,
                            state: batchState,
                            partNumber: partNumber,
                            onRetry: onRetry
                        )
                    }
                }

                for try await part in group {
                    completedParts[part.partNumber] = part
                    uploadedBytes += Self.blobMultipartByteCount(
                        partNumber: part.partNumber,
                        totalByteSize: byteSize
                    )
                    // Commit each acknowledged part immediately. If its sibling
                    // fails or the app is terminated between responses, the next
                    // attempt resumes from the most precise durable checkpoint.
                    state.completedParts = completedParts.values.sorted {
                        $0.partNumber < $1.partNumber
                    }
                    try await Self.saveBlobMultipartState(state)
                    onProgress?(min(Double(uploadedBytes) / Double(byteSize), 0.99))
                }
            }
        }

        let orderedParts = completedParts.values.sorted {
            $0.partNumber < $1.partNumber
        }
        guard orderedParts.count == partCount else {
            throw APIClientError.server("The resumable video upload is incomplete.", 0)
        }

        try await completeBlobMultipartUpload(
            source: source,
            state: state,
            parts: orderedParts,
            onRetry: onRetry
        )
        await Self.removeBlobMultipartState(pathname: source.pathname)
        onProgress?(1)
    }

    private func createBlobMultipartUploadState(
        pathname: String,
        sourceByteSize: Int64,
        source: ImageUploadPart
    ) async throws -> BlobMultipartUploadState {
        var lastError: Error?
        for attempt in 1...4 {
            do {
                var request = blobMultipartRequest(
                    source: source,
                    action: "create"
                )
                request.setValue(String(attempt - 1), forHTTPHeaderField: "x-api-blob-request-attempt")
                let response: BlobMultipartCreateResponse = try await sendBlobMultipartRequest(
                    request,
                    responseType: BlobMultipartCreateResponse.self
                )
                return BlobMultipartUploadState(
                    pathname: pathname,
                    sourceByteSize: sourceByteSize,
                    uploadId: response.uploadId,
                    key: response.key,
                    completedParts: []
                )
            } catch {
                lastError = error
                let statusCode = (error as? APIClientError)?.statusCode
                if statusCode.map({ [400, 401, 403, 404, 413, 422].contains($0) }) == true {
                    throw error
                }
                guard attempt < 4 else { break }
                try await Task.sleep(for: .milliseconds(700 * attempt + Int.random(in: 0...250)))
            }
        }
        throw lastError ?? APIClientError.server("Could not start the resumable video upload.", 0)
    }

    private func uploadBlobMultipartPart(
        fileURL: URL,
        byteSize: Int64,
        source: ImageUploadPart,
        state: BlobMultipartUploadState,
        partNumber: Int,
        onRetry: ((String) -> Void)?
    ) async throws -> BlobMultipartPart {
        let partOffset = Int64(partNumber - 1) * Self.blobMultipartPartBytes
        let partByteCount = min(Self.blobMultipartPartBytes, byteSize - partOffset)
        let partData = try await Task.detached(priority: .utility) {
            try Self.fileChunkData(
                fileURL: fileURL,
                offset: partOffset,
                length: partByteCount
            )
        }.value

        var lastError: Error?
        for attempt in 1...4 {
            try Task.checkCancellation()
            do {
                var request = blobMultipartRequest(
                    source: source,
                    action: "upload"
                )
                request.setValue(
                    Self.encodeURIComponent(state.key),
                    forHTTPHeaderField: "x-mpu-key"
                )
                request.setValue(state.uploadId, forHTTPHeaderField: "x-mpu-upload-id")
                request.setValue(String(partNumber), forHTTPHeaderField: "x-mpu-part-number")
                request.setValue(String(partData.count), forHTTPHeaderField: "x-content-length")
                request.setValue(String(attempt - 1), forHTTPHeaderField: "x-api-blob-request-attempt")

                let partFileURL = try await Self.stageTusChunk(
                    partData,
                    uploadURL: source.uploadUrl,
                    offset: partOffset
                )
                let (data, response) = try await tusChunkUploader(request, partFileURL)
                guard let http = response as? HTTPURLResponse,
                      200..<300 ~= http.statusCode else {
                    throw uploadError(data: data, response: response)
                }
                let result = try decoder.decode(BlobMultipartPartResponse.self, from: data)
                guard !result.etag.isEmpty else {
                    throw APIClientError.invalidResponse
                }
                return BlobMultipartPart(partNumber: partNumber, etag: result.etag)
            } catch {
                lastError = error
                let statusCode = (error as? APIClientError)?.statusCode
                if statusCode.map({ [400, 401, 403, 404, 413, 422].contains($0) }) == true {
                    throw error
                }
                guard attempt < 4 else { break }
                onRetry?("blob_part_\(partNumber)_attempt_\(attempt)")
                try await Task.sleep(for: .milliseconds(700 * attempt + Int.random(in: 0...250)))
            }
        }

        throw lastError ?? APIClientError.server("Video upload failed.", 0)
    }

    private func completeBlobMultipartUpload(
        source: ImageUploadPart,
        state: BlobMultipartUploadState,
        parts: [BlobMultipartPart],
        onRetry: ((String) -> Void)?
    ) async throws {
        let body = try encoder.encode(parts)
        var lastError: Error?

        for attempt in 1...4 {
            do {
                var request = blobMultipartRequest(source: source, action: "complete")
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.setValue(
                    Self.encodeURIComponent(state.key),
                    forHTTPHeaderField: "x-mpu-key"
                )
                request.setValue(state.uploadId, forHTTPHeaderField: "x-mpu-upload-id")
                request.httpBody = body
                _ = try await sendBlobMultipartRequest(
                    request,
                    responseType: BlobMultipartCompleteResponse.self
                )
                return
            } catch {
                lastError = error
                let statusCode = (error as? APIClientError)?.statusCode
                if statusCode.map({ [400, 401, 403, 404, 413, 422].contains($0) }) == true {
                    throw error
                }
                guard attempt < 4 else { break }
                onRetry?("blob_complete_attempt_\(attempt)")
                try await Task.sleep(for: .milliseconds(700 * attempt + Int.random(in: 0...250)))
            }
        }
        throw lastError ?? APIClientError.server("Could not finalize the video upload.", 0)
    }

    private func blobMultipartRequest(
        source: ImageUploadPart,
        action: String
    ) -> URLRequest {
        var components = URLComponents(url: source.uploadUrl, resolvingAgainstBaseURL: false)!
        components.path = "/mpu"
        components.queryItems = [URLQueryItem(name: "pathname", value: source.pathname)]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.timeoutInterval = Self.largeVideoUploadTimeout
        request.setValue("Bearer \(source.clientToken)", forHTTPHeaderField: "Authorization")
        request.setValue(source.access ?? "private", forHTTPHeaderField: "x-vercel-blob-access")
        request.setValue(source.contentType, forHTTPHeaderField: "x-content-type")
        request.setValue(Self.vercelBlobApiVersion, forHTTPHeaderField: "x-api-version")
        request.setValue(blobRequestId(clientToken: source.clientToken), forHTTPHeaderField: "x-api-blob-request-id")
        request.setValue("0", forHTTPHeaderField: "x-api-blob-request-attempt")
        request.setValue(action, forHTTPHeaderField: "x-mpu-action")
        return request
    }

    private func sendBlobMultipartRequest<Response: Decodable>(
        _ request: URLRequest,
        responseType: Response.Type
    ) async throws -> Response {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse,
              200..<300 ~= http.statusCode else {
            throw uploadError(data: data, response: response)
        }
        return try decoder.decode(Response.self, from: data)
    }

    private static func blobMultipartByteCount(
        partNumber: Int,
        totalByteSize: Int64
    ) -> Int64 {
        let offset = Int64(partNumber - 1) * blobMultipartPartBytes
        return max(0, min(blobMultipartPartBytes, totalByteSize - offset))
    }

    nonisolated private static func encodeURIComponent(_ value: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-_.!~*'()")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    nonisolated private static func blobMultipartStateURL(pathname: String) -> URL {
        let digest = SHA256.hash(data: Data(pathname.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        return FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("UBEYE", isDirectory: true)
            .appendingPathComponent("blob-multipart", isDirectory: true)
            .appendingPathComponent("\(digest).json")
    }

    private static func loadBlobMultipartState(
        pathname: String,
        sourceByteSize: Int64
    ) async throws -> BlobMultipartUploadState? {
        await Task.detached(priority: .utility) {
            let url = blobMultipartStateURL(pathname: pathname)
            guard let data = try? Data(contentsOf: url),
                  let state = try? JSONDecoder().decode(BlobMultipartUploadState.self, from: data),
                  state.pathname == pathname,
                  state.sourceByteSize == sourceByteSize else {
                try? FileManager.default.removeItem(at: url)
                return nil
            }
            return state
        }.value
    }

    private static func saveBlobMultipartState(
        _ state: BlobMultipartUploadState
    ) async throws {
        try await Task.detached(priority: .utility) {
            let url = blobMultipartStateURL(pathname: state.pathname)
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            let data = try JSONEncoder().encode(state)
            try data.write(to: url, options: .atomic)
        }.value
    }

    private static func removeBlobMultipartState(pathname: String) async {
        await Task.detached(priority: .utility) {
            try? FileManager.default.removeItem(
                at: blobMultipartStateURL(pathname: pathname)
            )
        }.value
    }

    private static func stageBlobUploadFile(_ sourceURL: URL) async throws -> URL {
        try await Task.detached(priority: .utility) {
            let rootURL = FileManager.default
                .urls(for: .cachesDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("UBEYE", isDirectory: true)
                .appendingPathComponent("background-tus", isDirectory: true)
            try FileManager.default.createDirectory(
                at: rootURL,
                withIntermediateDirectories: true
            )

            let pathExtension = sourceURL.pathExtension
            let suffix = pathExtension.isEmpty ? ".upload" : ".\(pathExtension)"
            let stagedURL = rootURL.appendingPathComponent(
                "blob-\(UUID().uuidString.lowercased())\(suffix)"
            )
            do {
                // A hard link is effectively free on-device and remains valid when
                // the background transport removes its disposable pathname.
                try FileManager.default.linkItem(at: sourceURL, to: stagedURL)
            } catch {
                // Fall back to a physical copy if the source and cache directories
                // ever reside on different volumes.
                try FileManager.default.copyItem(at: sourceURL, to: stagedURL)
            }
            return stagedURL
        }.value
    }

    private func uploadTusVideoFile(
        fileURL: URL,
        uploadURL: URL,
        onRetry: ((String) -> Void)?,
        maxChunkBytes: Int64,
        onProgress: ((Double) -> Void)?
    ) async throws {
        let totalBytes = try await StoryUploadFileIO.fileSize(at: fileURL)
        var offset = try await tusUploadOffsetWithRetry(
            uploadURL: uploadURL,
            onRetry: onRetry
        )
        guard offset >= 0, offset <= totalBytes else {
            throw APIClientError.server("The media service returned an invalid upload offset.", 0)
        }

        var lastError: Error?
        let maxAttempts = 4
        let resolvedMaxChunkBytes = max(5 * 1024 * 1024, maxChunkBytes)
        onProgress?(Double(offset) / Double(totalBytes))
        if offset > 0 {
            onRetry?("resume_offset_\(offset)")
        }

        while offset < totalBytes {
            try Task.checkCancellation()
            for attempt in 1...maxAttempts {
                if attempt > 1 {
                    offset = try await tusUploadOffsetWithRetry(
                        uploadURL: uploadURL,
                        onRetry: onRetry
                    )
                    guard offset >= 0, offset <= totalBytes else {
                        throw APIClientError.server("The media service returned an invalid upload offset.", 0)
                    }
                    onProgress?(Double(offset) / Double(totalBytes))
                    if offset >= totalBytes {
                        onProgress?(1)
                        return
                    }
                    onRetry?("offset_\(offset)")
                }

                let chunkBytes = min(resolvedMaxChunkBytes, totalBytes - offset)
                let chunkOffset = offset
                let chunkData = try await Task.detached(priority: .utility) {
                    try Self.fileChunkData(
                        fileURL: fileURL,
                        offset: chunkOffset,
                        length: chunkBytes
                    )
                }.value

                do {
                    var request = URLRequest(url: uploadURL)
                    request.httpMethod = "PATCH"
                    request.timeoutInterval = Self.largeVideoUploadTimeout
                    request.setValue("1.0.0", forHTTPHeaderField: "Tus-Resumable")
                    request.setValue(String(offset), forHTTPHeaderField: "Upload-Offset")
                    request.setValue("application/offset+octet-stream", forHTTPHeaderField: "Content-Type")

                    let chunkFileURL = try await Self.stageTusChunk(
                        chunkData,
                        uploadURL: uploadURL,
                        offset: offset
                    )
                    let (data, response) = try await tusChunkUploader(
                        request,
                        chunkFileURL
                    )

                    guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
                        throw uploadError(data: data, response: response)
                    }

                    let expectedOffset = offset + Int64(chunkData.count)
                    guard let nextOffset = Int64(http.value(forHTTPHeaderField: "Upload-Offset") ?? ""),
                          nextOffset == expectedOffset,
                          nextOffset <= totalBytes else {
                        throw APIClientError.server("The media service returned an invalid upload offset.", http.statusCode)
                    }
                    offset = nextOffset
                    onProgress?(Double(offset) / Double(totalBytes))
                    break
                } catch {
                    lastError = error
                    guard attempt < maxAttempts else {
                        throw lastError ?? APIClientError.server("Video upload failed.", 0)
                    }
                    onRetry?("attempt_\(attempt)")
                    try await Task.sleep(for: .milliseconds(600 * attempt))
                }
            }
        }
        onProgress?(1)
    }

    private func tusUploadOffsetWithRetry(
        uploadURL: URL,
        onRetry: ((String) -> Void)?
    ) async throws -> Int64 {
        var lastError: Error?

        for attempt in 1...4 {
            try Task.checkCancellation()
            do {
                return try await tusUploadOffset(uploadURL: uploadURL)
            } catch {
                let statusCode = (error as? APIClientError)?.statusCode
                if statusCode.map({ [403, 404, 410].contains($0) }) == true {
                    throw error
                }

                lastError = error
                guard attempt < 4 else {
                    break
                }
                onRetry?("head_attempt_\(attempt)")
                try await Task.sleep(for: .milliseconds(400 * attempt))
            }
        }

        throw lastError ?? APIClientError.server("Could not resume video upload.", 0)
    }

    private static func stageTusChunk(
        _ data: Data,
        uploadURL: URL,
        offset: Int64
    ) async throws -> URL {
        try await Task.detached(priority: .utility) {
            let rootURL = FileManager.default
                .urls(for: .cachesDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("UBEYE", isDirectory: true)
                .appendingPathComponent("background-tus", isDirectory: true)
            try FileManager.default.createDirectory(
                at: rootURL,
                withIntermediateDirectories: true
            )
            let uploadKey = SHA256.hash(data: Data(uploadURL.absoluteString.utf8))
                .prefix(8)
                .map { String(format: "%02x", $0) }
                .joined()
            let fileURL = rootURL.appendingPathComponent(
                "\(uploadKey)-\(offset)-\(UUID().uuidString.lowercased()).chunk"
            )
            try data.write(to: fileURL, options: .atomic)
            return fileURL
        }.value
    }

    private func tusUploadOffset(uploadURL: URL) async throws -> Int64 {
        var request = URLRequest(url: uploadURL)
        request.httpMethod = "HEAD"
        request.timeoutInterval = Self.largeVideoUploadTimeout
        request.setValue("1.0.0", forHTTPHeaderField: "Tus-Resumable")

        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
            throw APIClientError.server("Could not resume video upload.", (response as? HTTPURLResponse)?.statusCode ?? 0)
        }

        guard let offset = Int64(http.value(forHTTPHeaderField: "Upload-Offset") ?? "") else {
            throw APIClientError.server("The media service returned an invalid upload offset.", http.statusCode)
        }

        return offset
    }

    nonisolated private static func fileChunkData(fileURL: URL, offset: Int64, length: Int64) throws -> Data {
        let input = try FileHandle(forReadingFrom: fileURL)
        defer {
            try? input.close()
        }
        try input.seek(toOffset: UInt64(offset))

        var data = Data()
        data.reserveCapacity(Int(length))
        var remainingBytes = length
        while remainingBytes > 0 {
            let chunk = try input.read(upToCount: Int(min(1024 * 1024, remainingBytes))) ?? Data()
            if chunk.isEmpty {
                break
            }
            data.append(chunk)
            remainingBytes -= Int64(chunk.count)
        }

        guard data.count > 0 else {
            throw APIClientError.invalidResponse
        }

        return data
    }

    private func uploadError(data: Data, response: URLResponse) -> APIClientError {
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
        let detail = String(data: data, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines)

        return APIClientError.server(
            detail?.isEmpty == false ? "Video upload failed: \(detail!)" : "Video upload failed.",
            statusCode
        )
    }

    func completeVideoStory(
        upload: VideoUploadResponse,
        fileURL: URL,
        poster: PreparedImageDerivativeUpload,
        caption: String,
        brandTags: String,
        textOverlay: String,
        textOverlayPositionX: Double,
        textOverlayPositionY: Double,
        linkLabel: String,
        linkUrl: String,
        linkOverlayPositionX: Double,
        linkOverlayPositionY: Double,
        quoteReplyId: String,
        quoteReplyPositionX: Double,
        quoteReplyPositionY: Double,
        durationMs: Int?
    ) async throws -> StoryUploadResponse {
        struct Body: Encodable {
            let uid: String
            let uploadSessionId: String?
            let contentType: String
            let byteSize: Int64
            let durationMs: Int?
            let poster: PreparedImageDerivativeUpload
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
            let quoteReplyId: String
            let quoteReplyPositionX: String
            let quoteReplyPositionY: String
        }

        let byteSize = try await StoryUploadFileIO.fileSize(at: fileURL)
        return try await post(
            "/api/mobile/stories/video-complete",
            body: Body(
                uid: upload.uid,
                uploadSessionId: upload.uploadSessionId,
                contentType: videoMimeType(for: fileURL),
                byteSize: byteSize,
                durationMs: durationMs,
                poster: poster,
                caption: caption,
                brandTags: brandTags,
                stickers: "",
                textOverlays: textOverlay,
                textOverlayPositionX: String(format: "%.2f", textOverlayPositionX),
                textOverlayPositionY: String(format: "%.2f", textOverlayPositionY),
                linkLabel: linkLabel,
                linkUrl: linkUrl,
                linkOverlayPositionX: String(format: "%.2f", linkOverlayPositionX),
                linkOverlayPositionY: String(format: "%.2f", linkOverlayPositionY),
                quoteReplyId: quoteReplyId,
                quoteReplyPositionX: String(format: "%.2f", quoteReplyPositionX),
                quoteReplyPositionY: String(format: "%.2f", quoteReplyPositionY)
            )
        )
    }

    private func videoMimeType(for fileURL: URL) -> String {
        videoMimeType(forPathExtension: fileURL.pathExtension)
    }

    private func videoMimeType(forPathExtension pathExtension: String) -> String {
        switch pathExtension.lowercased() {
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

    private func imagePixelDimensions(_ fileURL: URL) -> (width: Int, height: Int)? {
        guard let source = CGImageSourceCreateWithURL(fileURL as CFURL, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else {
            return nil
        }

        let width = properties[kCGImagePropertyPixelWidth] as? NSNumber
        let height = properties[kCGImagePropertyPixelHeight] as? NSNumber

        guard let width, let height, width.intValue > 0, height.intValue > 0 else {
            return nil
        }

        return (width.intValue, height.intValue)
    }

    private func blobRequestId(clientToken: String) -> String {
        let segments = clientToken.split(separator: "_")
        let storeId = segments.count > 3 ? String(segments[3]) : "ios"
        let milliseconds = Int(Date().timeIntervalSince1970 * 1_000)
        let suffix = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()

        return "\(storeId):\(milliseconds):\(suffix)"
    }

    func waitForStoryLive(storyId: String) async -> StoryReadinessResult {
        for attempt in 0..<60 {
            let status: StoryStatusResponse? = try? await get("/api/mobile/stories/\(storyId)/status")
            if let story = status?.story,
               let result = StoryReadinessPolicy.terminalResult(for: story) {
                return result
            }

            let fallbackMilliseconds: Int
            switch attempt {
            case 0..<4:
                fallbackMilliseconds = 1_500
            case 4..<12:
                fallbackMilliseconds = 3_000
            default:
                fallbackMilliseconds = 5_000
            }
            let requestedMilliseconds = status?.story.pollAfterMs ?? fallbackMilliseconds
            let boundedMilliseconds = min(max(requestedMilliseconds, 1_000), 10_000)
            let jitter = Int.random(in: 0...max(1, boundedMilliseconds / 5))
            let delay: Duration = .milliseconds(boundedMilliseconds + jitter)
            try? await Task.sleep(for: delay)
        }
        return .timedOut
    }

    private func fetchStoryStackFromNetwork(storyId: String) async throws -> StoryStackResponse {
        let networkInterval = MediaPerformance.beginInterval("story_stack_network id=\(storyId)")
        do {
            let response: StoryStackResponse = try await get("/api/mobile/stories/\(storyId)")
            storyStackCache[storyId] = response
            storyStackRefreshedAt[storyId] = Date()
            await saveStoryStackToDisk(response, storyId: storyId)
            MediaPerformance.endInterval(networkInterval, event: "story_stack_network id=\(storyId)")
            return response
        } catch {
            MediaPerformance.cancelInterval(networkInterval, reason: "failed")
            throw error
        }
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

    private func cacheInitialStoryStacks(_ stacks: [String: StoryStackResponse]?, source: String) {
        guard let stacks, !stacks.isEmpty else {
            return
        }

        let cachedAt = Date()
        stacks.forEach { storyId, response in
            storyStackCache[storyId] = response
            storyStackRefreshedAt[storyId] = cachedAt
            MediaPreheater.preheat(stack: response.story, preheatVideoAssets: false)
        }
        MediaPerformance.mark("story_stack_manifest_cache source=\(source) count=\(stacks.count)")
    }

    private func saveInitialStoryStacksToDisk(_ stacks: [String: StoryStackResponse]?) async {
        guard let cacheNamespace, let stacks, !stacks.isEmpty else {
            return
        }

        for (storyId, response) in stacks {
            await responseCache.write(response, namespace: cacheNamespace, key: storyStackCacheKey(storyId))
        }
        MediaPerformance.mark("story_stack_manifest_disk_write count=\(stacks.count)")
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
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(deviceId(), forHTTPHeaderField: "X-Device-Id")
        request.setValue(Self.mediaPipelineVersion, forHTTPHeaderField: "X-UBEYE-Media-Pipeline")
        if let appBuild = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String,
           !appBuild.isEmpty {
            request.setValue(appBuild, forHTTPHeaderField: "X-UBEYE-App-Build")
        }
        if let authToken {
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        let startedAt = Date()
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }
        let requestPath = request.url?.path ?? "unknown"
        if requestPath != "/api/mobile/performance-events" {
            MediaPerformance.measure("api_request path=\(requestPath) status=\(http.statusCode)", since: startedAt)
            if let serverTiming = http.value(forHTTPHeaderField: "Server-Timing"), !serverTiming.isEmpty {
                MediaPerformance.mark("api_server_timing path=\(requestPath) \(serverTiming)")
            }
        }

        if !(200..<300).contains(http.statusCode) {
            let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data)
            throw APIClientError.server(envelope?.error ?? "The server returned HTTP \(http.statusCode).", http.statusCode)
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

        if trimmed.isEmpty {
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

final class BackgroundTusUploadTransport: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
    static let sessionIdentifier = "com.griffinaste.ubeye.story-upload.tus"
    static let shared = BackgroundTusUploadTransport()
    private static let uploadTimeout: TimeInterval = 10 * 60

    private struct PendingUpload {
        var data = Data()
        let bodyFileURL: URL
        let continuation: CheckedContinuation<(Data, URLResponse), Error>
    }

    private let lock = NSLock()
    private var pendingUploads: [Int: PendingUpload] = [:]
    private var systemCompletionHandler: (() -> Void)?
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.background(
            withIdentifier: Self.sessionIdentifier
        )
        configuration.isDiscretionary = false
        configuration.sessionSendsLaunchEvents = true
        configuration.waitsForConnectivity = true
        configuration.timeoutIntervalForRequest = Self.uploadTimeout
        configuration.timeoutIntervalForResource = Self.uploadTimeout
        return URLSession(
            configuration: configuration,
            delegate: self,
            delegateQueue: nil
        )
    }()

    private override init() {
        super.init()
        removeAbandonedChunkFiles()
    }

    func upload(request: URLRequest, bodyFileURL: URL) async throws -> (Data, URLResponse) {
        try await withCheckedThrowingContinuation { continuation in
            let task = session.uploadTask(with: request, fromFile: bodyFileURL)
            task.taskDescription = bodyFileURL.path

            lock.lock()
            pendingUploads[task.taskIdentifier] = PendingUpload(
                bodyFileURL: bodyFileURL,
                continuation: continuation
            )
            lock.unlock()
            task.resume()
        }
    }

    func attachSystemCompletionHandler(_ completionHandler: @escaping () -> Void) {
        lock.lock()
        systemCompletionHandler = completionHandler
        lock.unlock()
        // URLSession restores transport tasks after a process relaunch, but the
        // Swift continuations that created those tasks cannot be restored. Cancel
        // only orphaned tasks so the durable upload manifest can safely retry the
        // affected Blob part instead of racing an untracked completion.
        session.getAllTasks { [weak self] tasks in
            guard let self else { return }
            self.lock.lock()
            let trackedTaskIds = Set(self.pendingUploads.keys)
            self.lock.unlock()
            tasks
                .filter { !trackedTaskIds.contains($0.taskIdentifier) }
                .forEach { $0.cancel() }
        }
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive data: Data
    ) {
        lock.lock()
        pendingUploads[dataTask.taskIdentifier]?.data.append(data)
        lock.unlock()
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        lock.lock()
        let pending = pendingUploads.removeValue(forKey: task.taskIdentifier)
        lock.unlock()

        let bodyFileURL = pending?.bodyFileURL ?? task.taskDescription.map(URL.init(fileURLWithPath:))
        if let bodyFileURL {
            try? FileManager.default.removeItem(at: bodyFileURL)
        }

        guard let pending else {
            return
        }

        if let error {
            pending.continuation.resume(throwing: error)
        } else if let response = task.response {
            pending.continuation.resume(returning: (pending.data, response))
        } else {
            pending.continuation.resume(throwing: APIClientError.invalidResponse)
        }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        lock.lock()
        let completionHandler = systemCompletionHandler
        systemCompletionHandler = nil
        lock.unlock()

        DispatchQueue.main.async {
            completionHandler?()
        }
    }

    private func removeAbandonedChunkFiles() {
        let rootURL = FileManager.default
            .urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("UBEYE", isDirectory: true)
            .appendingPathComponent("background-tus", isDirectory: true)
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: rootURL,
            includingPropertiesForKeys: [.contentModificationDateKey]
        ) else {
            return
        }

        let cutoff = Date().addingTimeInterval(-24 * 60 * 60)
        for fileURL in files {
            let modifiedAt = try? fileURL.resourceValues(
                forKeys: [.contentModificationDateKey]
            ).contentModificationDate
            if modifiedAt.map({ $0 < cutoff }) ?? true {
                try? FileManager.default.removeItem(at: fileURL)
            }
        }
    }
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
