import Combine
import CryptoKit
import Foundation
import UIKit

@MainActor
final class StoryUploadCoordinator: ObservableObject {
    @Published private(set) var registrations: [StoryUploadResponse] = []

    private var readinessTasks: [String: Task<Void, Never>] = [:]

    func register(
        _ response: StoryUploadResponse,
        api: APIClient,
        notice: StoryUploadNoticeStore
    ) {
        StoryUploadDiagnostics.mark("registered", response: response)
        upsertRegistration(response)
        api.invalidateMobileFeedCache()
        preheatUploadThumbnail(response)

        guard response.moderationStatus == nil || response.moderationStatus == "approved" else {
            StoryUploadDiagnostics.mark("under_review", response: response)
            notice.showReview(reason: response.moderationReason)
            return
        }

        publishRegisteredUpload(response)
        refreshVisibleStoryState(response, api: api)

        if response.asset.assetKind == .video && response.processingStatus != "ready" {
            notice.showProcessing()
            startReadinessPolling(response, api: api, notice: notice)
        } else {
            notice.showPosted()
        }
    }

    private func upsertRegistration(_ response: StoryUploadResponse) {
        registrations.removeAll { $0.storyId == response.storyId }
        registrations.append(response)
        if registrations.count > 12 {
            registrations.removeFirst(registrations.count - 12)
        }
    }

    private func preheatUploadThumbnail(_ response: StoryUploadResponse) {
        guard let thumbnailUrl = response.asset.renditions?.playback.thumbnailUrl ?? response.asset.thumbnailUrl else {
            return
        }

        MediaImageCache.shared.preheat([thumbnailUrl], limit: 1)
    }

    private func publishRegisteredUpload(_ response: StoryUploadResponse) {
        Task { @MainActor in
            await Task.yield()
            NotificationCenter.default.post(
                name: .storyUploadDidRegister,
                object: response
            )
        }
    }

    private func refreshVisibleStoryState(_ response: StoryUploadResponse, api: APIClient) {
        api.invalidateStoryStacks(ids: ["my-story", response.storyId])
        api.prefetchStoryStacks(ids: ["my-story", response.storyId], refresh: true, limit: 2)
        NotificationCenter.default.post(name: .storyUploadDidComplete, object: nil)
        StoryUploadDiagnostics.mark("local_visibility_refreshed", response: response)
    }

    private func startReadinessPolling(
        _ response: StoryUploadResponse,
        api: APIClient,
        notice: StoryUploadNoticeStore
    ) {
        readinessTasks[response.storyId]?.cancel()
        readinessTasks[response.storyId] = Task { @MainActor [weak self, api, notice] in
            StoryUploadDiagnostics.mark("readiness_poll_started", response: response)
            let isLive = await api.waitForStoryLive(storyId: response.storyId)
            guard !Task.isCancelled else {
                return
            }

            self?.readinessTasks[response.storyId] = nil
            guard isLive else {
                StoryUploadDiagnostics.mark("readiness_poll_timeout", response: response)
                return
            }

            api.invalidateStoryStacks(ids: ["my-story", response.storyId])
            api.prefetchStoryStacks(ids: ["my-story", response.storyId], refresh: true, limit: 2)
            notice.showPosted()
            NotificationCenter.default.post(name: .storyUploadDidComplete, object: nil)
            StoryUploadDiagnostics.mark("readiness_poll_live", response: response)
        }
    }
}

enum PendingStoryUploadState: String, Codable, Hashable {
    case queued
    case uploading
    case completing
    case failed
}

enum PendingStoryUploadPipeline: String, Codable, Hashable {
    case imageMultipart
    case imageDirectBlob
    case videoTus
    // Decode build-250 manifests, but route every retry through Stream/TUS.
    case legacyOriginalQualityVideo = "originalQualityVideo"
}

struct PendingStoryUploadDraft: Codable, Hashable {
    let caption: String
    let brandTags: String
    let textOverlay: String
    let textOverlayPositionX: Double
    let textOverlayPositionY: Double
    let linkLabel: String
    let linkUrl: String
    let linkOverlayPositionX: Double
    let linkOverlayPositionY: Double
    let quoteReplyId: String
    let quoteReplyPositionX: Double
    let quoteReplyPositionY: Double
}

struct PendingStoryUpload: Codable, Hashable, Identifiable {
    let id: String
    let assetKind: SocialAssetKind
    let pipeline: PendingStoryUploadPipeline
    let mediaFileURL: URL
    let thumbnailFileURL: URL?
    let fileName: String
    let mimeType: String?
    let durationMs: Int?
    let textOverlays: [StoryTextOverlay]
    let draft: PendingStoryUploadDraft
    let createdAt: Date
    var updatedAt: Date
    var state: PendingStoryUploadState
    var progress: Double
    var retryCount: Int
    var errorMessage: String?
    var preparedVideoUpload: VideoUploadResponse?

    var displayProgress: Double {
        min(max(progress, 0), 1)
    }

    var isFailed: Bool {
        state == .failed
    }

    var statusLabel: String {
        switch state {
        case .queued:
            "Posting"
        case .uploading:
            "Posting \(Int((displayProgress * 100).rounded()))%"
        case .completing:
            "Finishing"
        case .failed:
            "Failed"
        }
    }
}

private struct LocalImageDerivative {
    let data: Data
    let contentType = "image/jpeg"
    let width: Int
    let height: Int

    var byteSize: Int64 {
        Int64(data.count)
    }

    var checksum: String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    func metadata(pathname: String) -> PreparedImageDerivativeUpload {
        PreparedImageDerivativeUpload(
            pathname: pathname,
            contentType: contentType,
            byteSize: byteSize,
            checksum: checksum,
            width: width,
            height: height
        )
    }
}

private struct LocalImageDerivativeSet {
    let display: LocalImageDerivative
    let thumbnail: LocalImageDerivative
    let placeholder: LocalImageDerivative
}

private struct UploadedImageDerivativeSet {
    let display: PreparedImageDerivativeUpload
    let thumbnail: PreparedImageDerivativeUpload
    let placeholder: PreparedImageDerivativeUpload
}

enum StoryUploadFileIO {
    static func stageVideo(
        sourceURL: URL,
        destinationURL: URL,
        thumbnailData: Data?,
        thumbnailURL: URL?
    ) async throws -> URL? {
        try await Task.detached(priority: .userInitiated) {
            let fileManager = FileManager.default
            try fileManager.createDirectory(
                at: destinationURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try? fileManager.removeItem(at: destinationURL)

            do {
                try fileManager.copyItem(at: sourceURL, to: destinationURL)

                guard let thumbnailData, !thumbnailData.isEmpty, let thumbnailURL else {
                    return nil
                }

                try thumbnailData.write(to: thumbnailURL, options: .atomic)
                return thumbnailURL
            } catch {
                try? fileManager.removeItem(at: destinationURL)
                if let thumbnailURL {
                    try? fileManager.removeItem(at: thumbnailURL)
                }
                throw error
            }
        }.value
    }

    static func fileSize(at url: URL) async throws -> Int64 {
        try await Task.detached(priority: .utility) {
            guard let size = try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber,
                  size.int64Value > 0 else {
                throw APIClientError.invalidResponse
            }

            return size.int64Value
        }.value
    }

    static func data(at url: URL?) async -> Data? {
        guard let url else {
            return nil
        }

        return await Task.detached(priority: .utility) {
            try? Data(contentsOf: url, options: .mappedIfSafe)
        }.value
    }

    static func remove(_ urls: Set<URL>) async {
        await Task.detached(priority: .utility) {
            for url in urls {
                try? FileManager.default.removeItem(at: url)
            }
        }.value
    }
}

private enum StoryImageDerivativeBuilder {
    static func build(fileURL: URL) async throws -> LocalImageDerivativeSet {
        try await Task.detached(priority: .userInitiated) {
            guard let image = UIImage(contentsOfFile: fileURL.path) else {
                throw APIClientError.invalidResponse
            }

            return LocalImageDerivativeSet(
                display: try encode(image, maxSize: CGSize(width: 1080, height: 1920), quality: 0.88),
                thumbnail: try encode(image, maxSize: CGSize(width: 720, height: 1280), quality: 0.84),
                placeholder: try encode(image, maxSize: CGSize(width: 36, height: 64), quality: 0.55)
            )
        }.value
    }

    private static func encode(_ image: UIImage, maxSize: CGSize, quality: CGFloat) throws -> LocalImageDerivative {
        let fittedSize = aspectFitSize(
            source: CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale),
            maxSize: maxSize
        )
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true

        let renderer = UIGraphicsImageRenderer(size: fittedSize, format: format)
        let rendered = renderer.image { context in
            UIColor.black.setFill()
            context.fill(CGRect(origin: .zero, size: fittedSize))
            image.draw(in: CGRect(origin: .zero, size: fittedSize))
        }

        guard let data = rendered.jpegData(compressionQuality: quality) else {
            throw APIClientError.invalidResponse
        }

        return LocalImageDerivative(
            data: data,
            width: max(1, Int(fittedSize.width.rounded())),
            height: max(1, Int(fittedSize.height.rounded()))
        )
    }

    private static func aspectFitSize(source: CGSize, maxSize: CGSize) -> CGSize {
        guard source.width > 0, source.height > 0 else {
            return maxSize
        }

        let scale = min(maxSize.width / source.width, maxSize.height / source.height, 1)
        return CGSize(
            width: max(1, floor(source.width * scale)),
            height: max(1, floor(source.height * scale))
        )
    }
}

@MainActor
final class PendingStoryUploadStore: ObservableObject {
    @Published private(set) var uploads: [PendingStoryUpload] = []

    private let fileManager: FileManager
    private let rootURL: URL
    private let filesURL: URL
    private let manifestURL: URL
    private let maxVideoDurationSeconds = 120

    init(fileManager: FileManager = .default) {
        self.fileManager = fileManager
        rootURL = fileManager
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("UBEYE", isDirectory: true)
            .appendingPathComponent("pending-story-uploads", isDirectory: true)
        filesURL = rootURL.appendingPathComponent("files", isDirectory: true)
        manifestURL = rootURL.appendingPathComponent("uploads.json")
        loadPersistedUploads()
    }

    var visibleUploads: [PendingStoryUpload] {
        uploads.sorted { $0.createdAt < $1.createdAt }
    }

    var latestVisibleUpload: PendingStoryUpload? {
        visibleUploads.last
    }

    func createImageUpload(
        upload: StoryImageUpload,
        draft: PendingStoryUploadDraft,
        textOverlays: [StoryTextOverlay]
    ) throws -> PendingStoryUpload {
        try ensureDirectories()
        let id = Self.makePendingId()
        let fileExtension = (upload.fileName as NSString).pathExtension.isEmpty
            ? "jpg"
            : (upload.fileName as NSString).pathExtension
        let mediaURL = filesURL.appendingPathComponent("\(id).\(fileExtension)")
        try upload.data.write(to: mediaURL, options: .atomic)

        let pending = PendingStoryUpload(
            id: id,
            assetKind: .image,
            pipeline: .imageDirectBlob,
            mediaFileURL: mediaURL,
            thumbnailFileURL: mediaURL,
            fileName: upload.fileName,
            mimeType: upload.mimeType,
            durationMs: nil,
            textOverlays: textOverlays,
            draft: draft,
            createdAt: Date(),
            updatedAt: Date(),
            state: .queued,
            progress: 0.05,
            retryCount: 0,
            errorMessage: nil,
            preparedVideoUpload: nil
        )
        upsert(pending)
        MediaImageCache.shared.preheat([mediaURL], limit: 1)
        return pending
    }

    func createVideoUpload(
        sourceURL: URL,
        thumbnailData: Data?,
        durationMs: Int?,
        draft: PendingStoryUploadDraft,
        textOverlays: [StoryTextOverlay]
    ) async throws -> PendingStoryUpload {
        let id = Self.makePendingId()
        let fileExtension = sourceURL.pathExtension.isEmpty ? "mp4" : sourceURL.pathExtension
        let mediaURL = filesURL.appendingPathComponent("\(id).\(fileExtension)")
        let thumbnailDestinationURL = thumbnailData?.isEmpty == false
            ? filesURL.appendingPathComponent("\(id)-thumbnail.jpg")
            : nil
        let thumbnailURL = try await StoryUploadFileIO.stageVideo(
            sourceURL: sourceURL,
            destinationURL: mediaURL,
            thumbnailData: thumbnailData,
            thumbnailURL: thumbnailDestinationURL
        )

        let pending = PendingStoryUpload(
            id: id,
            assetKind: .video,
            pipeline: .videoTus,
            mediaFileURL: mediaURL,
            thumbnailFileURL: thumbnailURL,
            fileName: sourceURL.lastPathComponent.isEmpty ? "story-video.mp4" : sourceURL.lastPathComponent,
            mimeType: nil,
            durationMs: durationMs,
            textOverlays: textOverlays,
            draft: draft,
            createdAt: Date(),
            updatedAt: Date(),
            state: .queued,
            progress: 0.08,
            retryCount: 0,
            errorMessage: nil,
            preparedVideoUpload: nil
        )
        upsert(pending)
        MediaImageCache.shared.preheat([thumbnailURL].compactMap { $0 }, limit: 1)
        return pending
    }

    func performUpload(id: String, api: APIClient) async throws -> StoryUploadResponse {
        guard let upload = uploads.first(where: { $0.id == id }) else {
            throw APIClientError.invalidResponse
        }

        let backgroundTask = StoryUploadBackgroundTask(name: "story-upload-\(id)")
        defer {
            backgroundTask.end()
        }

        do {
            let response: StoryUploadResponse
            switch upload.pipeline {
            case .imageMultipart:
                response = try await uploadImage(upload, api: api)
            case .imageDirectBlob:
                response = try await uploadDirectImage(upload, api: api)
            case .videoTus:
                response = try await uploadTusVideo(upload, api: api)
            case .legacyOriginalQualityVideo:
                MediaPerformance.mark("pending_video_legacy_pipeline_migrated id=\(upload.id)")
                response = try await uploadTusVideo(upload, api: api)
            }

            await cacheUploadedMedia(upload, response: response)
            reconcile(id: id)
            return response
        } catch {
            markFailed(id: id, error: error)
            throw error
        }
    }

    func retry(id: String, api: APIClient) async throws -> StoryUploadResponse {
        update(id: id, state: .queued, progress: 0.04, errorMessage: nil, incrementsRetry: true)
        return try await performUpload(id: id, api: api)
    }

    func remove(id: String) {
        guard let upload = uploads.first(where: { $0.id == id }) else {
            return
        }

        removeFiles(for: upload)
        uploads.removeAll { $0.id == id }
        persist()
    }

    func feedByMergingPendingUploads(into feed: MobileFeedResponse) -> MobileFeedResponse {
        let pendingCards = visibleUploads.map { upload in
            storyCard(for: upload, owner: feed.myStory.owner)
        }

        guard !pendingCards.isEmpty else {
            return feed
        }

        let mergedItems = feed.myStory.items.filter { item in
            !pendingCards.contains { $0.id == item.id }
        } + pendingCards
        let latestItem = mergedItems.last
        let latestThumbnailUrl = latestItem.flatMap {
            $0.assetKind == .image ? $0.playbackMediaUrl : $0.playbackThumbnailUrl
        }
        let myStory = MyStorySummary(
            owner: feed.myStory.owner,
            hasActiveStory: true,
            liveCount: max(feed.myStory.liveCount, mergedItems.count),
            latestThumbnailUrl: latestThumbnailUrl,
            latestAssetKind: latestItem?.assetKind,
            latestTextOverlays: latestItem?.textOverlays ?? [],
            expiresSoonLabel: feed.myStory.expiresSoonLabel,
            items: mergedItems
        )

        return MobileFeedResponse(
            ok: feed.ok,
            session: feed.session,
            followingProfiles: feed.followingProfiles,
            followingStories: feed.followingStories,
            followingTimelineStories: feed.followingTimelineStories,
            discoverTiles: feed.discoverTiles,
            initialStoryStacks: feed.initialStoryStacks,
            suggestedAccounts: feed.suggestedAccounts,
            myStory: myStory
        )
    }

    func storyStackByMergingPendingUploads(
        into stack: StoryStack?,
        account: MobileAccount?
    ) -> StoryStack? {
        guard stack != nil || !visibleUploads.isEmpty else {
            return nil
        }

        let base = stack ?? StoryStack(
            id: "my-story",
            creatorId: account?.email ?? "me",
            creator: account?.displayName ?? "My Story",
            handle: account?.handle ?? "",
            avatarUrl: account?.avatarUrl,
            items: []
        )
        let pendingItems = visibleUploads.map(stackItem(for:))
        let mergedItems = base.items.filter { item in
            !pendingItems.contains { $0.id == item.id }
        } + pendingItems

        return StoryStack(
            id: base.id,
            creatorId: base.creatorId,
            creator: base.creator,
            handle: base.handle,
            avatarUrl: base.avatarUrl,
            items: mergedItems
        )
    }

    static func isPendingStoryId(_ id: String) -> Bool {
        id.hasPrefix("pending-story-")
    }

    private func uploadImage(_ upload: PendingStoryUpload, api: APIClient) async throws -> StoryUploadResponse {
        update(id: upload.id, state: .uploading, progress: 0.18)
        let data = try Data(contentsOf: upload.mediaFileURL)
        guard let imageUpload = StoryImageUpload(
            data: data,
            fallbackFileName: upload.fileName
        ) else {
            throw APIClientError.invalidResponse
        }

        let response = try await api.uploadImageStory(
            upload: imageUpload,
            caption: upload.draft.caption,
            brandTags: upload.draft.brandTags,
            textOverlay: upload.draft.textOverlay,
            textOverlayPositionX: upload.draft.textOverlayPositionX,
            textOverlayPositionY: upload.draft.textOverlayPositionY,
            linkLabel: upload.draft.linkLabel,
            linkUrl: upload.draft.linkUrl,
            linkOverlayPositionX: upload.draft.linkOverlayPositionX,
            linkOverlayPositionY: upload.draft.linkOverlayPositionY,
            quoteReplyId: upload.draft.quoteReplyId,
            quoteReplyPositionX: upload.draft.quoteReplyPositionX,
            quoteReplyPositionY: upload.draft.quoteReplyPositionY
        )
        update(id: upload.id, state: .completing, progress: 1)
        return response
    }

    private func uploadDirectImage(_ upload: PendingStoryUpload, api: APIClient) async throws -> StoryUploadResponse {
        update(id: upload.id, state: .uploading, progress: 0.12)
        let byteSize = try fileSize(upload.mediaFileURL)
        let preparedUpload: ImageUploadResponse
        do {
            preparedUpload = try await api.prepareImageStoryUpload(
                fileName: upload.fileName.isEmpty ? "story-photo.jpg" : upload.fileName,
                contentType: upload.mimeType ?? "image/jpeg",
                byteSize: byteSize
            )
        } catch {
            if (error as? APIClientError)?.statusCode == 503 {
                MediaPerformance.mark("pending_image_direct_upload_fallback reason=not_configured")
                return try await uploadImage(upload, api: api)
            }

            throw error
        }
        update(id: upload.id, state: .uploading, progress: 0.24)

        _ = try await api.uploadImageFile(fileURL: upload.mediaFileURL, upload: preparedUpload)
        update(id: upload.id, state: .uploading, progress: 0.64)

        let derivatives = await uploadImageDerivativesIfPossible(
            upload: upload,
            preparedUpload: preparedUpload,
            api: api
        )
        update(id: upload.id, state: .uploading, progress: 0.88)

        let response = try await api.completeImageStory(
            upload: preparedUpload,
            fileURL: upload.mediaFileURL,
            displayDerivative: derivatives?.display,
            thumbnailDerivative: derivatives?.thumbnail,
            placeholderDerivative: derivatives?.placeholder,
            caption: upload.draft.caption,
            brandTags: upload.draft.brandTags,
            textOverlay: upload.draft.textOverlay,
            textOverlayPositionX: upload.draft.textOverlayPositionX,
            textOverlayPositionY: upload.draft.textOverlayPositionY,
            linkLabel: upload.draft.linkLabel,
            linkUrl: upload.draft.linkUrl,
            linkOverlayPositionX: upload.draft.linkOverlayPositionX,
            linkOverlayPositionY: upload.draft.linkOverlayPositionY,
            quoteReplyId: upload.draft.quoteReplyId,
            quoteReplyPositionX: upload.draft.quoteReplyPositionX,
            quoteReplyPositionY: upload.draft.quoteReplyPositionY
        )
        update(id: upload.id, state: .completing, progress: 1)
        return response
    }

    private func uploadImageDerivativesIfPossible(
        upload: PendingStoryUpload,
        preparedUpload: ImageUploadResponse,
        api: APIClient
    ) async -> UploadedImageDerivativeSet? {
        guard MediaControlConfig.shared.imageDerivativeUploadEnabled,
              let displayPart = preparedUpload.display,
              let thumbnailPart = preparedUpload.thumbnail,
              let placeholderPart = preparedUpload.placeholder else {
            return nil
        }

        do {
            let localDerivatives = try await StoryImageDerivativeBuilder.build(fileURL: upload.mediaFileURL)
            try await api.uploadImageData(localDerivatives.display.data, part: displayPart)
            try await api.uploadImageData(localDerivatives.thumbnail.data, part: thumbnailPart)
            try await api.uploadImageData(localDerivatives.placeholder.data, part: placeholderPart)

            let uploaded = UploadedImageDerivativeSet(
                display: localDerivatives.display.metadata(pathname: displayPart.pathname),
                thumbnail: localDerivatives.thumbnail.metadata(pathname: thumbnailPart.pathname),
                placeholder: localDerivatives.placeholder.metadata(pathname: placeholderPart.pathname)
            )
            MediaPerformance.mark(
                "image_derivatives_prepared displayBytes=\(uploaded.display.byteSize) thumbBytes=\(uploaded.thumbnail.byteSize) placeholderBytes=\(uploaded.placeholder.byteSize)"
            )
            return uploaded
        } catch {
            MediaPerformance.mark("image_derivative_upload_failed reason=client_prepare")
            return nil
        }
    }

    private func uploadTusVideo(_ upload: PendingStoryUpload, api: APIClient) async throws -> StoryUploadResponse {
        update(id: upload.id, state: .uploading, progress: 0.12)
        let byteSize = try await StoryUploadFileIO.fileSize(at: upload.mediaFileURL)
        let thumbnailData = await StoryUploadFileIO.data(at: upload.thumbnailFileURL)
        var preparedUpload: VideoUploadResponse

        if let resumableUpload = upload.preparedVideoUpload,
           resumableUpload.uploadProtocol == "tus" {
            preparedUpload = resumableUpload
            MediaPerformance.mark("pending_video_upload_resume uid=\(resumableUpload.uid)")
        } else {
            preparedUpload = try await prepareTusVideoUpload(
                upload,
                byteSize: byteSize,
                replacing: nil,
                api: api
            )
        }

        for leaseAttempt in 0..<2 {
            do {
                update(id: upload.id, state: .uploading, progress: 0.2)
                let uploadedThumbnailData = await uploadVideoThumbnailIfPossible(
                    thumbnailData,
                    upload: preparedUpload,
                    api: api
                )
                update(id: upload.id, state: .uploading, progress: 0.24)

                try await api.uploadVideoFile(
                    fileURL: upload.mediaFileURL,
                    upload: preparedUpload,
                    onRetry: { reason in
                        self.recordRetry(id: upload.id, reason: reason)
                    },
                    maxChunkBytes: videoUploadChunkBytes(),
                    onProgress: { progress in
                        self.update(
                            id: upload.id,
                            state: .uploading,
                            progress: 0.24 + min(max(progress, 0), 1) * 0.66
                        )
                    }
                )

                update(id: upload.id, state: .completing, progress: 0.94)
                let response = try await api.completeVideoStory(
                    upload: preparedUpload,
                    fileURL: upload.mediaFileURL,
                    caption: upload.draft.caption,
                    brandTags: upload.draft.brandTags,
                    textOverlay: upload.draft.textOverlay,
                    textOverlayPositionX: upload.draft.textOverlayPositionX,
                    textOverlayPositionY: upload.draft.textOverlayPositionY,
                    linkLabel: upload.draft.linkLabel,
                    linkUrl: upload.draft.linkUrl,
                    linkOverlayPositionX: upload.draft.linkOverlayPositionX,
                    linkOverlayPositionY: upload.draft.linkOverlayPositionY,
                    quoteReplyId: upload.draft.quoteReplyId,
                    quoteReplyPositionX: upload.draft.quoteReplyPositionX,
                    quoteReplyPositionY: upload.draft.quoteReplyPositionY,
                    durationMs: upload.durationMs,
                    thumbnailData: uploadedThumbnailData
                )
                update(id: upload.id, state: .completing, progress: 1)
                return response
            } catch {
                let statusCode = (error as? APIClientError)?.statusCode
                let sessionIsTerminal = statusCode.map { [403, 404, 410].contains($0) } == true
                guard leaseAttempt == 0, sessionIsTerminal else {
                    if sessionIsTerminal {
                        setPreparedVideoUpload(id: upload.id, preparedUpload: nil)
                    }
                    throw error
                }

                let failedSessionId = preparedUpload.uploadSessionId
                recordRetry(id: upload.id, reason: "replace_upload_session")
                setPreparedVideoUpload(id: upload.id, preparedUpload: nil)
                preparedUpload = try await prepareTusVideoUpload(
                    upload,
                    byteSize: byteSize,
                    replacing: failedSessionId,
                    api: api
                )
            }
        }

        throw APIClientError.server("Could not resume this video upload.", 0)
    }

    private func videoUploadChunkBytes() -> Int64 {
        Int64(MediaControlConfig.shared.uploadChunkBytes)
    }

    private func prepareTusVideoUpload(
        _ upload: PendingStoryUpload,
        byteSize: Int64,
        replacing uploadSessionId: String?,
        api: APIClient
    ) async throws -> VideoUploadResponse {
        let preparedUpload = try await api.prepareVideoUpload(
            fileName: upload.fileName.isEmpty ? "story-video.mp4" : upload.fileName,
            byteSize: byteSize,
            maxDurationSeconds: maxVideoDurationSeconds,
            clientUploadId: Self.clientUploadId(for: upload.id),
            replaceUploadSessionId: uploadSessionId
        )

        guard preparedUpload.uploadProtocol == "tus" else {
            throw APIClientError.server("The media service did not provide a resumable upload.", 0)
        }

        setPreparedVideoUpload(id: upload.id, preparedUpload: preparedUpload)
        return preparedUpload
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
            MediaPerformance.mark("pending_video_thumbnail_upload_failed")
            return nil
        }
    }

    private func cacheUploadedMedia(_ upload: PendingStoryUpload, response: StoryUploadResponse) async {
        let mediaUrl = response.asset.renditions?.playback.mediaUrl ?? response.asset.mediaUrl
        await MediaFileDiskCache.shared.storeLocalFile(
            sourceURL: upload.mediaFileURL,
            for: mediaUrl,
            kind: upload.assetKind == .video ? .video : .image
        )

        guard let thumbnailUrl = response.asset.renditions?.playback.thumbnailUrl ?? response.asset.thumbnailUrl,
              let localThumbnailURL = upload.thumbnailFileURL else {
            return
        }

        await MediaFileDiskCache.shared.storeLocalFile(
            sourceURL: localThumbnailURL,
            for: thumbnailUrl,
            kind: .image
        )
    }

    private func storyCard(for upload: PendingStoryUpload, owner: MyStorySummary.Owner) -> StoryCard {
        StoryCard(
            id: upload.id,
            creator: owner.name,
            handle: owner.handle,
            assetKind: upload.assetKind,
            mediaUrl: upload.mediaFileURL,
            thumbnailUrl: upload.assetKind == .image ? upload.mediaFileURL : upload.thumbnailFileURL,
            placeholderUrl: upload.assetKind == .image ? upload.mediaFileURL : upload.thumbnailFileURL,
            renditions: nil,
            title: upload.statusLabel,
            processingStatus: nil,
            textOverlays: upload.textOverlays,
            durationSeconds: upload.durationMs.map { Double($0) / 1_000 },
            lastUploadedAt: nil,
            progressPercent: upload.displayProgress * 100,
            timelineSegmentCount: nil
        )
    }

    private func stackItem(for upload: PendingStoryUpload) -> StoryStackItem {
        StoryStackItem(
            id: upload.id,
            assetKind: upload.assetKind,
            mediaUrl: upload.mediaFileURL,
            thumbnailUrl: upload.assetKind == .image ? upload.mediaFileURL : upload.thumbnailFileURL,
            placeholderUrl: upload.assetKind == .image ? upload.mediaFileURL : upload.thumbnailFileURL,
            renditions: nil,
            title: upload.statusLabel,
            processingStatus: nil,
            textOverlays: upload.textOverlays,
            postedAt: upload.statusLabel,
            durationSeconds: upload.durationMs.map { Double($0) / 1_000 },
            captionVerticalPercent: nil,
            stats: nil
        )
    }

    private func update(
        id: String,
        state: PendingStoryUploadState,
        progress: Double,
        errorMessage: String? = nil,
        incrementsRetry: Bool = false
    ) {
        guard let index = uploads.firstIndex(where: { $0.id == id }) else {
            return
        }

        uploads[index].state = state
        uploads[index].progress = min(max(progress, 0), 1)
        uploads[index].updatedAt = Date()
        uploads[index].errorMessage = errorMessage
        if incrementsRetry {
            uploads[index].retryCount += 1
        }
        persist()
    }

    private func recordRetry(id: String, reason: String) {
        guard let index = uploads.firstIndex(where: { $0.id == id }) else {
            return
        }

        uploads[index].retryCount += 1
        uploads[index].updatedAt = Date()
        persist()
        MediaPerformance.mark("pending_story_upload_retry id=\(id) reason=\(reason)")
    }

    private func setPreparedVideoUpload(id: String, preparedUpload: VideoUploadResponse?) {
        guard let index = uploads.firstIndex(where: { $0.id == id }) else {
            return
        }

        uploads[index].preparedVideoUpload = preparedUpload
        uploads[index].updatedAt = Date()
        persist()
    }

    private func markFailed(id: String, error: Error) {
        let message = error.localizedDescription
        update(id: id, state: .failed, progress: uploads.first(where: { $0.id == id })?.displayProgress ?? 0, errorMessage: message)
        MediaPerformance.mark("pending_story_upload_failed id=\(id)")
    }

    private func reconcile(id: String) {
        guard let upload = uploads.first(where: { $0.id == id }) else {
            return
        }

        removeFiles(for: upload)
        uploads.removeAll { $0.id == id }
        persist()
    }

    private func upsert(_ upload: PendingStoryUpload) {
        uploads.removeAll { $0.id == upload.id }
        uploads.append(upload)
        persist()
    }

    private func loadPersistedUploads() {
        guard let data = try? Data(contentsOf: manifestURL),
              let decoded = try? JSONDecoder().decode([PendingStoryUpload].self, from: data) else {
            uploads = []
            return
        }

        uploads = decoded.compactMap { upload in
            guard fileManager.fileExists(atPath: upload.mediaFileURL.path) else {
                return nil
            }

            var restoredUpload = upload
            if restoredUpload.state != .failed {
                restoredUpload.state = .failed
                restoredUpload.errorMessage = "Upload interrupted. Tap to retry."
                restoredUpload.updatedAt = Date()
                let prepared = restoredUpload.preparedVideoUpload == nil ? "false" : "true"
                MediaPerformance.mark(
                    "background_upload_resume id=\(restoredUpload.id) pipeline=\(restoredUpload.pipeline.rawValue) prepared=\(prepared)"
                )
            }
            return restoredUpload
        }
        persist()
    }

    private func persist() {
        do {
            try ensureDirectories()
            let data = try JSONEncoder().encode(uploads)
            try data.write(to: manifestURL, options: .atomic)
        } catch {
            MediaPerformance.mark("pending_story_upload_persist_failed")
        }
    }

    private func ensureDirectories() throws {
        try fileManager.createDirectory(at: filesURL, withIntermediateDirectories: true)
    }

    private func removeFiles(for upload: PendingStoryUpload) {
        try? fileManager.removeItem(at: upload.mediaFileURL)
        if let thumbnailFileURL = upload.thumbnailFileURL, thumbnailFileURL != upload.mediaFileURL {
            try? fileManager.removeItem(at: thumbnailFileURL)
        }
    }

    private func fileSize(_ url: URL) throws -> Int64 {
        guard let size = try fileManager.attributesOfItem(atPath: url.path)[.size] as? NSNumber,
              size.int64Value > 0 else {
            throw APIClientError.invalidResponse
        }

        return size.int64Value
    }

    private static func makePendingId() -> String {
        "pending-story-\(UUID().uuidString.lowercased())"
    }

    private static func clientUploadId(for pendingId: String) -> String {
        let prefix = "pending-story-"
        guard pendingId.hasPrefix(prefix) else {
            return pendingId
        }

        return String(pendingId.dropFirst(prefix.count))
    }
}

private final class StoryUploadBackgroundTask {
    private var identifier = UIBackgroundTaskIdentifier.invalid

    init(name: String) {
        identifier = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in
            self?.end()
        }
    }

    func end() {
        guard identifier != .invalid else {
            return
        }

        UIApplication.shared.endBackgroundTask(identifier)
        identifier = .invalid
    }

    deinit {
        end()
    }
}

enum StoryUploadDiagnostics {
    static func mark(_ event: String, response: StoryUploadResponse? = nil) {
        let metadata = [
            "event=\(event)",
            response.map { "storyId=\($0.storyId)" },
            response.map { "asset=\($0.asset.assetKind.rawValue)" },
            response?.processingStatus.map { "processing=\($0)" },
            response?.moderationStatus.map { "moderation=\($0)" },
        ]
            .compactMap { $0 }
            .joined(separator: " ")

        MediaPerformance.mark("story_upload \(metadata)")
    }
}
