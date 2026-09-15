import AVKit
import CryptoKit
import SwiftUI
import UIKit

struct AutoPlayVideoPlayer: View {
    let source: StoryVideoPlaybackSource
    let thumbnailUrl: URL?
    let expectedDuration: TimeInterval?
    let preloadSources: [StoryVideoPlaybackSource]
    let playerPool: StoryVideoPlaybackPool?
    let refreshSource: () async -> StoryVideoPlaybackSource?
    let showsThumbnailWhileLoading: Bool
    let preparesPlayerPool: Bool
    let isActive: Bool
    let isPaused: Bool
    let isMuted: Bool
    let contentMode: StoryImageContentMode
    let onReadyForPlayback: () -> Void
    let onProgress: (Double) -> Void
    let onFinished: () -> Void
    @StateObject private var playback = AutoPlayVideoPlaybackController()
    @State private var deferredRewindTask: Task<Void, Never>?

    init(
        source: StoryVideoPlaybackSource,
        thumbnailUrl: URL? = nil,
        expectedDuration: TimeInterval? = nil,
        preloadSources: [StoryVideoPlaybackSource] = [],
        playerPool: StoryVideoPlaybackPool? = nil,
        refreshSource: @escaping () async -> StoryVideoPlaybackSource? = { nil },
        showsThumbnailWhileLoading: Bool = true,
        preparesPlayerPool: Bool = true,
        isActive: Bool = true,
        isPaused: Bool = false,
        isMuted: Bool = false,
        contentMode: StoryImageContentMode = .fit,
        onReadyForPlayback: @escaping () -> Void = {},
        onProgress: @escaping (Double) -> Void = { _ in },
        onFinished: @escaping () -> Void = {}
    ) {
        self.source = source
        self.thumbnailUrl = thumbnailUrl
        self.expectedDuration = expectedDuration
        self.preloadSources = preloadSources
        self.playerPool = playerPool
        self.refreshSource = refreshSource
        self.showsThumbnailWhileLoading = showsThumbnailWhileLoading
        self.preparesPlayerPool = preparesPlayerPool
        self.isActive = isActive
        self.isPaused = isPaused
        self.isMuted = isMuted
        self.contentMode = contentMode
        self.onReadyForPlayback = onReadyForPlayback
        self.onProgress = onProgress
        self.onFinished = onFinished
    }

    var body: some View {
        ZStack {
            Color.black

            AspectFitVideoPlayer(
                player: playback.player,
                surface: playback.displaySurface,
                videoGravity: contentMode == .fill ? .resizeAspectFill : .resizeAspect,
                onPlayerAttached: { player in
                    playback.playerDidAttach(player)
                },
                onReadyForDisplay: { player in
                    playback.revealVideo(player: player, reason: "layer_ready")
                }
            )
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            if !playback.isReadyForPlayback, let held = playback.heldFrame {
                AspectFitVideoPlayer(player: held.player, surface: held.surface,
                    videoGravity: contentMode == .fill ? .resizeAspectFill : .resizeAspect,
                    onPlayerAttached: { _ in }, onReadyForDisplay: { _ in })
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .allowsHitTesting(false)
                    .zIndex(1)
            } else if showsThumbnailWhileLoading, !playback.isReadyForPlayback, let thumbnailUrl {
                CachedAsyncImage(url: thumbnailUrl) { image in
                    StoryCanvasImage(image: image, contentMode: contentMode)
                } placeholder: {
                    Color.black
                }
                // The Stream poster is the playback start frame. Remove it without
                // blending so a motion-heavy video cannot expose two frames at once.
                .transition(.identity)
                .zIndex(1)
            }

            if playback.hasTerminalPlaybackFailure {
                Button {
                    playback.retry(playerPool: playerPool)
                } label: {
                    Label("Retry video", systemImage: "arrow.clockwise")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 11)
                        .background(.black.opacity(0.72), in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Attempts to load this video again")
                .zIndex(2)
            }
        }
        .background(Color.black)
        .onAppear {
            playback.setVisible(isActive)
            playback.setMuted(isMuted)
            if preparesPlayerPool {
                playerPool?.prepare(
                    sources: [source] + preloadSources,
                    activeIdentity: source.identity
                )
            }
            playback.play(
                source: source,
                expectedDuration: expectedDuration,
                playerPool: playerPool,
                refreshSource: refreshSource,
                isPaused: isPaused,
                onReadyForPlayback: onReadyForPlayback,
                onProgress: onProgress,
                onFinished: onFinished
            )
        }
        .onChange(of: source) { _, nextSource in
            if preparesPlayerPool {
                playerPool?.prepare(
                    sources: [nextSource] + preloadSources,
                    activeIdentity: nextSource.identity
                )
            }
            playback.play(
                source: nextSource,
                expectedDuration: expectedDuration,
                playerPool: playerPool,
                refreshSource: refreshSource,
                isPaused: isPaused,
                onReadyForPlayback: onReadyForPlayback,
                onProgress: onProgress,
                onFinished: onFinished
            )
        }
        .onChange(of: preloadSources) { _, nextSources in
            if preparesPlayerPool {
                playerPool?.prepare(
                    sources: [source] + nextSources,
                    activeIdentity: source.identity
                )
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: StoryVideoPlaybackPool.preparationAvailable)) { notification in
            guard !isActive, notification.object as? StoryVideoPlaybackPool === playerPool,
                  notification.userInfo?["identity"] as? String == source.identity else { return }
            playback.play(source: source, expectedDuration: expectedDuration, playerPool: playerPool, refreshSource: refreshSource, isPaused: true, onReadyForPlayback: onReadyForPlayback, onProgress: onProgress, onFinished: onFinished)
        }
        .onChange(of: isActive) { previousValue, nextValue in
            deferredRewindTask?.cancel()
            deferredRewindTask = nil
            playback.updateCallbacks(onReadyForPlayback: onReadyForPlayback, onProgress: onProgress, onFinished: onFinished)
            playback.setVisible(nextValue)
            if nextValue {
                playback.play(source: source, expectedDuration: expectedDuration, playerPool: playerPool, refreshSource: refreshSource, isPaused: isPaused, onReadyForPlayback: onReadyForPlayback, onProgress: onProgress, onFinished: onFinished)
            }
            guard StoryVideoVisitPolicy.shouldRewindForNextVisit(
                previousIsActive: previousValue,
                nextIsActive: nextValue
            ) else {
                return
            }

            deferredRewindTask = Task { @MainActor in
                // Rewinding performs AVPlayer seek/preroll bookkeeping. Running
                // it during the same frame as the destination swap caused a
                // visible hitch in the media and independently laid-out text.
                try? await Task.sleep(for: .milliseconds(180))
                guard !Task.isCancelled else {
                    return
                }
                playback.rewindForNextVisit()
                deferredRewindTask = nil
            }
        }
        .onChange(of: isPaused) { _, nextValue in
            playback.updateCallbacks(
                onReadyForPlayback: onReadyForPlayback,
                onProgress: onProgress,
                onFinished: onFinished
            )
            playback.setPaused(nextValue)
            if !nextValue, playback.isReadyForPlayback {
                onReadyForPlayback()
            }
        }
        .onChange(of: isMuted) { _, nextValue in
            playback.setMuted(nextValue)
        }
        .onDisappear {
            deferredRewindTask?.cancel()
            deferredRewindTask = nil
            playback.stop(reason: "disappear")
        }
    }
}
