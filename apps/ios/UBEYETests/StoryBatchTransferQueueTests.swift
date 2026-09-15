import XCTest
@testable import UBEYE

final class StoryBatchTransferQueueTests: XCTestCase {
    @MainActor
    func testRegistrationWaitsForDurableBatchStagingAndLaterCompletionsRegisterImmediately() async {
        let queue = StoryBatchTransferQueue()
        var registrations: [String] = []
        queue.enqueue { queue.registerAfterPreparation { registrations.append("first") } }
        queue.enqueue { queue.registerAfterPreparation { registrations.append("second") } }
        await queue.finish()
        XCTAssertTrue(registrations.isEmpty)
        queue.finishPreparation()
        XCTAssertEqual(registrations, ["first", "second"])
        queue.registerAfterPreparation { registrations.append("third") }
        queue.finishPreparation()
        XCTAssertEqual(registrations, ["first", "second", "third"])
    }
    @MainActor
    func testTransferStartsBeforePreparationEndsAndRemainingTransfersStayOrdered() async {
        let firstStarted = expectation(description: "first starts during preparation")
        let queue = StoryBatchTransferQueue()
        var releaseFirst: CheckedContinuation<Void, Never>?
        var events: [String] = []
        queue.enqueue {
            events.append("first-start")
            await withCheckedContinuation { continuation in
                releaseFirst = continuation
                firstStarted.fulfill()
            }
            events.append("first-end")
        }
        await fulfillment(of: [firstStarted], timeout: 2)
        // The producer can stage more work while the first transfer is pending.
        events.append("second-prepared")
        queue.enqueue { events.append("second-transfer") }
        queue.enqueue { events.append("third-transfer") }
        XCTAssertEqual(events, ["first-start", "second-prepared"])
        releaseFirst?.resume()
        await queue.finish()
        XCTAssertEqual(events, ["first-start", "second-prepared", "first-end", "second-transfer", "third-transfer"])
    }

    @MainActor
    func testCaughtFailureDoesNotPreventLaterDurableItemsFromTransferring() async {
        let queue = StoryBatchTransferQueue()
        var events: [String] = []
        queue.enqueue {
            do { throw URLError(.networkConnectionLost) }
            catch { events.append("failed") }
        }
        queue.enqueue { events.append("recovered") }
        await queue.finish()
        XCTAssertEqual(events, ["failed", "recovered"])
    }
}
