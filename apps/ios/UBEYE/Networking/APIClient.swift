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

@MainActor
final class APIClient: ObservableObject {
    @Published var baseURLString: String {
        didSet {
            UserDefaults.standard.set(baseURLString, forKey: Self.baseURLKey)
        }
    }

    var authToken: String?

    private static let baseURLKey = "ubeye.ios.apiBaseUrl"
    private static let deviceIdKey = "ubeye.ios.deviceId"
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(session: URLSession = .shared) {
        self.session = session
        baseURLString = UserDefaults.standard.string(forKey: Self.baseURLKey) ?? "http://127.0.0.1:3000"
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
        textOverlayPositionY: Double
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
        appendField("textOverlayPositionX", "50.00", boundary: boundary, to: &body)
        appendField("textOverlayPositionY", String(format: "%.2f", textOverlayPositionY), boundary: boundary, to: &body)
        appendField("linkLabel", "", boundary: boundary, to: &body)
        appendField("linkUrl", "", boundary: boundary, to: &body)
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
            mimeType: "video/mp4",
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

    func completeVideoStory(
        uid: String,
        fileURL: URL,
        caption: String,
        brandTags: String,
        textOverlay: String,
        durationMs: Int?
    ) async throws -> StoryUploadResponse {
        struct Body: Encodable {
            let uid: String
            let contentType: String
            let byteSize: Int64
            let durationMs: Int?
            let caption: String
            let brandTags: String
            let stickers: String
            let textOverlays: String
            let textOverlayPositionX: String
            let textOverlayPositionY: String
            let linkLabel: String
            let linkUrl: String
        }

        let byteSize = (try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? NSNumber)?.int64Value ?? 0
        return try await post(
            "/api/mobile/stories/video-complete",
            body: Body(
                uid: uid,
                contentType: "video/mp4",
                byteSize: byteSize,
                durationMs: durationMs,
                caption: caption,
                brandTags: brandTags,
                stickers: "",
                textOverlays: textOverlay,
                textOverlayPositionX: "50.00",
                textOverlayPositionY: "74.00",
                linkLabel: "",
                linkUrl: ""
            )
        )
    }

    func waitForStoryLive(storyId: String) async {
        for _ in 0..<36 {
            try? await Task.sleep(for: .seconds(2.5))
            let status: StoryStatusResponse? = try? await get("/api/mobile/stories/\(storyId)/status")
            if status?.story.isLive == true {
                return
            }
        }
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
}
