import XCTest
import AVFoundation
import UIKit
@testable import UBEYE

@MainActor
final class StoryLibrarySelectionTests: XCTestCase {
    private let fixtureDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("selection-tests-\(UUID())")
    private func media(_ name: String) -> PickedStoryMedia {
        .video(StoryVideoUpload(url: fixtureDirectory.appendingPathComponent("\(name).mp4"), source: .library))
    }
    private func names(_ media: [PickedStoryMedia]) -> [String] {
        media.compactMap { if case .video(let video) = $0 { return video.url.deletingPathExtension().lastPathComponent }; return nil }
    }

    func testImportedPhotoRetainsVisibleImageAfterProviderFileDisappears() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("provider-photo-\(UUID()).jpg")
        let image = UIGraphicsImageRenderer(size: CGSize(width: 120, height: 240)).image { context in
            UIColor.systemBlue.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 120, height: 240))
        }
        try XCTUnwrap(image.jpegData(compressionQuality: 0.95)).write(to: file)
        let imported = try await PickedImage.importFile(file)
        try FileManager.default.removeItem(at: file)
        let store = StoryComposerStore()
        store.selectedMedia = .image(imported.upload)
        guard case .image(let selected) = store.selectedMedia else { return XCTFail("Imported photo wasn't selected") }
        XCTAssertGreaterThan(selected.image.size.width, 0)
        XCTAssertGreaterThan(selected.image.size.height, 0)
        XCTAssertEqual(selected.data, imported.upload.data)
        XCTAssertNotNil(UIImage(data: selected.data))
    }

    func testImportedVideoSurvivesProviderFileRemovalAndActuallyDisplays() async throws {
        let fixture = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MediaUploadQualityAudit/audit-motion.mp4")
        guard FileManager.default.fileExists(atPath: fixture.path) else { throw XCTSkip("Generate synthetic motion fixture") }
        let providerFile = FileManager.default.temporaryDirectory.appendingPathComponent("provider-video-\(UUID()).mp4")
        try FileManager.default.copyItem(at: fixture, to: providerFile)
        let imported = try await PickedVideo.importFile(providerFile)
        defer { try? FileManager.default.removeItem(at: imported.url) }
        try FileManager.default.removeItem(at: providerFile)
        XCTAssertNotEqual(imported.url, providerFile)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
        window.rootViewController = UIViewController()
        let preview = StoryVideoPreviewView(frame: window.bounds)
        window.rootViewController?.view.addSubview(preview)
        window.isHidden = false
        defer { window.isHidden = true; preview.removeFromSuperview() }
        preview.configure(url: imported.url, mirrorsHorizontally: false)
        preview.layoutIfNeeded()
        let layer = try XCTUnwrap(preview.layer.sublayers?.compactMap { $0 as? AVPlayerLayer }.first)
        for _ in 0..<300 where !layer.isReadyForDisplay { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertTrue(layer.isReadyForDisplay, "Selected video must produce a visible decoded frame")
        for _ in 0..<100 where (layer.player?.currentTime().seconds ?? 0) < 0.1 { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertGreaterThan(layer.player?.currentTime().seconds ?? 0, 0.1)
    }

    func testFirstPreviewAppearsBeforeSlowBatchFinishesAndOrderIsPreserved() async throws {
        let loader = StoryLibrarySelectionLoader()
        var previews: [[String]] = []
        var completed: [String]?
        loader.load(count: 2, importItem: { index in
            if index == 1 { try await Task.sleep(for: .milliseconds(150)) }
            return self.media("item-\(index)")
        }, onMediaLoaded: { previews.append(self.names($0)) }, onComplete: { media, failed in
            completed = self.names(media)
            XCTAssertEqual(failed, 0)
        })
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(previews, [["item-0"]])
        XCTAssertTrue(loader.isLoading)
        XCTAssertNil(completed)
        try await Task.sleep(for: .milliseconds(180))
        XCTAssertEqual(previews, [["item-0"], ["item-0", "item-1"]])
        XCTAssertEqual(completed, ["item-0", "item-1"])
        XCTAssertFalse(loader.isLoading)
    }

    func testOlderUncancellableImportCannotOverwriteReplacement() async throws {
        let loader = StoryLibrarySelectionLoader()
        var previews: [[String]] = []
        var completions: [[String]] = []
        loader.load(count: 1, importItem: { _ in
            // Mimic a Photos provider which finishes after Task cancellation.
            await Task.detached { try? await Task.sleep(for: .milliseconds(120)) }.value
            return self.media("old")
        }, onMediaLoaded: { previews.append(self.names($0)) }, onComplete: { media, _ in completions.append(self.names(media)) })
        try await Task.sleep(for: .milliseconds(20))
        loader.load(count: 1, importItem: { _ in self.media("new") }, onMediaLoaded: { previews.append(self.names($0)) }, onComplete: { media, _ in completions.append(self.names(media)) })
        try await Task.sleep(for: .milliseconds(160))
        XCTAssertEqual(previews, [["new"]])
        XCTAssertEqual(completions, [["new"]])
        XCTAssertFalse(loader.isLoading)
    }

    func testDiscardPreventsLatePreviewAndRemovesLateOwnedVideo() async throws {
        let loader = StoryLibrarySelectionLoader()
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("cancelled-pick-\(UUID()).mp4")
        try Data([1, 2, 3]).write(to: file)
        let started = expectation(description: "provider import started")
        var finishImport: CheckedContinuation<Void, Never>?
        loader.load(count: 1, importItem: { _ in
            await withCheckedContinuation { continuation in
                finishImport = continuation
                started.fulfill()
            }
            return .video(StoryVideoUpload(url: file, source: .library))
        }, onMediaLoaded: { _ in XCTFail("Discarded selection appeared") }, onComplete: { _, _ in XCTFail("Discarded selection completed") })
        await fulfillment(of: [started], timeout: 2)
        let cancelledImport = loader.cancel()
        finishImport?.resume()
        await cancelledImport?.value
        XCTAssertFalse(loader.isLoading)
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    }

    func testFailedFirstItemStillShowsNextValidSelection() async throws {
        let loader = StoryLibrarySelectionLoader()
        var previews: [[String]] = []
        var failures: Int?
        loader.load(count: 3, importItem: { index in
            if index == 0 { throw APIClientError.invalidResponse }
            return index == 2 ? nil : self.media("valid")
        }, onMediaLoaded: { previews.append(self.names($0)) }, onComplete: { _, failed in failures = failed })
        for _ in 0..<20 { await Task.yield() }
        XCTAssertEqual(previews, [["valid"]])
        XCTAssertEqual(failures, 2)
        XCTAssertEqual(loader.completedCount, 3)
        XCTAssertFalse(loader.isLoading)
    }
}
