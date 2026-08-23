import AVFoundation
import ImageIO
import SwiftUI
import UniformTypeIdentifiers
import UIKit
import XCTest
@testable import UBEYE

final class MediaPerformanceTests: XCTestCase {
    func testVideoUploadResponseDecodesPrivatePosterTarget() throws {
        let data = try JSONSerialization.data(withJSONObject: [
            "ok": true,
            "uid": String(repeating: "a", count: 32),
            "uploadSessionId": "upload-123",
            "uploadUrl": "https://upload.cloudflare.example/tus",
            "uploadProtocol": "tus",
            "poster": [
                "pathname": "stories/video-posters/\(String(repeating: "a", count: 32))-poster.jpg",
                "uploadUrl": "https://blob.vercel-storage.com?pathname=poster",
                "clientToken": "poster-token",
                "contentType": "image/jpeg",
                "maxSizeBytes": 2 * 1024 * 1024,
                "access": "private",
            ],
        ])

        let response = try JSONDecoder().decode(VideoUploadResponse.self, from: data)

        XCTAssertEqual(response.uploadProtocol, "tus")
        XCTAssertEqual(response.poster?.contentType, "image/jpeg")
        XCTAssertEqual(response.poster?.access, "private")
        XCTAssertEqual(response.poster?.maxSizeBytes, 2 * 1024 * 1024)
    }

    func testVideoPosterMetadataReadsEncodedPixelDimensions() async throws {
        let data = makeTestImageData(width: 1_080, height: 1_920)
        let detectedSize = await StoryUploadFileIO.imagePixelSize(of: data)
        let size = try XCTUnwrap(detectedSize)

        XCTAssertEqual(size.width, 1_080)
        XCTAssertEqual(size.height, 1_920)
    }

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

    func testStoryImageTranscoderBoundsAndNormalizesOversizedImage() throws {
        let sourceData = makeTestImageData(width: 4_800, height: 3_200)

        let encoded = try XCTUnwrap(
            StoryImageTranscoder.normalizedJPEG(
                data: sourceData,
                maxPixelDimension: StoryImageUpload.maximumTranscodedPixelDimension,
                quality: StoryImageUpload.transcodedJPEGQuality
            )
        )

        XCTAssertEqual(max(encoded.width, encoded.height), StoryImageUpload.maximumTranscodedPixelDimension)
        XCTAssertLessThanOrEqual(
            min(encoded.width, encoded.height),
            StoryImageUpload.maximumTranscodedPixelDimension
        )

        let imageSource = try XCTUnwrap(CGImageSourceCreateWithData(encoded.data as CFData, nil))
        XCTAssertEqual(CGImageSourceGetType(imageSource) as String?, UTType.jpeg.identifier)
    }

    func testStoryImageUploadPreservesCompatibleOriginalAndBuildsBoundedPreview() throws {
        let sourceData = makeTestImageData(width: 2_400, height: 3_200)

        let upload = try XCTUnwrap(
            StoryImageUpload(
                data: sourceData,
                fallbackFileName: "IMG_1234.HEIC"
            )
        )

        XCTAssertEqual(upload.fileName, "IMG_1234.png")
        XCTAssertEqual(upload.mimeType, "image/png")
        XCTAssertEqual(upload.data, sourceData)

        let imageSource = try XCTUnwrap(CGImageSourceCreateWithData(upload.data as CFData, nil))
        XCTAssertEqual(CGImageSourceGetType(imageSource) as String?, UTType.png.identifier)
        XCTAssertLessThanOrEqual(
            max(upload.image.cgImage?.width ?? 0, upload.image.cgImage?.height ?? 0),
            StoryImageUpload.maximumPreviewPixelDimension
        )
    }

    func testStoryImageUploadPreservesCameraJPEGBytes() throws {
        let sourceData = try makeOrientedJPEGData(width: 1_200, height: 800)
        let upload = try XCTUnwrap(
            StoryImageUpload(
                data: sourceData,
                fallbackFileName: "story-photo"
            )
        )

        XCTAssertEqual(upload.fileName, "story-photo.jpg")
        XCTAssertEqual(upload.mimeType, "image/jpeg")
        XCTAssertEqual(upload.data, sourceData)
    }

    func testStoryImageTranscoderHonorsOrientationFromFileURL() throws {
        let sourceData = try makeOrientedJPEGData(width: 1_200, height: 800)
        let fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("oriented-photo-\(UUID().uuidString).jpg")
        try sourceData.write(to: fileURL, options: .atomic)
        defer { try? FileManager.default.removeItem(at: fileURL) }

        let encoded = try XCTUnwrap(
            StoryImageTranscoder.normalizedJPEG(
                fileURL: fileURL,
                maxPixelDimension: StoryImageUpload.maximumTranscodedPixelDimension
            )
        )

        XCTAssertEqual(encoded.width, 800)
        XCTAssertEqual(encoded.height, 1_200)
        let imageSource = try XCTUnwrap(CGImageSourceCreateWithData(encoded.data as CFData, nil))
        XCTAssertEqual(CGImageSourceGetType(imageSource) as String?, UTType.jpeg.identifier)
    }

    func testStoryImageTranscoderFillsStoryCanvasWithoutSideBands() throws {
        let cameraPhoto = makeTestImageData(width: 1_600, height: 1_200)
        let reelPhoto = makeCropTestImageData(width: 900, height: 1_950)

        for (index, sourceData) in [cameraPhoto, reelPhoto].enumerated() {
            let encoded = try XCTUnwrap(
                StoryImageTranscoder.storyCanvasJPEG(
                    data: sourceData,
                    width: StoryImageUpload.playbackCanvasWidth,
                    height: StoryImageUpload.playbackCanvasHeight,
                    quality: StoryImageUpload.playbackJPEGQuality,
                    contentMode: .fill
                )
            )

            XCTAssertEqual(encoded.width, StoryImageUpload.playbackCanvasWidth)
            XCTAssertEqual(encoded.height, StoryImageUpload.playbackCanvasHeight)
            let imageSource = try XCTUnwrap(
                CGImageSourceCreateWithData(encoded.data as CFData, nil)
            )
            XCTAssertEqual(CGImageSourceGetType(imageSource) as String?, UTType.jpeg.identifier)

            if index == 1 {
                let image = try XCTUnwrap(CGImageSourceCreateImageAtIndex(imageSource, 0, nil))
                let topPixel = try XCTUnwrap(
                    rgbaPixel(in: image, x: image.width / 2, y: 4)
                )
                let centerPixel = try XCTUnwrap(
                    rgbaPixel(in: image, x: image.width / 2, y: image.height / 2)
                )

                XCTAssertGreaterThan(topPixel[2], topPixel[0])
                XCTAssertGreaterThan(centerPixel[2], centerPixel[0])
            }
        }
    }

    func testStoryImageTranscoderFitPreservesTheWholePhotoWithBlackLetterboxing() throws {
        let sourceData = makeCropTestImageData(width: 1_600, height: 1_200)
        let encoded = try XCTUnwrap(
            StoryImageTranscoder.storyCanvasJPEG(
                data: sourceData,
                width: StoryImageUpload.playbackCanvasWidth,
                height: StoryImageUpload.playbackCanvasHeight,
                quality: StoryImageUpload.playbackJPEGQuality,
                contentMode: .fit
            )
        )
        let imageSource = try XCTUnwrap(
            CGImageSourceCreateWithData(encoded.data as CFData, nil)
        )
        let image = try XCTUnwrap(CGImageSourceCreateImageAtIndex(imageSource, 0, nil))
        let topCenterPixel = try XCTUnwrap(
            rgbaPixel(in: image, x: image.width / 2, y: 4)
        )
        let bottomCenterPixel = try XCTUnwrap(
            rgbaPixel(in: image, x: image.width / 2, y: image.height - 5)
        )
        let centerPixel = try XCTUnwrap(
            rgbaPixel(in: image, x: image.width / 2, y: image.height / 2)
        )

        XCTAssertLessThan(topCenterPixel[0], 16)
        XCTAssertLessThan(topCenterPixel[1], 16)
        XCTAssertLessThan(topCenterPixel[2], 16)
        XCTAssertLessThan(bottomCenterPixel[0], 16)
        XCTAssertLessThan(bottomCenterPixel[1], 16)
        XCTAssertLessThan(bottomCenterPixel[2], 16)
        XCTAssertGreaterThan(centerPixel[2], centerPixel[0])
    }

    func testStoryCanvasLayoutTopAlignsAcrossViewerChromeVariants() {
        let screenSize = CGSize(width: 393, height: 852)

        for reservedBottomHeight in [CGFloat(0), 90, 108] {
            let layout = StoryCanvasLayout(
                containerSize: screenSize,
                reservedBottomHeight: reservedBottomHeight
            )

            XCTAssertEqual(
                layout.frame.width / layout.frame.height,
                StoryCanvasLayout.aspectRatio,
                accuracy: 0.000_1
            )
            XCTAssertEqual(layout.frame.minY, 0, accuracy: 0.000_1)
            XCTAssertGreaterThanOrEqual(layout.frame.minX, 0)
            XCTAssertLessThanOrEqual(layout.frame.maxX, screenSize.width + 0.000_1)
            XCTAssertLessThanOrEqual(
                layout.frame.maxY,
                screenSize.height - reservedBottomHeight + 0.000_1
            )
        }
    }

    func testStoryCanvasLayoutScalesDownOnCompactScreensWithoutChangingAspect() {
        let layout = StoryCanvasLayout(
            containerSize: CGSize(width: 320, height: 568),
            reservedBottomHeight: 110
        )

        XCTAssertEqual(layout.frame.height, 458, accuracy: 0.000_1)
        XCTAssertEqual(
            layout.frame.width,
            458 * StoryCanvasLayout.aspectRatio,
            accuracy: 0.000_1
        )
        XCTAssertEqual(layout.frame.midX, 160, accuracy: 0.000_1)
        XCTAssertEqual(layout.frame.minY, 0, accuracy: 0.000_1)
    }

    func testStoryCanvasLayoutCanFillFromScreenTopWhileKeepingReservedBottom() {
        let screenSize = CGSize(width: 393, height: 852)
        let reservedBottomHeight = CGFloat(90)
        let layout = StoryCanvasLayout(
            containerSize: screenSize,
            reservedBottomHeight: reservedBottomHeight,
            fillsAvailableHeight: true
        )

        XCTAssertEqual(layout.frame.minY, 0, accuracy: 0.000_1)
        XCTAssertEqual(
            layout.frame.maxY,
            screenSize.height - reservedBottomHeight,
            accuracy: 0.000_1
        )
        XCTAssertEqual(
            layout.frame.width / layout.frame.height,
            StoryCanvasLayout.aspectRatio,
            accuracy: 0.000_1
        )
        XCTAssertEqual(layout.frame.midX, screenSize.width / 2, accuracy: 0.000_1)
        XCTAssertLessThan(layout.frame.minX, 0)
        XCTAssertGreaterThan(layout.frame.maxX, screenSize.width)
    }

    func testStoryCanvasContractUsesCanonicalDerivativeSizes() {
        XCTAssertEqual(StoryCanvasLayout.playbackPixelSize.width, 1_080)
        XCTAssertEqual(StoryCanvasLayout.playbackPixelSize.height, 1_920)
        XCTAssertEqual(StoryCanvasLayout.thumbnailPixelSize.width, 360)
        XCTAssertEqual(StoryCanvasLayout.thumbnailPixelSize.height, 640)
        XCTAssertEqual(StoryMediaContract.maximumImageUploadBytes, 25 * 1024 * 1024)
        XCTAssertEqual(
            StoryMediaContract.maximumImageDisplayDerivativeBytes,
            1_500_000
        )
        XCTAssertEqual(
            StoryMediaContract.maximumImageThumbnailDerivativeBytes,
            150_000
        )
        XCTAssertEqual(
            StoryMediaContract.displayAVIFQualityCandidates,
            [0.65, 0.60, 0.55, 0.50]
        )
        XCTAssertEqual(
            StoryMediaContract.displayWebPQualityCandidates,
            [0.85, 0.80, 0.75, 0.70, 0.65]
        )
        XCTAssertEqual(
            StoryMediaContract.thumbnailWebPQualityCandidates,
            [0.80, 0.75, 0.70, 0.65, 0.60]
        )
        XCTAssertEqual(StoryMediaContract.maximumVideoUploadBytes, 512 * 1024 * 1024)
        XCTAssertEqual(StoryMediaContract.maximumVideoDurationSeconds, 120)
        XCTAssertEqual(
            StoryCanvasLayout.playbackPixelSize.width /
                StoryCanvasLayout.playbackPixelSize.height,
            StoryCanvasLayout.aspectRatio,
            accuracy: 0.000_1
        )
    }

    func testStoryImageDerivativeBuilderProducesCanonicalBoundedVariants() async throws {
        let sourceData = makeCropTestImageData(width: 1_600, height: 1_200)
        let fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("story-derivative-\(UUID().uuidString).png")
        try sourceData.write(to: fileURL, options: .atomic)
        defer { try? FileManager.default.removeItem(at: fileURL) }

        let derivatives = try await StoryImageDerivativeBuilder.build(
            fileURL: fileURL,
            contentMode: .fit
        )

        XCTAssertEqual(derivatives.display.width, 1_080)
        XCTAssertEqual(derivatives.display.height, 1_920)
        XCTAssertLessThanOrEqual(
            derivatives.display.data.count,
            StoryMediaContract.maximumImageDisplayDerivativeBytes
        )
        XCTAssertTrue(["image/avif", "image/webp"].contains(derivatives.display.contentType))
        XCTAssertEqual(derivatives.thumbnail.width, 360)
        XCTAssertEqual(derivatives.thumbnail.height, 640)
        XCTAssertEqual(derivatives.thumbnail.contentType, "image/webp")
        XCTAssertLessThanOrEqual(
            derivatives.thumbnail.data.count,
            StoryMediaContract.maximumImageThumbnailDerivativeBytes
        )
        XCTAssertFalse(derivatives.thumbHash.isEmpty)
    }

    @MainActor
    func testStoryCanvasImagePreservesBothHorizontalEdges() throws {
        let sourceImage = makeHorizontalEdgeMarkerImage(width: 400, height: 400)
        let renderer = ImageRenderer(
            content: StoryCanvasImage(image: Image(uiImage: sourceImage))
                .frame(width: 360, height: 640)
        )
        renderer.scale = 1
        let renderedUIImage = try XCTUnwrap(renderer.uiImage)
        let renderedImage = try XCTUnwrap(renderedUIImage.cgImage)
        let leftPixel = try XCTUnwrap(
            rgbaPixel(in: renderedImage, x: 2, y: renderedImage.height / 2)
        )
        let rightPixel = try XCTUnwrap(
            rgbaPixel(
                in: renderedImage,
                x: renderedImage.width - 3,
                y: renderedImage.height / 2
            )
        )

        XCTAssertGreaterThan(leftPixel[0], leftPixel[1])
        XCTAssertGreaterThan(leftPixel[0], leftPixel[2])
        XCTAssertGreaterThan(rightPixel[1], rightPixel[0])
        XCTAssertGreaterThan(rightPixel[1], rightPixel[2])
    }

    @MainActor
    func testStoryCanvasImageUsesBlackLetterboxInEveryColorScheme() throws {
        let sourceImage = makeHorizontalEdgeMarkerImage(width: 400, height: 400)
        let lightRenderer = ImageRenderer(
            content: StoryCanvasImage(image: Image(uiImage: sourceImage))
                .frame(width: 360, height: 640)
                .environment(\.colorScheme, .light)
        )
        let darkRenderer = ImageRenderer(
            content: StoryCanvasImage(image: Image(uiImage: sourceImage))
                .frame(width: 360, height: 640)
                .environment(\.colorScheme, .dark)
        )
        lightRenderer.scale = 1
        darkRenderer.scale = 1

        let lightImage = try XCTUnwrap(lightRenderer.uiImage?.cgImage)
        let darkImage = try XCTUnwrap(darkRenderer.uiImage?.cgImage)
        let lightTopPixel = try XCTUnwrap(rgbaPixel(in: lightImage, x: 180, y: 2))
        let lightBottomPixel = try XCTUnwrap(rgbaPixel(in: lightImage, x: 180, y: 637))
        let darkTopPixel = try XCTUnwrap(rgbaPixel(in: darkImage, x: 180, y: 2))
        let darkBottomPixel = try XCTUnwrap(rgbaPixel(in: darkImage, x: 180, y: 637))

        for component in 0..<3 {
            XCTAssertLessThan(lightTopPixel[component], 10)
            XCTAssertLessThan(lightBottomPixel[component], 10)
            XCTAssertLessThan(darkTopPixel[component], 10)
            XCTAssertLessThan(darkBottomPixel[component], 10)
        }
    }

    @MainActor
    func testPreferredPlaybackAlwaysUsesCanonicalAdaptiveStream() {
        let defaultURL = URL(string: "https://example.com/playback/video.m3u8")!
        let selected = MediaPlaybackQuality.preferredPlaybackURL(defaultURL: defaultURL)

        XCTAssertEqual(selected.url, defaultURL)
        XCTAssertEqual(selected.quality, "adaptive_hls")
    }

    func testPressPausePolicyOnlyPausesPlayableVideoWhileTouchIsDown() {
        XCTAssertTrue(
            StoryViewerPausePolicy.isPressingPlayableVideo(
                assetKind: .video,
                processingStatus: "ready",
                isPressing: true
            )
        )
        XCTAssertTrue(
            StoryViewerPausePolicy.isPressingPlayableVideo(
                assetKind: .video,
                processingStatus: nil,
                isPressing: true
            )
        )
        XCTAssertFalse(
            StoryViewerPausePolicy.isPressingPlayableVideo(
                assetKind: .image,
                processingStatus: "ready",
                isPressing: true
            )
        )
        XCTAssertFalse(
            StoryViewerPausePolicy.isPressingPlayableVideo(
                assetKind: .video,
                processingStatus: "processing",
                isPressing: true
            )
        )
        XCTAssertFalse(
            StoryViewerPausePolicy.isPressingPlayableVideo(
                assetKind: .video,
                processingStatus: "ready",
                isPressing: false
            )
        )
    }

    func testReleasingVideoPressDoesNotOverrideAnotherPauseReason() {
        var policy = StoryViewerPausePolicy(isPressingPlayableVideo: true)
        XCTAssertTrue(policy.shouldPausePlayback)

        policy.isPressingPlayableVideo = false
        policy.isRepliesSheetPresented = true
        XCTAssertTrue(policy.shouldPausePlayback)

        policy.isRepliesSheetPresented = false
        policy.sceneIsActive = false
        XCTAssertTrue(policy.shouldPausePlayback)

        policy.sceneIsActive = true
        XCTAssertFalse(policy.shouldPausePlayback)
    }

    @MainActor
    func testPlayerPoolUsesLimitForAdjacentURLsInsteadOfActiveURL() {
        let first = URL(string: "https://example.com/first.m3u8")!
        let active = URL(string: "https://example.com/active.m3u8")!
        let third = URL(string: "https://example.com/third.m3u8")!
        let fourth = URL(string: "https://example.com/fourth.m3u8")!

        let prioritized = StoryVideoPlaybackPool.prioritizedURLs(
            urls: [first, active, third, fourth, active],
            activeURL: active,
            limit: 3
        )

        XCTAssertEqual(prioritized, [first, third, fourth])
    }

    @MainActor
    func testPlayerPoolReturnsNoURLsWhenPrefetchIsDisabled() {
        let url = URL(string: "https://example.com/video.m3u8")!

        XCTAssertEqual(
            StoryVideoPlaybackPool.prioritizedURLs(urls: [url], activeURL: url, limit: 0),
            []
        )
    }

    @MainActor
    func testPlayerPoolOnlyPrerollsWhenPlayerAndItemAreReady() {
        XCTAssertTrue(
            StoryVideoPlaybackPool.canPreroll(
                playerStatus: .readyToPlay,
                itemStatus: .readyToPlay
            )
        )
        XCTAssertFalse(
            StoryVideoPlaybackPool.canPreroll(
                playerStatus: .unknown,
                itemStatus: .readyToPlay
            )
        )
        XCTAssertFalse(
            StoryVideoPlaybackPool.canPreroll(
                playerStatus: .readyToPlay,
                itemStatus: .unknown
            )
        )
    }

    @MainActor
    func testFullBleedPlayerViewReplacesAndDetachesPlayers() {
        let view = FullBleedPlayerView(frame: CGRect(x: 0, y: 0, width: 360, height: 640))
        let firstPlayer = AVPlayer()
        let secondPlayer = AVPlayer()

        view.attach(firstPlayer)
        XCTAssertTrue(view.player === firstPlayer)

        view.attach(secondPlayer)
        XCTAssertTrue(view.player === secondPlayer)

        view.attach(nil)
        XCTAssertNil(view.player)
        XCTAssertNil(view.playerLayer.player)
    }

    @MainActor
    func testPlayerPoolCoalescesRefreshedSignedURLsByCanonicalIdentity() {
        let first = URL(string: "https://customer.cloudflarestream.com/id/manifest/video.m3u8?token=first&quality=auto")!
        let refreshed = URL(string: "https://customer.cloudflarestream.com/id/manifest/video.m3u8?quality=auto&token=second&v=2")!

        XCTAssertEqual(
            StoryVideoPlaybackPool.canonicalURL(for: first),
            StoryVideoPlaybackPool.canonicalURL(for: refreshed)
        )
        XCTAssertEqual(
            StoryVideoPlaybackPool.prioritizedURLs(
                urls: [first, refreshed],
                activeURL: nil,
                limit: 3
            ),
            [first]
        )
    }

    @MainActor
    func testStableAssetIdentitySurvivesCloudflareSignedPathRotation() {
        let storageKey = String(repeating: "a", count: 32)
        let firstURL = URL(
            string: "https://customer.cloudflarestream.com/header.payload.signature-one/manifest/video.m3u8"
        )!
        let refreshedURL = URL(
            string: "https://customer.cloudflarestream.com/header.payload.signature-two/manifest/video.m3u8"
        )!
        let first = makeStoryCard(
            id: "story-1",
            playbackURL: firstURL,
            storageKey: storageKey
        ).playbackSource
        let refreshed = makeStoryCard(
            id: "story-1",
            playbackURL: refreshedURL,
            storageKey: storageKey
        ).playbackSource

        XCTAssertNotEqual(first.url, refreshed.url)
        XCTAssertEqual(first.identity, "storage:\(storageKey)")
        XCTAssertTrue(refreshed.representsSameMedia(as: first))
        XCTAssertEqual(
            StoryVideoPlaybackPool.prioritizedSources(
                sources: [first, refreshed],
                activeIdentity: nil,
                limit: 3
            ),
            [first]
        )
    }

    @MainActor
    func testDistinctStorageAssetsRemainDistinctPlaybackSources() {
        let first = makeStoryCard(
            id: "story-1",
            playbackURL: URL(string: "https://customer.cloudflarestream.com/first-token/manifest/video.m3u8")!,
            storageKey: String(repeating: "a", count: 32)
        ).playbackSource
        let second = makeStoryCard(
            id: "story-2",
            playbackURL: URL(string: "https://customer.cloudflarestream.com/second-token/manifest/video.m3u8")!,
            storageKey: String(repeating: "b", count: 32)
        ).playbackSource

        XCTAssertFalse(second.representsSameMedia(as: first))
        XCTAssertEqual(
            StoryVideoPlaybackPool.prioritizedSources(
                sources: [first, second],
                activeIdentity: nil,
                limit: 3
            ),
            [first, second]
        )
    }

    func testPlaybackIdentityFallsBackToStoryIDWithoutRenditionMetadata() {
        let card = StoryCard(
            id: "story-without-rendition",
            creator: "Creator",
            handle: "creator",
            assetKind: .video,
            mediaUrl: URL(string: "https://example.com/video.mp4")!,
            thumbnailUrl: nil,
            placeholderUrl: nil,
            renditions: nil,
            title: "",
            processingStatus: "ready",
            textOverlays: nil,
            durationSeconds: 10,
            lastUploadedAt: nil,
            progressPercent: nil,
            timelineSegmentCount: nil
        )

        XCTAssertEqual(card.playbackIdentity, "story:story-without-rendition")
    }

    @MainActor
    func testPlayerPoolWaitsForAndHandsOffOwnedPreparation() async {
        let url = URL(string: "https://example.com/video.m3u8")!
        let expectedPlayer = AVPlayer()
        let pool = StoryVideoPlaybackPool(maxPreparedPlayers: 1) { requestedURL in
            XCTAssertEqual(requestedURL, url)
            try? await Task.sleep(for: .milliseconds(40))
            return StoryVideoPlaybackPool.PreparedPlayer(
                player: expectedPlayer,
                playbackURL: requestedURL,
                cacheState: "miss"
            )
        }

        pool.prepare(urls: [url], activeURL: nil)
        let prepared = await pool.takePreparedPlayer(
            for: url,
            waitUpTo: .milliseconds(250)
        )

        XCTAssertTrue(prepared?.player === expectedPlayer)
        XCTAssertEqual(prepared?.playbackURL, url)
    }

    @MainActor
    func testPlayerPoolDoesNotPruneAPlayerWhileItIsBeingAcquired() async {
        let requestedURL = URL(string: "https://example.com/requested.m3u8?token=one")!
        let unrelatedURL = URL(string: "https://example.com/unrelated.m3u8")!
        let expectedPlayer = AVPlayer()
        let pool = StoryVideoPlaybackPool(maxPreparedPlayers: 1) { url in
            try? await Task.sleep(for: .milliseconds(60))
            return StoryVideoPlaybackPool.PreparedPlayer(
                player: url == requestedURL ? expectedPlayer : AVPlayer(),
                playbackURL: url,
                cacheState: "miss"
            )
        }

        pool.prepare(urls: [requestedURL], activeURL: nil)
        let acquisition = Task { @MainActor in
            await pool.takePreparedPlayer(for: requestedURL, waitUpTo: .milliseconds(250))
        }
        await Task.yield()
        pool.prepare(urls: [unrelatedURL], activeURL: nil)

        let prepared = await acquisition.value
        XCTAssertTrue(prepared?.player === expectedPlayer)
    }

    @MainActor
    func testPlayerPoolTimesOutWithoutWaitingIndefinitely() async {
        let url = URL(string: "https://example.com/slow-video.m3u8")!
        let pool = StoryVideoPlaybackPool(maxPreparedPlayers: 1) { requestedURL in
            try? await Task.sleep(for: .seconds(1))
            return StoryVideoPlaybackPool.PreparedPlayer(
                player: AVPlayer(),
                playbackURL: requestedURL,
                cacheState: "miss"
            )
        }

        pool.prepare(urls: [url], activeURL: nil)
        let startedAt = Date()
        let prepared = await pool.takePreparedPlayer(
            for: url,
            waitUpTo: .milliseconds(30)
        )

        XCTAssertNil(prepared)
        XCTAssertLessThan(Date().timeIntervalSince(startedAt), 0.5)
    }

    @MainActor
    func testPlayerPoolContinuesTimedOutPreparationForLaterClaim() async {
        let url = URL(string: "https://example.com/continued-video.m3u8")!
        let expectedPlayer = AVPlayer()
        let pool = StoryVideoPlaybackPool(maxPreparedPlayers: 1) { requestedURL in
            try? await Task.sleep(for: .milliseconds(70))
            return StoryVideoPlaybackPool.PreparedPlayer(
                player: expectedPlayer,
                playbackURL: requestedURL,
                cacheState: "miss",
                wasPrerolled: true
            )
        }

        pool.prepare(urls: [url], activeURL: nil)
        let timedOut = await pool.takePreparedPlayer(
            for: url,
            waitUpTo: .milliseconds(10)
        )
        XCTAssertNil(timedOut)

        try? await Task.sleep(for: .milliseconds(100))
        let prepared = await pool.takePreparedPlayer(
            for: url,
            waitUpTo: .milliseconds(10)
        )

        XCTAssertTrue(prepared?.player === expectedPlayer)
        XCTAssertTrue(prepared?.wasPrerolled == true)
    }

    @MainActor
    func testPlayerPoolPromotesActiveSourceWhenLaunchWarmMisses() async {
        let active = StoryVideoPlaybackSource(
            identity: "story:active",
            url: URL(string: "https://example.com/active.m3u8")!
        )
        let adjacent = StoryVideoPlaybackSource(
            identity: "story:adjacent",
            url: URL(string: "https://example.com/adjacent.m3u8")!
        )
        let expectedPlayer = AVPlayer()
        let pool = StoryVideoPlaybackPool(maxPreparedPlayers: 1) { sourceURL in
            try? await Task.sleep(for: .milliseconds(20))
            return StoryVideoPlaybackPool.PreparedPlayer(
                player: sourceURL == active.url ? expectedPlayer : AVPlayer(),
                playbackURL: sourceURL,
                cacheState: "miss"
            )
        }

        pool.prepare(
            sources: [active, adjacent],
            activeIdentity: active.identity
        )
        let prepared = await pool.takePreparedPlayer(
            for: active,
            waitUpTo: .milliseconds(100)
        )

        XCTAssertTrue(prepared?.player === expectedPlayer)
        XCTAssertEqual(prepared?.playbackURL, active.url)
    }

    @MainActor
    func testVisibleStackWarmSelectsOneEarlyVideoPerStack() {
        let firstVideo = makeStoryStackItem(id: "video-1", assetKind: .video)
        let secondVideo = makeStoryStackItem(id: "video-2", assetKind: .video)
        let stacks = [
            makeStoryStack(
                id: "stack-1",
                items: [
                    makeStoryStackItem(id: "image-1", assetKind: .image),
                    firstVideo,
                ]
            ),
            makeStoryStack(
                id: "stack-2",
                items: [
                    makeStoryStackItem(
                        id: "processing-video",
                        assetKind: .video,
                        processingStatus: "processing"
                    ),
                    secondVideo,
                ]
            ),
            makeStoryStack(id: "stack-3", items: [firstVideo]),
        ]

        let sources = MediaEngine.initialVideoSources(in: stacks, limit: 4)

        XCTAssertEqual(sources.map(\.identity), ["story:video-1", "story:video-2"])
        XCTAssertEqual(sources.map(\.url), [firstVideo.mediaUrl, secondVideo.mediaUrl])
    }

    @MainActor
    func testVisibleStackWarmHonorsPlayerLimit() {
        let stacks = (0..<4).map { index in
            makeStoryStack(
                id: "stack-\(index)",
                items: [makeStoryStackItem(id: "video-\(index)", assetKind: .video)]
            )
        }

        XCTAssertEqual(
            MediaEngine.initialVideoSources(in: stacks, limit: 2).map(\.identity),
            ["story:video-0", "story:video-1"]
        )
        XCTAssertTrue(MediaEngine.initialVideoSources(in: stacks, limit: 0).isEmpty)
    }

    @MainActor
    func testSeekInvalidatesPreviouslyCompletedPreroll() {
        XCTAssertTrue(
            StoryVideoPlaybackPool.retainsPreroll(
                wasPrerolled: true,
                neededSeek: false
            )
        )
        XCTAssertFalse(
            StoryVideoPlaybackPool.retainsPreroll(
                wasPrerolled: true,
                neededSeek: true
            )
        )
        XCTAssertFalse(
            StoryVideoPlaybackPool.retainsPreroll(
                wasPrerolled: false,
                neededSeek: false
            )
        )
    }

    func testVideoStartupFastPathRequiresMatchingCompletedPreroll() {
        XCTAssertEqual(VideoStartupPolicy.freshForwardBufferDuration, 2)
        XCTAssertTrue(
            VideoStartupPolicy.canReuseCompletedPreroll(
                wasPrerolled: true,
                targetSeconds: 0,
                currentSeconds: 0.04
            )
        )
        XCTAssertFalse(
            VideoStartupPolicy.canReuseCompletedPreroll(
                wasPrerolled: false,
                targetSeconds: 0,
                currentSeconds: 0
            )
        )
        XCTAssertFalse(
            VideoStartupPolicy.canReuseCompletedPreroll(
                wasPrerolled: true,
                targetSeconds: 0,
                currentSeconds: 0.2
            )
        )
    }

    private func makeTestImageData(width: Int, height: Int) -> Data {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(
            size: CGSize(width: width, height: height),
            format: format
        )

        return renderer.pngData { context in
            UIColor.systemBlue.setFill()
            context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }
    }

    private func makeStoryCard(
        id: String,
        playbackURL: URL,
        storageKey: String
    ) -> StoryCard {
        StoryCard(
            id: id,
            creator: "Creator",
            handle: "creator",
            assetKind: .video,
            mediaUrl: playbackURL,
            thumbnailUrl: nil,
            placeholderUrl: nil,
            renditions: StoryMediaRenditions(
                playback: StoryMediaRendition(
                    mediaUrl: playbackURL,
                    thumbnailUrl: nil,
                    placeholderUrl: nil,
                    storageProvider: "cloudflare-stream",
                    storageKey: storageKey,
                    contentType: "application/x-mpegURL",
                    byteSize: nil,
                    checksum: nil,
                    width: nil,
                    height: nil,
                    durationMs: 10_000,
                    processingStatus: "ready"
                ),
                original: nil
            ),
            title: "",
            processingStatus: "ready",
            textOverlays: nil,
            durationSeconds: 10,
            lastUploadedAt: nil,
            progressPercent: nil,
            timelineSegmentCount: nil
        )
    }

    private func makeStoryStack(id: String, items: [StoryStackItem]) -> StoryStack {
        StoryStack(
            id: id,
            creatorId: "creator-\(id)",
            creator: "Creator",
            handle: "creator",
            avatarUrl: nil,
            items: items
        )
    }

    private func makeStoryStackItem(
        id: String,
        assetKind: SocialAssetKind,
        processingStatus: String = "ready"
    ) -> StoryStackItem {
        StoryStackItem(
            id: id,
            assetKind: assetKind,
            mediaUrl: URL(string: "https://example.com/\(id).\(assetKind == .video ? "m3u8" : "jpg")")!,
            thumbnailUrl: nil,
            placeholderUrl: nil,
            renditions: nil,
            title: "",
            processingStatus: processingStatus,
            textOverlays: nil,
            postedAt: "2026-08-23T00:00:00.000Z",
            durationSeconds: assetKind == .video ? 10 : nil,
            captionVerticalPercent: nil,
            stats: nil
        )
    }

    private func makeCropTestImageData(width: Int, height: Int) -> Data {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(
            size: CGSize(width: width, height: height),
            format: format
        )

        return renderer.pngData { context in
            UIColor.systemBlue.setFill()
            context.fill(CGRect(x: 0, y: 0, width: width, height: height))
            UIColor.systemRed.setFill()
            context.fill(CGRect(x: 0, y: 0, width: width, height: 100))
            context.fill(CGRect(x: 0, y: height - 100, width: width, height: 100))
        }
    }

    private func makeHorizontalEdgeMarkerImage(width: Int, height: Int) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(
            size: CGSize(width: width, height: height),
            format: format
        ).image { context in
            UIColor.systemBlue.setFill()
            context.fill(CGRect(x: 0, y: 0, width: width, height: height))
            UIColor.systemRed.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 24, height: height))
            UIColor.systemGreen.setFill()
            context.fill(CGRect(x: width - 24, y: 0, width: 24, height: height))
        }
    }

    private func makeOrientedJPEGData(width: Int, height: Int) throws -> Data {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let image = UIGraphicsImageRenderer(
            size: CGSize(width: width, height: height),
            format: format
        ).image { context in
            UIColor.systemGreen.setFill()
            context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }
        let cgImage = try XCTUnwrap(image.cgImage)
        let output = NSMutableData()
        let destination = try XCTUnwrap(
            CGImageDestinationCreateWithData(
                output,
                UTType.jpeg.identifier as CFString,
                1,
                nil
            )
        )
        let properties: [CFString: Any] = [
            kCGImagePropertyOrientation: CGImagePropertyOrientation.right.rawValue,
            kCGImageDestinationLossyCompressionQuality: 0.9,
        ]
        CGImageDestinationAddImage(destination, cgImage, properties as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        return output as Data
    }

    private func rgbaPixel(in image: CGImage, x: Int, y: Int) -> [UInt8]? {
        guard let pixelImage = image.cropping(
            to: CGRect(x: x, y: y, width: 1, height: 1)
        ) else {
            return nil
        }

        let bytes = UnsafeMutablePointer<UInt8>.allocate(capacity: 4)
        defer { bytes.deallocate() }
        bytes.initialize(repeating: 0, count: 4)

        guard let context = CGContext(
            data: bytes,
            width: 1,
            height: 1,
            bitsPerComponent: 8,
            bytesPerRow: 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            return nil
        }

        context.draw(pixelImage, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        return Array(UnsafeBufferPointer(start: bytes, count: 4))
    }
}
