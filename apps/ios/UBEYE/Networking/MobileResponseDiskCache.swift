import Foundation

private struct DiskCacheEnvelope<Value: Codable>: Codable {
    let cachedAt: Date
    let value: Value
}


actor MobileResponseDiskCache {
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

