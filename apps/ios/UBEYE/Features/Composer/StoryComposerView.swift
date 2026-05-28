import AVFoundation
import Photos
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

enum PickedStoryMedia {
    case image(StoryImageUpload)
    case video(URL)
}

struct StoryImageUpload: Equatable {
    let image: UIImage
    let data: Data
    let fileName: String
    let mimeType: String

    init?(data: Data, fallbackFileName: String = "story-photo") {
        guard let image = UIImage(data: data) else {
            return nil
        }

        let format = StoryImageFormat(data: data)
        self.image = image
        self.data = data
        fileName = Self.normalizedFileName(fallbackFileName, fileExtension: format.fileExtension)
        mimeType = format.mimeType
    }

    private static func normalizedFileName(_ value: String, fileExtension: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = trimmed.isEmpty ? "story-photo" : trimmed

        if base.lowercased().hasSuffix(".\(fileExtension)") {
            return base
        }

        let stem = (base as NSString).deletingPathExtension
        return "\(stem.isEmpty ? "story-photo" : stem).\(fileExtension)"
    }

    static func == (lhs: StoryImageUpload, rhs: StoryImageUpload) -> Bool {
        lhs.data == rhs.data &&
            lhs.fileName == rhs.fileName &&
            lhs.mimeType == rhs.mimeType
    }
}

private struct StoryImageFormat {
    let fileExtension: String
    let mimeType: String

    init(data: Data) {
        let bytes = [UInt8](data.prefix(16))

        if bytes.starts(with: [0xff, 0xd8, 0xff]) {
            fileExtension = "jpg"
            mimeType = "image/jpeg"
        } else if bytes.starts(with: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) {
            fileExtension = "png"
            mimeType = "image/png"
        } else if data.count >= 12,
                  String(data: data.prefix(4), encoding: .ascii) == "RIFF",
                  String(data: data.dropFirst(8).prefix(4), encoding: .ascii) == "WEBP" {
            fileExtension = "webp"
            mimeType = "image/webp"
        } else if data.count >= 12,
                  String(data: data.dropFirst(4).prefix(4), encoding: .ascii) == "ftyp" {
            let brand = String(data: data.dropFirst(8).prefix(4), encoding: .ascii) ?? ""
            if ["avif", "avis"].contains(brand) {
                fileExtension = "avif"
                mimeType = "image/avif"
            } else {
                fileExtension = "heic"
                mimeType = "image/heic"
            }
        } else {
            fileExtension = "jpg"
            mimeType = "image/jpeg"
        }
    }
}

private struct PreparedStoryVideo {
    let url: URL
    let durationMs: Int?
    let byteSize: Int64
    let shouldRemoveAfterUpload: Bool
}

private enum StoryVideoUploadNormalizer {
    static func prepare(url: URL, maxDurationSeconds: Int) async throws -> PreparedStoryVideo {
        let normalizedURL = try await normalizedVideoURL(for: url)
        let uploadURL = normalizedURL ?? url
        let durationMs = await videoDurationMs(for: uploadURL)
        let byteSize = try videoFileSize(for: uploadURL)

        if byteSize > 150 * 1024 * 1024 {
            if let normalizedURL {
                try? FileManager.default.removeItem(at: normalizedURL)
            }
            throw APIClientError.server("Story videos are capped at 150 MB.", 0)
        }

        if let durationMs, durationMs > maxDurationSeconds * 1_000 {
            if let normalizedURL {
                try? FileManager.default.removeItem(at: normalizedURL)
            }
            throw APIClientError.server("Story videos are capped at 2 minutes.", 0)
        }

        return PreparedStoryVideo(
            url: uploadURL,
            durationMs: durationMs,
            byteSize: byteSize,
            shouldRemoveAfterUpload: normalizedURL != nil
        )
    }

    private static func normalizedVideoURL(for url: URL) async throws -> URL? {
        let asset = AVURLAsset(url: url)
        let outputURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("story-upload-\(UUID().uuidString).mp4")
        let preset = await compatibleExportPreset(for: asset)

        guard let export = AVAssetExportSession(asset: asset, presetName: preset) else {
            return nil
        }

        export.outputURL = outputURL
        export.outputFileType = .mp4
        export.shouldOptimizeForNetworkUse = true

        if let duration = await alignedPlayableDuration(for: asset) {
            export.timeRange = CMTimeRange(start: .zero, duration: duration)
        }

        await exportVideo(export)

        if export.status == .completed {
            MediaPerformance.mark("video_upload_normalized preset=\(preset)")
            return outputURL
        }

        try? FileManager.default.removeItem(at: outputURL)
        let nsError = export.error as NSError?
        MediaPerformance.mark(
            "video_upload_normalize_failed status=\(export.status.rawValue) code=\(nsError?.code ?? 0)"
        )
        return nil
    }

    private static func compatibleExportPreset(for asset: AVAsset) async -> String {
        let preferred = AVAssetExportPreset1920x1080
        let fallback = AVAssetExportPresetHighestQuality

        if await AVAssetExportSession.compatibility(
            ofExportPreset: preferred,
            with: asset,
            outputFileType: .mp4
        ) {
            return preferred
        }

        return fallback
    }

    private static func alignedPlayableDuration(for asset: AVURLAsset) async -> CMTime? {
        let duration: CMTime?
        let tracks: [AVAssetTrack]
        let trackDurations: [CMTime]

        if #available(iOS 16.0, *) {
            duration = try? await asset.load(.duration)
            tracks = (try? await asset.load(.tracks)) ?? []
            var loadedDurations: [CMTime] = []
            for track in tracks {
                if let timeRange = try? await track.load(.timeRange) {
                    loadedDurations.append(timeRange.duration)
                }
            }
            trackDurations = loadedDurations
        } else {
            duration = asset.duration
            tracks = asset.tracks
            trackDurations = tracks.map(\.timeRange.duration)
        }

        let finiteDurations = ([duration].compactMap { $0 } + trackDurations)
            .filter { time in
                let seconds = CMTimeGetSeconds(time)
                return time.isValid && seconds.isFinite && seconds > 0.2
            }

        guard let shortest = finiteDurations.min(by: { CMTimeCompare($0, $1) < 0 }) else {
            return nil
        }

        return shortest
    }

    private static func exportVideo(_ export: AVAssetExportSession) async {
        await withCheckedContinuation { continuation in
            export.exportAsynchronously {
                continuation.resume()
            }
        }
    }

    private static func videoFileSize(for url: URL) throws -> Int64 {
        guard let size = try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber,
              size.int64Value > 0 else {
            throw APIClientError.invalidResponse
        }

        return size.int64Value
    }

    private static func videoDurationMs(for url: URL) async -> Int? {
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
    @Published var selectedMedia: PickedStoryMedia?
    @Published var uploadStatus: String?
    @Published var error: String?
    @Published var isUploading = false

    func upload(api: APIClient) async -> StoryUploadResponse? {
        guard let selectedMedia else {
            error = "Capture or choose story media first."
            return nil
        }

        isUploading = true
        error = nil
        normalizeLinkDraft()
        uploadStatus = "Preparing upload"
        var uploadResponse: StoryUploadResponse?

        do {
            switch selectedMedia {
            case .image(let upload):
                uploadStatus = "Uploading image"
                uploadResponse = try await api.uploadImageStory(
                    upload: upload,
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
            case .video(let url):
                uploadResponse = try await uploadVideoStory(url: url, api: api)
            }

            uploadStatus = uploadResponse?.processingStatus == "ready" ? "Story posted" : "Upload complete"
            api.invalidateMobileFeedCache()
            api.invalidateStoryStacks(ids: ["my-story"])
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
            self.selectedMedia = nil
        } catch {
            self.error = error.localizedDescription
        }

        isUploading = false
        return uploadResponse
    }

    private func uploadVideoStory(url: URL, api: APIClient) async throws -> StoryUploadResponse {
        uploadStatus = "Preparing video"
        let preparedVideo = try await StoryVideoUploadNormalizer.prepare(
            url: url,
            maxDurationSeconds: maxVideoDurationSeconds
        )
        defer {
            if preparedVideo.shouldRemoveAfterUpload {
                try? FileManager.default.removeItem(at: preparedVideo.url)
            }
        }

        let upload = try await api.prepareVideoUpload(
            fileName: preparedVideo.url.lastPathComponent.isEmpty ? "story-video.mp4" : preparedVideo.url.lastPathComponent,
            byteSize: preparedVideo.byteSize,
            maxDurationSeconds: maxVideoDurationSeconds
        )
        uploadStatus = "Uploading video"
        try await api.uploadVideoFile(fileURL: preparedVideo.url, upload: upload)
        uploadStatus = "Finishing story"

        return try await api.completeVideoStory(
            upload: upload,
            fileURL: preparedVideo.url,
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
            quoteReplyPositionY: quoteReplyPositionY,
            durationMs: preparedVideo.durationMs,
            thumbnailData: nil
        )
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

    private func videoThumbnailData(for url: URL, durationMs: Int?) async -> Data? {
        await Task.detached(priority: .userInitiated) {
            let asset = AVURLAsset(url: url)
            let generator = AVAssetImageGenerator(asset: asset)
            generator.appliesPreferredTrackTransform = true
            generator.maximumSize = CGSize(width: 720, height: 1280)

            let durationSeconds = durationMs.map { max(Double($0) / 1_000, 0.1) } ?? 1
            let targetSeconds = max(durationSeconds - 0.12, 0)
            let targetTime = CMTime(seconds: targetSeconds, preferredTimescale: 600)
            let midpointTime = CMTime(seconds: max(durationSeconds * 0.5, 0), preferredTimescale: 600)
            let fallbackTime = CMTime(seconds: 0, preferredTimescale: 600)

            let image = (try? generator.copyCGImage(at: targetTime, actualTime: nil))
                ?? (try? generator.copyCGImage(at: midpointTime, actualTime: nil))
                ?? (try? generator.copyCGImage(at: fallbackTime, actualTime: nil))

            guard let image else {
                return nil
            }

            return UIImage(cgImage: image).jpegData(compressionQuality: 0.82)
        }.value
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
}

struct StoryComposerView: View {
    @EnvironmentObject private var api: APIClient
    @StateObject private var camera = CameraController()
    @StateObject private var store = StoryComposerStore()
    @State private var photoPickerItem: PhotosPickerItem?
    @State private var overlayInputMode: ComposerOverlayInputMode?
    @State private var recordingStartedAt = Date()
    @State private var recordingElapsed: TimeInterval = 0
    @State private var latestLibraryThumbnail: UIImage?
    @FocusState private var isOverlayInputFocused: Bool
    let quotedReply: QuotedStoryReply?
    var clearQuotedReply: () -> Void = {}
    var onUploadRegistered: (StoryUploadResponse) -> Void = { _ in }

    private let maxVideoSegments = 6
    private let videoSegmentDuration: TimeInterval = 10
    private var maxRecordingDuration: TimeInterval { TimeInterval(maxVideoSegments) * videoSegmentDuration }
    private let recordingTimer = Timer.publish(every: 0.05, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            mediaPreview
                .frame(maxWidth: .infinity, maxHeight: .infinity)
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

                            if store.selectedMedia == nil {
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

                Spacer()

                if let uploadStatus = store.uploadStatus {
                    Text(uploadStatus)
                        .font(.system(size: 18, weight: .bold))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(.black.opacity(0.45), in: Capsule())
                        .padding(.bottom, 16)
                } else if let error = store.error ?? camera.error {
                    Text(error)
                        .font(.system(size: 16, weight: .bold))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(Color.ubeyeRed.opacity(0.9), in: Capsule())
                        .padding(.horizontal, 22)
                        .padding(.bottom, 16)
                } else if store.selectedMedia == nil {
                    Text("Tap for photo, hold for video")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white.opacity(0.65))
                        .padding(.bottom, 24)
                }

                HStack {
                    PhotosPicker(selection: $photoPickerItem, matching: .any(of: [.images, .videos])) {
                        LibraryPickerThumbnail(image: latestLibraryThumbnail)
                    }

                    Spacer()

                    StoryShutterButton(
                        isRecording: camera.isRecording,
                        progress: recordingProgress,
                        segmentCount: recordingSegmentCount,
                        maxSegments: maxVideoSegments,
                        capturePhoto: capturePhoto,
                        startRecording: startRecording,
                        stopRecording: stopRecording
                    )

                    Spacer()

                    Button {
                        Task {
                            if let response = await store.upload(api: api) {
                                onUploadRegistered(response)
                            }
                        }
                    } label: {
                        Image(systemName: store.isUploading ? "hourglass" : "paperplane.fill")
                            .font(.system(size: 21, weight: .bold))
                            .frame(width: 58, height: 58)
                            .background(.black.opacity(0.34), in: Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(store.isUploading)
                }
                .padding(.horizontal, 28)
                .padding(.bottom, 28)
            }
            .foregroundStyle(.white)

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
                store.selectedMedia = .image(photo)
            }
        }
        .onChange(of: camera.capturedVideoURL) { _, url in
            if let url {
                store.selectedMedia = .video(url)
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
        if store.selectedMedia != nil {
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
                        onSubmit: finishOverlayInput
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
                        onSubmit: finishOverlayInput
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
        guard store.selectedMedia != nil else {
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
    private var mediaStage: some View {
        ZStack(alignment: .bottom) {
            mediaPreview
                .frame(height: 520)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(Color.ubeyeBorder, lineWidth: 1)
                )

            HStack(spacing: 18) {
                PhotosPicker(selection: $photoPickerItem, matching: .any(of: [.images, .videos])) {
                    Image(systemName: "photo.on.rectangle")
                        .font(.title2)
                        .frame(width: 54, height: 54)
                        .background(.black.opacity(0.45), in: Circle())
                }

                Button {
                    camera.capturePhoto()
                    if let photo = camera.capturedPhoto {
                        store.selectedMedia = .image(photo)
                    }
                } label: {
                    Circle()
                        .strokeBorder(.white, lineWidth: 4)
                        .frame(width: 72, height: 72)
                        .overlay(Circle().fill(.white).padding(9))
                }

                Button {
                    if camera.isRecording {
                        camera.stopRecording()
                    } else {
                        camera.startRecording()
                    }
                } label: {
                    Image(systemName: camera.isRecording ? "stop.fill" : "video.fill")
                        .font(.title2)
                        .frame(width: 54, height: 54)
                        .background(camera.isRecording ? Color.ubeyeRed : .black.opacity(0.45), in: Circle())
                }

                Button {
                    store.selectedMedia = nil
                    camera.capturedPhoto = nil
                    camera.capturedVideoURL = nil
                } label: {
                    Image(systemName: "arrow.counterclockwise")
                        .font(.title2)
                        .frame(width: 54, height: 54)
                        .background(.black.opacity(0.45), in: Circle())
                }
            }
            .foregroundStyle(.white)
            .padding(.bottom, 18)
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var mediaPreview: some View {
        switch store.selectedMedia {
        case .image(let upload):
            Image(uiImage: upload.image)
                .resizable()
                .scaledToFill()
        case .video(let url):
            StoryVideoPreview(url: url)
        case nil:
            if let photo = camera.capturedPhoto {
                Image(uiImage: photo.image)
                    .resizable()
                    .scaledToFill()
                    .onAppear {
                        store.selectedMedia = .image(photo)
                    }
            } else if let videoURL = camera.capturedVideoURL {
                StoryVideoPreview(url: videoURL)
                    .onAppear {
                        store.selectedMedia = .video(videoURL)
                    }
            } else if camera.authorizationStatus == .authorized {
                CameraPreview(session: camera.session)
            } else {
                EmptyStateView(title: "Camera unavailable", message: "Enable camera access or choose media from your library.", systemImage: "camera")
            }
        }
    }

    private var metadataFields: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Story details")
                .font(.headline)
            composerTextField("Caption", text: $store.caption)
            composerTextField("Brand tags", text: $store.brandTags)
            composerTextField("Text overlay", text: $store.textOverlay)
        }
        .padding(14)
        .ubeyeCard()
    }

    private func composerTextField(_ title: String, text: Binding<String>) -> some View {
        TextField(title, text: text)
            .padding()
            .frame(height: 52)
            .background(Color.ubeyeSubtle)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .textInputAutocapitalization(.sentences)
            .foregroundStyle(Color.ubeyeInk)
    }

    private func loadPickedItem(_ item: PhotosPickerItem?) async {
        guard let item else {
            return
        }

        if item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) }) {
            if let pickedVideo = try? await item.loadTransferable(type: PickedVideo.self) {
                store.selectedMedia = .video(pickedVideo.url)
            }
            return
        }

        if let pickedImage = try? await item.loadTransferable(type: PickedImage.self) {
            store.selectedMedia = .image(pickedImage.upload)
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

    private func resetCapture(clearQuote: Bool = false) {
        store.selectedMedia = nil
        store.error = nil
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
    let onPositionChanged: (Double, Double) -> Void

    var body: some View {
        chip
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

                        let nextX = clampedPercent(value.location.x, dimension: size.width)
                        let nextY = clampedPercent(value.location.y, dimension: size.height)
                        onPositionChanged(nextX, nextY)
                    }
            )
    }

    private var chip: some View {
        HStack(spacing: 7) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 13, weight: .bold))
            }

            if isEditing {
                TextField(
                    "",
                    text: $text,
                    prompt: Text(placeholder).foregroundStyle(.white.opacity(0.62))
                )
                .focused(isFocused)
                .keyboardType(keyboardType)
                .textInputAutocapitalization(autocapitalization)
                .autocorrectionDisabled(autocorrectionDisabled)
                .submitLabel(.done)
                .onSubmit(onSubmit)
                .font(.system(size: 18, weight: .bold))
                .multilineTextAlignment(.center)
                .frame(minWidth: 70, maxWidth: 210)
            } else {
                Text(displayText ?? text)
                    .font(.system(size: 18, weight: .bold))
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(.black.opacity(0.46), in: Capsule())
    }

    private func clampedPercent(_ value: CGFloat, dimension: CGFloat) -> Double {
        guard dimension > 0 else {
            return 50
        }

        return min(max(Double(value / dimension) * 100, 8), 92)
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

private struct PickedVideo: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { video in
            SentTransferredFile(video.url)
        } importing: { received in
            let sourceExtension = received.file.pathExtension
            let fileExtension = sourceExtension.isEmpty ? "mov" : sourceExtension
            let copy = FileManager.default.temporaryDirectory.appendingPathComponent("picked-\(UUID().uuidString).\(fileExtension)")
            if FileManager.default.fileExists(atPath: copy.path) {
                try FileManager.default.removeItem(at: copy)
            }
            try FileManager.default.copyItem(at: received.file, to: copy)
            return PickedVideo(url: copy)
        }
    }
}

private struct PickedImage: Transferable {
    let upload: StoryImageUpload

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .image) { image in
            let copy = FileManager.default.temporaryDirectory
                .appendingPathComponent("picked-\(UUID().uuidString).\(image.upload.fileName)")
            try image.upload.data.write(to: copy, options: .atomic)
            return SentTransferredFile(copy)
        } importing: { received in
            let data = try Data(contentsOf: received.file)
            guard let upload = StoryImageUpload(
                data: data,
                fallbackFileName: received.file.lastPathComponent
            ) else {
                throw APIClientError.invalidResponse
            }

            return PickedImage(upload: upload)
        }
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

    func makeUIView(context: Context) -> StoryVideoPreviewView {
        let view = StoryVideoPreviewView()
        view.configure(url: url)
        return view
    }

    func updateUIView(_ uiView: StoryVideoPreviewView, context: Context) {
        uiView.configure(url: url)
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

final class StoryVideoPreviewView: UIView {
    private let playerLayer = AVPlayerLayer()
    private var player: AVQueuePlayer?
    private var looper: AVPlayerLooper?
    private var currentURL: URL?

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

    func configure(url: URL) {
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

    deinit {
        player?.pause()
    }
}
