import AVFoundation
import Photos
import PhotosUI
import SwiftUI
import UIKit

private struct StoryThumbnailOverlaySpec {
    let label: String
    let positionX: Double
    let positionY: Double
    let isLink: Bool
    var isQuoteReply = false
    var actorName: String?
    var actorHandle: String?
}

private final class StoryVideoThumbnailGenerationBox: @unchecked Sendable {
    private let lock = NSLock()
    private var generator: AVAssetImageGenerator?

    func set(_ generator: AVAssetImageGenerator) {
        lock.lock()
        self.generator = generator
        lock.unlock()
    }

    func cancel() {
        lock.lock()
        let generator = self.generator
        lock.unlock()
        generator?.cancelAllCGImageGeneration()
    }
}

private enum ComposerOverlayInputMode: Identifiable {
    case text
    case link

    var id: String {
        switch self {
        case .text: "text"
        case .link: "link"
        }
    }
}

fileprivate enum StoryComposerUploadStage {
    case preparing
    case imageQueue
    case video(StoryVideoUploadPhase)
    case visibleLocally(SocialAssetKind)

    var title: String {
        switch self {
        case .preparing:
            "Preparing story"
        case .imageQueue:
            "Posting photo"
        case .video(let phase):
            phase.statusLabel
        case .visibleLocally:
            "Visible in My Story"
        }
    }

    var subtitle: String {
        switch self {
        case .preparing:
            "Keeping the original media local while the upload starts."
        case .imageQueue:
            "Your photo will appear locally while it uploads."
        case .video(let phase):
            switch phase {
            case .inspect:
                "Checking video duration, audio, and format."
            case .prepare:
                "Optimizing playback without blocking the composer."
            case .thumbnailGenerate:
                "Building the poster frame shown in My Story."
            case .prepareUpload:
                "Creating a local story and starting the upload."
            case .thumbnailUpload:
                "Uploading the poster frame."
            case .videoUpload:
                "Your story is visible locally while this continues."
            case .completeStory:
                "Registering the story with your profile."
            case .processing:
                "Cloudflare will finish processing after it appears locally."
            }
        case .visibleLocally(let kind):
            switch kind {
            case .image:
                "Upload continues in My Story."
            case .video:
                "Processing continues in My Story."
            }
        }
    }

    var systemImage: String {
        switch self {
        case .preparing:
            "wand.and.stars"
        case .imageQueue:
            "photo"
        case .video:
            "video"
        case .visibleLocally:
            "checkmark.circle.fill"
        }
    }

    var progress: Double? {
        switch self {
        case .preparing:
            0.08
        case .imageQueue:
            0.28
        case .video(let phase):
            switch phase {
            case .inspect:
                0.12
            case .prepare:
                0.28
            case .thumbnailGenerate:
                0.46
            case .prepareUpload:
                0.68
            case .thumbnailUpload:
                0.76
            case .videoUpload:
                0.84
            case .completeStory:
                0.94
            case .processing:
                1
            }
        case .visibleLocally:
            1
        }
    }

    var allowsCancel: Bool {
        switch self {
        case .visibleLocally:
            false
        default:
            true
        }
    }
}

@MainActor
final class StoryComposerStore: ObservableObject {
    private let maxVideoDurationSeconds = 120

    @Published var caption = ""
    @Published var brandTags = ""
    @Published var textOverlay = ""
    @Published var textOverlayPositionX: Double = 50
    @Published var textOverlayPositionY: Double = 68
    @Published var linkUrl = ""
    @Published var linkLabel = ""
    @Published var linkOverlayPositionX: Double = 50
    @Published var linkOverlayPositionY: Double = 78
    @Published var quotedReply: QuotedStoryReply?
    @Published var quoteReplyPositionX: Double = 50
    @Published var quoteReplyPositionY: Double = 58
    @Published fileprivate var uploadStage: StoryComposerUploadStage?
    @Published var uploadStatus: String?
    @Published var error: String?
    @Published var lastUploadReport: String?
    @Published var isUploading = false

    private var thumbnailOverlaySpecs: [StoryThumbnailOverlaySpec] {
        var overlays: [StoryThumbnailOverlaySpec] = []
        let trimmedText = textOverlay.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedText.isEmpty {
            overlays.append(
                StoryThumbnailOverlaySpec(
                    label: trimmedText,
                    positionX: textOverlayPositionX,
                    positionY: textOverlayPositionY,
                    isLink: false
                )
            )
        }

        if let quotedReply {
            overlays.append(
                StoryThumbnailOverlaySpec(
                    label: quotedReply.message,
                    positionX: quoteReplyPositionX,
                    positionY: quoteReplyPositionY,
                    isLink: false,
                    isQuoteReply: true,
                    actorName: quotedReply.actorName,
                    actorHandle: quotedReply.actorHandle
                )
            )
        }

        let trimmedLinkLabel = linkLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedLinkLabel.isEmpty, !normalizedLinkUrl.isEmpty {
            overlays.append(
                StoryThumbnailOverlaySpec(
                    label: trimmedLinkLabel,
                    positionX: linkOverlayPositionX,
                    positionY: linkOverlayPositionY,
                    isLink: true
                )
            )
        }

        return overlays
    }

    private var pendingUploadDraft: PendingStoryUploadDraft {
        PendingStoryUploadDraft(
            caption: caption,
            brandTags: brandTags,
            textOverlay: textOverlay,
            textOverlayPositionX: textOverlayPositionX,
            textOverlayPositionY: textOverlayPositionY,
            linkLabel: linkLabel,
            linkUrl: normalizedLinkUrl,
            linkOverlayPositionX: linkOverlayPositionX,
            linkOverlayPositionY: linkOverlayPositionY,
            quoteReplyId: quotedReply?.id ?? "",
            quoteReplyPositionX: quoteReplyPositionX,
            quoteReplyPositionY: quoteReplyPositionY
        )
    }

    private var pendingTextOverlays: [StoryTextOverlay] {
        var overlays: [StoryTextOverlay] = []
        let trimmedText = textOverlay.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedText.isEmpty {
            overlays.append(
                StoryTextOverlay(
                    id: "pending-text-\(UUID().uuidString.lowercased())",
                    label: trimmedText,
                    positionX: textOverlayPositionX,
                    positionY: textOverlayPositionY,
                    kind: "text",
                    href: nil,
                    sourceInteractionId: nil,
                    sourceActorName: nil,
                    sourceActorHandle: nil,
                    sourceActorAvatarUrl: nil
                )
            )
        }

        if let quotedReply {
            overlays.append(
                StoryTextOverlay(
                    id: "pending-quote-\(quotedReply.id)",
                    label: quotedReply.message,
                    positionX: quoteReplyPositionX,
                    positionY: quoteReplyPositionY,
                    kind: "quote_reply",
                    href: nil,
                    sourceInteractionId: quotedReply.id,
                    sourceActorName: quotedReply.actorName,
                    sourceActorHandle: quotedReply.actorHandle,
                    sourceActorAvatarUrl: quotedReply.actorAvatarUrl
                )
            )
        }

        let trimmedLinkLabel = linkLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedLinkLabel.isEmpty,
           !normalizedLinkUrl.isEmpty,
           let url = URL(string: normalizedLinkUrl) {
            overlays.append(
                StoryTextOverlay(
                    id: "pending-link-\(UUID().uuidString.lowercased())",
                    label: trimmedLinkLabel,
                    positionX: linkOverlayPositionX,
                    positionY: linkOverlayPositionY,
                    kind: "link",
                    href: url,
                    sourceInteractionId: nil,
                    sourceActorName: nil,
                    sourceActorHandle: nil,
                    sourceActorAvatarUrl: nil
                )
            )
        }

        return overlays
    }

    func upload(
        media: StoryReadyMedia,
        api: APIClient,
        pendingUploads: PendingStoryUploadStore,
        onPendingUploadStarted: (PendingStoryUpload) -> Void,
        onUploadCompleted: @escaping (StoryUploadResponse) -> Void
    ) async -> Bool {
        isUploading = true
        error = nil
        lastUploadReport = nil
        normalizeLinkDraft()
        setUploadStage(.preparing)

        defer {
            isUploading = false
        }

        do {
            switch media {
            case .image(let upload):
                setUploadStage(.imageQueue)
                let pendingUpload = try pendingUploads.createImageUpload(
                    upload: upload,
                    draft: pendingUploadDraft,
                    textOverlays: pendingTextOverlays
                )
                onPendingUploadStarted(pendingUpload)
                pendingUploads.startUpload(
                    id: pendingUpload.id,
                    api: api,
                    onCompleted: onUploadCompleted
                )
                setUploadStage(.visibleLocally(.image))
                clearUploadedDraft()
            case .video(let video):
                try await prepareVideoStory(
                    video: video,
                    api: api,
                    pendingUploads: pendingUploads,
                    onPendingUploadStarted: onPendingUploadStarted,
                    onUploadCompleted: onUploadCompleted
                )
            }

            api.invalidateMobileFeedCache()
            api.invalidateStoryStacks(ids: ["my-story"])
            uploadStage = nil
            uploadStatus = nil
            return true
        } catch {
            if Self.isCancellation(error) {
                self.error = nil
            } else {
                self.error = error.localizedDescription
            }
            if let lastUploadReport {
                MediaPerformance.mark("video_upload_failed report=\(lastUploadReport)")
            }
            uploadStage = nil
            uploadStatus = nil
            return false
        }
    }

    func cancelUploadPreparation() {
        isUploading = false
        uploadStage = nil
        uploadStatus = nil
        error = nil
    }

    private func prepareVideoStory(
        video: StoryVideoUpload,
        api: APIClient,
        pendingUploads: PendingStoryUploadStore,
        onPendingUploadStarted: (PendingStoryUpload) -> Void,
        onUploadCompleted: @escaping (StoryUploadResponse) -> Void
    ) async throws {
        var attempt = StoryVideoUploadAttempt()

        do {
            attempt.begin(.inspect)
            setUploadStage(.video(.inspect))
            attempt.begin(.prepare)
            setUploadStage(.video(.prepare))
            let preparedVideo = try await StoryVideoUploadNormalizer.prepare(
                url: video.url,
                source: video.source,
                maxDurationSeconds: maxVideoDurationSeconds
            )
            attempt.attach(video: preparedVideo)
            lastUploadReport = attempt.report
            defer {
                if preparedVideo.shouldRemoveAfterUpload {
                    try? FileManager.default.removeItem(at: preparedVideo.url)
                }
            }

            attempt.begin(.thumbnailGenerate)
            setUploadStage(.video(.thumbnailGenerate))
            let thumbnailData = await optionalVideoThumbnailData(
                for: preparedVideo.url,
                durationMs: preparedVideo.durationMs,
                overlays: thumbnailOverlaySpecs
            )

            attempt.begin(.prepareUpload)
            setUploadStage(.video(.prepareUpload))
            let pendingUpload = try pendingUploads.createVideoUpload(
                sourceURL: preparedVideo.url,
                thumbnailData: thumbnailData,
                durationMs: preparedVideo.durationMs,
                pipeline: preparedVideo.shouldUploadOriginalQuality ? .originalQualityVideo : .videoTus,
                draft: pendingUploadDraft,
                textOverlays: pendingTextOverlays
            )
            onPendingUploadStarted(pendingUpload)
            clearUploadedDraft()

            setUploadStage(.visibleLocally(.video))
            pendingUploads.startUpload(
                id: pendingUpload.id,
                api: api,
                onCompleted: onUploadCompleted
            )
            MediaPerformance.mark("video_upload_queued attempt=\(attempt.id) pendingId=\(pendingUpload.id)")
            lastUploadReport = attempt.report
        } catch {
            attempt.recordFailure(error)
            lastUploadReport = attempt.report
            throw error
        }
    }

    private func uploadVideoThumbnailIfPossible(
        _ data: Data?,
        upload: VideoUploadResponse,
        api: APIClient
    ) async -> Data? {
        guard let data else {
            return nil
        }

        do {
            try await api.uploadVideoThumbnail(data: data, upload: upload)
            return data
        } catch {
            MediaPerformance.mark("video_thumbnail_upload_failed")
            return nil
        }
    }

    private func videoFileSize(for url: URL) throws -> Int64 {
        guard let size = try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber,
              size.int64Value > 0 else {
            throw APIClientError.invalidResponse
        }

        return size.int64Value
    }

    private func videoDurationMs(for url: URL) async -> Int? {
        let asset = AVURLAsset(url: url)
        let duration: CMTime?

        if #available(iOS 16.0, *) {
            duration = try? await asset.load(.duration)
        } else {
            duration = asset.duration
        }

        guard let duration else {
            return nil
        }

        let seconds = CMTimeGetSeconds(duration)
        guard seconds.isFinite, seconds > 0 else {
            return nil
        }

        return max(1, Int((seconds * 1_000).rounded()))
    }

    private func optionalVideoThumbnailData(
        for url: URL,
        durationMs: Int?,
        overlays: [StoryThumbnailOverlaySpec]
    ) async -> Data? {
        do {
            return try await withThrowingTaskGroup(of: Data.self) { group in
                group.addTask {
                    try await self.generateVideoThumbnailData(
                        for: url,
                        durationMs: durationMs,
                        overlays: overlays
                    )
                }
                group.addTask {
                    try await Task.sleep(nanoseconds: 3_000_000_000)
                    throw APIClientError.server("Could not prepare video thumbnail. Try a different video.", 0)
                }

                guard let data = try await group.next() else {
                    throw APIClientError.server("Could not prepare video thumbnail. Try a different video.", 0)
                }

                group.cancelAll()
                return data
            }
        } catch {
            MediaPerformance.mark("video_thumbnail_generation_failed")
            return nil
        }
    }

    private func generateVideoThumbnailData(
        for url: URL,
        durationMs: Int?,
        overlays: [StoryThumbnailOverlaySpec]
    ) async throws -> Data {
        let image = try await generateVideoThumbnailImage(for: url, durationMs: durationMs)
        let thumbnail = compositedThumbnailImage(
            baseImage: UIImage(cgImage: image),
            overlays: overlays
        )

        let maxThumbnailBytes = 2 * 1024 * 1024
        let preferredData = thumbnail.jpegData(compressionQuality: 0.9)
        let fallbackData = thumbnail.jpegData(compressionQuality: 0.82)
        let data = [preferredData, fallbackData]
            .compactMap { $0 }
            .first { !$0.isEmpty && $0.count <= maxThumbnailBytes }

        guard let data else {
            throw APIClientError.server("Could not prepare video thumbnail. Try a different video.", 0)
        }

        return data
    }

    private func uploadOriginalQualityVideoThumbnailIfPossible(
        _ data: Data?,
        upload: OriginalVideoUploadResponse,
        api: APIClient
    ) async -> Data? {
        guard let data else {
            return nil
        }

        do {
            try await api.uploadOriginalQualityVideoThumbnail(data: data, upload: upload)
        } catch {
            MediaPerformance.mark("video_original_thumbnail_upload_failed")
            return nil
        }

        return data
    }

    private func generateVideoThumbnailImage(for url: URL, durationMs: Int?) async throws -> CGImage {
        let generationBox = StoryVideoThumbnailGenerationBox()

        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                let asset = AVURLAsset(url: url)
                let generator = AVAssetImageGenerator(asset: asset)
                generator.appliesPreferredTrackTransform = true
                generator.maximumSize = CGSize(width: 1080, height: 1920)
                generator.requestedTimeToleranceBefore = .zero
                generator.requestedTimeToleranceAfter = CMTime(seconds: 0.04, preferredTimescale: 600)
                generationBox.set(generator)

                let lock = NSLock()
                var didResume = false
                var remaining = 0
                var lastError: Error?
                let times = videoThumbnailCandidateTimes(durationMs: durationMs)
                remaining = times.count

                func finish(_ result: Result<CGImage, Error>) {
                    lock.lock()
                    guard !didResume else {
                        lock.unlock()
                        return
                    }
                    didResume = true
                    lock.unlock()
                    generator.cancelAllCGImageGeneration()
                    continuation.resume(with: result)
                }

                func recordFailure(_ error: Error?) {
                    lock.lock()
                    guard !didResume else {
                        lock.unlock()
                        return
                    }
                    remaining -= 1
                    if let error {
                        lastError = error
                    }
                    let shouldFinish = remaining <= 0
                    lock.unlock()

                    if shouldFinish {
                        finish(.failure(lastError ?? APIClientError.server("Could not prepare video thumbnail. Try a different video.", 0)))
                    }
                }

                generator.generateCGImagesAsynchronously(forTimes: times.map { NSValue(time: $0) }) { _, image, _, result, error in
                    switch result {
                    case .succeeded:
                        if let image {
                            finish(.success(image))
                        } else {
                            recordFailure(nil)
                        }
                    case .failed:
                        recordFailure(error)
                    case .cancelled:
                        recordFailure(error ?? APIClientError.server("Could not prepare video thumbnail. Try a different video.", 0))
                    @unknown default:
                        recordFailure(error)
                    }
                }
            }
        } onCancel: {
            generationBox.cancel()
        }
    }

    private func compositedThumbnailImage(
        baseImage: UIImage,
        overlays: [StoryThumbnailOverlaySpec]
    ) -> UIImage {
        let visibleOverlays = overlays.filter {
            !$0.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }

        guard !visibleOverlays.isEmpty else {
            return baseImage
        }

        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let size = baseImage.size
        let renderer = UIGraphicsImageRenderer(size: size, format: format)

        return renderer.image { context in
            baseImage.draw(in: CGRect(origin: .zero, size: size))

            for overlay in visibleOverlays.prefix(2) {
                drawThumbnailOverlay(overlay, in: size, context: context.cgContext)
            }
        }
    }

    private func drawThumbnailOverlay(
        _ overlay: StoryThumbnailOverlaySpec,
        in canvasSize: CGSize,
        context: CGContext
    ) {
        let scale = max(canvasSize.width / 390, 1)
        if overlay.isQuoteReply {
            drawThumbnailQuoteReplyOverlay(overlay, in: canvasSize, scale: scale, context: context)
            return
        }

        let fontSize = min(max(18 * scale, 24), 42)
        let horizontalPadding = 14 * scale
        let verticalPadding = 8 * scale
        let maxTextWidth = max(canvasSize.width - 72 * scale, 120)
        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.alignment = .center
        paragraphStyle.lineBreakMode = .byWordWrapping
        let attributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: fontSize, weight: .bold),
            .foregroundColor: UIColor.white,
            .paragraphStyle: paragraphStyle,
        ]
        let label = overlay.label.trimmingCharacters(in: .whitespacesAndNewlines)
        let text = overlay.isLink ? "\(label)" : label
        let textRect = (text as NSString).boundingRect(
            with: CGSize(width: maxTextWidth, height: canvasSize.height),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: attributes,
            context: nil
        )
        let chipSize = CGSize(
            width: min(max(textRect.width + horizontalPadding * 2, 70 * scale), canvasSize.width - 32 * scale),
            height: textRect.height + verticalPadding * 2
        )
        let rawCenter = CGPoint(
            x: canvasSize.width * CGFloat(min(max(overlay.positionX, 0), 100) / 100),
            y: canvasSize.height * CGFloat(min(max(overlay.positionY, 0), 100) / 100)
        )
        let center = CGPoint(
            x: min(max(rawCenter.x, chipSize.width / 2 + 8 * scale), canvasSize.width - chipSize.width / 2 - 8 * scale),
            y: min(max(rawCenter.y, chipSize.height / 2 + 8 * scale), canvasSize.height - chipSize.height / 2 - 8 * scale)
        )
        let chipRect = CGRect(
            x: center.x - chipSize.width / 2,
            y: center.y - chipSize.height / 2,
            width: chipSize.width,
            height: chipSize.height
        )

        context.saveGState()
        context.setShadow(offset: CGSize(width: 0, height: 6 * scale), blur: 12 * scale, color: UIColor.black.withAlphaComponent(0.24).cgColor)
        let chipPath = UIBezierPath(roundedRect: chipRect, cornerRadius: chipRect.height / 2)
        UIColor.black.withAlphaComponent(overlay.isLink ? 0.56 : 0.42).setFill()
        chipPath.fill()
        context.restoreGState()

        UIColor.white.withAlphaComponent(0.2).setStroke()
        chipPath.lineWidth = max(scale, 1)
        chipPath.stroke()

        let labelRect = CGRect(
            x: chipRect.minX + horizontalPadding,
            y: chipRect.minY + verticalPadding,
            width: chipRect.width - horizontalPadding * 2,
            height: chipRect.height - verticalPadding * 2
        )
        (text as NSString).draw(with: labelRect, options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: attributes, context: nil)
    }

    private func drawThumbnailQuoteReplyOverlay(
        _ overlay: StoryThumbnailOverlaySpec,
        in canvasSize: CGSize,
        scale: CGFloat,
        context: CGContext
    ) {
        let name = (overlay.actorName ?? "Reply").trimmingCharacters(in: .whitespacesAndNewlines)
        let handle = overlay.actorHandle?.trimmingCharacters(in: .whitespacesAndNewlines)
        let message = overlay.label.trimmingCharacters(in: .whitespacesAndNewlines)
        let cardWidth = min(max(canvasSize.width * 0.72, 240 * scale), canvasSize.width - 32 * scale)
        let horizontalPadding = 12 * scale
        let verticalPadding = 10 * scale
        let avatarSize = 24 * scale
        let titleFont = min(max(12 * scale, 16), 28)
        let handleFont = min(max(10 * scale, 13), 22)
        let messageFont = min(max(15 * scale, 20), 34)
        let textWidth = cardWidth - horizontalPadding * 2
        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.alignment = .left
        paragraphStyle.lineBreakMode = .byTruncatingTail
        let nameAttributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: titleFont, weight: .bold),
            .foregroundColor: UIColor.white,
            .paragraphStyle: paragraphStyle,
        ]
        let handleAttributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: handleFont, weight: .semibold),
            .foregroundColor: UIColor.white.withAlphaComponent(0.72),
            .paragraphStyle: paragraphStyle,
        ]
        let messageAttributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: messageFont, weight: .bold),
            .foregroundColor: UIColor.white,
            .paragraphStyle: paragraphStyle,
        ]
        let messageRect = (message as NSString).boundingRect(
            with: CGSize(width: textWidth, height: messageFont * 2.5),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: messageAttributes,
            context: nil
        )
        let headerHeight = max(avatarSize, titleFont + (handle?.isEmpty == false ? handleFont : 0) + 2 * scale)
        let cardHeight = verticalPadding * 2 + headerHeight + 8 * scale + messageRect.height
        let rawCenter = CGPoint(
            x: canvasSize.width * CGFloat(min(max(overlay.positionX, 0), 100) / 100),
            y: canvasSize.height * CGFloat(min(max(overlay.positionY, 0), 100) / 100)
        )
        let center = CGPoint(
            x: min(max(rawCenter.x, cardWidth / 2 + 8 * scale), canvasSize.width - cardWidth / 2 - 8 * scale),
            y: min(max(rawCenter.y, cardHeight / 2 + 8 * scale), canvasSize.height - cardHeight / 2 - 8 * scale)
        )
        let cardRect = CGRect(
            x: center.x - cardWidth / 2,
            y: center.y - cardHeight / 2,
            width: cardWidth,
            height: cardHeight
        )

        context.saveGState()
        UIColor.black.withAlphaComponent(0.68).setFill()
        UIBezierPath(roundedRect: cardRect, cornerRadius: 8 * scale).fill()
        UIColor.white.withAlphaComponent(0.18).setStroke()
        UIBezierPath(roundedRect: cardRect, cornerRadius: 8 * scale).stroke()
        UIColor(red: 224 / 255, green: 22 / 255, blue: 22 / 255, alpha: 1).setFill()
        UIBezierPath(ovalIn: CGRect(
            x: cardRect.minX + horizontalPadding,
            y: cardRect.minY + verticalPadding,
            width: avatarSize,
            height: avatarSize
        )).fill()
        context.restoreGState()

        let initial = name.first.map { String($0).uppercased() } ?? "R"
        let initialAttributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: max(avatarSize * 0.48, 10), weight: .black),
            .foregroundColor: UIColor.white,
        ]
        let avatarRect = CGRect(
            x: cardRect.minX + horizontalPadding,
            y: cardRect.minY + verticalPadding,
            width: avatarSize,
            height: avatarSize
        )
        let initialSize = (initial as NSString).size(withAttributes: initialAttributes)
        (initial as NSString).draw(
            at: CGPoint(x: avatarRect.midX - initialSize.width / 2, y: avatarRect.midY - initialSize.height / 2),
            withAttributes: initialAttributes
        )

        let titleX = avatarRect.maxX + 7 * scale
        let titleWidth = cardRect.maxX - horizontalPadding - titleX
        (name as NSString).draw(
            with: CGRect(x: titleX, y: cardRect.minY + verticalPadding - 1 * scale, width: titleWidth, height: titleFont + 3 * scale),
            options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
            attributes: nameAttributes,
            context: nil
        )
        if let handle, !handle.isEmpty {
            ("@\(handle)" as NSString).draw(
                with: CGRect(x: titleX, y: cardRect.minY + verticalPadding + titleFont + 1 * scale, width: titleWidth, height: handleFont + 3 * scale),
                options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
                attributes: handleAttributes,
                context: nil
            )
        }

        (message as NSString).draw(
            with: CGRect(
                x: cardRect.minX + horizontalPadding,
                y: cardRect.minY + verticalPadding + headerHeight + 8 * scale,
                width: textWidth,
                height: messageRect.height
            ),
            options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
            attributes: messageAttributes,
            context: nil
        )
    }

    private func videoThumbnailCandidateTimes(durationMs: Int?) -> [CMTime] {
        let durationSeconds = durationMs.map { max(Double($0) / 1_000, 0.1) } ?? 1
        let candidateSeconds = [
            min(0.08, max(durationSeconds - 0.02, 0)),
            min(0.16, max(durationSeconds - 0.02, 0)),
            max(durationSeconds * 0.5, 0),
            0,
        ]
        var seen = Set<Int>()

        return candidateSeconds.compactMap { seconds in
            let milliseconds = Int((seconds * 1_000).rounded())
            guard !seen.contains(milliseconds) else {
                return nil
            }
            seen.insert(milliseconds)
            return CMTime(seconds: max(seconds, 0), preferredTimescale: 600)
        }
    }

    var normalizedLinkUrl: String {
        normalizedUrlString(linkUrl)
    }

    func normalizeLinkDraft() {
        linkUrl = normalizedLinkUrl
        if linkLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            linkLabel = linkHostLabel(from: linkUrl)
        }
    }

    func applyQuotedReply(_ quote: QuotedStoryReply?) {
        guard quotedReply != quote else {
            return
        }

        quotedReply = quote
        quoteReplyPositionX = 50
        quoteReplyPositionY = 58
    }

    func clearQuotedReply() {
        quotedReply = nil
        quoteReplyPositionX = 50
        quoteReplyPositionY = 58
    }

    private func clearUploadedDraft() {
        caption = ""
        brandTags = ""
        textOverlay = ""
        textOverlayPositionX = 50
        textOverlayPositionY = 68
        linkUrl = ""
        linkLabel = ""
        linkOverlayPositionX = 50
        linkOverlayPositionY = 78
        clearQuotedReply()
    }

    private func normalizedUrlString(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return ""
        }

        if trimmed.contains("://") {
            return trimmed
        }

        return "https://\(trimmed)"
    }

    private func linkHostLabel(from value: String) -> String {
        guard let url = URL(string: value),
              let host = url.host?.replacingOccurrences(of: "www.", with: ""),
              !host.isEmpty else {
            return "Link"
        }

        return host
    }

    private func setUploadStage(_ stage: StoryComposerUploadStage) {
        uploadStage = stage
        uploadStatus = stage.title
    }

    private static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError {
            return true
        }

        if let urlError = error as? URLError {
            return urlError.code == .cancelled
        }

        let nsError = error as NSError
        return nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled
    }
}

struct StoryComposerView: View {
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var pendingStoryUploads: PendingStoryUploadStore
    @StateObject private var camera = CameraController()
    @StateObject private var store = StoryComposerStore()
    @State private var photoPickerItem: PhotosPickerItem?
    @State private var overlayInputMode: ComposerOverlayInputMode?
    @State private var recordingStartedAt = Date()
    @State private var recordingElapsed: TimeInterval = 0
    @State private var latestLibraryThumbnail: UIImage?
    @State private var mode: StoryComposerMode = .capture
    @State private var uploadTask: Task<Void, Never>?
    @FocusState private var isOverlayInputFocused: Bool
    let quotedReply: QuotedStoryReply?
    var clearQuotedReply: () -> Void = {}
    var onPendingUploadStarted: () -> Void = {}
    var onUploadRegistered: (StoryUploadResponse) -> Void = { _ in }

    private let maxVideoSegments = 6
    private let videoSegmentDuration: TimeInterval = 10
    private let footerSideControlSize: CGFloat = 58
    private let footerShutterSlotSize: CGFloat = 88
    private let footerHorizontalInset: CGFloat = 28
    private let footerBottomInset: CGFloat = 28
    private let selectedMediaFooterBottomInset: CGFloat = 28
    private var maxRecordingDuration: TimeInterval { TimeInterval(maxVideoSegments) * videoSegmentDuration }
    private let recordingTimer = Timer.publish(every: 0.05, on: .main, in: .common).autoconnect()

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Color.black.ignoresSafeArea()

                mediaPreview
                    .frame(width: proxy.size.width, height: proxy.size.height)
                    .clipped()
                    .overlay(Color.black.opacity(0.18))
                    .overlay {
                        composerOverlayLayer
                    }

                VStack(spacing: 0) {
                    ZStack(alignment: .top) {
                        Label("Story", systemImage: "camera.fill")
                            .font(.system(size: 15, weight: .bold))
                            .padding(.horizontal, 14)
                            .frame(height: 38)
                            .background(.black.opacity(0.34), in: Capsule())

                        HStack(alignment: .top) {
                            Button {
                                resetCapture(clearQuote: true)
                            } label: {
                                Image(systemName: "xmark")
                                    .font(.system(size: 18, weight: .bold))
                                    .frame(width: 42, height: 42)
                                    .background(.black.opacity(0.34), in: Circle())
                            }
                            .buttonStyle(.plain)

                            Spacer()

                            VStack(spacing: 8) {
                                TopAvatarSpacer()

                                if activeMedia == nil {
                                    Button {
                                        camera.switchCamera()
                                    } label: {
                                        Image(systemName: "camera.rotate")
                                            .font(.system(size: 18, weight: .bold))
                                            .frame(width: 42, height: 42)
                                            .background(.black.opacity(0.34), in: Circle())
                                    }
                                    .buttonStyle(.plain)
                                    .disabled(camera.isRecording)
                                } else {
                                    composerToolRail
                                }
                            }
                        }
                    }
                    .padding(.horizontal, UBEYEMetrics.screenInset)
                    .padding(.top, 14)
                    .frame(maxWidth: .infinity)

                    Spacer()

                    if activeMedia == nil {
                        captureSourceBar
                            .padding(.bottom, 14)
                    }

                    if let uploadStage = store.uploadStage {
                        StoryComposerUploadPanel(stage: uploadStage) {
                            cancelComposerUpload()
                        }
                        .padding(.horizontal, 22)
                        .padding(.bottom, 16)
                    } else if let error = store.error ?? (activeMedia == nil ? camera.error : nil) {
                        Text(error)
                            .font(.system(size: 16, weight: .bold))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(Color.ubeyeRed.opacity(0.9), in: Capsule())
                            .padding(.horizontal, 22)
                            .padding(.bottom, 16)
                    } else if activeMedia == nil {
                        Text("Tap for photo, hold for video")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(.white.opacity(0.65))
                            .padding(.bottom, 24)
                    }

                    composerFooter
                        .padding(.horizontal, footerHorizontalInset)
                        .padding(.bottom, activeMedia == nil ? footerBottomInset : selectedMediaFooterBottomInset)
                }
                .frame(width: proxy.size.width, height: proxy.size.height)
                .foregroundStyle(.white)
                .zIndex(1)
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .task {
            store.applyQuotedReply(quotedReply)
            await camera.requestAccessAndConfigure()
            await refreshLatestLibraryThumbnail()
        }
        .onChange(of: quotedReply) { _, quote in
            store.applyQuotedReply(quote)
        }
        .onDisappear {
            camera.stop()
        }
        .onChange(of: photoPickerItem) { _, item in
            Task {
                await loadPickedItem(item)
            }
        }
        .onChange(of: camera.capturedPhoto) { _, photo in
            if let photo {
                enterReadyMedia(with: StoryMediaIngestor.readyMedia(fromCameraPhoto: photo))
            }
        }
        .onChange(of: camera.capturedVideoURL) { _, url in
            if let url {
                enterReadyMedia(
                    with: StoryMediaIngestor.readyMedia(
                        fromCameraVideoURL: url,
                        cameraPosition: camera.capturedVideoCameraPosition
                    )
                )
                recordingElapsed = 0
            }
        }
        .onReceive(recordingTimer) { now in
            updateRecordingProgress(now: now)
        }
        .onChange(of: isOverlayInputFocused) { _, isFocused in
            if !isFocused {
                finishOverlayInput()
            }
        }
    }

    private var captureFooter: some View {
        StoryComposerFooter(
            leftSlotSize: footerSideControlSize,
            centerSlotSize: footerShutterSlotSize,
            rightSlotSize: footerSideControlSize
        ) {
            StoryComposerFooterPlaceholder(size: footerSideControlSize)
        } center: {
            StoryShutterButton(
                isRecording: camera.isRecording,
                progress: recordingProgress,
                segmentCount: recordingSegmentCount,
                maxSegments: maxVideoSegments,
                capturePhoto: capturePhoto,
                startRecording: startRecording,
                stopRecording: stopRecording
            )
            .disabled(store.isUploading)
        } right: {
            StoryComposerFooterPlaceholder(size: footerSideControlSize)
        }
    }

    private var captureSourceBar: some View {
        HStack(spacing: 6) {
            Button {
                resetCapture()
            } label: {
                ComposerSourcePill(
                    title: "Camera",
                    systemImage: "camera.fill",
                    isSelected: true
                )
            }
            .buttonStyle(.plain)
            .disabled(store.isUploading)

            PhotosPicker(
                selection: $photoPickerItem,
                matching: .any(of: [.images, .videos]),
                preferredItemEncoding: .current
            ) {
                ComposerLibrarySourcePill(image: latestLibraryThumbnail)
            }
            .disabled(store.isUploading)
        }
        .padding(4)
        .background(.black.opacity(0.34), in: Capsule())
        .overlay(Capsule().stroke(.white.opacity(0.14), lineWidth: 1))
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var composerFooter: some View {
        Group {
            if activeMedia == nil {
                captureFooter
            } else {
                selectedMediaFooter
            }
        }
        .frame(maxWidth: .infinity, minHeight: footerShutterSlotSize)
    }

    private var selectedMediaFooter: some View {
        StoryComposerFooter(
            leftSlotSize: footerSideControlSize,
            centerSlotSize: footerShutterSlotSize,
            rightSlotSize: footerSideControlSize,
            verticalAlignment: .bottom,
            frameAlignment: .bottom
        ) {
            StoryComposerFooterPlaceholder(size: footerSideControlSize)
        } center: {
            StoryComposerFooterPlaceholder(size: footerShutterSlotSize)
        } right: {
            uploadStoryButton
        }
    }

    private var uploadStoryButton: some View {
        Button {
            Task {
                await uploadSelectedMedia()
            }
        } label: {
            uploadButtonIcon
        }
        .buttonStyle(.plain)
        .disabled(store.isUploading)
        .accessibilityLabel("Upload story")
        .accessibilityIdentifier("story-composer-upload-button")
    }

    private var uploadButtonIcon: some View {
        Image(systemName: store.isUploading ? "hourglass" : "paperplane.fill")
            .font(.system(size: 21, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: 58, height: 58)
            .background(.black.opacity(0.34), in: Circle())
    }

    private var composerToolRail: some View {
        VStack(spacing: 8) {
            Button {
                openOverlayInput(.text)
            } label: {
                Text("Aa")
                    .font(.system(size: 18, weight: .bold))
                    .frame(width: 42, height: 42)
                    .background(.black.opacity(0.34), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Add text overlay")

            Button {
                openOverlayInput(.link)
            } label: {
                Image(systemName: "link")
                    .font(.system(size: 18, weight: .bold))
                    .frame(width: 42, height: 42)
                    .background(.black.opacity(0.34), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Add link overlay")
        }
    }

    @ViewBuilder
    private var composerOverlayLayer: some View {
        if activeMedia != nil {
            GeometryReader { proxy in
                if overlayInputMode == .text || !store.textOverlay.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    EditableStoryOverlayChip(
                        text: $store.textOverlay,
                        placeholder: "Text",
                        systemImage: nil,
                        positionX: store.textOverlayPositionX,
                        positionY: store.textOverlayPositionY,
                        size: proxy.size,
                        displayText: nil,
                        isEditing: overlayInputMode == .text,
                        isFocused: $isOverlayInputFocused,
                        keyboardType: .default,
                        autocapitalization: .sentences,
                        autocorrectionDisabled: false,
                        onSubmit: finishOverlayInput,
                        onTapToEdit: {
                            openOverlayInput(.text)
                        }
                    ) { x, y in
                        store.textOverlayPositionX = x
                        store.textOverlayPositionY = y
                    }
                }

                if overlayInputMode == .link || !store.normalizedLinkUrl.isEmpty {
                    EditableStoryOverlayChip(
                        text: $store.linkUrl,
                        placeholder: "Paste link",
                        systemImage: "link",
                        positionX: store.linkOverlayPositionX,
                        positionY: store.linkOverlayPositionY,
                        size: proxy.size,
                        displayText: store.linkLabel.isEmpty ? nil : store.linkLabel,
                        isEditing: overlayInputMode == .link,
                        isFocused: $isOverlayInputFocused,
                        keyboardType: .URL,
                        autocapitalization: .never,
                        autocorrectionDisabled: true,
                        onSubmit: finishOverlayInput,
                        onTapToEdit: {
                            openOverlayInput(.link)
                        }
                    ) { x, y in
                        store.linkOverlayPositionX = x
                        store.linkOverlayPositionY = y
                    }
                }

                if let quotedReply = store.quotedReply {
                    DraggableQuoteReplyOverlay(
                        quote: quotedReply,
                        positionX: store.quoteReplyPositionX,
                        positionY: store.quoteReplyPositionY,
                        size: proxy.size,
                        clear: clearCurrentQuotedReply
                    ) { x, y in
                        store.quoteReplyPositionX = x
                        store.quoteReplyPositionY = y
                    }
                }
            }
        }
    }

    private func openOverlayInput(_ mode: ComposerOverlayInputMode) {
        guard activeMedia != nil else {
            return
        }

        overlayInputMode = mode
        Task {
            try? await Task.sleep(for: .milliseconds(120))
            await MainActor.run {
                isOverlayInputFocused = true
            }
        }
    }

    private func finishOverlayInput() {
        if overlayInputMode == .link {
            store.normalizeLinkDraft()
        }

        isOverlayInputFocused = false
        overlayInputMode = nil
    }

    private func clearCurrentQuotedReply() {
        store.clearQuotedReply()
        clearQuotedReply()
    }

    @ViewBuilder
    private var mediaPreview: some View {
        switch activeMedia {
        case .image(let upload):
            Image(uiImage: upload.image)
                .resizable()
                .scaledToFill()
        case .video(let video):
            StoryVideoPreview(
                url: video.url,
                mirrorsHorizontally: video.source == .cameraFront
            )
        case nil:
            if let photo = camera.capturedPhoto {
                Image(uiImage: photo.image)
                    .resizable()
                    .scaledToFill()
                    .onAppear {
                        enterReadyMedia(with: StoryMediaIngestor.readyMedia(fromCameraPhoto: photo))
                    }
            } else if let videoURL = camera.capturedVideoURL {
                StoryVideoPreview(
                    url: videoURL,
                    mirrorsHorizontally: camera.capturedVideoCameraPosition == .front
                )
                    .onAppear {
                        enterReadyMedia(
                            with: StoryMediaIngestor.readyMedia(
                                fromCameraVideoURL: videoURL,
                                cameraPosition: camera.capturedVideoCameraPosition
                            )
                        )
                    }
            } else if camera.authorizationStatus == .authorized {
                CameraPreview(
                    session: camera.session,
                    cameraPosition: camera.cameraPosition,
                    device: camera.activeVideoDevice
                )
            } else {
                EmptyStateView(title: "Camera unavailable", message: "Enable camera access or choose media from your library.", systemImage: "camera")
            }
        }
    }

    private func loadPickedItem(_ item: PhotosPickerItem?) async {
        guard let item else {
            return
        }

        store.error = nil
        store.uploadStatus = nil
        overlayInputMode = nil
        isOverlayInputFocused = false
        camera.capturedPhoto = nil
        camera.capturedVideoURL = nil
        defer {
            photoPickerItem = nil
        }

        do {
            let media = try await StoryMediaIngestor.readyMedia(fromLibraryItem: item)
            enterReadyMedia(with: media)
        } catch {
            store.error = (error as? LocalizedError)?.errorDescription ??
                "Could not load that media. Try another photo or video."
        }
    }

    private func refreshLatestLibraryThumbnail() async {
        latestLibraryThumbnail = await latestAuthorizedPhotoLibraryThumbnail()
    }

    private func latestAuthorizedPhotoLibraryThumbnail() async -> UIImage? {
        await Task.detached(priority: .userInitiated) {
            let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)

            guard status == .authorized || status == .limited else {
                return nil
            }

            let fetchOptions = PHFetchOptions()
            fetchOptions.fetchLimit = 1
            fetchOptions.sortDescriptors = [
                NSSortDescriptor(key: "creationDate", ascending: false)
            ]

            let assets = PHAsset.fetchAssets(with: .image, options: fetchOptions)
            guard let asset = assets.firstObject else {
                return nil
            }

            let requestOptions = PHImageRequestOptions()
            requestOptions.deliveryMode = .opportunistic
            requestOptions.resizeMode = .fast
            requestOptions.isNetworkAccessAllowed = true
            requestOptions.isSynchronous = true

            var thumbnail: UIImage?
            PHImageManager.default().requestImage(
                for: asset,
                targetSize: CGSize(width: 180, height: 180),
                contentMode: .aspectFill,
                options: requestOptions
            ) { image, _ in
                thumbnail = image
            }

            return thumbnail
        }.value
    }

    private var recordingProgress: Double {
        guard camera.isRecording else {
            return 0
        }

        let segmentElapsed = recordingElapsed.truncatingRemainder(dividingBy: videoSegmentDuration)
        return min(max(segmentElapsed / videoSegmentDuration, 0), 1)
    }

    private var recordingSegmentCount: Int {
        guard camera.isRecording else {
            return 0
        }

        return min(Int(recordingElapsed / videoSegmentDuration) + 1, maxVideoSegments)
    }

    private func capturePhoto() {
        guard !camera.isRecording, !store.isUploading else {
            return
        }

        resetCapture()
        camera.capturePhoto()
    }

    private func startRecording() {
        guard !camera.isRecording, !store.isUploading else {
            return
        }

        resetCapture()
        recordingElapsed = 0
        recordingStartedAt = Date()
        camera.startRecording()
    }

    private func stopRecording() {
        guard camera.isRecording else {
            return
        }

        camera.stopRecording()
    }

    private var activeMedia: StoryReadyMedia? {
        mode.media
    }

    private func enterReadyMedia(with media: StoryReadyMedia) {
        store.error = nil
        store.uploadStatus = nil
        overlayInputMode = nil
        isOverlayInputFocused = false
        mode = .ready(media)
    }

    private func uploadSelectedMedia() async {
        guard !store.isUploading, uploadTask == nil else {
            return
        }

        guard let media = activeMedia else {
            store.error = "Capture or choose story media first."
            return
        }

        uploadTask = Task { @MainActor in
            _ = await store.upload(
                media: media,
                api: api,
                pendingUploads: pendingStoryUploads,
                onPendingUploadStarted: { _ in
                    mode = .capture
                    camera.capturedPhoto = nil
                    camera.capturedVideoURL = nil
                    onPendingUploadStarted()
                },
                onUploadCompleted: { response in
                    onUploadRegistered(response)
                }
            )
            uploadTask = nil
        }
    }

    private func cancelComposerUpload() {
        uploadTask?.cancel()
        uploadTask = nil
        store.cancelUploadPreparation()
    }

    private func resetCapture(clearQuote: Bool = false) {
        if store.isUploading {
            cancelComposerUpload()
        }
        mode = .capture
        store.error = nil
        store.uploadStatus = nil
        store.textOverlay = ""
        store.textOverlayPositionX = 50
        store.textOverlayPositionY = 68
        store.linkUrl = ""
        store.linkLabel = ""
        store.linkOverlayPositionX = 50
        store.linkOverlayPositionY = 78
        if clearQuote {
            store.clearQuotedReply()
            clearQuotedReply()
        }
        overlayInputMode = nil
        isOverlayInputFocused = false
        camera.capturedPhoto = nil
        camera.capturedVideoURL = nil
    }

    private func updateRecordingProgress(now: Date) {
        guard camera.isRecording else {
            return
        }

        recordingElapsed = now.timeIntervalSince(recordingStartedAt)
        if recordingElapsed >= maxRecordingDuration {
            stopRecording()
        }
    }
}

private struct EditableStoryOverlayChip: View {
    @Binding var text: String
    @State private var measuredChipSize: CGSize = .zero
    @State private var dragStartCenter: CGPoint?
    let placeholder: String
    let systemImage: String?
    let positionX: Double
    let positionY: Double
    let size: CGSize
    let displayText: String?
    let isEditing: Bool
    var isFocused: FocusState<Bool>.Binding
    let keyboardType: UIKeyboardType
    let autocapitalization: TextInputAutocapitalization
    let autocorrectionDisabled: Bool
    let onSubmit: () -> Void
    let onTapToEdit: () -> Void
    let onPositionChanged: (Double, Double) -> Void

    var body: some View {
        chip
            .background {
                GeometryReader { proxy in
                    Color.clear
                        .onAppear {
                            measuredChipSize = proxy.size
                        }
                        .onChange(of: proxy.size) { _, nextSize in
                            measuredChipSize = nextSize
                        }
                }
            }
            .position(
                x: size.width * CGFloat(positionX / 100),
                y: size.height * CGFloat(positionY / 100)
            )
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        guard !isEditing else {
                            return
                        }

                        guard abs(value.translation.width) > 3 || abs(value.translation.height) > 3 else {
                            return
                        }

                        if dragStartCenter == nil {
                            dragStartCenter = CGPoint(
                                x: size.width * CGFloat(positionX / 100),
                                y: size.height * CGFloat(positionY / 100)
                            )
                        }

                        let startCenter = dragStartCenter ?? CGPoint(
                            x: size.width * CGFloat(positionX / 100),
                            y: size.height * CGFloat(positionY / 100)
                        )
                        let nextCenter = clampedCenter(
                            CGPoint(
                                x: startCenter.x + value.translation.width,
                                y: startCenter.y + value.translation.height
                            )
                        )
                        onPositionChanged(
                            percent(nextCenter.x, dimension: size.width),
                            percent(nextCenter.y, dimension: size.height)
                        )
                    }
                    .onEnded { value in
                        defer {
                            dragStartCenter = nil
                        }

                        guard !isEditing else {
                            return
                        }

                        if abs(value.translation.width) <= 6, abs(value.translation.height) <= 6 {
                            onTapToEdit()
                        }
                    }
            )
    }

    private var chip: some View {
        let maxChipWidth = max(size.width - 32, 70)

        return HStack(alignment: .center, spacing: 7) {
            if isEditing {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 13, weight: .bold))
                        .frame(height: 30)
                }

                TextField(
                    "",
                    text: sanitizedTextBinding,
                    prompt: Text(placeholder).foregroundStyle(.white.opacity(0.62)),
                    axis: .vertical
                )
                .focused(isFocused)
                .keyboardType(keyboardType)
                .textInputAutocapitalization(autocapitalization)
                .autocorrectionDisabled(autocorrectionDisabled)
                .submitLabel(.done)
                .onSubmit(onSubmit)
                .font(.system(size: 18, weight: .bold))
                .multilineTextAlignment(.center)
                .lineLimit(1...4)
                .fixedSize(horizontal: false, vertical: true)
                .frame(minWidth: 70, maxWidth: maxChipWidth)
            } else {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 13, weight: .bold))
                }

                Text(displayText ?? text)
                    .font(.system(size: 18, weight: .bold))
                    .lineLimit(4)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: maxChipWidth)
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .frame(maxWidth: maxChipWidth)
        .background(.black.opacity(systemImage == nil ? 0.42 : 0.56), in: Capsule())
        .overlay(
            Capsule()
                .stroke(.white.opacity(0.22), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.28), radius: 12, y: 6)
    }

    private var sanitizedTextBinding: Binding<String> {
        Binding(
            get: {
                text
            },
            set: { nextValue in
                if nextValue.contains(where: \.isNewline) {
                    text = nextValue
                        .split(whereSeparator: \.isNewline)
                        .joined(separator: " ")
                    DispatchQueue.main.async {
                        onSubmit()
                    }
                } else {
                    text = nextValue
                }
            }
        )
    }

    private func clampedCenter(_ center: CGPoint) -> CGPoint {
        let horizontalInset = clampedInset(measuredChipSize.width, dimension: size.width)
        let verticalInset = clampedInset(measuredChipSize.height, dimension: size.height)

        return CGPoint(
            x: min(max(center.x, horizontalInset), size.width - horizontalInset),
            y: min(max(center.y, verticalInset), size.height - verticalInset)
        )
    }

    private func clampedInset(_ measuredLength: CGFloat, dimension: CGFloat) -> CGFloat {
        guard dimension > 0 else {
            return 0
        }

        let fallbackLength = min(dimension - 32, 70)
        let length = measuredLength > 0 ? measuredLength : fallbackLength
        return min(max((length / 2) + 8, 8), dimension / 2)
    }

    private func percent(_ value: CGFloat, dimension: CGFloat) -> Double {
        guard dimension > 0 else {
            return 50
        }

        return Double(value / dimension) * 100
    }
}

private struct DraggableQuoteReplyOverlay: View {
    let quote: QuotedStoryReply
    let positionX: Double
    let positionY: Double
    let size: CGSize
    let clear: () -> Void
    let onPositionChanged: (Double, Double) -> Void

    var body: some View {
        QuoteReplyOverlayBubble(
            quote: quote,
            includesCloseButton: true,
            clear: clear
        )
        .frame(width: min(size.width - 44, 300), alignment: .leading)
        .position(
            x: size.width * CGFloat(positionX / 100),
            y: size.height * CGFloat(positionY / 100)
        )
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    let nextX = clampedPercent(value.location.x, dimension: size.width)
                    let nextY = clampedPercent(value.location.y, dimension: size.height)
                    onPositionChanged(nextX, nextY)
                }
        )
    }

    private func clampedPercent(_ value: CGFloat, dimension: CGFloat) -> Double {
        guard dimension > 0 else {
            return 50
        }

        return min(max(Double(value / dimension) * 100, 12), 88)
    }
}

private struct QuoteReplyOverlayBubble: View {
    let quote: QuotedStoryReply
    var includesCloseButton = false
    var clear: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                RemoteAvatar(url: quote.actorAvatarUrl, size: 24, name: quote.actorName)

                VStack(alignment: .leading, spacing: 0) {
                    Text(quote.actorName)
                        .font(.system(size: 13, weight: .bold))
                        .lineLimit(1)
                    Text("@\(quote.actorHandle)")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.7))
                        .lineLimit(1)
                }

                Spacer(minLength: 6)

                if includesCloseButton {
                    Button(action: clear) {
                        Image(systemName: "xmark")
                            .font(.system(size: 11, weight: .bold))
                            .frame(width: 24, height: 24)
                            .background(.white.opacity(0.14), in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove quoted reply")
                }
            }

            Text(quote.message)
                .font(.system(size: 18, weight: .bold))
                .lineLimit(4)
                .multilineTextAlignment(.leading)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(.black.opacity(0.76), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(.white.opacity(0.22), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.3), radius: 14, y: 7)
    }
}

private struct StoryShutterButton: View {
    let isRecording: Bool
    let progress: Double
    let segmentCount: Int
    let maxSegments: Int
    let capturePhoto: () -> Void
    let startRecording: () -> Void
    let stopRecording: () -> Void

    @State private var pressStartedAt: Date?
    @State private var didStartRecordingForPress = false
    @State private var longPressTask: Task<Void, Never>?

    var body: some View {
        ZStack {
            Circle()
                .stroke(.white.opacity(0.42), lineWidth: 5)
                .frame(width: 88, height: 88)

            Circle()
                .trim(from: 0, to: isRecording ? progress : 0)
                .stroke(
                    Color.ubeyeRed,
                    style: StrokeStyle(lineWidth: 5, lineCap: .round)
                )
                .frame(width: 88, height: 88)
                .rotationEffect(.degrees(-90))

            Circle()
                .fill(.white)
                .frame(width: isRecording ? 56 : 60, height: isRecording ? 56 : 60)

            if isRecording {
                Text("\(segmentCount)/\(maxSegments)")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Color.ubeyeInk)
            }
        }
        .contentShape(Circle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    beginPressIfNeeded()
                }
                .onEnded { _ in
                    endPress()
                }
        )
        .animation(.easeOut(duration: 0.12), value: isRecording)
    }

    private func beginPressIfNeeded() {
        guard pressStartedAt == nil else {
            return
        }

        pressStartedAt = Date()
        didStartRecordingForPress = false
        longPressTask?.cancel()
        longPressTask = Task {
            try? await Task.sleep(nanoseconds: 250_000_000)
            await MainActor.run {
                guard pressStartedAt != nil, !didStartRecordingForPress else {
                    return
                }
                didStartRecordingForPress = true
                startRecording()
            }
        }
    }

    private func endPress() {
        longPressTask?.cancel()

        if didStartRecordingForPress || isRecording {
            stopRecording()
        } else {
            capturePhoto()
        }

        pressStartedAt = nil
        didStartRecordingForPress = false
    }
}

struct StoryVideoPreview: UIViewRepresentable {
    let url: URL
    var mirrorsHorizontally = false

    func makeUIView(context: Context) -> StoryVideoPreviewView {
        let view = StoryVideoPreviewView()
        view.configure(url: url, mirrorsHorizontally: mirrorsHorizontally)
        return view
    }

    func updateUIView(_ uiView: StoryVideoPreviewView, context: Context) {
        uiView.configure(url: url, mirrorsHorizontally: mirrorsHorizontally)
    }
}

private struct LibraryPickerThumbnail: View {
    let image: UIImage?

    var body: some View {
        ZStack {
            thumbnailContent

            Image(systemName: "photo.on.rectangle")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.45), radius: 4, x: 0, y: 1)
        }
        .frame(width: 58, height: 58)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(.white.opacity(0.85), lineWidth: 2)
        )
        .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    @ViewBuilder
    private var thumbnailContent: some View {
        if let image {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: 58, height: 58)
        } else {
            LinearGradient(
                colors: [
                    .white.opacity(0.22),
                    .black.opacity(0.28)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
    }
}

private struct ComposerSourcePill: View {
    let title: String
    let systemImage: String
    var isSelected = false

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: systemImage)
                .font(.system(size: 13, weight: .bold))
            Text(title)
                .font(.system(size: 13, weight: .black))
                .lineLimit(1)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 12)
        .frame(height: 36)
        .background(isSelected ? .white.opacity(0.2) : .white.opacity(0.08), in: Capsule())
        .overlay(Capsule().stroke(.white.opacity(isSelected ? 0.24 : 0.1), lineWidth: 1))
        .contentShape(Capsule())
    }
}

private struct ComposerLibrarySourcePill: View {
    let image: UIImage?

    var body: some View {
        HStack(spacing: 8) {
            LibraryPickerThumbnail(image: image)
                .frame(width: 30, height: 30)
                .scaleEffect(30 / 58)
                .frame(width: 30, height: 30)

            Text("Camera Roll")
                .font(.system(size: 13, weight: .black))
                .lineLimit(1)
        }
        .foregroundStyle(.white)
        .padding(.leading, 4)
        .padding(.trailing, 12)
        .frame(height: 36)
        .background(.white.opacity(0.08), in: Capsule())
        .overlay(Capsule().stroke(.white.opacity(0.1), lineWidth: 1))
        .contentShape(Capsule())
        .accessibilityLabel("Choose from camera roll")
    }
}

private struct StoryComposerUploadPanel: View {
    let stage: StoryComposerUploadStage
    let cancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                ZStack {
                    Circle()
                        .fill(Color.ubeyeRed)
                    Image(systemName: stage.systemImage)
                        .font(.system(size: 14, weight: .black))
                        .foregroundStyle(.white)
                }
                .frame(width: 34, height: 34)

                VStack(alignment: .leading, spacing: 2) {
                    Text(stage.title)
                        .font(.system(size: 15, weight: .black))
                    Text(stage.subtitle)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.7))
                        .lineLimit(2)
                }

                Spacer(minLength: 8)

                if stage.allowsCancel {
                    Button(action: cancel) {
                        Image(systemName: "xmark")
                            .font(.system(size: 11, weight: .black))
                            .frame(width: 30, height: 30)
                            .background(.white.opacity(0.12), in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Cancel upload")
                }
            }

            if let progress = stage.progress {
                ProgressView(value: progress)
                    .progressViewStyle(.linear)
                    .tint(.white)
            } else {
                ProgressView()
                    .tint(.white)
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, minHeight: 92, alignment: .leading)
        .background(.black.opacity(0.62), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(.white.opacity(0.16), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.28), radius: 18, y: 8)
    }
}

final class StoryVideoPreviewView: UIView {
    private let playerLayer = AVPlayerLayer()
    private var player: AVQueuePlayer?
    private var looper: AVPlayerLooper?
    private var currentURL: URL?
    private var isMirrored = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        playerLayer.videoGravity = .resizeAspectFill
        layer.addSublayer(playerLayer)
    }

    required init?(coder: NSCoder) {
        nil
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        playerLayer.frame = bounds
    }

    func configure(url: URL, mirrorsHorizontally: Bool) {
        updateMirroring(mirrorsHorizontally)

        guard currentURL != url else {
            player?.play()
            return
        }

        currentURL = url
        AppAudioSession.configureForVideoPlayback()
        let item = AVPlayerItem(url: url)
        let queuePlayer = AVQueuePlayer(playerItem: item)
        queuePlayer.isMuted = false
        queuePlayer.volume = 1
        queuePlayer.actionAtItemEnd = .none
        looper = AVPlayerLooper(player: queuePlayer, templateItem: item)
        player = queuePlayer
        playerLayer.player = queuePlayer
        queuePlayer.play()
    }

    private func updateMirroring(_ mirrorsHorizontally: Bool) {
        guard isMirrored != mirrorsHorizontally else {
            return
        }

        isMirrored = mirrorsHorizontally
        playerLayer.setAffineTransform(
            mirrorsHorizontally ? CGAffineTransform(scaleX: -1, y: 1) : .identity
        )
    }

    deinit {
        player?.pause()
    }
}
