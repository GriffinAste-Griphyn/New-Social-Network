import Combine
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
        guard let thumbnailUrl = response.asset.thumbnailUrl else {
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
    case videoTus
    case originalQualityVideo
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
    var publishedStoryId: String?
    var originalUpload: OriginalVideoUploadResponse?

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
            "Posting"
        case .completing:
            "Finishing"
        case .failed:
            "Failed"
        }
    }

    var statusDetailLabel: String {
        switch state {
        case .queued:
            "Queued"
        case .uploading:
            progressPercentLabel
        case .completing:
            "Visible locally"
        case .failed:
            "Tap to retry"
        }
    }

    var progressPercentLabel: String {
        "\(Int((displayProgress * 100).rounded()))%"
    }

    var showsUploadProgressPercent: Bool {
        state == .uploading && !isFailed
    }
}

@MainActor
final class PendingStoryUploadStore: ObservableObject {
    @Published private(set) var uploads: [PendingStoryUpload] = []
    @Published private(set) var activeUploadIds: Set<String> = []

    private let fileManager: FileManager
    private let rootURL: URL
    private let filesURL: URL
    private let manifestURL: URL
    private let maxVideoDurationSeconds = 120
    private let maxOriginalAttachmentRetries = 5
    private var uploadTasks: [String: Task<Void, Never>] = [:]
    private var originalAttachmentTasks: [String: Task<Void, Never>] = [:]

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
        uploads
            .filter { $0.publishedStoryId == nil }
            .sorted { $0.createdAt < $1.createdAt }
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
            pipeline: .imageMultipart,
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
            publishedStoryId: nil,
            originalUpload: nil
        )
        upsert(pending)
        MediaImageCache.shared.preheat([mediaURL], limit: 1)
        return pending
    }

    func createVideoUpload(
        sourceURL: URL,
        thumbnailData: Data?,
        durationMs: Int?,
        pipeline: PendingStoryUploadPipeline,
        draft: PendingStoryUploadDraft,
        textOverlays: [StoryTextOverlay]
    ) throws -> PendingStoryUpload {
        try ensureDirectories()
        let id = Self.makePendingId()
        let fileExtension = sourceURL.pathExtension.isEmpty ? "mp4" : sourceURL.pathExtension
        let mediaURL = filesURL.appendingPathComponent("\(id).\(fileExtension)")
        try? fileManager.removeItem(at: mediaURL)
        try fileManager.copyItem(at: sourceURL, to: mediaURL)

        let thumbnailURL: URL?
        if let thumbnailData, !thumbnailData.isEmpty {
            let localThumbnailURL = filesURL.appendingPathComponent("\(id)-thumbnail.jpg")
            try thumbnailData.write(to: localThumbnailURL, options: .atomic)
            thumbnailURL = localThumbnailURL
        } else {
            thumbnailURL = nil
        }

        let pending = PendingStoryUpload(
            id: id,
            assetKind: .video,
            pipeline: pipeline,
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
            publishedStoryId: nil,
            originalUpload: nil
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
            case .videoTus:
                response = try await uploadTusVideo(upload, api: api)
            case .originalQualityVideo:
                response = try await uploadOriginalQualityVideo(upload, api: api)
            }

            await cacheUploadedMedia(upload, response: response)
            if !shouldKeepOriginalAttachmentRecord(id: id) {
                reconcile(id: id)
            }
            return response
        } catch {
            if Self.isCancellation(error) {
                remove(id: id)
                throw CancellationError()
            }
            markFailed(id: id, error: error)
            throw error
        }
    }

    func retry(id: String, api: APIClient) async throws -> StoryUploadResponse {
        update(id: id, state: .queued, progress: 0.04, errorMessage: nil, incrementsRetry: true)
        return try await performUpload(id: id, api: api)
    }

    func startUpload(
        id: String,
        api: APIClient,
        onCompleted: @escaping (StoryUploadResponse) -> Void,
        onFailed: @escaping (String) -> Void = { _ in }
    ) {
        guard uploadTasks[id] == nil,
              uploads.contains(where: { $0.id == id }) else {
            return
        }

        activeUploadIds.insert(id)
        uploadTasks[id] = Task { @MainActor [weak self, api] in
            guard let self else {
                return
            }

            defer {
                self.activeUploadIds.remove(id)
                self.uploadTasks[id] = nil
            }

            do {
                let response = try await self.performUpload(id: id, api: api)
                guard !Task.isCancelled else {
                    return
                }
                onCompleted(response)
            } catch {
                guard !Self.isCancellation(error) else {
                    return
                }

                let message = error.localizedDescription
                if self.uploads.contains(where: { $0.id == id }) {
                    onFailed(message)
                }
            }
        }
    }

    func retryUpload(
        id: String,
        api: APIClient,
        onCompleted: @escaping (StoryUploadResponse) -> Void,
        onFailed: @escaping (String) -> Void = { _ in }
    ) {
        guard uploadTasks[id] == nil else {
            return
        }
        update(id: id, state: .queued, progress: 0.04, errorMessage: nil, incrementsRetry: true)
        startUpload(id: id, api: api, onCompleted: onCompleted, onFailed: onFailed)
    }

    func cancelUpload(id: String) {
        uploadTasks[id]?.cancel()
        uploadTasks[id] = nil
        activeUploadIds.remove(id)
        remove(id: id)
        MediaPerformance.mark("pending_story_upload_cancelled id=\(id)")
    }

    func resumeBackgroundOriginalAttachments(api: APIClient) {
        let candidates = uploads.filter { upload in
            upload.pipeline == .originalQualityVideo &&
                upload.publishedStoryId != nil &&
                upload.retryCount < maxOriginalAttachmentRetries
        }

        for upload in candidates {
            scheduleOriginalAttachment(id: upload.id, api: api, preferredUpload: nil)
        }
    }

    func remove(id: String) {
        guard let upload = uploads.first(where: { $0.id == id }) else {
            return
        }

        uploadTasks[id]?.cancel()
        uploadTasks[id] = nil
        activeUploadIds.remove(id)
        originalAttachmentTasks[id]?.cancel()
        originalAttachmentTasks[id] = nil
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

    private func uploadTusVideo(_ upload: PendingStoryUpload, api: APIClient) async throws -> StoryUploadResponse {
        update(id: upload.id, state: .uploading, progress: 0.12)
        let preparedUpload = try await api.prepareVideoUpload(
            fileName: upload.fileName.isEmpty ? "story-video.mp4" : upload.fileName,
            byteSize: try fileSize(upload.mediaFileURL),
            maxDurationSeconds: maxVideoDurationSeconds
        )
        update(id: upload.id, state: .uploading, progress: 0.2)

        let uploadedThumbnailData = await uploadVideoThumbnailIfPossible(
            localThumbnailData(for: upload),
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
    }

    private func uploadOriginalQualityVideo(_ upload: PendingStoryUpload, api: APIClient) async throws -> StoryUploadResponse {
        update(id: upload.id, state: .uploading, progress: 0.12)
        let preparedUpload = try await api.prepareOriginalQualityVideoUpload(
            fileName: upload.fileName.isEmpty ? "story-video.mov" : upload.fileName,
            fileURL: upload.mediaFileURL
        )
        markOriginalUploadPrepared(id: upload.id, upload: preparedUpload)
        update(id: upload.id, state: .uploading, progress: 0.2)
        let playbackTargets = preparedUpload.playbackRenditionUploads ?? []
        let playbackRenditions: [StoryVideoPlaybackRendition]
        let playbackRendition: StoryVideoPlaybackRendition?

        if !playbackTargets.isEmpty {
            playbackRenditions = try await StoryVideoUploadNormalizer.playbackRenditions(
                for: upload.mediaFileURL,
                targets: playbackTargets
            )
            playbackRendition = playbackRenditions.first { $0.quality == "1080p" }
        } else if preparedUpload.playbackPathname != nil,
                  preparedUpload.playbackUploadUrl != nil,
                  preparedUpload.playbackClientToken != nil,
                  preparedUpload.playbackContentType != nil,
                  preparedUpload.maxPlaybackSizeBytes != nil {
            playbackRenditions = []
            playbackRendition = try await StoryVideoUploadNormalizer.playbackRendition(for: upload.mediaFileURL)
        } else {
            playbackRenditions = []
            playbackRendition = nil
        }
        defer {
            var removed = Set<URL>()
            for rendition in playbackRenditions + [playbackRendition].compactMap({ $0 }) where removed.insert(rendition.url).inserted {
                try? FileManager.default.removeItem(at: rendition.url)
            }
        }

        let uploadedThumbnailData = await uploadOriginalQualityVideoThumbnailIfPossible(
            localThumbnailData(for: upload),
            upload: preparedUpload,
            api: api
        )
        update(id: upload.id, state: .uploading, progress: 0.24)

        if !playbackTargets.isEmpty {
            var targetsByQuality: [String: OriginalVideoPlaybackRenditionUpload] = [:]
            playbackTargets.forEach { targetsByQuality[$0.quality] = $0 }

            let renditionProgressSlice = playbackRenditions.isEmpty ? 0 : 0.2 / Double(playbackRenditions.count)
            for (index, rendition) in playbackRenditions.enumerated() {
                guard let target = targetsByQuality[rendition.quality] else {
                    continue
                }

                _ = try await api.uploadOriginalQualityPlaybackRenditionFile(
                    fileURL: rendition.url,
                    target: target,
                    onProgress: { progress in
                        self.update(
                            id: upload.id,
                            state: .uploading,
                            progress: 0.24 + Double(index) * renditionProgressSlice + min(max(progress, 0), 1) * renditionProgressSlice
                        )
                    }
                )
            }
        } else if let playbackRendition {
            _ = try await api.uploadOriginalQualityPlaybackVideoFile(
                fileURL: playbackRendition.url,
                upload: preparedUpload,
                onProgress: { progress in
                    self.update(
                        id: upload.id,
                        state: .uploading,
                        progress: 0.24 + min(max(progress, 0), 1) * 0.2
                    )
                }
            )
        }

        update(id: upload.id, state: .completing, progress: 0.94)
        let response = try await api.completeOriginalQualityPlaybackStory(
            upload: preparedUpload,
            playbackRendition: playbackRendition,
            playbackRenditions: playbackRenditions,
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
        await MediaFileDiskCache.shared.storeLocalFile(
            sourceURL: playbackRendition?.url ?? upload.mediaFileURL,
            for: response.asset.mediaUrl,
            kind: .video
        )
        if let remoteRenditions = response.asset.renditions?.playbackLadder {
            for rendition in playbackRenditions {
                guard let remote = remoteRenditions.first(where: { $0.quality == rendition.quality })?.mediaUrl else {
                    continue
                }

                await MediaFileDiskCache.shared.storeLocalFile(
                    sourceURL: rendition.url,
                    for: remote,
                    kind: .video
                )
            }
        }
        markPlaybackPublished(id: upload.id, storyId: response.storyId, upload: preparedUpload)
        scheduleOriginalAttachment(id: upload.id, api: api, preferredUpload: preparedUpload)
        update(id: upload.id, state: .completing, progress: 1)
        return response
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
            return data
        } catch {
            MediaPerformance.mark("pending_video_original_thumbnail_upload_failed")
            return nil
        }
    }

    private func cacheUploadedMedia(_ upload: PendingStoryUpload, response: StoryUploadResponse) async {
        if upload.pipeline != .originalQualityVideo {
            let mediaUrl = response.asset.renditions?.playback.mediaUrl ?? response.asset.mediaUrl
            await MediaFileDiskCache.shared.storeLocalFile(
                sourceURL: upload.mediaFileURL,
                for: mediaUrl,
                kind: upload.assetKind == .video ? .video : .image
            )
        }

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

    private func markOriginalUploadPrepared(id: String, upload: OriginalVideoUploadResponse) {
        guard let index = uploads.firstIndex(where: { $0.id == id }) else {
            return
        }

        uploads[index].originalUpload = upload
        uploads[index].updatedAt = Date()
        persist()
    }

    private func markPlaybackPublished(id: String, storyId: String, upload: OriginalVideoUploadResponse) {
        guard let index = uploads.firstIndex(where: { $0.id == id }) else {
            return
        }

        uploads[index].publishedStoryId = storyId
        uploads[index].originalUpload = upload
        uploads[index].state = .completing
        uploads[index].progress = 1
        uploads[index].errorMessage = nil
        uploads[index].updatedAt = Date()
        persist()
    }

    private func shouldKeepOriginalAttachmentRecord(id: String) -> Bool {
        guard let upload = uploads.first(where: { $0.id == id }) else {
            return false
        }

        return upload.pipeline == .originalQualityVideo && upload.publishedStoryId != nil
    }

    private func scheduleOriginalAttachment(
        id: String,
        api: APIClient,
        preferredUpload: OriginalVideoUploadResponse?
    ) {
        guard originalAttachmentTasks[id] == nil,
              let upload = uploads.first(where: { $0.id == id }),
              upload.pipeline == .originalQualityVideo,
              upload.publishedStoryId != nil else {
            return
        }

        guard upload.retryCount < maxOriginalAttachmentRetries else {
            MediaPerformance.mark("pending_story_original_attach_retry_exhausted id=\(id)")
            return
        }

        originalAttachmentTasks[id] = Task { @MainActor [weak self, api] in
            await self?.attachOriginalInBackground(
                id: id,
                api: api,
                preferredUpload: preferredUpload
            )
        }
    }

    private func attachOriginalInBackground(
        id: String,
        api: APIClient,
        preferredUpload: OriginalVideoUploadResponse?
    ) async {
        let backgroundTask = StoryUploadBackgroundTask(name: "story-original-attach-\(id)")
        defer {
            backgroundTask.end()
            originalAttachmentTasks[id] = nil
        }

        guard let upload = uploads.first(where: { $0.id == id }),
              upload.pipeline == .originalQualityVideo,
              let storyId = upload.publishedStoryId else {
            return
        }

        guard fileManager.fileExists(atPath: upload.mediaFileURL.path) else {
            MediaPerformance.mark("pending_story_original_attach_missing_file id=\(id) storyId=\(storyId)")
            reconcile(id: id)
            return
        }

        do {
            update(id: id, state: .completing, progress: 1, errorMessage: nil)
            let attachment: OriginalVideoAttachResponse
            if let existingAttachment = await attachPreparedOriginalIfAvailable(
                id: id,
                storyId: storyId,
                upload: upload,
                api: api,
                preferredUpload: preferredUpload
            ) {
                attachment = existingAttachment
            } else {
                let uploadTarget = try await originalUploadTarget(
                    for: upload,
                    api: api,
                    preferredUpload: preferredUpload
                )

                guard !Task.isCancelled else {
                    return
                }

                _ = try await api.uploadOriginalQualityVideoFile(
                    fileURL: upload.mediaFileURL,
                    upload: uploadTarget
                )

                guard !Task.isCancelled else {
                    return
                }

                attachment = try await api.attachOriginalQualityVideo(
                    storyId: storyId,
                    upload: uploadTarget,
                    fileURL: upload.mediaFileURL,
                    durationMs: upload.durationMs
                )
            }

            if let originalUrl = attachment.asset?.renditions?.original?.mediaUrl {
                await MediaFileDiskCache.shared.storeLocalFile(
                    sourceURL: upload.mediaFileURL,
                    for: originalUrl,
                    kind: .video
                )
            }

            MediaPerformance.mark("pending_story_original_attach_complete id=\(id) storyId=\(storyId)")
            reconcile(id: id)
        } catch {
            guard !Task.isCancelled else {
                return
            }

            markOriginalAttachmentFailed(id: id, error: error)
        }
    }

    private func attachPreparedOriginalIfAvailable(
        id: String,
        storyId: String,
        upload: PendingStoryUpload,
        api: APIClient,
        preferredUpload: OriginalVideoUploadResponse?
    ) async -> OriginalVideoAttachResponse? {
        guard preferredUpload == nil,
              let originalUpload = upload.originalUpload else {
            return nil
        }

        do {
            let attachment = try await api.attachOriginalQualityVideo(
                storyId: storyId,
                upload: originalUpload,
                fileURL: upload.mediaFileURL,
                durationMs: upload.durationMs
            )
            MediaPerformance.mark("pending_story_original_attach_reused_upload id=\(id) storyId=\(storyId)")
            return attachment
        } catch {
            MediaPerformance.mark("pending_story_original_attach_reuse_miss id=\(id) storyId=\(storyId)")
            return nil
        }
    }

    private func originalUploadTarget(
        for upload: PendingStoryUpload,
        api: APIClient,
        preferredUpload: OriginalVideoUploadResponse?
    ) async throws -> OriginalVideoUploadResponse {
        if let preferredUpload {
            markOriginalUploadPrepared(id: upload.id, upload: preferredUpload)
            return preferredUpload
        }

        let preparedUpload = try await api.prepareOriginalQualityVideoUpload(
            fileName: upload.fileName.isEmpty ? "story-video.mov" : upload.fileName,
            fileURL: upload.mediaFileURL
        )
        markOriginalUploadPrepared(id: upload.id, upload: preparedUpload)
        return preparedUpload
    }

    private func markOriginalAttachmentFailed(id: String, error: Error) {
        update(
            id: id,
            state: .failed,
            progress: 1,
            errorMessage: error.localizedDescription,
            incrementsRetry: true
        )
        MediaPerformance.mark("pending_story_original_attach_failed id=\(id)")
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

    private func markFailed(id: String, error: Error) {
        let message = error.localizedDescription
        update(id: id, state: .failed, progress: uploads.first(where: { $0.id == id })?.displayProgress ?? 0, errorMessage: message)
        MediaPerformance.mark("pending_story_upload_failed id=\(id)")
    }

    private func reconcile(id: String) {
        guard let upload = uploads.first(where: { $0.id == id }) else {
            return
        }

        originalAttachmentTasks[id]?.cancel()
        originalAttachmentTasks[id] = nil
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
            if restoredUpload.publishedStoryId != nil {
                restoredUpload.state = .completing
                restoredUpload.progress = 1
                restoredUpload.errorMessage = nil
                restoredUpload.updatedAt = Date()
            } else if restoredUpload.state != .failed {
                restoredUpload.state = .failed
                restoredUpload.errorMessage = "Upload interrupted. Tap to retry."
                restoredUpload.updatedAt = Date()
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

    private func localThumbnailData(for upload: PendingStoryUpload) -> Data? {
        guard let thumbnailFileURL = upload.thumbnailFileURL else {
            return nil
        }

        return try? Data(contentsOf: thumbnailFileURL)
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
