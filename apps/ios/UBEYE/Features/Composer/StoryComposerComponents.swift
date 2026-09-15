import AVFoundation
import CryptoKit
import ImageIO
import Photos
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

enum StoryComposerChromeAppearance {
    static let controlSize: CGFloat = 42
    static let controlBackgroundOpacity = 0.30
    static let pillBackgroundOpacity = 0.36
    static let borderOpacity = 0.16
    static let borderWidth: CGFloat = 0.75
}

struct StoryComposerCircularChrome: ViewModifier {
    func body(content: Content) -> some View {
        content
            .foregroundStyle(.white.opacity(0.94))
            .frame(
                width: StoryComposerChromeAppearance.controlSize,
                height: StoryComposerChromeAppearance.controlSize
            )
            .background(
                .black.opacity(StoryComposerChromeAppearance.controlBackgroundOpacity),
                in: Circle()
            )
            .overlay(
                Circle()
                    .stroke(
                        .white.opacity(StoryComposerChromeAppearance.borderOpacity),
                        lineWidth: StoryComposerChromeAppearance.borderWidth
                    )
            )
            .contentShape(Circle())
    }
}

struct StoryComposerPillChrome: ViewModifier {
    let backgroundOpacity: Double

    func body(content: Content) -> some View {
        content
            .background(.black.opacity(backgroundOpacity), in: Capsule())
            .overlay(
                Capsule()
                    .stroke(
                        .white.opacity(StoryComposerChromeAppearance.borderOpacity),
                        lineWidth: StoryComposerChromeAppearance.borderWidth
                    )
            )
    }
}

extension View {
    func storyComposerCircularChrome() -> some View {
        modifier(StoryComposerCircularChrome())
    }

    func storyComposerPillChrome(
        backgroundOpacity: Double = StoryComposerChromeAppearance.pillBackgroundOpacity
    ) -> some View {
        modifier(StoryComposerPillChrome(backgroundOpacity: backgroundOpacity))
    }
}

struct EditableStoryOverlayChip: View {
    @Binding var text: String
    let maximumLength: Int
    let normalizesWhitespace: Bool
    @State private var measuredChipSize: CGSize = .zero
    @State private var dragStartCenter: CGPoint?
    @State private var editingText: String?
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
    let keyboardHeight: CGFloat
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
                y: resolvedCenterY
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
            .onChange(of: isEditing) { wasEditing, nextIsEditing in
                if nextIsEditing {
                    editingText = text
                } else if wasEditing, let editingText {
                    text = editingText
                    self.editingText = nil
                }
            }
    }

    private var resolvedCenterY: CGFloat {
        let naturalCenterY = size.height * CGFloat(positionY / 100)
        guard isEditing, keyboardHeight > 0 else {
            return naturalCenterY
        }
        let halfHeight = max(measuredChipSize.height / 2, 24)
        let minimumCenterY = halfHeight + 20
        let maximumCenterY = max(
            minimumCenterY,
            size.height - keyboardHeight - halfHeight - 18
        )
        return min(max(naturalCenterY, minimumCenterY), maximumCenterY)
    }

    private var chip: some View {
        let maxChipWidth = max(
            size.width - StoryTextOverlayAppearance.horizontalScreenInset * 2,
            StoryTextOverlayAppearance.minimumWidth
        )

        return HStack(alignment: .bottom, spacing: 6) {
            if isEditing {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 12, weight: .semibold))
                        .frame(height: 28)
                }

                TextField(
                    "",
                    text: sanitizedTextBinding,
                    prompt: Text(placeholder).foregroundStyle(.white.opacity(0.62)),
                    axis: .vertical
                )
                .focused(isFocused)
                .task {
                    await Task.yield()
                    guard !Task.isCancelled, isEditing else { return }
                    isFocused.wrappedValue = true
                }
                .keyboardType(keyboardType)
                .textInputAutocapitalization(autocapitalization)
                .autocorrectionDisabled(autocorrectionDisabled)
                .submitLabel(.done)
                .onSubmit(commitEditingTextAndSubmit)
                .font(.system(size: StoryTextOverlayAppearance.fontSize, weight: .regular))
                .tracking(StoryTextOverlayAppearance.letterSpacing)
                .multilineTextAlignment(.center)
                .lineLimit(1...4)
                .fixedSize(horizontal: false, vertical: true)
                .frame(
                    minWidth: StoryTextOverlayAppearance.minimumWidth,
                    maxWidth: maxChipWidth
                )
            } else {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 12, weight: .semibold))
                }

                Text(displayText ?? sanitizedInputValue(text, preservesTrailingSpace: false))
                    .font(.system(size: StoryTextOverlayAppearance.fontSize, weight: .regular))
                    .tracking(StoryTextOverlayAppearance.letterSpacing)
                    .lineLimit(4)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: maxChipWidth)
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, StoryTextOverlayAppearance.horizontalPadding)
        .padding(.vertical, StoryTextOverlayAppearance.verticalPadding)
        .frame(maxWidth: maxChipWidth)
        .background(
            .black.opacity(0.46),
            in: RoundedRectangle(
                cornerRadius: StoryTextOverlayAppearance.cornerRadius,
                style: .continuous
            )
        )
    }

    private var sanitizedTextBinding: Binding<String> {
        Binding(
            get: {
                editingText ?? text
            },
            set: { nextValue in
                let sanitizedValue: String
                if nextValue.contains(where: \.isNewline) {
                    sanitizedValue = storyTextPrefix(
                        sanitizedInputValue(nextValue, preservesTrailingSpace: true),
                        maximumUTF16Length: maximumLength
                    )
                    editingText = sanitizedValue
                    text = sanitizedValue
                    DispatchQueue.main.async {
                        commitEditingTextAndSubmit()
                    }
                } else {
                    sanitizedValue = storyTextPrefix(
                        sanitizedInputValue(nextValue, preservesTrailingSpace: true),
                        maximumUTF16Length: maximumLength
                    )
                    editingText = sanitizedValue
                    text = sanitizedValue
                }
            }
        )
    }

    private func commitEditingTextAndSubmit() {
        let committedText = storyTextPrefix(
            sanitizedInputValue(editingText ?? text, preservesTrailingSpace: false),
            maximumUTF16Length: maximumLength
        )
        editingText = committedText
        text = committedText
        onSubmit()
    }

    private func sanitizedInputValue(
        _ value: String,
        preservesTrailingSpace: Bool
    ) -> String {
        guard normalizesWhitespace else {
            return value.contains(where: \.isNewline)
                ? value.split(whereSeparator: \.isNewline).joined(separator: " ")
                : value
        }

        return normalizedStoryOverlayText(
            value,
            preservesTrailingSpace: preservesTrailingSpace
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

        let fallbackLength = min(
            dimension - 32,
            StoryTextOverlayAppearance.minimumWidth
        )
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

struct DraggableQuoteReplyOverlay: View {
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

struct QuoteReplyOverlayBubble: View {
    let quote: QuotedStoryReply
    var includesCloseButton = false
    var clear: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 7) {
                RemoteAvatar(url: quote.actorAvatarUrl, size: 22, name: quote.actorName)

                VStack(alignment: .leading, spacing: 0) {
                    Text(quote.actorName)
                        .font(.system(size: 12, weight: .semibold))
                        .lineLimit(1)
                    Text("@\(quote.actorHandle)")
                        .font(.system(size: 10, weight: .regular))
                        .foregroundStyle(.white.opacity(0.7))
                        .lineLimit(1)
                }

                Spacer(minLength: 6)

                if includesCloseButton {
                    Button(action: clear) {
                        Image(systemName: "xmark")
                            .font(.system(size: 10, weight: .semibold))
                            .frame(width: 24, height: 24)
                            .background(.white.opacity(0.14), in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove quoted reply")
                }
            }

            Text(quote.message)
                .font(.system(size: 15, weight: .medium))
                .lineLimit(4)
                .multilineTextAlignment(.leading)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(.black.opacity(0.76), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(.white.opacity(0.22), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.3), radius: 14, y: 7)
    }
}

struct PickedVideo: Transferable, Sendable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { video in
            SentTransferredFile(video.url)
        } importing: { received in
            try await importFile(received.file)
        }
    }

    static func importFile(_ file: URL) async throws -> PickedVideo {
        try await Task.detached(priority: .userInitiated) {
            let sourceExtension = file.pathExtension
            let fileExtension = sourceExtension.isEmpty ? "mov" : sourceExtension
            let copy = FileManager.default.temporaryDirectory.appendingPathComponent("picked-\(UUID().uuidString).\(fileExtension)")
            try FileManager.default.copyItem(at: file, to: copy)
            return PickedVideo(url: copy)
        }.value
    }

}

struct PickedImage: Transferable {
    let upload: StoryImageUpload

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .image) { image in
            let copy = FileManager.default.temporaryDirectory
                .appendingPathComponent("picked-\(UUID().uuidString).\(image.upload.fileName)")
            try image.upload.data.write(to: copy, options: .atomic)
            return SentTransferredFile(copy)
        } importing: { received in
            try await importFile(received.file)
        }
    }

    static func importFile(_ file: URL) async throws -> PickedImage {
        guard let upload = await StoryImageUpload.prepare(fileURL: file, fallbackFileName: file.lastPathComponent) else {
            throw APIClientError.invalidResponse
        }
        return PickedImage(upload: upload)
    }

}

struct StoryShutterButton: View {
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
                .stroke(.white.opacity(0.52), lineWidth: 3)
                .frame(width: 88, height: 88)

            Circle()
                .trim(from: 0, to: isRecording ? progress : 0)
                .stroke(
                    Color.ubeyeRed,
                    style: StrokeStyle(lineWidth: 3.5, lineCap: .round)
                )
                .frame(width: 88, height: 88)
                .rotationEffect(.degrees(-90))

            Circle()
                .fill(.white)
                .frame(width: isRecording ? 56 : 60, height: isRecording ? 56 : 60)

            if isRecording {
                Text("\(segmentCount)/\(maxSegments)")
                    .font(.system(size: 12, weight: .medium))
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

struct LibraryPickerThumbnail: View {
    let image: UIImage?

    var body: some View {
        ZStack {
            thumbnailContent

            Image(systemName: "photo.on.rectangle")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(.white.opacity(0.94))
                .shadow(color: .black.opacity(0.45), radius: 4, x: 0, y: 1)
        }
        .frame(width: 58, height: 58)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(.white.opacity(0.72), lineWidth: 1)
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
    private var isMirrored = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        clipsToBounds = true

        playerLayer.backgroundColor = UIColor.black.cgColor
        playerLayer.videoGravity = .resizeAspect
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
