import XCTest
@testable import UBEYE

final class MediaPerformanceTests: XCTestCase {
    func testParsesEventNameAndMetadata() {
        let parsed = MediaPerformance.parsedEventForTesting(
            "video_first_frame reason=layer_ready delivery=hls cache=hit source=pooled url=clip.m3u8"
        )

        XCTAssertEqual(parsed?.name, "video_first_frame")
        XCTAssertEqual(parsed?.metadata["reason"], "layer_ready")
        XCTAssertEqual(parsed?.metadata["delivery"], "hls")
        XCTAssertEqual(parsed?.metadata["cache"], "hit")
        XCTAssertEqual(parsed?.metadata["source"], "pooled")
        XCTAssertEqual(parsed?.metadata["url"], "clip.m3u8")
    }

    func testLimitsMetadataCardinality() {
        let metadata = (0..<25)
            .map { "k\($0)=v\($0)" }
            .joined(separator: " ")
        let parsed = MediaPerformance.parsedEventForTesting("video_startup \(metadata)")

        XCTAssertEqual(parsed?.name, "video_startup")
        XCTAssertEqual(parsed?.metadata.count, 20)
        XCTAssertEqual(parsed?.metadata["k0"], "v0")
        XCTAssertNil(parsed?.metadata["k24"])
    }

    func testTruncatesMetadataKeysAndValues() {
        let longKey = String(repeating: "k", count: 48)
        let longValue = String(repeating: "v", count: 540)
        let parsed = MediaPerformance.parsedEventForTesting("story_open \(longKey)=\(longValue)")

        XCTAssertEqual(parsed?.metadata.keys.first?.count, 40)
        XCTAssertEqual(parsed?.metadata.values.first?.count, 500)
    }

    @MainActor
    func testPreferredPlaybackAlwaysUsesCanonicalAdaptiveStream() {
        let defaultURL = URL(string: "https://example.com/playback/video.m3u8")!
        let selected = MediaPlaybackQuality.preferredPlaybackURL(defaultURL: defaultURL)

        XCTAssertEqual(selected.url, defaultURL)
        XCTAssertEqual(selected.quality, "adaptive_hls")
    }

    @MainActor
    func testPlayerPoolKeepsActiveURLInsideBoundedPriorityWindow() {
        let first = URL(string: "https://example.com/first.m3u8")!
        let active = URL(string: "https://example.com/active.m3u8")!
        let third = URL(string: "https://example.com/third.m3u8")!
        let fourth = URL(string: "https://example.com/fourth.m3u8")!

        let prioritized = StoryVideoPlaybackPool.prioritizedURLs(
            urls: [first, active, third, fourth, active],
            activeURL: active,
            limit: 3
        )

        XCTAssertEqual(prioritized, [active, first, third])
    }

    @MainActor
    func testPlayerPoolReturnsNoURLsWhenPrefetchIsDisabled() {
        let url = URL(string: "https://example.com/video.m3u8")!

        XCTAssertEqual(
            StoryVideoPlaybackPool.prioritizedURLs(urls: [url], activeURL: url, limit: 0),
            []
        )
    }
}
