import XCTest
@testable import UBEYE

final class StoryUploadReadinessMeasurementTests: XCTestCase {
    @MainActor
    func testPendingReadinessSurvivesRelaunchAndDuplicateReadyDoesNotRecreateIt() throws {
        let suite = "readiness-test-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let measurements = StoryUploadReadinessMeasurements(defaults: defaults)
        measurements.accept(storyId: "story", attempt: "upload", kind: .video, submittedAt: Date(), bytes: 1_000_000, alreadyReady: false)
        let data = try XCTUnwrap(defaults.data(forKey: "story-upload-readiness-v1"))
        let entry = try XCTUnwrap((JSONSerialization.jsonObject(with: data) as? [String: Any])?["story"] as? [String: Any])
        XCTAssertEqual(entry["attempt"] as? String, "upload")
        let relaunched = StoryUploadReadinessMeasurements(defaults: defaults)
        relaunched.ready(storyId: "story")
        relaunched.ready(storyId: "story")
        relaunched.accept(storyId: "story", attempt: "upload", kind: .video, submittedAt: Date(), bytes: 1_000_000, alreadyReady: false)
        let remaining = try XCTUnwrap(defaults.data(forKey: "story-upload-readiness-v1"))
        XCTAssertEqual((try JSONSerialization.jsonObject(with: remaining) as? [String: Any])?.count, 0)
        let completed = try JSONDecoder().decode([String: Date].self, from: XCTUnwrap(defaults.data(forKey: "story-upload-readiness-v1-completed")))
        XCTAssertNotNil(completed["story"])
    }
}
