import Foundation
import XCTest
@testable import UBEYE

final class FeedPerformanceTests: XCTestCase {
    private func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [FeedURLProtocol.self]
        return URLSession(configuration: config)
    }

    override func tearDown() {
        FeedURLProtocol.handler = nil
        super.tearDown()
    }

    @MainActor
    func testResponseDecodingRunsOffMainThread() async throws {
        struct Probe: Decodable {
            let onMainThread: Bool
            init(from decoder: Decoder) throws { onMainThread = Thread.isMainThread }
        }
        let transport = APITransport(session: session())
        let value = try await transport.decode(Probe.self, from: Data("{}".utf8))
        XCTAssertFalse(value.onMainThread)
    }

    @MainActor
    func testConditionalFeedReusesBodyAndIsolatesAccountsAndMutations() async throws {
        let session = session()
        defer { session.invalidateAndCancel() }
        let api = APIClient(session: session)
        api.authToken = "account-a"
        var requests = 0
        FeedURLProtocol.handler = { request, loader in
            requests += 1
            if requests == 2 {
                XCTAssertEqual(request.value(forHTTPHeaderField: "If-None-Match"), "\"feed-a\"")
                loader.finish(status: 304)
            } else {
                XCTAssertNil(request.value(forHTTPHeaderField: "If-None-Match"))
                loader.finish(status: 200, headers: ["ETag": "\"feed-a\""], body: Data("{\"ok\":true}".utf8))
            }
        }
        let first: BasicOkResponse = try await api.get("/api/mobile/feed")
        let second: BasicOkResponse = try await api.get("/api/mobile/feed")
        XCTAssertTrue(first.ok && second.ok)
        let _: BasicOkResponse = try await api.postEmpty("/api/mobile/test-mutation")
        let _: BasicOkResponse = try await api.get("/api/mobile/feed")
        api.authToken = "account-b"
        let _: BasicOkResponse = try await api.get("/api/mobile/feed")
        XCTAssertEqual(requests, 5)
    }

    @MainActor
    func testUnsolicited304RetriesWithoutValidator() async throws {
        let session = session()
        defer { session.invalidateAndCancel() }
        let api = APIClient(session: session)
        api.authToken = "retry-account"
        var requests = 0
        FeedURLProtocol.handler = { request, loader in
            requests += 1
            XCTAssertNil(request.value(forHTTPHeaderField: "If-None-Match"))
            loader.finish(status: requests == 1 ? 304 : 200, body: Data("{\"ok\":true}".utf8))
        }
        let result: BasicOkResponse = try await api.get("/api/mobile/feed")
        XCTAssertTrue(result.ok)
        XCTAssertEqual(requests, 2)
    }

    @MainActor
    func testFreshFeedWinsWithoutWaitingForDiskOrThumbnails() async throws {
        let session = session()
        defer { session.invalidateAndCancel() }
        let api = APIClient(session: session)
        api.authToken = "startup-\(UUID())"
        let diskGate = FeedTestGate()
        let networkFeed = try Self.feed(name: "network")
        let cachedFeed = try Self.feed(name: "disk")
        FeedURLProtocol.handler = { request, loader in
            if request.url?.path == "/api/mobile/feed" {
                loader.finish(status: 200, body: try! JSONEncoder().encode(networkFeed))
            } else { loader.finish(status: 404) }
        }
        let store = FeedStore(readCachedFeed: { _ in await diskGate.wait(); return cachedFeed })
        let engine = MediaEngine()
        let start = ContinuousClock.now
        await store.load(api: api, mediaEngine: engine)
        XCTAssertEqual(store.feed?.session.displayName, "network")
        // A generous regression ceiling, not a physical-device launch claim.
        XCTAssertLessThan(start.duration(to: .now), .seconds(1))
        diskGate.release()
        for _ in 0..<10 { await Task.yield() }
        XCTAssertEqual(store.feed?.session.displayName, "network")
        XCTAssertFalse(store.isLoading)
        engine.removeAll()
    }

    @MainActor
    func testDiskContentPresentsBeforeSlowNetworkCompletes() async throws {
        let session = session()
        defer { session.invalidateAndCancel() }
        let api = APIClient(session: session)
        api.authToken = "disk-first-\(UUID())"
        let cached = try Self.feed(name: "disk")
        let pending = FeedResponseGate()
        FeedURLProtocol.handler = { request, loader in
            if request.url?.path == "/api/mobile/feed" { pending.set(loader) }
            else { loader.finish(status: 404) }
        }
        let store = FeedStore(readCachedFeed: { _ in cached })
        let engine = MediaEngine()
        let task = Task { await store.load(api: api, mediaEngine: engine) }
        for _ in 0..<100 where store.feed == nil { try await Task.sleep(for: .milliseconds(5)) }
        XCTAssertEqual(store.feed?.session.displayName, "disk")
        XCTAssertFalse(store.isLoading)
        pending.finish(status: 200, body: try JSONEncoder().encode(Self.feed(name: "network")))
        await task.value
        engine.removeAll()
    }

    @MainActor
    func testAccountChangeDiscardsInFlightFeed() async throws {
        let session = session()
        defer { session.invalidateAndCancel() }
        let api = APIClient(session: session)
        api.authToken = "old-account"
        let pending = FeedResponseGate()
        FeedURLProtocol.handler = { _, loader in pending.set(loader) }
        let task = Task { () -> BasicOkResponse in try await api.get("/api/mobile/feed") }
        for _ in 0..<100 where !pending.hasRequest { try await Task.sleep(for: .milliseconds(5)) }
        XCTAssertTrue(pending.hasRequest)
        api.authToken = "new-account"
        pending.finish(status: 200, body: Data("{\"ok\":true}".utf8))
        do { _ = try await task.value; XCTFail("A previous account response must be discarded") }
        catch { XCTAssertTrue(error is CancellationError) }
    }

    @MainActor
    func testCompactPaginationCannotOverwriteConcurrentRefresh() async throws {
        let session = session()
        defer { session.invalidateAndCancel() }
        let api = APIClient(session: session)
        api.authToken = "pagination"
        let pending = FeedResponseGate()
        FeedURLProtocol.handler = { request, loader in
            XCTAssertTrue(request.url!.absoluteString.contains("format=timeline-v1"))
            pending.set(loader)
        }
        let store = FeedStore()
        store.feed = try Self.feed(name: "old", cursor: "page-a")
        let engine = MediaEngine()
        let task = Task { await store.loadNextPage(api: api, mediaEngine: engine) }
        for _ in 0..<100 where !pending.hasRequest { try await Task.sleep(for: .milliseconds(5)) }
        store.feed = try Self.feed(name: "refreshed", cursor: "page-b")
        pending.finish(status: 200, body: Data("{\"ok\":true,\"followingTimelineStories\":[],\"nextCursor\":null}".utf8))
        await task.value
        XCTAssertEqual(store.feed?.session.displayName, "refreshed")
        XCTAssertEqual(store.feed?.nextCursor, "page-b")
        engine.removeAll()
    }

    @MainActor
    func testRepresentativeFeedDecodeBudget() async throws {
        let base = try Self.feed(name: "benchmark")
        var object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(base)) as! [String: Any]
        let cards: [[String: Any]] = (0..<50).map { i in [
            "id": "story-\(i)", "creator": "Creator \(i)", "handle": "creator\(i)",
            "assetKind": "image", "mediaUrl": "https://media.invalid/\(i).jpg", "title": "Story \(i)",
            "textOverlays": [["id": "text-\(i)", "label": String(repeating: "A caption. ", count: 20), "positionX": 50, "positionY": 74]],
        ] }
        object["followingTimelineStories"] = cards
        let data = try JSONSerialization.data(withJSONObject: object)
        let session = session()
        defer { session.invalidateAndCancel() }
        let transport = APITransport(session: session)
        var samples: [Double] = []
        for i in 0..<55 {
            let start = ContinuousClock.now
            let decoded = try await transport.decode(MobileFeedResponse.self, from: data)
            XCTAssertEqual(decoded.followingTimelineStories?.count, 50)
            let elapsed = start.duration(to: .now).components
            if i >= 5 { samples.append(Double(elapsed.seconds) * 1_000 + Double(elapsed.attoseconds) / 1e15) }
        }
        samples.sort()
        let p95 = samples[Int(ceil(Double(samples.count) * 0.95)) - 1]
        XCTAssertLessThan(p95, 50, "Representative feed decoding exceeded the simulator regression budget")
        let report: [String: Any] = ["scenario": "feed_decode_50_creators", "environment": "simulator",
            "samples": samples.count, "payloadBytes": data.count, "p50Ms": samples[samples.count / 2], "p95Ms": p95, "budgetMs": 50]
        let json = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
        print("FEED_PERFORMANCE_BENCHMARK \(String(decoding: json, as: UTF8.self))")
    }

    private static func feed(name: String, cursor: String? = nil) throws -> MobileFeedResponse {
        let object: [String: Any] = ["ok": true, "session": ["displayName": name, "handle": "test"],
            "followingProfiles": [], "followingStories": [], "followingTimelineStories": [],
            "nextCursor": cursor as Any? ?? NSNull(), "discoverTiles": [], "suggestedAccounts": [],
            "myStory": ["owner": ["id": "owner", "name": "Owner", "handle": "owner"],
                        "hasActiveStory": false, "liveCount": 0, "items": []]]
        return try JSONDecoder().decode(MobileFeedResponse.self, from: JSONSerialization.data(withJSONObject: object))
    }
}

@MainActor private final class FeedTestGate {
    private var continuation: CheckedContinuation<Void, Never>?
    private var released = false
    func wait() async { if !released { await withCheckedContinuation { continuation = $0 } } }
    func release() { released = true; continuation?.resume(); continuation = nil }
}

private final class FeedResponseGate: @unchecked Sendable {
    private let lock = NSLock()
    private var loader: FeedURLProtocol?
    var hasRequest: Bool { lock.lock(); defer { lock.unlock() }; return loader != nil }
    func set(_ loader: FeedURLProtocol) { lock.lock(); self.loader = loader; lock.unlock() }
    func finish(status: Int, body: Data) {
        lock.lock(); let current = loader; loader = nil; lock.unlock()
        current?.finish(status: status, body: body)
    }
}

private final class FeedURLProtocol: URLProtocol, @unchecked Sendable {
    static var handler: ((URLRequest, FeedURLProtocol) -> Void)?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let handler = Self.handler else { finish(status: 500); return }
        handler(request, self)
    }
    override func stopLoading() {}
    func finish(status: Int, headers: [String: String] = [:], body: Data = Data()) {
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
}
