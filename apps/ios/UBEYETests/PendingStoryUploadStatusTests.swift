import Foundation
import XCTest
@testable import UBEYE

final class PendingStoryUploadStatusTests: XCTestCase {
    func testUploadingStatusLabelOmitsPercentForStoryCard() {
        let upload = makeUpload(state: .uploading, progress: 0.42)

        XCTAssertEqual(upload.statusLabel, "Posting")
    }

    func testUploadingProgressPercentLabelIsAvailableForNoticeOverlay() {
        let upload = makeUpload(state: .uploading, progress: 0.42)

        XCTAssertTrue(upload.showsUploadProgressPercent)
        XCTAssertEqual(upload.progressPercentLabel, "42%")
    }

    func testQueuedAndCompletingDoNotExposeUploadPercentChip() {
        XCTAssertFalse(makeUpload(state: .queued, progress: 0).showsUploadProgressPercent)
        XCTAssertFalse(makeUpload(state: .completing, progress: 1).showsUploadProgressPercent)
    }

    private func makeUpload(
        state: PendingStoryUploadState,
        progress: Double
    ) -> PendingStoryUpload {
        PendingStoryUpload(
            id: "pending-story-test",
            assetKind: .image,
            pipeline: .imageMultipart,
            mediaFileURL: URL(fileURLWithPath: "/tmp/pending-story.jpg"),
            thumbnailFileURL: nil,
            fileName: "pending-story.jpg",
            mimeType: "image/jpeg",
            durationMs: nil,
            textOverlays: [],
            draft: PendingStoryUploadDraft(
                caption: "",
                brandTags: "",
                textOverlay: "",
                textOverlayPositionX: 50,
                textOverlayPositionY: 50,
                linkLabel: "",
                linkUrl: "",
                linkOverlayPositionX: 50,
                linkOverlayPositionY: 50,
                quoteReplyId: "",
                quoteReplyPositionX: 50,
                quoteReplyPositionY: 50
            ),
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0),
            state: state,
            progress: progress,
            retryCount: 0,
            errorMessage: nil,
            publishedStoryId: nil,
            originalUpload: nil
        )
    }
}
