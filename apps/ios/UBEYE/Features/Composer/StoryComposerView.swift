import AVFoundation
import CryptoKit
import ImageIO
import Photos
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

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

struct StoryComposerView: View {
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var pendingStoryUploads: PendingStoryUploadStore
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var camera = CameraController()
    @StateObject private var store = StoryComposerStore()
    @State private var photoPickerItems: [PhotosPickerItem] = []
    @StateObject private var librarySelection = StoryLibrarySelectionLoader()
    @State private var selectedBatchMedia: [PickedStoryMedia] = []
    @State private var overlayInputMode: ComposerOverlayInputMode?
    @State private var recordingStartedAt = Date()
    @State private var recordingElapsed: TimeInterval = 0
    @State private var latestLibraryThumbnail: UIImage?
    @State private var stagedMedia: PickedStoryMedia?
    @State private var composerKeyboardHeight: CGFloat = 0
    @State private var overlayFocusRequestAt: Date?
    @FocusState private var isOverlayInputFocused: Bool
    let isActive: Bool
    let quotedReply: QuotedStoryReply?
    var clearQuotedReply: () -> Void = {}
    var onPendingUploadStarted: () -> Void = {}
    var onUploadRegistered: (StoryUploadResponse) -> Void = { _ in }

    private let maxVideoSegments = 6
    private let videoSegmentDuration: TimeInterval = 10
    private let footerSideControlSize: CGFloat = 58
    private let footerShutterSlotSize: CGFloat = 88
    private var maxRecordingDuration: TimeInterval { TimeInterval(maxVideoSegments) * videoSegmentDuration }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.black.ignoresSafeArea()

                mediaPreview
                    .frame(width: geometry.size.width, height: geometry.size.height)
                    .clipped()
                    .overlay(Color.black.opacity(0.18))
                    .overlay {
                        positionedComposerOverlay(in: geometry.size)
                    }
                    .simultaneousGesture(cameraZoomGesture)

                VStack(spacing: 0) {
                    ZStack(alignment: .top) {
                        Label(
                            selectedBatchMedia.count > 1
                                ? "\(selectedBatchMedia.count) stories"
                                : "Story",
                            systemImage: "camera"
                        )
                            .font(.system(size: 15, weight: .regular))
                            .padding(.horizontal, 14)
                            .frame(height: 38)
                            .storyComposerPillChrome(backgroundOpacity: 0.30)

                        HStack(alignment: .top) {
                            if hasSelectedMedia || librarySelection.isLoading {
                                Button {
                                    UBEYEFeedback.selection()
                                    resetCapture(clearQuote: true)
                                } label: {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 18, weight: .medium))
                                        .storyComposerCircularChrome()
                                }
                                .buttonStyle(UBEYEPressButtonStyle(pressedScale: 0.9))
                                .accessibilityLabel("Discard captured story")
                                .transition(.scale.combined(with: .opacity))
                            }

                            Spacer()

                            VStack(spacing: 8) {
                                TopAvatarSpacer()

                                if stagedMedia == nil {
                                    Button {
                                        UBEYEFeedback.impact(.light)
                                        camera.switchCamera()
                                    } label: {
                                        Image(systemName: "camera.rotate")
                                            .font(.system(size: 17, weight: .medium))
                                            .storyComposerCircularChrome()
                                    }
                                    .buttonStyle(UBEYEPressButtonStyle(pressedScale: 0.9))
                                    .disabled(camera.isRecording || camera.isCapturingPhoto)
                                } else if selectedBatchMedia.count <= 1 {
                                    composerToolRail
                                }
                            }
                        }
                    }
                    .padding(.horizontal, UBEYEMetrics.screenInset)
                    .padding(.top, 14)

                    Spacer()

                    if librarySelection.isLoading {
                        HStack(spacing: 8) {
                            ProgressView().tint(.white)
                            Text(librarySelection.totalCount > 1
                                 ? "Loading media \(min(librarySelection.completedCount + 1, librarySelection.totalCount)) of \(librarySelection.totalCount)"
                                 : "Loading selected media")
                        }
                        .font(.system(size: 14))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .storyComposerPillChrome()
                        .padding(.bottom, 16)
                    } else if let uploadStatus = store.uploadStatus {
                        Text(uploadStatus)
                            .font(.system(size: 13, weight: .regular))
                            .tracking(0.1)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .storyComposerPillChrome()
                            .padding(.bottom, 16)
                    } else if let error = store.error ?? (stagedMedia == nil ? camera.error : nil) {
                        Text(error)
                            .font(.system(size: 14, weight: .medium))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(Color.ubeyeRed.opacity(0.9), in: Capsule())
                            .padding(.horizontal, 22)
                            .padding(.bottom, 16)
                    } else if camera.isCapturingPhoto {
                        Text("Preparing photo")
                            .font(.system(size: 14, weight: .regular))
                            .foregroundStyle(.white.opacity(0.76))
                            .padding(.bottom, 24)
                    } else if stagedMedia == nil {
                        Text("Tap for photo, hold for video")
                            .font(.system(size: 14, weight: .regular))
                            .foregroundStyle(.white.opacity(0.72))
                            .padding(.bottom, 24)
                    }

                    composerFooter
                        .padding(.horizontal, 28)
                        .padding(.bottom, 28)
                }
                .frame(width: geometry.size.width, height: geometry.size.height)
                .foregroundStyle(.white)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .clipped()
        }
        .task {
            store.configureDraft(accountScope: api.accountScope)
            store.beginPresentation()
            store.applyQuotedReply(quotedReply)
            if isActive {
                store.resumeEarlyUpload(api: api, media: selectedBatchMedia.isEmpty ? store.selectedMedia.map { [$0] } ?? [] : selectedBatchMedia)
                await camera.requestAccessAndConfigure()
            }
            await refreshLatestLibraryThumbnail()
            applyLayoutFixtureIfRequested()
        }
        .onChange(of: isActive) { _, nextIsActive in
            if nextIsActive {
                store.beginPresentation()
                store.resumeEarlyUpload(api: api, media: selectedBatchMedia.isEmpty ? store.selectedMedia.map { [$0] } ?? [] : selectedBatchMedia)
                camera.start()
            } else {
                store.persistTextDraft()
                isOverlayInputFocused = false
                librarySelection.cancel()
                store.suspendEarlyUpload(api: api)
                camera.stop()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: NetworkQualityMonitor.playbackBudgetChanged)) { _ in
            guard isActive, !store.isUploading else { return }
            store.resumeEarlyUpload(api: api, media: framingMedia)
        }
        .onChange(of: quotedReply) { _, quote in
            store.applyQuotedReply(quote)
        }
        .onDisappear {
            librarySelection.cancel()
            store.suspendEarlyUpload(api: api)
            store.persistTextDraft()
            camera.stop()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active {
                store.persistTextDraft()
                camera.stop()
            } else if isActive { camera.start() }
        }
        .onChange(of: photoPickerItems) { _, items in
            guard !items.isEmpty else { return }
            loadPickedItems(items)
            // Clear only this submitted picker selection, never a newer request
            // from an older import task's deferred completion.
            photoPickerItems = []
        }
        .onChange(of: camera.capturedPhoto) { _, photo in
            if let photo {
                enterComposer(with: .image(photo))
            }
        }
        .onChange(of: camera.capturedVideoURL) { _, url in
            if let url {
                let source: StoryVideoUpload.Source = camera.capturedVideoCameraPosition == .front ? .cameraFront : .cameraBack
                enterComposer(with: .video(StoryVideoUpload(url: url, source: source)))
                recordingElapsed = 0
            }
        }
        .task(id: isActive && scenePhase == .active && camera.isRecording) {
            guard isActive, scenePhase == .active, camera.isRecording else { return }
            while !Task.isCancelled {
                updateRecordingProgress(now: Date())
                do { try await Task.sleep(for: .milliseconds(50)) } catch { return }
            }
        }
        .onChange(of: isOverlayInputFocused) { _, isFocused in
            if !isFocused {
                finishOverlayInput()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { notification in
            updateComposerKeyboard(from: notification)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { notification in
            updateComposerKeyboard(from: notification, forcedHeight: 0)
        }
    }

    @ViewBuilder
    private var composerFooter: some View {
        VStack(spacing: 12) {
            Group {
                if stagedMedia == nil {
                    captureFooter
                } else {
                    selectedMediaFooter
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: footerShutterSlotSize)
    }

    private var captureFooter: some View {
        HStack {
            PhotosPicker(
                selection: $photoPickerItems,
                maxSelectionCount: quotedReply == nil ? 10 : 1,
                selectionBehavior: .ordered,
                matching: .any(of: [.images, .videos]),
                preferredItemEncoding: .current
            ) {
                LibraryPickerThumbnail(image: latestLibraryThumbnail)
            }
            .disabled(store.isUploading || camera.isCapturingPhoto || camera.isRecording)

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
            .disabled(store.isUploading || librarySelection.isLoading)

            Spacer()

            footerPlaceholder(size: footerSideControlSize)
        }
    }

    private var cameraZoomGesture: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                guard stagedMedia == nil,
                      store.selectedMedia == nil,
                      camera.authorizationStatus == .authorized else {
                    return
                }

                camera.updateZoomGesture(magnification: value.magnification)
            }
            .onEnded { _ in
                camera.endZoomGesture()
            }
    }

    private var selectedMediaFooter: some View {
        HStack(spacing: 0) {
            if selectedBatchMedia.count > 1 {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(selectedBatchMedia.count) separate stories")
                        .font(.system(size: 14, weight: .medium))
                    Text("They’ll upload in the background")
                        .font(.system(size: 11, weight: .regular))
                        .foregroundStyle(.white.opacity(0.68))
                }
            }

            Spacer(minLength: 0)
            uploadStoryButton
        }
    }

    private var framingMedia: [PickedStoryMedia] {
        if !selectedBatchMedia.isEmpty {
            return selectedBatchMedia
        }
        return (stagedMedia ?? store.selectedMedia).map { [$0] } ?? []
    }

    private var hasSelectedMedia: Bool {
        (stagedMedia ?? store.selectedMedia) != nil
    }

    private func footerPlaceholder(size: CGFloat) -> some View {
        Color.clear
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }

    private var uploadStoryButton: some View {
        Button {
            UBEYEFeedback.impact(.medium)
            Task {
                await uploadSelectedMedia()
            }
        } label: {
            HStack(spacing: 7) {
                uploadButtonIcon
                if selectedBatchMedia.count > 1 {
                    Text("Post \(selectedBatchMedia.count)")
                        .font(.system(size: 14, weight: .medium))
                }
            }
            .foregroundStyle(.white)
            .frame(
                width: selectedBatchMedia.count > 1 ? 104 : footerSideControlSize,
                height: footerSideControlSize
            )
            .storyComposerPillChrome(backgroundOpacity: 0.42)
        }
        .buttonStyle(UBEYEPressButtonStyle(pressedScale: 0.9))
        .disabled(store.isUploading)
        .accessibilityLabel(
            selectedBatchMedia.count > 1
                ? "Upload \(selectedBatchMedia.count) separate stories"
                : "Upload story"
        )
        .accessibilityIdentifier("story-composer-upload-button")
    }

    private var uploadButtonIcon: some View {
        Image(systemName: store.isUploading ? "hourglass" : "paperplane")
            .font(.system(size: 20, weight: .medium))
    }

    private var composerToolRail: some View {
        VStack(spacing: 8) {
            Button {
                UBEYEFeedback.selection()
                openOverlayInput(.text)
            } label: {
                Text("Aa")
                    .font(.system(size: 18, weight: .regular))
                    .tracking(-0.25)
                    .storyComposerCircularChrome()
            }
            .buttonStyle(UBEYEPressButtonStyle(pressedScale: 0.9))
            .accessibilityLabel("Add text overlay")

            Button {
                UBEYEFeedback.selection()
                openOverlayInput(.link)
            } label: {
                Image(systemName: "link")
                    .font(.system(size: 18, weight: .regular))
                    .storyComposerCircularChrome()
            }
            .buttonStyle(UBEYEPressButtonStyle(pressedScale: 0.9))
            .accessibilityLabel("Add link overlay")
        }
    }

    @ViewBuilder
    private var composerOverlayLayer: some View {
        if stagedMedia != nil {
            GeometryReader { proxy in
                if overlayInputMode == .text || !store.textOverlay.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    EditableStoryOverlayChip(
                        text: $store.textOverlay,
                        maximumLength: StoryComposerLimits.textOverlay,
                        normalizesWhitespace: true,
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
                        keyboardHeight: composerKeyboardHeight,
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
                        maximumLength: StoryComposerLimits.linkURL,
                        normalizesWhitespace: false,
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
                        keyboardHeight: composerKeyboardHeight,
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

    @ViewBuilder
    private func positionedComposerOverlay(in containerSize: CGSize) -> some View {
        if hasSelectedMedia {
            let canvasLayout = StoryCanvasLayout(containerSize: containerSize)
            composerOverlayLayer
                .storyCanvasFrame(canvasLayout)
        } else {
            composerOverlayLayer
        }
    }

    private func openOverlayInput(_ mode: ComposerOverlayInputMode) {
        guard stagedMedia != nil else {
            return
        }

        overlayInputMode = mode
        overlayFocusRequestAt = Date()
        UBEYEFeedback.prepare(.selection)

    }

    private func finishOverlayInput() {
        let finishingMode = overlayInputMode
        let finishingFocusRequestAt = overlayFocusRequestAt
        isOverlayInputFocused = false

        // Resigning the first responder can deliver one final TextField binding
        // update (autocorrection, smart spacing, or a deletion). Keep the editor
        // alive through that update before snapshotting the draft for upload.
        Task { @MainActor in
            await Task.yield()
            guard overlayInputMode == finishingMode,
                  overlayFocusRequestAt == finishingFocusRequestAt else {
                return
            }
            if finishingMode == .link {
                store.normalizeLinkDraft()
            }
            store.persistTextDraft()
            overlayInputMode = nil
        }
    }

    private func updateComposerKeyboard(
        from notification: Notification,
        forcedHeight: CGFloat? = nil
    ) {
        let measuredHeight: CGFloat
        if let forcedHeight {
            measuredHeight = forcedHeight
        } else if let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect {
            measuredHeight = max(0, UIScreen.main.bounds.maxY - frame.minY)
        } else {
            return
        }

        let height = measuredHeight > 1 ? measuredHeight : 0
        if height > 0, let overlayFocusRequestAt {
            MediaPerformance.measure(
                "keyboard_latency surface=story_composer phase=will_change_frame",
                since: overlayFocusRequestAt
            )
            self.overlayFocusRequestAt = nil
        }
        let duration = (notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? NSNumber)?.doubleValue ?? 0.25
        withAnimation(.easeOut(duration: duration)) {
            composerKeyboardHeight = height
        }
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
                PhotosPicker(
                    selection: $photoPickerItems,
                    maxSelectionCount: quotedReply == nil ? 10 : 1,
                    selectionBehavior: .ordered,
                    matching: .any(of: [.images, .videos]),
                    preferredItemEncoding: .current
                ) {
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
        switch stagedMedia ?? store.selectedMedia {
        case .image(let upload):
            storyImagePreview(upload.image)
        case .video(let video):
            storyVideoPreview(
                url: video.url,
                mirrorsHorizontally: false
            )
        case nil:
            if librarySelection.isLoading {
                Color.black
            } else if let photo = camera.capturedPhoto {
                storyImagePreview(photo.image)
                    .onAppear {
                        enterComposer(with: .image(photo))
                    }
            } else if let photoPreview = camera.capturedPhotoPreview {
                storyImagePreview(photoPreview)
            } else if let videoURL = camera.capturedVideoURL {
                storyVideoPreview(
                    url: videoURL,
                    mirrorsHorizontally: false
                )
                    .onAppear {
                        let source: StoryVideoUpload.Source = camera.capturedVideoCameraPosition == .front ? .cameraFront : .cameraBack
                        enterComposer(with: .video(StoryVideoUpload(url: videoURL, source: source)))
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

    private func storyImagePreview(_ image: UIImage) -> some View {
        GeometryReader { proxy in
            let canvasLayout = StoryCanvasLayout(containerSize: proxy.size)

            StoryCanvasImage(image: Image(uiImage: image))
                .storyCanvasFrame(canvasLayout)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
    }

    private func storyVideoPreview(url: URL, mirrorsHorizontally: Bool) -> some View {
        GeometryReader { proxy in
            let canvasLayout = StoryCanvasLayout(containerSize: proxy.size)

            StoryVideoPreview(
                url: url,
                mirrorsHorizontally: mirrorsHorizontally
            )
            .storyCanvasFrame(canvasLayout)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
    }

    private var metadataFields: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Story details")
                .font(.headline)
            composerTextField(
                "Caption",
                text: $store.caption,
                maximumLength: StoryComposerLimits.caption
            )
            composerTextField(
                "Brand tags",
                text: $store.brandTags,
                maximumLength: StoryComposerLimits.brandTagsInput
            )
            composerTextField(
                "Text overlay",
                text: $store.textOverlay,
                maximumLength: StoryComposerLimits.textOverlay
            )
        }
        .padding(14)
        .ubeyeCard()
    }

    private func composerTextField(
        _ title: String,
        text: Binding<String>,
        maximumLength: Int
    ) -> some View {
        TextField(
            title,
            text: Binding(
                get: { text.wrappedValue },
                set: {
                    text.wrappedValue = storyTextPrefix(
                        $0,
                        maximumUTF16Length: maximumLength
                    )
                }
            )
        )
            .padding()
            .frame(height: 52)
            .background(Color.ubeyeSubtle)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .textInputAutocapitalization(.sentences)
            .foregroundStyle(Color.ubeyeInk)
    }

    private func loadPickedItems(_ items: [PhotosPickerItem]) {
        stagedMedia = nil
        selectedBatchMedia = []
        store.selectedMedia = nil
        store.error = nil
        store.uploadStatus = nil
        overlayInputMode = nil
        isOverlayInputFocused = false
        camera.capturedPhoto = nil
        camera.capturedPhotoPreview = nil
        camera.capturedVideoURL = nil

        librarySelection.load(count: items.count, importItem: { index in
            let item = items[index]
            if item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) }) {
                guard let video = try await item.loadTransferable(type: PickedVideo.self) else { return nil }
                return .video(StoryVideoUpload(url: video.url, source: .library))
            }
            // Some Photos providers expose image bytes rather than a file. A
            // failed file representation must not leave a supported image blank.
            if let image = try? await item.loadTransferable(type: PickedImage.self) {
                return .image(image.upload)
            }
            guard let data = try await item.loadTransferable(type: Data.self),
                  let image = await StoryImageUpload.prepare(data: data) else { return nil }
            return .image(image)
        }, onMediaLoaded: { media in
            if media.count == 1, let first = media.first { enterComposer(with: first) }
            selectedBatchMedia = media.count > 1 ? media : []
        }, onComplete: { media, failedItemCount in
            guard !media.isEmpty else {
                store.error = "Could not load that media. Try another photo or video."
                return
            }
            UBEYEFeedback.success()
            selectedBatchMedia = media.count > 1 ? media : []
            store.prepareSelectionLocally(media)
            if failedItemCount > 0 {
                store.error = failedItemCount == 1
                    ? "One item couldn’t be loaded. The others are ready."
                    : "\(failedItemCount) items couldn’t be loaded. The others are ready."
            }
        })
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
        guard !camera.isRecording, !camera.isCapturingPhoto, !store.isUploading else {
            return
        }

        resetCapture()
        UBEYEFeedback.impact(.rigid, intensity: 1)
        camera.capturePhoto()
    }

    private func startRecording() {
        guard !camera.isRecording, !camera.isCapturingPhoto, !store.isUploading else {
            return
        }

        resetCapture()
        recordingElapsed = 0
        recordingStartedAt = Date()
        UBEYEFeedback.impact(.heavy, intensity: 0.95)
        camera.startRecording()
    }

    private func stopRecording() {
        guard camera.isRecording else {
            return
        }

        UBEYEFeedback.impact(.medium)
        camera.stopRecording()
    }

    private func uploadSelectedMedia() async {
        guard !store.isUploading, !librarySelection.isLoading else {
            return
        }

        if selectedBatchMedia.count > 1 {
            let didStart = await store.uploadBatch(
                media: selectedBatchMedia,
                api: api,
                pendingUploads: pendingStoryUploads,
                onPendingBatchStarted: {
                    selectedBatchMedia = []
                    stagedMedia = nil
                    onPendingUploadStarted()
                },
                onUploadRegistered: onUploadRegistered
            )
            if didStart {
                UBEYEFeedback.success()
                selectedBatchMedia = []
                stagedMedia = nil
            }
            return
        }

        if let response = await store.upload(
            api: api,
            pendingUploads: pendingStoryUploads,
            onPendingUploadStarted: { _ in
                stagedMedia = nil
                onPendingUploadStarted()
            }
        ) {
            UBEYEFeedback.success()
            stagedMedia = nil
            onUploadRegistered(response)
        } else if store.error != nil {
            UBEYEFeedback.error()
        }
    }

    private func resetCapture(clearQuote: Bool = false) {
        librarySelection.cancel()
        for media in selectedBatchMedia {
            if case .video(let video) = media {
                try? FileManager.default.removeItem(at: video.url)
            }
        }
        selectedBatchMedia = []
        photoPickerItems = []
        stagedMedia = nil
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
        camera.capturedPhotoPreview = nil
        camera.capturedVideoURL = nil
    }

    private func enterComposer(with media: PickedStoryMedia) {
        selectedBatchMedia = []
        store.error = nil
        store.uploadStatus = nil
        overlayInputMode = nil
        isOverlayInputFocused = false
        stagedMedia = media
        store.selectedMedia = media
    }

    private func applyLayoutFixtureIfRequested() {
        #if DEBUG
        guard ProcessInfo.processInfo.arguments.contains("-story-composer-selected-photo-fixture") else {
            return
        }

        let image = UIGraphicsImageRenderer(size: CGSize(width: 1_080, height: 1_920)).image { context in
            UIColor.systemBrown.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 1_080, height: 1_920))
        }
        guard let data = image.jpegData(compressionQuality: 0.9),
              let upload = StoryImageUpload(data: data, displayImage: image) else {
            return
        }
        enterComposer(with: .image(upload))
        #endif
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
