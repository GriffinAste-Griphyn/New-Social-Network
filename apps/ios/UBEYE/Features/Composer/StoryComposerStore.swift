import AVFoundation
import CryptoKit
import ImageIO
import Photos
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

enum StoryComposerLimits {
    static let caption = 220
    static let textOverlay = 220
    static let linkLabel = 64
    static let linkURL = 320
    static let brandTag = 32
    static let brandTagsInput = 320
}

func storyTextPrefix(_ value: String, maximumUTF16Length: Int) -> String {
    guard value.utf16.count > maximumUTF16Length else {
        return value
    }

    var result = ""
    var length = 0
    for character in value {
        let characterLength = String(character).utf16.count
        guard length + characterLength <= maximumUTF16Length else {
            break
        }
        result.append(character)
        length += characterLength
    }
    return result
}

@MainActor
final class StoryComposerStore: ObservableObject {
    private let maxVideoDurationSeconds = StoryMediaContract.maximumVideoDurationSeconds
    private let draftPersistence: ComposerDraftPersistence
    private var isRestoringDraft = false
    private static let earlyUploadPreferenceKey = "ubeye.story-composer-early-upload.v1"
    private let preferences: UserDefaults


    @Published var caption = "" { didSet { scheduleDraftSave() } }
    @Published var brandTags = "" { didSet { scheduleDraftSave() } }
    @Published var textOverlay = "" { didSet { scheduleDraftSave() } }
    @Published var textOverlayPositionX: Double = 50 { didSet { scheduleDraftSave() } }
    @Published var textOverlayPositionY: Double = 68 { didSet { scheduleDraftSave() } }
    @Published var linkUrl = "" { didSet { scheduleDraftSave() } }
    @Published var linkLabel = "" { didSet { scheduleDraftSave() } }
    @Published var linkOverlayPositionX: Double = 50 { didSet { scheduleDraftSave() } }
    @Published var linkOverlayPositionY: Double = 78 { didSet { scheduleDraftSave() } }
    @Published var quotedReply: QuotedStoryReply? { didSet { scheduleDraftSave() } }
    @Published var quoteReplyPositionX: Double = 50 { didSet { scheduleDraftSave() } }
    @Published var quoteReplyPositionY: Double = 58 { didSet { scheduleDraftSave() } }
    @Published var selectedMedia: PickedStoryMedia? {
        didSet {
            guard !isUploading else { return }
            prepareSelectionLocally(selectedMedia.map { [$0] } ?? [])
        }
    }
    private struct LocalVideoPreparation {
        let video: PreparedStoryVideo
        let fingerprint: StoryUploadFileFingerprint
    }
    private struct PreparationEntry {
        let source: String
        let durationLimit: Int
        let adaptiveEncodingEnabled: Bool
        let fingerprint: StoryUploadFileFingerprint
        let task: Task<LocalVideoPreparation, Error>
    }
    private var localPreparations: [URL: PreparationEntry] = [:]
    private var selectionPreparationTask: Task<Void, Never>?
    private var readyPreparations: [URL: LocalVideoPreparation] = [:]
    @Published private(set) var uploadWhileEditing = false
    private var draftUploadAPI: APIClient?
    private var draftUploads: [URL: StoryDraftVideoTransfer] = [:]
    private var readyDraftUploads: [URL: StoryDraftVideoUpload] = [:]

    func setUploadWhileEditing(_ enabled: Bool, api: APIClient, media: [PickedStoryMedia]) {
        preferences.set(enabled, forKey: Self.earlyUploadPreferenceKey)
        configureEarlyUpload(enabled, api: api, media: media)
    }

    func resumeEarlyUpload(api: APIClient, media: [PickedStoryMedia]) {
        configureEarlyUpload((preferences.object(forKey: Self.earlyUploadPreferenceKey) as? Bool ?? true), api: api, media: media)
    }

    func suspendEarlyUpload(api: APIClient) {
        // Dismissal cancels private work, but does not revoke a saved preference.
        configureEarlyUpload(false, api: api, media: [])
    }

    private func configureEarlyUpload(_ enabled: Bool, api: APIClient, media: [PickedStoryMedia]) {
        uploadWhileEditing = enabled
        draftUploadAPI = enabled ? api : nil
        if !enabled { for url in Array(draftUploads.keys) { discardDraftUpload(for: url, api: api) } }
        prepareSelectionLocally(media)
    }

    private func discardDraftUpload(for url: URL, api: APIClient) {
        readyDraftUploads[url] = nil
        guard let entry = draftUploads.removeValue(forKey: url) else { return }
        entry.task.cancel()
        Task {
            if let result = try? await entry.task.value {
                if api.authToken == entry.account, api.baseURLString == entry.origin, let session = result.upload.uploadSessionId {
                    try? await api.cancelPrivateVideoUpload(clientUploadId: entry.clientUploadId, uploadSessionId: session)
                }
                await StoryUploadFileIO.remove([result.video.url])
            }
        }
    }

    private func startDraftUpload(for video: StoryVideoUpload, prepared: PreparedStoryVideo) async {
        guard uploadWhileEditing, let api = draftUploadAPI, let account = api.authToken,
              NetworkQualityMonitor.shared.isConnected, !NetworkQualityMonitor.shared.isLimitedPath,
              UBEYEResourceMonitor.shared.mode == .standard,
              draftUploads[video.url] == nil, !Task.isCancelled else { return }
        let id = UUID().uuidString.lowercased()
        let origin = api.baseURLString
        let owned = FileManager.default.temporaryDirectory.appendingPathComponent("story-draft-upload-\(id).\(prepared.url.pathExtension)")
        let originalFingerprint: StoryUploadFileFingerprint
        let fingerprint: StoryUploadFileFingerprint
        do {
            originalFingerprint = try await StoryUploadFileFingerprint.read(video.url)
            try await StoryUploadFileIO.stageFile(source: prepared.url, destination: owned)
            fingerprint = try await StoryUploadFileFingerprint.read(owned)
            try Task.checkCancellation()
        } catch {
            await StoryUploadFileIO.remove([owned])
            return
        }
        let ownership = StoryDraftVideoOwnership()
        let task = Task { [weak self] () throws -> StoryDraftVideoUpload in
            var lease: VideoUploadResponse?
            do {
                guard try await StoryUploadFileIO.hasFastStartMoov(at: owned) else { throw APIClientError.invalidResponse }
                try Task.checkCancellation()
                guard api.authToken == account, api.baseURLString == origin else { throw CancellationError() }
                try await StoryUploadPermitPool.videoTransfer.acquire()
                defer { StoryUploadPermitPool.videoTransfer.release() }
                let upload = try await api.prepareVideoUpload(fileName: owned.lastPathComponent,
                    byteSize: prepared.byteSize, maxDurationSeconds: StoryMediaContract.maximumVideoDurationSeconds,
                    clientUploadId: id)
                lease = upload
                try Task.checkCancellation()
                async let checksumWork = StoryUploadFileIO.sha256Hex(at: owned)
                let receipt = try await api.uploadVideoFile(fileURL: owned, upload: upload,
                    maxChunkBytes: Int64(MediaControlConfig.shared.uploadChunkBytes),
                    attemptId: "draft-\(id)", unmeteredOnly: true,
                    onProgress: { progress in Task { @MainActor in ownership.onProgress?(progress) } })
                let checksum = try await checksumWork
                try Task.checkCancellation()
                guard api.authToken == account, api.baseURLString == origin,
                      try await StoryUploadFileFingerprint.read(owned) == fingerprint else { throw CancellationError() }
                if !ownership.isSubmitted {
                    guard try await StoryUploadFileFingerprint.read(video.url) == originalFingerprint else { throw CancellationError() }
                }
                let result = StoryDraftVideoUpload(clientUploadId: id,
                    video: PreparedStoryVideo(url: owned, durationMs: prepared.durationMs, byteSize: prepared.byteSize,
                        strategy: prepared.strategy, inspection: prepared.inspection),
                    upload: upload, blobUploadId: receipt, checksum: checksum,
                    fingerprint: fingerprint, originalFingerprint: originalFingerprint)
                if self?.draftUploads[video.url]?.clientUploadId == id { self?.readyDraftUploads[video.url] = result }
                return result
            } catch {
                // Unstructured cleanup can finish even when speculative work is cancelled.
                let failedLease = lease
                if !ownership.isSubmitted, self?.draftUploads[video.url]?.clientUploadId == id {
                    self?.draftUploads[video.url] = nil
                    self?.readyDraftUploads[video.url] = nil
                }
                Task {
                    if !ownership.isSubmitted, api.authToken == account, api.baseURLString == origin, let session = failedLease?.uploadSessionId {
                        try? await api.cancelPrivateVideoUpload(clientUploadId: id, uploadSessionId: session)
                    }
                    await StoryUploadFileIO.remove([owned])
                }
                throw error
            }
        }
        draftUploads[video.url] = StoryDraftVideoTransfer(clientUploadId: id, account: account, origin: origin,
            video: PreparedStoryVideo(url: owned, durationMs: prepared.durationMs, byteSize: prepared.byteSize,
                strategy: prepared.strategy, inspection: prepared.inspection),
            fingerprint: fingerprint, originalFingerprint: originalFingerprint, ownership: ownership, task: task)
        // The task records its receipt. Preparing the next selected clip must
        // not wait for this transfer; the shared transfer permit still serializes bytes.
    }

    private func readyDraftUpload(for video: StoryVideoUpload) async -> StoryDraftVideoUpload? {
        guard let result = readyDraftUploads[video.url],
              draftUploadAPI?.authToken == draftUploads[video.url]?.account,
              draftUploadAPI?.baseURLString == draftUploads[video.url]?.origin,
              let original = try? await StoryUploadFileFingerprint.read(video.url), original == result.originalFingerprint,
              let uploaded = try? await StoryUploadFileFingerprint.read(result.video.url), uploaded == result.fingerprint else { return nil }
        return result
    }

    private func transferableDraftUpload(for video: StoryVideoUpload) async -> StoryDraftVideoTransfer? {
        guard let entry = draftUploads[video.url],
              draftUploadAPI?.authToken == entry.account, draftUploadAPI?.baseURLString == entry.origin,
              let original = try? await StoryUploadFileFingerprint.read(video.url), original == entry.originalFingerprint,
              let uploaded = try? await StoryUploadFileFingerprint.read(entry.video.url), uploaded == entry.fingerprint else { return nil }
        return entry
    }

    private func finishDraftAdoption(for url: URL) {
        guard let result = readyDraftUploads.removeValue(forKey: url) else { return }
        draftUploads[url] = nil
        Task { await StoryUploadFileIO.remove([result.video.url]) }
    }

    /// Private speculative transfer respects the saved choice and unmetered-path guard.
    func prepareSelectionLocally(_ media: [PickedStoryMedia]) {
        selectionPreparationTask?.cancel()
        let videos = media.prefix(10).compactMap { item -> StoryVideoUpload? in
            guard case .video(let video) = item else { return nil }
            return video
        }
        let retained = Set(videos.map(\.url))
        for url in Array(localPreparations.keys) where !retained.contains(url) {
            discardLocalPreparation(for: url)
        }
        if let api = draftUploadAPI {
            for url in Array(draftUploads.keys) where !retained.contains(url) { discardDraftUpload(for: url, api: api) }
        }
        guard UBEYEResourceMonitor.shared.mode != .critical else { return }
        selectionPreparationTask = Task { [weak self] in
            // Serial preparation avoids competing exports for a multi-item draft.
            for video in videos {
                guard !Task.isCancelled, let self else { return }
                if let prepared = try? await self.preparedVideo(for: video) {
                    await self.startDraftUpload(for: video, prepared: prepared)
                }
            }
        }
    }

    private func discardLocalPreparation(for url: URL) {
        readyPreparations[url] = nil
        guard let entry = localPreparations.removeValue(forKey: url) else { return }
        entry.task.cancel()
        Task {
            if let result = try? await entry.task.value, result.video.url != url {
                await StoryUploadFileIO.remove([result.video.url])
            }
        }
    }

    deinit {
        selectionPreparationTask?.cancel()
        for entry in draftUploads.values {
            entry.task.cancel()
            let api = draftUploadAPI
            Task { @MainActor in
                if let result = try? await entry.task.value {
                    if let api, api.authToken == entry.account, api.baseURLString == entry.origin, let session = result.upload.uploadSessionId {
                        try? await api.cancelPrivateVideoUpload(clientUploadId: entry.clientUploadId, uploadSessionId: session)
                    }
                    await StoryUploadFileIO.remove([result.video.url])
                }
            }
        }
        for (url, entry) in localPreparations {
            entry.task.cancel()
            Task {
                if let result = try? await entry.task.value, result.video.url != url {
                    await StoryUploadFileIO.remove([result.video.url])
                }
            }
        }
    }
    @Published var uploadStatus: String?
    @Published var error: String?
    @Published var lastUploadReport: String?
    @Published var isUploading = false

    init(preferences: UserDefaults = .standard) {
        self.preferences = preferences
        self.draftPersistence = ComposerDraftPersistence(preferences: preferences)
        uploadWhileEditing = (preferences.object(forKey: Self.earlyUploadPreferenceKey) as? Bool ?? true)
    }

    func configureDraft(accountScope: String?) {
        guard draftPersistence.accountScope != accountScope else { return }
        persistTextDraft()
        isRestoringDraft = true
        let draft = draftPersistence.activate(accountScope: accountScope)
        caption = draft?.caption ?? ""
        brandTags = draft?.brandTags ?? ""
        textOverlay = draft?.textOverlay ?? ""
        textOverlayPositionX = draft?.textOverlayPositionX ?? 50
        textOverlayPositionY = draft?.textOverlayPositionY ?? 68
        linkUrl = draft?.linkUrl ?? ""
        linkLabel = draft?.linkLabel ?? ""
        linkOverlayPositionX = draft?.linkOverlayPositionX ?? 50
        linkOverlayPositionY = draft?.linkOverlayPositionY ?? 78
        quotedReply = draft?.quotedReply
        quoteReplyPositionX = draft?.quoteReplyPositionX ?? 50
        quoteReplyPositionY = draft?.quoteReplyPositionY ?? 58
        isRestoringDraft = false
    }

    func beginPresentation() { uploadStatus = nil }

    private var textDraft: StoryComposerTextDraft {
        StoryComposerTextDraft(caption: caption, brandTags: brandTags, textOverlay: textOverlay,
            textOverlayPositionX: textOverlayPositionX, textOverlayPositionY: textOverlayPositionY,
            linkUrl: linkUrl, linkLabel: linkLabel, linkOverlayPositionX: linkOverlayPositionX,
            linkOverlayPositionY: linkOverlayPositionY, quotedReply: quotedReply,
            quoteReplyPositionX: quoteReplyPositionX, quoteReplyPositionY: quoteReplyPositionY)
    }

    private func scheduleDraftSave() {
        guard !isRestoringDraft else { return }
        draftPersistence.schedule(textDraft)
    }

    func persistTextDraft() {
        guard !isRestoringDraft else { return }
        draftPersistence.flush(textDraft)
    }

    func preparedVideo(for video: StoryVideoUpload) async throws -> PreparedStoryVideo {
        let fingerprint = try await StoryUploadFileFingerprint.read(video.url)
        try Task.checkCancellation()
        let source = video.source.diagnosticName
        let durationLimit = maxVideoDurationSeconds
        let adaptiveEncoding = StoryAdaptiveEncodingContext.current()
        if let entry = localPreparations[video.url],
           entry.source == source, entry.durationLimit == durationLimit,
           entry.adaptiveEncodingEnabled == adaptiveEncoding.enabled,
           entry.fingerprint == fingerprint {
            do {
                let prepared = try await entry.task.value
                if try await StoryUploadFileFingerprint.read(prepared.video.url) == prepared.fingerprint {
                    MediaPerformance.mark("video_local_preparation_reused")
                    return prepared.video
                }
            } catch is CancellationError { throw CancellationError() }
            catch { /* A failed speculative preparation gets a fresh Post attempt. */ }
        }
        discardLocalPreparation(for: video.url)
        let task = Task { [weak self] () throws -> LocalVideoPreparation in
            guard let self else { throw CancellationError() }
            try await StoryUploadPermitPool.videoPreparation.acquire()
            defer { StoryUploadPermitPool.videoPreparation.release() }
            let prepared = try await StoryVideoUploadNormalizer.prepare(
                url: video.url, source: video.source, maxDurationSeconds: durationLimit,
                adaptiveEncoding: adaptiveEncoding
            )
            do {
                try Task.checkCancellation()
                let result = try await LocalVideoPreparation(
                    video: prepared, fingerprint: StoryUploadFileFingerprint.read(prepared.url)
                )
                try Task.checkCancellation()
                guard try await StoryUploadFileFingerprint.read(video.url) == fingerprint else {
                    throw APIClientError.server("The selected video changed. Please select it again.", 0)
                }
                self.readyPreparations[video.url] = result
                return result
            } catch {
                if prepared.url != video.url { await StoryUploadFileIO.remove([prepared.url]) }
                throw error
            }
        }
        localPreparations[video.url] = PreparationEntry(
            source: source, durationLimit: durationLimit, adaptiveEncodingEnabled: adaptiveEncoding.enabled, fingerprint: fingerprint, task: task
        )
        return try await task.value.video
    }

    private func preparedVideoIfReady(for video: StoryVideoUpload) async -> PreparedStoryVideo? {
        guard let result = readyPreparations[video.url],
              let entry = localPreparations[video.url],
              let sourceFingerprint = try? await StoryUploadFileFingerprint.read(video.url),
              sourceFingerprint == entry.fingerprint,
              let preparedFingerprint = try? await StoryUploadFileFingerprint.read(result.video.url),
              preparedFingerprint == result.fingerprint else { return nil }
        return result.video
    }

    private var thumbnailOverlaySpecs: [StoryThumbnailOverlaySpec] {
        var overlays: [StoryThumbnailOverlaySpec] = []
        let normalizedText = normalizedStoryOverlayText(textOverlay)
        if !normalizedText.isEmpty {
            overlays.append(
                StoryThumbnailOverlaySpec(
                    label: normalizedText,
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
            textOverlay: normalizedStoryOverlayText(textOverlay),
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
        let normalizedText = normalizedStoryOverlayText(textOverlay)
        if !normalizedText.isEmpty {
            overlays.append(
                StoryTextOverlay(
                    id: "pending-text-\(UUID().uuidString.lowercased())",
                    label: normalizedText,
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
        api: APIClient,
        pendingUploads: PendingStoryUploadStore,
        onPendingUploadStarted: (PendingStoryUpload) -> Void
    ) async -> StoryUploadResponse? {
        guard let selectedMedia else {
            error = "Capture or choose story media first."
            return nil
        }

        error = nil
        lastUploadReport = nil
        normalizeLinkDraft()
        if let validationMessage = draftValidationMessage {
            error = validationMessage
            return nil
        }

        selectionPreparationTask?.cancel()
        isUploading = true
        uploadStatus = "Preparing upload"
        var uploadResponse: StoryUploadResponse?
        var didCreatePendingUpload = false

        do {
            switch selectedMedia {
            case .image(let upload):
                guard MediaControlConfig.shared.storyImageUploadsAvailable else {
                    throw APIClientError.server(
                        "Photo uploads are temporarily unavailable. Video stories still work.",
                        503
                    )
                }
                uploadStatus = "Posting"
                let pendingUpload = try await pendingUploads.createImageUpload(
                    upload: upload,
                    contentMode: upload.contentMode,
                    draft: pendingUploadDraft,
                    textOverlays: pendingTextOverlays,
                    submittedAt: Date()
                )
                didCreatePendingUpload = true
                onPendingUploadStarted(pendingUpload)
                clearUploadedDraft()
                uploadResponse = try await pendingUploads.performUpload(id: pendingUpload.id, api: api)
            case .video(let video):
                uploadResponse = try await uploadVideoStory(
                    video: video,
                    api: api,
                    pendingUploads: pendingUploads,
                    onPendingUploadStarted: { pendingUpload in
                        didCreatePendingUpload = true
                        onPendingUploadStarted(pendingUpload)
                    }
                )
            }

            uploadStatus = uploadResponse?.processingStatus == "ready" ? "Story posted" : "Upload complete"
            api.invalidateMobileFeedCache()
            api.invalidateStoryStacks(ids: ["my-story"])
            clearUploadedDraft()
        } catch {
            uploadStatus = nil
            if didCreatePendingUpload {
                self.error = nil
            } else {
                self.error = error.localizedDescription
            }
            if let lastUploadReport {
                MediaPerformance.mark("video_upload_failed report=\(lastUploadReport)")
            }
        }

        isUploading = false
        if self.selectedMedia == nil { prepareSelectionLocally([]) }
        return uploadResponse
    }

    func uploadBatch(
        media: [PickedStoryMedia],
        api: APIClient,
        pendingUploads: PendingStoryUploadStore,
        onPendingBatchStarted: () -> Void,
        onUploadRegistered: @escaping (StoryUploadResponse) -> Void
    ) async -> Bool {
        guard (2...10).contains(media.count) else {
            error = "Choose between two and ten items for a batch."
            return false
        }

        error = nil
        lastUploadReport = nil
        normalizeLinkDraft()
        if let validationMessage = draftValidationMessage {
            error = validationMessage
            return false
        }

        selectionPreparationTask?.cancel()
        isUploading = true
        let submittedAt = Date()
        let batchId = UUID().uuidString.lowercased()
        pendingUploads.beginBatch(batchId, totalCount: media.count)
        var stagedUploads: [PendingStoryUpload] = []
        var failedPreparationCount = 0
        let transfers = StoryBatchTransferQueue(maxConcurrentPhotos:
            NetworkQualityMonitor.shared.isLimitedPath || UBEYEResourceMonitor.shared.mode != .standard ? 1 : 2)
        let batchDraft = pendingUploadDraft
        let batchTextOverlays = pendingTextOverlays

        for (offset, item) in media.enumerated() {
            uploadStatus = "Saving your stories…"
            do {
                let pendingUpload = try await createPendingBatchUpload(
                    item,
                    batchId: batchId,
                    batchPosition: offset + 1,
                    batchCount: media.count,
                    draft: batchDraft,
                    textOverlays: batchTextOverlays,
                    submittedAt: submittedAt,
                    pendingUploads: pendingUploads
                )
                stagedUploads.append(pendingUpload)
                // The durable manifest owns this item before network work starts.
                // Prepared metadata is resolved by the upload store after the
                // original and draft have become durable.
                transfers.enqueue(assetKind: pendingUpload.assetKind) { beforeCompletion in
                    do {
                        let response = try await pendingUploads.performUpload(
                            id: pendingUpload.id,
                            api: api,
                            beforeCompletion: beforeCompletion
                        )
                        // Root's registration callback navigates home. Keep the
                        // producer visible until every selected item is staged.
                        transfers.registerAfterPreparation {
                            onUploadRegistered(response)
                        }
                    } catch {
                        MediaPerformance.mark(
                            "story_batch_upload_failed id=\(pendingUpload.id) error=\(error.localizedDescription)"
                        )
                    }
                }
            } catch {
                failedPreparationCount += 1
                if case .video(let video) = item {
                    await StoryUploadFileIO.remove([video.url])
                }
                MediaPerformance.mark(
                    "story_batch_prepare_failed position=\(offset + 1) error=\(error.localizedDescription)"
                )
            }
        }

        pendingUploads.finishBatchPreparation(batchId)
        guard !stagedUploads.isEmpty else {
            isUploading = false
            uploadStatus = nil
            error = MediaControlConfig.shared.storyImageUploadsAvailable
                ? "Could not prepare those stories. Try different photos or videos."
                : "Photo uploads are temporarily unavailable. Video stories still work."
            return false
        }

        clearUploadedDraft()
        isUploading = false
        prepareSelectionLocally([])
        uploadStatus = nil
        onPendingBatchStarted()
        transfers.finishPreparation()

        if failedPreparationCount > 0 {
            MediaPerformance.mark(
                "story_batch_prepare_partial prepared=\(stagedUploads.count) failed=\(failedPreparationCount)"
            )
        }

        return true
    }

    private func createPendingBatchUpload(
        _ media: PickedStoryMedia,
        batchId: String,
        batchPosition: Int,
        batchCount: Int,
        draft: PendingStoryUploadDraft,
        textOverlays: [StoryTextOverlay],
        submittedAt: Date,
        pendingUploads: PendingStoryUploadStore
    ) async throws -> PendingStoryUpload {
        switch media {
        case .image(let upload):
            guard MediaControlConfig.shared.storyImageUploadsAvailable else {
                throw APIClientError.server(
                    "Photo uploads are temporarily unavailable. Video stories still work.",
                    503
                )
            }
            return try await pendingUploads.createImageUpload(
                upload: upload,
                contentMode: upload.contentMode,
                draft: draft,
                textOverlays: textOverlays,
                submittedAt: submittedAt,
                batchId: batchId,
                batchPosition: batchPosition,
                batchCount: batchCount
            )
        case .video(let video):
            let draftUpload = await readyDraftUpload(for: video)
            let transfer = draftUpload == nil ? await transferableDraftUpload(for: video) : nil
            let localReady = await preparedVideoIfReady(for: video)
            let ready = draftUpload?.video ?? transfer?.video ?? localReady
            let pending = try await pendingUploads.createSubmittedVideoUpload(
                sourceURL: video.url, source: video.source, preparedVideo: ready,
                draftUpload: draftUpload, draftTransfer: transfer,
                draft: draft, textOverlays: textOverlays, submittedAt: submittedAt,
                batchId: batchId, batchPosition: batchPosition, batchCount: batchCount
            )
            if draftUpload != nil { finishDraftAdoption(for: video.url) }
            else if transfer != nil { draftUploads[video.url] = nil; readyDraftUploads[video.url] = nil }
            else if let api = draftUploadAPI { discardDraftUpload(for: video.url, api: api) }
            discardLocalPreparation(for: video.url)
            await StoryUploadFileIO.remove([video.url])
            return pending
        }
    }

    private func uploadVideoStory(
        video: StoryVideoUpload, api: APIClient, pendingUploads: PendingStoryUploadStore,
        onPendingUploadStarted: (PendingStoryUpload) -> Void
    ) async throws -> StoryUploadResponse {
        let submittedAt = Date()
        let draftUpload = await readyDraftUpload(for: video)
        let transfer = draftUpload == nil ? await transferableDraftUpload(for: video) : nil
        let localReady = await preparedVideoIfReady(for: video)
        let ready = draftUpload?.video ?? transfer?.video ?? localReady
        let pending = try await pendingUploads.createSubmittedVideoUpload(
            sourceURL: video.url, source: video.source, preparedVideo: ready,
            draftUpload: draftUpload, draftTransfer: transfer,
            draft: pendingUploadDraft, textOverlays: pendingTextOverlays, submittedAt: submittedAt
        )
        if draftUpload != nil { finishDraftAdoption(for: video.url) }
        else if transfer != nil { draftUploads[video.url] = nil; readyDraftUploads[video.url] = nil }
        else if let api = draftUploadAPI { discardDraftUpload(for: video.url, api: api) }
        discardLocalPreparation(for: video.url)
        await StoryUploadFileIO.remove([video.url])
        onPendingUploadStarted(pending)
        clearUploadedDraft()
        return try await pendingUploads.performUpload(id: pending.id, api: api)
    }

    private func videoThumbnailData(
        for url: URL,
        overlays: [StoryThumbnailOverlaySpec]
    ) async throws -> Data {
        do {
            return try await withThrowingTaskGroup(of: Data.self) { group in
                group.addTask {
                    try await self.generateVideoThumbnailData(
                        for: url,
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
            throw error
        }
    }

    private func generateVideoThumbnailData(
        for url: URL,
        overlays: [StoryThumbnailOverlaySpec]
    ) async throws -> Data {
        let image = try await StoryVideoThumbnailGenerator.firstFrame(for: url)
        // Story overlays are rendered by the viewer. Keeping this fallback image
        // clean prevents the thumbnail caption from appearing underneath the
        // live caption while a video is loading.
        let thumbnail = UIImage(cgImage: image)

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

        let fontSize = min(max(StoryTextOverlayAppearance.fontSize * scale, 22), 40)
        let horizontalPadding = StoryTextOverlayAppearance.horizontalPadding * scale
        let verticalPadding = StoryTextOverlayAppearance.verticalPadding * scale
        let maxTextWidth = max(canvasSize.width - 72 * scale, 120)
        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.alignment = .center
        paragraphStyle.lineBreakMode = .byWordWrapping
        let attributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: fontSize, weight: .regular),
            .kern: StoryTextOverlayAppearance.letterSpacing * scale,
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
        UIColor.black.withAlphaComponent(0.46).setFill()
        UIBezierPath(
            roundedRect: chipRect,
            cornerRadius: StoryTextOverlayAppearance.cornerRadius * scale
        ).fill()
        context.restoreGState()

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
        let avatarSize = 22 * scale
        let titleFont = min(max(11 * scale, 14), 25)
        let handleFont = min(max(9 * scale, 12), 20)
        let messageFont = min(max(13 * scale, 17), 30)
        let textWidth = cardWidth - horizontalPadding * 2
        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.alignment = .left
        paragraphStyle.lineBreakMode = .byTruncatingTail
        let nameAttributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: titleFont, weight: .semibold),
            .foregroundColor: UIColor.white,
            .paragraphStyle: paragraphStyle,
        ]
        let handleAttributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: handleFont, weight: .regular),
            .foregroundColor: UIColor.white.withAlphaComponent(0.72),
            .paragraphStyle: paragraphStyle,
        ]
        let messageAttributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: messageFont, weight: .medium),
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

    var normalizedLinkUrl: String {
        normalizedUrlString(linkUrl)
    }

    func normalizeLinkDraft() {
        linkUrl = normalizedLinkUrl
        if linkLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            linkLabel = linkHostLabel(from: linkUrl)
        }
    }

    private var draftValidationMessage: String? {
        if caption.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count > StoryComposerLimits.caption {
            return "Captions must be \(StoryComposerLimits.caption) characters or fewer."
        }

        if textOverlay.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count > StoryComposerLimits.textOverlay {
            return "Story text must be \(StoryComposerLimits.textOverlay) characters or fewer."
        }

        let resolvedLinkURL = normalizedLinkUrl
        if !resolvedLinkURL.isEmpty {
            if resolvedLinkURL.utf16.count > StoryComposerLimits.linkURL || URL(string: resolvedLinkURL) == nil {
                return "Enter a valid link up to \(StoryComposerLimits.linkURL) characters."
            }
            if linkLabel.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count > StoryComposerLimits.linkLabel {
                return "Link labels must be \(StoryComposerLimits.linkLabel) characters or fewer."
            }
        }

        let rawBrandTags = brandTags.components(
            separatedBy: CharacterSet(charactersIn: ",\n")
        ).map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines)
        }.filter {
            !$0.isEmpty
        }
        for rawBrandTag in rawBrandTags {
            let normalizedBrandTag = rawBrandTag
                .lowercased()
                .replacingOccurrences(
                    of: "^[@#]+",
                    with: "",
                    options: .regularExpression
                )
                .replacingOccurrences(
                    of: "[^a-z0-9._-]+",
                    with: "-",
                    options: .regularExpression
                )
                .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
            guard (2...StoryComposerLimits.brandTag).contains(normalizedBrandTag.utf16.count) else {
                return "Each brand tag must be 2–\(StoryComposerLimits.brandTag) characters."
            }
        }

        return nil
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
        selectedMedia = nil
        draftPersistence.clear()
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
