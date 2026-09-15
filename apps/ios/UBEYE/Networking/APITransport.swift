import Foundation

/// Network response storage and decoding never occupy the UI actor. Conditional
/// bodies are scoped to the exact authenticated request and bounded in memory.
actor APITransport {
    private struct CachedResponse {
        let data: Data
        let etag: String
        let storedAt: Date
    }
    private let session: URLSession
    private let decoder = JSONDecoder()
    private var feedResponses: [String: CachedResponse] = [:]
    private let maximumBodyBytes = 2 * 1_024 * 1_024

    init(session: URLSession) { self.session = session }

    func data(for original: URLRequest) async throws -> (Data, HTTPURLResponse) {
        var request = original
        let conditionalKey = feedKey(request)
        let cached = conditionalKey.flatMap { feedResponses[$0] }
        if let cached, Date().timeIntervalSince(cached.storedAt) < 60 {
            request.setValue(cached.etag, forHTTPHeaderField: "If-None-Match")
        }
        var (data, response) = try await session.data(for: request)
        guard var http = response as? HTTPURLResponse else { throw APIClientError.invalidResponse }
        if http.statusCode == 304 {
            if let cached, request.value(forHTTPHeaderField: "If-None-Match") == cached.etag {
                return (cached.data, http)
            }
            // Recover from an intermediary's unsolicited 304 without a body.
            request.setValue(nil, forHTTPHeaderField: "If-None-Match")
            (data, response) = try await session.data(for: request)
            guard let retried = response as? HTTPURLResponse else { throw APIClientError.invalidResponse }
            http = retried
        }
        if let key = conditionalKey, http.statusCode == 200,
           data.count <= maximumBodyBytes, let etag = http.value(forHTTPHeaderField: "ETag") {
            if feedResponses.count >= 8, feedResponses[key] == nil,
               let oldest = feedResponses.min(by: { $0.value.storedAt < $1.value.storedAt })?.key {
                feedResponses.removeValue(forKey: oldest)
            }
            feedResponses[key] = CachedResponse(data: data, etag: etag, storedAt: Date())
        }
        if original.httpMethod != "GET", (200..<300).contains(http.statusCode) {
            feedResponses.removeAll()
        }
        return (data, http)
    }

    func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        try decoder.decode(type, from: data)
    }

    private func feedKey(_ request: URLRequest) -> String? {
        guard request.httpMethod == "GET", let url = request.url,
              url.path == "/api/mobile/feed",
              let authorization = request.value(forHTTPHeaderField: "Authorization"),
              !authorization.isEmpty,
              URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
                .contains(where: { $0.name == "cursor" }) != true else { return nil }
        return [url.absoluteString, authorization,
                request.value(forHTTPHeaderField: "X-Device-Id") ?? "",
                request.value(forHTTPHeaderField: "X-UBEYE-App-Build") ?? "",
                request.value(forHTTPHeaderField: "X-UBEYE-Media-Pipeline") ?? ""]
            .joined(separator: "\n")
    }
}
