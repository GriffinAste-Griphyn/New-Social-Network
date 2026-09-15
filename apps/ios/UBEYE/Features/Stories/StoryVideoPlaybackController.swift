import AVKit
import CryptoKit
import SwiftUI
import UIKit

@MainActor
final class AutoPlayVideoPlaybackController: ObservableObject {
    struct HeldFrame {
        let player: AVPlayer
        let surface: AspectFitPlayerView
    }
    private enum PlaybackPhase: Equatable {
        case idle
        case resolving
        case awaitingAttachment
        case positioning
        case prerolling
        case awaitingFirstFrame
        case visible
        case finished
    }

    @Published private(set) var displaySurface: AspectFitPlayerView?
    @Published private(set) var player: AVPlayer?
    @Published private(set) var isReadyForPlayback = false
    @Published private(set) var hasTerminalPlaybackFailure = false
    @Published private(set) var heldFrame: HeldFrame?

    private var isVisible = true
    private var visibleFirstFrameLogged = false
    private var preparationStartedAt: Date?
    private var attachmentMilliseconds = 0
    private var prerollMilliseconds = 0
    private var preparationMilliseconds = 0
    private var layerReadyMilliseconds = 0
    private var activeIdentity: String?
    private var activeURL: URL?
    private var activePlaybackURL: URL?
    private var expectedDurationSeconds: TimeInterval?
    private var expectedPixelWidth: Int?
    private var expectedPixelHeight: Int?
    private var didAttemptQualityUpgrade = false
    private var qualityHealthySince: Date?
    private var isPaused = false
    private var needsRewindForNextVisit = false
    private var isUserMuted = false
    private var didFinishPlayback = false
    private var lastPublishedProgress = 0.0
    private var accessLogObserver: NSObjectProtocol?
    private var startupState = "unknown"
    private var stallObserver: NSObjectProtocol?
    private var playbackFailureObserver: NSObjectProtocol?
    private var playbackEndObserver: NSObjectProtocol?
    private var audioInterruptionObserver: NSObjectProtocol?
    private var timeControlStatusObservation: NSKeyValueObservation?
    private var timeObserver: Any?
    private weak var timeObserverPlayer: AVPlayer?
    private var playTask: Task<Void, Never>?
    private var revealTask: Task<Void, Never>?
    private var seekTask: Task<Void, Never>?
    private var stallConfirmationTask: Task<Void, Never>?
    private var stallRecoveryTask: Task<Void, Never>?
    private var sameItemRecoveryTask: Task<Void, Never>?
    private var rebuildTask: Task<Void, Never>?
    private var qualityRampTask: Task<Void, Never>?
    private var progressWatchdogTask: Task<Void, Never>?
    private var completionFallbackTask: Task<Void, Never>?
    private var playbackStartedAt: Date?
    private var qualityRampStartedAt: Date?
    private var qualityRampLastSize = CGSize.zero
    private var startupInterval: MediaPerformance.Interval?
    private var startupMetadata = ""
    private var onReadyForPlayback: () -> Void = {}
    private var onProgress: (Double) -> Void = { _ in }
    private var onFinished: () -> Void = {}
    private var refreshSource: () async -> StoryVideoPlaybackSource? = { nil }
    private var playbackRetryCount = 0
    private var sameItemRecoveryCount = 0
    private var playbackAttemptId = UUID().uuidString.lowercased()
    private var wasPlayingBeforeAudioInterruption = false
    private var isAudioInterrupted = false
    private var layerReadyForDisplay = false
    private var didUploadAccessLog = false
    private var didUpload720p = false
    private var didUploadQualityRamp = false
    private var didRelaxStreamingHints = false
    private var shouldUploadQoE = false
    private var playbackPhase = PlaybackPhase.idle
    private var playbackGeneration = 0
    private var revealTargetSeconds: TimeInterval = 0
    private var hasCompletedPreroll = false
    private var shouldStartImmediatelyAfterPreroll = false
    private var shouldPlayWhileAwaitingFirstFrame = false
    private var stallEpisodeStartedAt: Date?

    func play(
        source: StoryVideoPlaybackSource,
        expectedDuration: TimeInterval?,
        playerPool: StoryVideoPlaybackPool?,
        refreshSource: @escaping () async -> StoryVideoPlaybackSource?,
        isPaused: Bool,
        onReadyForPlayback: @escaping () -> Void,
        onProgress: @escaping (Double) -> Void,
        onFinished: @escaping () -> Void
    ) {
        self.onReadyForPlayback = onReadyForPlayback
        self.onProgress = onProgress
        self.onFinished = onFinished
        self.refreshSource = refreshSource
        self.isPaused = isPaused
        let nextExpectedDurationSeconds = expectedDuration.map { max(0.001, $0) }

        if source.representsSameMedia(as: activePlaybackSource),
           (!ExactVideoQualityPolicy.supports(source.url) || (activePlaybackURL ?? activeURL).map(ExactVideoQualityPolicy.supports) == true),
           playbackPhase != .idle,
           !hasTerminalPlaybackFailure {
            activeURL = source.url
            expectedDurationSeconds = nextExpectedDurationSeconds
            setPaused(isPaused)
            return
        }

        cleanupCurrentPlayer(reason: activeIdentity == nil ? nil : "replace")
        activeIdentity = source.identity
        startupState = "unknown"
        visibleFirstFrameLogged = false
        attachmentMilliseconds = 0
        prerollMilliseconds = 0
        preparationMilliseconds = 0
        layerReadyMilliseconds = 0
        activeURL = source.url
        expectedDurationSeconds = nextExpectedDurationSeconds
        playbackRetryCount = 0
        didAttemptQualityUpgrade = false
        qualityHealthySince = nil
        sameItemRecoveryCount = 0
        playbackAttemptId = UUID().uuidString.lowercased()
        isReadyForPlayback = false
        hasTerminalPlaybackFailure = false
        layerReadyForDisplay = false
        didFinishPlayback = false
        didUploadAccessLog = false
        didUpload720p = false
        didUploadQualityRamp = false
        didRelaxStreamingHints = false
        shouldUploadQoE = isVisible && MediaControlConfig.shared.shouldUploadAccessLog()
        qualityRampStartedAt = nil
        qualityRampLastSize = .zero
        lastPublishedProgress = 0
        startPlayback(
            source: source,
            playerPool: playerPool
        )
    }

    private func startPlayback(
        source: StoryVideoPlaybackSource,
        playerPool: StoryVideoPlaybackPool?,
        resumeTimeSeconds: TimeInterval? = nil,
        allowsStartupQualityLock: Bool = true,
        exactQualityTarget: Int? = nil
    ) {
        expectedPixelWidth = source.pixelWidth
        expectedPixelHeight = source.pixelHeight
        let url = source.url
        if isVisible { NetworkQualityMonitor.shared.setActivePlayback(identity: source.identity, buffering: true) }
        playTask?.cancel()
        revealTask?.cancel()
        revealTask = nil
        seekTask?.cancel()
        seekTask = nil
        playbackGeneration += 1
        let generation = playbackGeneration
        playbackPhase = .resolving
        shouldPlayWhileAwaitingFirstFrame = false
        revealTargetSeconds = resumeTimeSeconds.flatMap { value in
            value.isFinite ? max(0, value) : nil
        } ?? 0
        playTask = Task { @MainActor in
            let startedAt = Date()
            preparationStartedAt = startedAt
            if isVisible { playbackStartedAt = startedAt }
            let startupInterval = MediaPerformance.beginInterval(
                self.playbackEvent("video_startup url=\(url.lastPathComponent)")
            )
            if isVisible { self.startupInterval = startupInterval }
            else { MediaPerformance.cancelInterval(startupInterval, reason: "speculative_preparation") }
            startupMetadata = "url=\(url.lastPathComponent)"
            let selected = MediaPlaybackQuality.preferredPlaybackURL(defaultURL: url)
            let selectedSource = StoryVideoPlaybackSource(
                identity: source.identity,
                url: selected.url,
                durationSeconds: source.durationSeconds,
                pixelWidth: source.pixelWidth,
                pixelHeight: source.pixelHeight
            )
            var prepared = await playerPool?.takePreparedPlayer(for: selectedSource, completedOnly: !isVisible)
            if !isVisible, prepared == nil {
                guard isCurrentPlayback(generation: generation, identity: source.identity), !Task.isCancelled else { return }
                playbackPhase = .idle
                return
            }
            if let candidate = prepared,
               (!MediaPlaybackQuality.allowsPreparedPlaybackURL(candidate.playbackURL) ||
                (ExactVideoQualityPolicy.supports(selected.url) && ExactVideoQualityPolicy.target(in: candidate.playbackURL) == nil)) {
                candidate.player.cancelPendingPrerolls()
                candidate.player.replaceCurrentItem(with: nil)
                prepared = nil
            }
            let resolved = prepared == nil
                ? await resolvePlaybackURL(
                    for: StoryVideoPlaybackSource(
                        identity: source.identity,
                        url: selected.url,
                        durationSeconds: source.durationSeconds
                    )
                )
                : nil

            guard self.isCurrentPlayback(
                generation: generation,
                identity: source.identity
            ),
                  !Task.isCancelled else {
                prepared?.player.pause()
                prepared?.player.replaceCurrentItem(with: nil)
                prepared?.displaySurface.attach(nil)
                return
            }

            let resolvedPlaybackURL = resolved?.playbackURL ?? selected.url
            let defaultPlaybackURL = prepared?.playbackURL ?? (
                allowsStartupQualityLock
                    ? MediaPlaybackQuality.startupPlaybackURL(for: resolvedPlaybackURL)
                    : MediaPlaybackQuality.adaptivePlaybackURL(for: resolvedPlaybackURL)
            )
            let playbackURL = exactQualityTarget.map {
                ExactVideoQualityPolicy.url(defaultPlaybackURL, target: $0)
            } ?? defaultPlaybackURL
            activePlaybackURL = playbackURL
            let delivery = playbackDelivery(for: selected.url)
            let cacheState = prepared?.cacheState ?? resolved?.cacheState ?? "miss"
            let playerSource = prepared?.handoffStage == .staged
                ? "staged"
                : (prepared == nil ? "fresh" : "pooled")
            let prerollState = prepared?.wasPrerolled == true ? "ready" : "required"
            startupState = prepared?.wasPrerolled == true ? "prerolled" : (prepared != nil ? "prepared" : (cacheState == "hit" ? "cached" : "cold"))
            let qualityLabel = ExactVideoQualityPolicy.target(in: playbackURL).map { "exact_\($0)" } ?? selected.quality
            startupMetadata = "delivery=\(delivery) cache=\(cacheState) source=\(playerSource) preroll=\(prerollState) quality=\(qualityLabel) url=\(selected.url.lastPathComponent)"
            MediaPerformance.mark(playbackEvent("video_startup \(startupMetadata)"))

            if cacheState == "hit" {
                MediaPerformance.mark(
                    playbackEvent(
                        "video_disk_cache_hit state=\(cacheState) quality=\(selected.quality) url=\(selected.url.lastPathComponent)"
                    )
                )
            }

            player?.pause()
            let next = prepared?.player ?? makeFreshPlayer(playbackURL: playbackURL)
            if prepared != nil {
                MediaPlaybackQuality.applyStreamingHints(
                    for: next.currentItem,
                    playbackURL: playbackURL,
                    profile: isVisible ? .cold : .prepared
                )
            }
            next.pause()
            next.isMuted = true
            if #available(iOS 26.0, *) {
                next.networkResourcePriority = isVisible ? .high : .low
            }
            hasCompletedPreroll = prepared?.wasPrerolled == true
            shouldStartImmediatelyAfterPreroll = false
            let surface = prepared?.displaySurface ?? AspectFitPlayerView(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
            surface.attach(next)
            preparationMilliseconds = prepared?.preparationMilliseconds ?? 0
            displaySurface = surface
            player = next
            playbackPhase = .awaitingAttachment
            observeReadiness(
                player: next,
                url: selected.url,
                startedAt: startedAt,
                generation: generation,
                source: playerSource
            )
            observeNetworkAccess(player: next, generation: generation)
            observeStalls(player: next, url: selected.url, generation: generation)
            observeTimeControlStatus(player: next, url: selected.url, generation: generation)
            observeFailures(player: next, url: selected.url, generation: generation)
            observeCompletion(player: next, url: selected.url, generation: generation)
            observeProgress(player: next, generation: generation)
            observeAudioInterruptions(player: next, url: selected.url, generation: generation)
        }
    }

    func playerDidAttach(_ attachedPlayer: AVPlayer) {
        guard player === attachedPlayer,
              playbackPhase == .awaitingAttachment else {
            return
        }

        attachmentMilliseconds = Int(max(0, Date().timeIntervalSince(preparationStartedAt ?? Date()) * 1_000))
        let generation = playbackGeneration
        playbackPhase = .positioning
        let targetSeconds = revealTargetSeconds
        attachedPlayer.pause()

        let currentSeconds = attachedPlayer.currentTime().seconds
        if VideoStartupPolicy.canReuseCompletedPreroll(
            wasPrerolled: hasCompletedPreroll,
            targetSeconds: targetSeconds,
            currentSeconds: currentSeconds
        ) {
            MediaPerformance.mark(
                playbackEvent(
                    "video_preroll_reused position_ms=\(Int(targetSeconds * 1_000))"
                )
            )
            beginAwaitingFirstFrame(
                player: attachedPlayer,
                reason: "pooled_preroll"
            )
            return
        }

        hasCompletedPreroll = false
        seekTask?.cancel()
        seekTask = Task { @MainActor [weak self, weak attachedPlayer] in
            guard let self, let attachedPlayer else {
                return
            }

            let isReadyToPosition = await self.waitUntilReadyToPreroll(
                player: attachedPlayer,
                generation: generation
            )
            guard !Task.isCancelled,
                  self.isCurrentPlayer(attachedPlayer, generation: generation) else {
                return
            }
            guard isReadyToPosition else {
                self.handlePrerollReadinessTimeout(
                    player: attachedPlayer,
                    generation: generation,
                    reason: "preroll_readiness_timeout"
                )
                return
            }

            let currentSeconds = attachedPlayer.currentTime().seconds
            let needsSeek = !currentSeconds.isFinite || abs(currentSeconds - targetSeconds) > 0.05
            if needsSeek {
                let didSeek = await Self.seek(
                    player: attachedPlayer,
                    to: targetSeconds
                )
                guard !Task.isCancelled,
                      self.isCurrentPlayer(attachedPlayer, generation: generation) else { return }
                guard didSeek else {
                    if self.isCurrentPlayer(attachedPlayer, generation: generation),
                       let activeURL = self.activeURL {
                        self.recoverOrFail(
                            player: attachedPlayer,
                            url: activeURL,
                            reason: "reveal_position_failed"
                        )
                    }
                    return
                }
            }

            let isReadyToPreroll = await self.waitUntilReadyToPreroll(
                player: attachedPlayer,
                generation: generation
            )
            guard !Task.isCancelled,
                  self.isCurrentPlayer(attachedPlayer, generation: generation) else {
                return
            }
            guard isReadyToPreroll else {
                self.handlePrerollReadinessTimeout(
                    player: attachedPlayer,
                    generation: generation,
                    reason: "preroll_readiness_lost"
                )
                return
            }

            self.playbackPhase = .prerolling
            attachedPlayer.pause()
            let prerollStartedAt = Date()
            let didPreroll = await attachedPlayer.preroll(atRate: 1)
            guard !Task.isCancelled,
                  self.isCurrentPlayer(attachedPlayer, generation: generation) else { return }
            self.prerollMilliseconds = Int(max(0, Date().timeIntervalSince(prerollStartedAt) * 1_000))
            guard didPreroll else {
                if self.isCurrentPlayer(attachedPlayer, generation: generation),
                   let activeURL = self.activeURL {
                    self.recoverOrFail(
                        player: attachedPlayer,
                        url: activeURL,
                        reason: "preroll_failed"
                    )
                }
                return
            }

            self.seekTask = nil
            self.hasCompletedPreroll = true
            MediaPerformance.measure(
                self.playbackEvent(
                    "video_prerolled position_ms=\(Int(targetSeconds * 1_000))"
                ),
                since: prerollStartedAt
            )
            self.beginAwaitingFirstFrame(
                player: attachedPlayer,
                reason: "viewer_preroll"
            )
        }
    }

    private func beginAwaitingFirstFrame(player: AVPlayer, reason: String) {
        guard self.player === player else {
            return
        }

        playbackPhase = .awaitingFirstFrame
        shouldStartImmediatelyAfterPreroll = hasCompletedPreroll
        shouldPlayWhileAwaitingFirstFrame = hasCompletedPreroll

        if layerReadyForDisplay {
            attemptRevealVideo(reason: reason)
        }

        // A successful preroll guarantees media data is available. Starting muted
        // behind the thumbnail gives AVPlayerLayer a decoded frame to display without
        // asking AVPlayer to perform another stall-minimizing startup wait.
        if isVisible, !isReadyForPlayback, !isPaused, hasCompletedPreroll,
           ExactVideoQualityPolicy.target(in: activePlaybackURL) == nil || isPlayerReadyToReveal {
            player.isMuted = true
            player.playImmediately(atRate: 1)
        }
    }

    private func handlePrerollReadinessTimeout(
        player: AVPlayer,
        generation: Int,
        reason: String
    ) {
        guard isCurrentPlayer(player, generation: generation),
              let item = player.currentItem,
              let activeURL else {
            return
        }

        switch VideoStartupPolicy.readinessTimeoutAction(
            playerStatus: player.status,
            itemStatus: item.status
        ) {
        case .fail:
            handlePlaybackFailure(
                player: player,
                url: activeURL,
                reason: "\(reason)_failed"
            )
        case .continueBufferedPlayback:
            seekTask = nil
            hasCompletedPreroll = false
            shouldStartImmediatelyAfterPreroll = false
            shouldPlayWhileAwaitingFirstFrame = true
            playbackPhase = .awaitingFirstFrame
            MediaPerformance.mark(
                playbackEvent(
                    "video_startup_fallback reason=\(reason) player_status=\(player.status.rawValue) item_status=\(item.status.rawValue) url=\(activeURL.lastPathComponent)"
                )
            )
            updatePlaybackState(for: player)
        }
    }

    func retry(playerPool _: StoryVideoPlaybackPool?) {
        guard let activeIdentity, let activeURL else {
            return
        }

        let expectedDuration = expectedDurationSeconds
        let fallbackSource = StoryVideoPlaybackSource(
            identity: activeIdentity,
            url: activeURL,
            durationSeconds: expectedDuration
        )
        cleanupCurrentPlayer(reason: nil)
        self.activeIdentity = activeIdentity
        self.activeURL = activeURL
        expectedDurationSeconds = expectedDuration
        playbackRetryCount = 0
        sameItemRecoveryCount = 0
        playbackAttemptId = UUID().uuidString.lowercased()
        hasTerminalPlaybackFailure = false
        didFinishPlayback = false
        lastPublishedProgress = 0
        rebuildTask = Task { @MainActor in
            let refreshedSource = await self.refreshSource()
            guard !Task.isCancelled,
                  self.activeIdentity == activeIdentity else {
                return
            }

            let nextSource: StoryVideoPlaybackSource
            if let refreshedSource,
               refreshedSource.identity == activeIdentity {
                nextSource = refreshedSource
            } else {
                nextSource = fallbackSource
            }
            self.activeURL = nextSource.url
            self.rebuildTask = nil
            MediaPerformance.mark(
                self.playbackEvent(
                    "video_retry reason=manual strategy=rebuild refreshed=\(refreshedSource != nil) url=\(nextSource.url.lastPathComponent)"
                )
            )
            self.startPlayback(source: nextSource, playerPool: nil)
        }
    }

    private func updatePlaybackState(for player: AVPlayer) {
        guard self.player === player else {
            return
        }

        guard isVisible, !isPaused, !didFinishPlayback else {
            player.pause()
            return
        }

        switch playbackPhase {
        case .awaitingFirstFrame:
            player.isMuted = true
            if shouldPlayWhileAwaitingFirstFrame &&
                (ExactVideoQualityPolicy.target(in: activePlaybackURL) == nil || isPlayerReadyToReveal) {
                player.play()
            } else {
                player.pause()
            }
        case .visible:
            player.isMuted = isUserMuted
            if shouldStartImmediatelyAfterPreroll {
                shouldStartImmediatelyAfterPreroll = false
                player.playImmediately(atRate: 1)
            } else {
                player.play()
            }
        default:
            player.pause()
        }
    }

    private func makeFreshPlayer(playbackURL: URL) -> AVPlayer {
        let item = AVPlayerItem(url: playbackURL)
        item.preferredForwardBufferDuration = VideoStartupPolicy.freshForwardBufferDuration
        item.canUseNetworkResourcesForLiveStreamingWhilePaused = true
        configureStreamingHints(for: item, playbackURL: playbackURL)
        let player = AVPlayer(playerItem: item)
        player.actionAtItemEnd = .pause
        player.automaticallyWaitsToMinimizeStalling = true
        return player
    }

    private func resolvePlaybackURL(
        for source: StoryVideoPlaybackSource
    ) async -> (playbackURL: URL, cacheState: String) {
        // An offline package may contain only a low rendition. Online playback
        // needs the full ladder so it can recover to HD.
        if !NetworkQualityMonitor.shared.isConnected,
           let localHLSURL = await HLSOfflineCache.shared.cachedPlaybackURL(for: source) {
            return (localHLSURL, "hls_package")
        }

        let url = source.url
        let canPersistVideo = await MediaFileDiskCache.shared.supportsPersistence(url: url, kind: .video)

        if canPersistVideo,
           let cachedPlaybackURL = await MediaFileDiskCache.shared.cachedFileURL(for: url) {
            return (cachedPlaybackURL, "hit")
        }

        return (url, "miss")
    }

    private func configureStreamingHints(for item: AVPlayerItem?, playbackURL: URL) {
        MediaPlaybackQuality.applyStreamingHints(
            for: item,
            playbackURL: playbackURL,
            profile: .cold
        )
    }

    private func playbackDelivery(for url: URL) -> String {
        if url.pathExtension.lowercased() == "m3u8" {
            let host = url.host?.lowercased() ?? ""
            if url.path.contains("/cloudflare-stream/") || host.hasSuffix(".cloudflarestream.com") || host.hasSuffix(".videodelivery.net") {
                return "cloudflare-stream"
            }
            if url.path.contains("/story-media/") || url.path.contains("/media-delivery/") {
                return "vercel-hls"
            }
            return "hls"
        }

        if url.isFileURL {
            return "file"
        }

        return "progressive"
    }

    func setVisible(_ visible: Bool) {
        guard isVisible != visible else { return }
        isVisible = visible
        if #available(iOS 26.0, *) { player?.networkResourcePriority = visible ? .high : .low }
        if !visible {
            releaseHeldFrame()
            qualityRampTask?.cancel()
            qualityRampTask = nil
            needsRewindForNextVisit = player != nil
            NetworkQualityMonitor.shared.clearActivePlayback(identity: activeIdentity)
            player?.pause()
            player?.isMuted = true
            return
        }
        // A return before the deferred rewind executes still starts at zero.
        // Never publish the old frame as a completed destination handoff.
        if needsRewindForNextVisit { rewindForNextVisit() }
        visibleFirstFrameLogged = false
        playbackStartedAt = Date()
        shouldUploadQoE = isVisible && MediaControlConfig.shared.shouldUploadAccessLog()
        if let activeIdentity {
            NetworkQualityMonitor.shared.setActivePlayback(identity: activeIdentity, buffering: true)
            if let player { updateSpeculativePlaybackBudget(player: player) }
        }
        if let player, isReadyForPlayback {
            recordVisibleFirstFrame(player: player, reason: "prepared_layer_handoff", hiddenAdvanceSeconds: 0)
            startQualityRampMonitoring(player: player, generation: playbackGeneration)
        }
    }

    func setPaused(_ isPaused: Bool) {
        self.isPaused = isPaused
        guard let player else {
            return
        }

        if isPaused {
            completionFallbackTask?.cancel()
            completionFallbackTask = nil
        }
        updatePlaybackState(for: player)
        if !isPaused {
            scheduleCompletionFallbackIfNeeded(player: player)
            if progressWatchdogTask == nil,
               isReadyForPlayback,
               playbackPhase == .visible,
               let activeURL {
                startProgressWatchdog(
                    player: player,
                    url: activeURL,
                    generation: playbackGeneration
                )
            }
        }
    }

    func setMuted(_ isMuted: Bool) {
        isUserMuted = isMuted
        guard let player else {
            return
        }

        if isVisible, playbackPhase == .visible {
            player.isMuted = isMuted
        } else {
            // Preroll and hidden buffered players must remain silent regardless of
            // the user's visible-playback preference.
            player.isMuted = true
        }
    }

    func rewindForNextVisit() {
        guard let player,
              let activeURL,
              activeIdentity != nil else {
            return
        }

        needsRewindForNextVisit = false
        isPaused = true
        player.pause()
        player.isMuted = true
        player.cancelPendingPrerolls()
        player.currentItem?.cancelPendingSeeks()

        playTask?.cancel()
        playTask = nil
        revealTask?.cancel()
        revealTask = nil
        seekTask?.cancel()
        seekTask = nil
        stallConfirmationTask?.cancel()
        stallConfirmationTask = nil
        stallRecoveryTask?.cancel()
        stallRecoveryTask = nil
        stallEpisodeStartedAt = nil
        sameItemRecoveryTask?.cancel()
        sameItemRecoveryTask = nil
        rebuildTask?.cancel()
        rebuildTask = nil
        completionFallbackTask?.cancel()
        completionFallbackTask = nil
        progressWatchdogTask?.cancel()
        progressWatchdogTask = nil
        logQualityRampIfNeeded(result: "interrupted_story_reentry")
        qualityRampTask?.cancel()
        qualityRampTask = nil
        logAccessLogIfNeeded(reason: "story_reentry")
        if let startupInterval {
            MediaPerformance.cancelInterval(startupInterval, reason: "story_reentry")
            self.startupInterval = nil
        }

        playbackRetryCount = 0
        sameItemRecoveryCount = 0
        playbackAttemptId = UUID().uuidString.lowercased()
        isReadyForPlayback = false
        hasTerminalPlaybackFailure = false
        didFinishPlayback = false
        didUploadAccessLog = false
        didUpload720p = false
        didUploadQualityRamp = false
        didRelaxStreamingHints = false
        shouldUploadQoE = isVisible && MediaControlConfig.shared.shouldUploadAccessLog()
        qualityRampStartedAt = nil
        qualityRampLastSize = .zero
        lastPublishedProgress = 0
        revealTargetSeconds = 0
        hasCompletedPreroll = false
        shouldStartImmediatelyAfterPreroll = false
        shouldPlayWhileAwaitingFirstFrame = false

        if let activePlaybackURL {
            configureStreamingHints(
                for: player.currentItem,
                playbackURL: activePlaybackURL
            )
        }

        let startedAt = Date()
        preparationStartedAt = startedAt
        if isVisible { playbackStartedAt = startedAt }
        visibleFirstFrameLogged = false
        attachmentMilliseconds = 0
        prerollMilliseconds = 0
        layerReadyMilliseconds = 0
        preparationMilliseconds = 0
        startupState = "prepared"
        startupMetadata = "source=reentry url=\(activeURL.lastPathComponent)"
        if isVisible {
            startupInterval = MediaPerformance.beginInterval(playbackEvent("video_startup \(startupMetadata)"))
        }
        playbackPhase = .awaitingAttachment
        observeReadiness(
            player: player,
            url: activeURL,
            startedAt: startedAt,
            generation: playbackGeneration,
            source: "reentry"
        )
        MediaPerformance.mark(
            playbackEvent(
                "video_reentry_rewind position_ms=0 url=\(activeURL.lastPathComponent)"
            )
        )
        playerDidAttach(player)
    }

    func updateCallbacks(
        onReadyForPlayback: @escaping () -> Void,
        onProgress: @escaping (Double) -> Void,
        onFinished: @escaping () -> Void
    ) {
        self.onReadyForPlayback = onReadyForPlayback
        self.onProgress = onProgress
        self.onFinished = onFinished
    }

    func stop(reason: String) {
        cleanupCurrentPlayer(reason: reason)
        activeIdentity = nil
        activeURL = nil
    }

    private func observeReadiness(
        player: AVPlayer,
        url: URL,
        startedAt: Date,
        generation: Int,
        source: String
    ) {
        revealTask?.cancel()
        revealTask = Task { @MainActor in
            var didLogItemReady = false
            var elapsedUnpausedSeconds: TimeInterval = 0
            let timeoutSeconds = ExactVideoQualityPolicy.target(in: self.activePlaybackURL).map {
                ExactVideoQualityPolicy.preparationTimeout(target: $0)
            } ?? VideoStartupPolicy.firstFrameTimeout(
                isLimitedNetwork: NetworkQualityMonitor.shared.isLimitedPath
            )

            while elapsedUnpausedSeconds < timeoutSeconds {
                guard self.isCurrentPlayer(player, generation: generation),
                      !Task.isCancelled else {
                    return
                }

                if self.isReadyForPlayback {
                    return
                }

                if player.currentItem?.status == .readyToPlay {
                    if !didLogItemReady {
                        didLogItemReady = true
                        MediaPerformance.measure(
                            self.playbackEvent(
                                "video_item_ready url=\(url.lastPathComponent)"
                            ),
                            since: startedAt
                        )
                    }
                    attemptRevealVideo(reason: "item_ready")
                    if self.playbackPhase == .awaitingFirstFrame { self.updatePlaybackState(for: player) }
                } else if player.currentItem?.status == .failed {
                    handlePlaybackFailure(player: player, url: url, reason: "item_failed")
                    return
                }

                if !self.isPaused {
                    switch self.playbackPhase {
                    case .positioning, .prerolling, .awaitingFirstFrame:
                        elapsedUnpausedSeconds += 0.05
                    default:
                        break
                    }
                }
                try? await Task.sleep(for: .milliseconds(50))
            }

            guard self.isCurrentPlayer(player, generation: generation),
                  !Task.isCancelled,
                  !isReadyForPlayback else {
                return
            }

            recoverOrFail(
                player: player,
                url: url,
                reason: "first_frame_timeout_\(source)"
            )
        }
    }

    func revealVideo(player: AVPlayer, reason: String) {
        guard self.player === player,
              !isReadyForPlayback else {
            return
        }

        layerReadyForDisplay = true
        layerReadyMilliseconds = Int(max(0, Date().timeIntervalSince(preparationStartedAt ?? Date()) * 1_000))

        guard playbackPhase != .awaitingAttachment,
              playbackPhase != .positioning else {
            return
        }

        attemptRevealVideo(reason: reason)
        if !isReadyForPlayback, playbackPhase == .awaitingFirstFrame {
            updatePlaybackState(for: player)
        }
    }

    private func attemptRevealVideo(reason: String) {
        guard !isReadyForPlayback,
              playbackPhase == .awaitingFirstFrame,
              layerReadyForDisplay,
              let player else {
            return
        }

        guard isPlayerReadyToReveal else {
            return
        }

        let generation = playbackGeneration
        let displayedSeconds = player.currentTime().seconds
        let hiddenAdvanceSeconds = displayedSeconds.isFinite
            ? max(0, displayedSeconds - revealTargetSeconds)
            : 0
        completeReveal(
            player: player,
            generation: generation,
            reason: reason,
            hiddenAdvanceSeconds: hiddenAdvanceSeconds
        )
    }

    private func completeReveal(
        player: AVPlayer,
        generation: Int,
        reason: String,
        hiddenAdvanceSeconds: TimeInterval
    ) {
        guard isCurrentPlayer(player, generation: generation),
              !isReadyForPlayback else {
            return
        }

        playbackPhase = .visible
        shouldPlayWhileAwaitingFirstFrame = false
        isReadyForPlayback = true
        releaseHeldFrame()
        updateSpeculativePlaybackBudget(player: player)
        if isVisible { startQualityRampMonitoring(player: player, generation: generation) }
        if isVisible, let activeURL {
            startProgressWatchdog(
                player: player,
                url: activeURL,
                generation: generation
            )
        }
        if isVisible {
            recordVisibleFirstFrame(player: player, reason: reason, hiddenAdvanceSeconds: hiddenAdvanceSeconds)
            onReadyForPlayback()
        }
        updatePlaybackState(for: player)
    }

    private func recordVisibleFirstFrame(player: AVPlayer, reason: String, hiddenAdvanceSeconds: TimeInterval) {
        guard isVisible, !visibleFirstFrameLogged else { return }
        visibleFirstFrameLogged = true
        let startedAt = playbackStartedAt ?? Date()
        let metadata = startupMetadata.isEmpty
            ? "url=\(activeURL?.lastPathComponent ?? "unknown")"
            : startupMetadata
        let displayedSeconds = player.currentTime().seconds
        let finiteDisplayedSeconds = displayedSeconds.isFinite
            ? max(0, displayedSeconds)
            : revealTargetSeconds
        let positionMilliseconds = Int(finiteDisplayedSeconds * 1_000)
        let hiddenMilliseconds = Int(max(0, hiddenAdvanceSeconds) * 1_000)
        let size = player.currentItem?.presentationSize ?? .zero
        let dimensions = "width=\(Int(max(0, size.width))) height=\(Int(max(0, size.height)))"
        let firstFrameEvent = playbackEvent(
            "video_first_frame \(dimensions) reason=\(reason) position_ms=\(positionMilliseconds) hidden_ms=\(hiddenMilliseconds) layer_ready_ms=\(layerReadyMilliseconds) attachment_ms=\(attachmentMilliseconds) preroll_ms=\(prerollMilliseconds) preparation_ms=\(preparationMilliseconds) \(metadata)"
        )
        if let startupInterval {
            MediaPerformance.endInterval(startupInterval, event: firstFrameEvent)
            self.startupInterval = nil
        } else {
            MediaPerformance.measure(firstFrameEvent, since: startedAt)
        }
        updatePlaybackState(for: player)
    }

    private var isPlayerReadyToReveal: Bool {
        guard let item = player?.currentItem, item.status == .readyToPlay else {
            return false
        }

        if activePlaybackURL?.isFileURL == true {
            return true
        }

        if let target = ExactVideoQualityPolicy.target(in: activePlaybackURL) {
            let current = player?.currentTime().seconds ?? 0
            return ExactVideoQualityPolicy.isReady(size: item.presentationSize, target: target,
                sourceWidth: expectedPixelWidth, sourceHeight: expectedPixelHeight,
                buffered: bufferedAheadSeconds(item: item, currentSeconds: current),
                remaining: expectedDurationSeconds.map { max(0, $0 - current) })
        }

        if hasCompletedPreroll {
            return true
        }

        if item.isPlaybackLikelyToKeepUp || item.isPlaybackBufferFull {
            return true
        }

        let currentTime = player?.currentTime().seconds ?? 0
        let bufferedAhead = item.loadedTimeRanges
            .map(\.timeRangeValue)
            .compactMap { range -> TimeInterval? in
                let start = range.start.seconds
                let end = start + range.duration.seconds
                guard start.isFinite,
                      end.isFinite,
                      currentTime.isFinite,
                      currentTime + 0.05 >= start,
                      currentTime <= end else {
                    return nil
                }

                return max(0, end - currentTime)
            }
            .max() ?? 0
        return bufferedAhead >= 0.75
    }

    private func observeNetworkAccess(player: AVPlayer, generation: Int) {
        if let accessLogObserver { NotificationCenter.default.removeObserver(accessLogObserver) }
        accessLogObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemNewAccessLogEntry, object: player.currentItem, queue: .main) { [weak self, weak player] _ in
            Task { @MainActor in
                guard let self, let player, self.isCurrentPlayer(player, generation: generation),
                      let event = player.currentItem?.accessLog()?.events.last else { return }
                // Learning is local and independent of telemetry sampling.
                NetworkQualityMonitor.shared.recordPlaybackObservation(observedBitrate: event.observedBitrate, stalls: event.numberOfStalls)
            }
        }
    }

    private func updateSpeculativePlaybackBudget(player: AVPlayer) {
        guard isVisible, let activeIdentity else { return }
        let item = player.currentItem
        let currentSeconds = player.currentTime().seconds
        let ahead = bufferedAheadSeconds(item: item, currentSeconds: currentSeconds)
        let remaining = finiteSeconds(item?.duration).flatMap { currentSeconds.isFinite ? max(0, $0 - currentSeconds) : nil }
        let healthy = StoryPreheatPolicy.canResumePreparation(visible: isReadyForPlayback, stalled: stallEpisodeStartedAt != nil, local: activePlaybackURL?.isFileURL == true, likelyToKeepUp: item?.isPlaybackLikelyToKeepUp == true, bufferedAhead: ahead, throughput: NetworkQualityMonitor.shared.recentPlaybackThroughput, recoveryReserve: NetworkQualityMonitor.shared.playbackRecoveryReserve, coolingDown: NetworkQualityMonitor.shared.playbackRecoveryCoolingDown, remainingSeconds: remaining)
        NetworkQualityMonitor.shared.setActivePlayback(identity: activeIdentity, buffering: !healthy)
    }

    private func observeStalls(player: AVPlayer, url: URL, generation: Int) {
        if let stallObserver {
            NotificationCenter.default.removeObserver(stallObserver)
        }

        stallObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemPlaybackStalled,
            object: player.currentItem,
            queue: .main
        ) { [weak self, weak player] _ in
            Task { @MainActor in
                guard let self,
                      let player,
                      self.isCurrentPlayer(player, generation: generation) else {
                    return
                }

                self.confirmObservedStall(
                    player: player,
                    url: url,
                    generation: generation,
                    reason: "notification",
                    startedAt: Date()
                )
            }
        }
    }

    private func observeTimeControlStatus(
        player: AVPlayer,
        url: URL,
        generation: Int
    ) {
        timeControlStatusObservation?.invalidate()
        timeControlStatusObservation = player.observe(
            \.timeControlStatus,
            options: [.initial, .new]
        ) { [weak self, weak player] observedPlayer, _ in
            Task { @MainActor in
                guard let self,
                      let player,
                      observedPlayer === player,
                      self.isCurrentPlayer(player, generation: generation) else {
                    return
                }

                switch player.timeControlStatus {
                case .waitingToPlayAtSpecifiedRate:
                    guard self.isReadyForPlayback,
                          self.playbackPhase == .visible,
                          !self.isPaused else {
                        return
                    }

                    let waitingReason = player.reasonForWaitingToPlay?.rawValue
                        .replacingOccurrences(of: " ", with: "_") ?? "unknown"
                    self.scheduleStallConfirmation(
                        player: player,
                        url: url,
                        generation: generation,
                        reason: "waiting_\(waitingReason)"
                    )
                case .playing:
                    // `.playing` is not proof that frames are moving. Only cancel a
                    // pending waiting-state confirmation; an established stall is
                    // cleared by measured playhead progress in the watchdog.
                    if self.stallEpisodeStartedAt == nil {
                        self.stallConfirmationTask?.cancel()
                        self.stallConfirmationTask = nil
                    }
                case .paused:
                    if self.isPaused {
                        self.stallConfirmationTask?.cancel()
                        self.stallConfirmationTask = nil
                    }
                @unknown default:
                    break
                }
            }
        }
    }

    private func scheduleStallConfirmation(
        player: AVPlayer,
        url: URL,
        generation: Int,
        reason: String
    ) {
        guard stallEpisodeStartedAt == nil,
              stallConfirmationTask == nil,
              stallRecoveryTask == nil else {
            return
        }

        let startedAt = Date()
        stallConfirmationTask = Task { @MainActor [weak self, weak player] in
            try? await Task.sleep(for: VideoStallRecoveryPolicy.confirmationDelay)
            guard let self,
                  let player,
                  !Task.isCancelled,
                  self.isCurrentPlayer(player, generation: generation),
                  self.isReadyForPlayback,
                  self.playbackPhase == .visible,
                  !self.isPaused,
                  player.timeControlStatus == .waitingToPlayAtSpecifiedRate else {
                self?.stallConfirmationTask = nil
                return
            }

            self.stallConfirmationTask = nil
            self.confirmObservedStall(
                player: player,
                url: url,
                generation: generation,
                reason: reason,
                startedAt: startedAt
            )
        }
    }

    private func confirmObservedStall(
        player: AVPlayer,
        url: URL,
        generation: Int,
        reason: String,
        startedAt: Date
    ) {
        guard isCurrentPlayer(player, generation: generation),
              !isPaused,
              stallEpisodeStartedAt == nil,
              stallRecoveryTask == nil else {
            return
        }

        stallConfirmationTask?.cancel()
        stallConfirmationTask = nil
        stallEpisodeStartedAt = startedAt
        if isVisible, let activeIdentity {
            NetworkQualityMonitor.shared.setActivePlayback(identity: activeIdentity, buffering: true)
            NetworkQualityMonitor.shared.recordConfirmedPlaybackStall(identity: activeIdentity)
            // Reserve a little more active-stream buffer after confirmed stalls;
            // speculative players remain on their existing small buffer budgets.
            player.currentItem?.preferredForwardBufferDuration = min(6, NetworkQualityMonitor.shared.playbackRecoveryReserve + 1)
        }
        qualityRampTask?.cancel()
        qualityRampTask = nil
        didRelaxStreamingHints = false
        MediaPlaybackQuality.applyStreamingHints(
            for: player.currentItem,
            playbackURL: activePlaybackURL,
            profile: .cold
        )
        let phase = isReadyForPlayback ? "playing" : "startup"
        let currentSeconds = player.currentTime().seconds
        let durationSeconds = finiteSeconds(player.currentItem?.duration)
        let bufferedSeconds = bufferedAheadSeconds(
            item: player.currentItem,
            currentSeconds: currentSeconds
        )
        let currentMilliseconds = currentSeconds.isFinite
            ? Int(max(0, currentSeconds) * 1_000)
            : -1
        let durationMilliseconds = durationSeconds.map { Int($0 * 1_000) } ?? -1
        let bufferedMilliseconds = Int(max(0, bufferedSeconds) * 1_000)
        MediaPerformance.mark(
            playbackEvent(
                "video_stalled phase=\(phase) reason=\(reason) control=\(timeControlStatusToken(player.timeControlStatus)) current_ms=\(currentMilliseconds) duration_ms=\(durationMilliseconds) buffer_ms=\(bufferedMilliseconds) url=\(url.lastPathComponent)"
            )
        )

        if reason == "progress_watchdog" {
            // The watchdog has already observed a full no-progress window. Waiting
            // for AVPlayer's state machine to agree only extends a visible freeze.
            stallEpisodeStartedAt = nil
            recoverOrFail(
                player: player,
                url: url,
                reason: reason
            )
            return
        }

        monitorStallRecovery(
            player: player,
            url: url,
            generation: generation
        )
    }

    private func finishObservedStall(
        player: AVPlayer,
        url: URL,
        generation: Int
    ) {
        guard isCurrentPlayer(player, generation: generation) else {
            return
        }

        stallConfirmationTask?.cancel()
        stallConfirmationTask = nil
        guard let startedAt = stallEpisodeStartedAt else {
            return
        }

        stallEpisodeStartedAt = nil
        stallRecoveryTask?.cancel()
        stallRecoveryTask = nil
        MediaPerformance.measure(
            playbackEvent(
                "video_recovered reason=stall strategy=automatic url=\(url.lastPathComponent)"
            ),
            since: startedAt
        )
        startQualityRampMonitoring(player: player, generation: generation)
    }

    private func observeAudioInterruptions(
        player: AVPlayer,
        url: URL,
        generation: Int
    ) {
        if let audioInterruptionObserver {
            NotificationCenter.default.removeObserver(audioInterruptionObserver)
        }

        audioInterruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self, weak player] notification in
            Task { @MainActor in
                guard let self,
                      let player,
                      self.isCurrentPlayer(player, generation: generation),
                      let typeValue = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                      let interruptionType = AVAudioSession.InterruptionType(rawValue: typeValue) else {
                    return
                }

                switch interruptionType {
                case .began:
                    self.wasPlayingBeforeAudioInterruption =
                        !self.isPaused && self.playbackPhase == .visible
                    self.isAudioInterrupted = true
                    self.stallConfirmationTask?.cancel()
                    self.stallConfirmationTask = nil
                    self.stallRecoveryTask?.cancel()
                    self.stallRecoveryTask = nil
                    self.stallEpisodeStartedAt = nil
                    self.sameItemRecoveryTask?.cancel()
                    self.sameItemRecoveryTask = nil
                    player.pause()
                    MediaPerformance.mark(
                        self.playbackEvent(
                            "video_stalled phase=playing reason=audio_interruption url=\(url.lastPathComponent)"
                        )
                    )
                case .ended:
                    let optionsValue = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
                    let options = AVAudioSession.InterruptionOptions(rawValue: optionsValue)
                    let shouldResume = options.contains(.shouldResume) &&
                        self.wasPlayingBeforeAudioInterruption &&
                        !self.isPaused
                    if shouldResume {
                        self.isAudioInterrupted = false
                        self.wasPlayingBeforeAudioInterruption = false
                        _ = AppAudioSession.configureForVideoPlayback()
                        self.updatePlaybackState(for: player)
                        if self.progressWatchdogTask == nil {
                            self.startProgressWatchdog(
                                player: player,
                                url: url,
                                generation: generation
                            )
                        }
                        MediaPerformance.mark(
                            self.playbackEvent(
                                "video_recovered reason=audio_interruption url=\(url.lastPathComponent)"
                            )
                        )
                    } else {
                        self.wasPlayingBeforeAudioInterruption = false
                    }
                @unknown default:
                    break
                }
            }
        }
    }

    private func monitorStallRecovery(player: AVPlayer, url: URL, generation: Int) {
        stallRecoveryTask?.cancel()
        stallRecoveryTask = Task { @MainActor in
            let stalledTime = player.currentTime().seconds
            var recoveryChecks = 0

            while recoveryChecks < 20 {
                guard self.isCurrentPlayer(player, generation: generation),
                      !Task.isCancelled else {
                    return
                }

                if self.isPaused || self.isAudioInterrupted {
                    try? await Task.sleep(for: .milliseconds(50))
                    continue
                }
                recoveryChecks += 1

                let currentTime = player.currentTime().seconds
                let playbackAdvanced = stalledTime.isFinite &&
                    currentTime.isFinite &&
                    currentTime - stalledTime >= VideoStallRecoveryPolicy.minimumRecoveryAdvanceSeconds
                if VideoStallRecoveryPolicy.hasRecovered(
                    timeControlStatus: player.timeControlStatus,
                    playbackAdvanced: playbackAdvanced
                ) {
                    self.finishObservedStall(
                        player: player,
                        url: url,
                        generation: generation
                    )
                    return
                }

                try? await Task.sleep(for: .milliseconds(50))
            }

            guard self.isCurrentPlayer(player, generation: generation),
                  !Task.isCancelled else {
                return
            }

            self.stallEpisodeStartedAt = nil
            self.stallRecoveryTask = nil
            logPlaybackFailure(player: player, url: url, reason: "stall_recovery_timeout")
            recoverOrFail(player: player, url: url, reason: "stall_recovery_timeout")
        }
    }

    private func observeFailures(player: AVPlayer, url: URL, generation: Int) {
        if let playbackFailureObserver {
            NotificationCenter.default.removeObserver(playbackFailureObserver)
        }

        playbackFailureObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemFailedToPlayToEndTime,
            object: player.currentItem,
            queue: .main
        ) { [weak self, weak player] notification in
            Task { @MainActor in
                guard let self,
                      let player,
                      self.isCurrentPlayer(player, generation: generation) else {
                    return
                }

                let error = notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
                self.handlePlaybackFailure(player: player, url: url, reason: "failed_to_end", error: error)
            }
        }
    }

    private func observeCompletion(player: AVPlayer, url: URL, generation: Int) {
        if let playbackEndObserver {
            NotificationCenter.default.removeObserver(playbackEndObserver)
        }

        playbackEndObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: player.currentItem,
            queue: .main
        ) { [weak self, weak player] _ in
            Task { @MainActor in
                guard let self,
                      let player,
                      self.isCurrentPlayer(player, generation: generation) else {
                    return
                }

                self.finishPlayback(player: player, url: url)
            }
        }
    }

    private func observeProgress(player: AVPlayer, generation: Int) {
        removeTimeObserver()

        // Thirty progress updates per second keeps the indicator visually smooth
        // without driving a full SwiftUI state-update chain at display refresh rate.
        let interval = CMTime(value: 1, timescale: 30)
        timeObserverPlayer = player
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self, weak player] time in
            Task { @MainActor in
                guard let self,
                      let player,
                      self.isCurrentPlayer(player, generation: generation) else {
                    return
                }

                self.updateSpeculativePlaybackBudget(player: player)
                self.publishProgress(currentTime: time, player: player)
            }
        }
    }

    private func startProgressWatchdog(
        player: AVPlayer,
        url: URL,
        generation: Int
    ) {
        progressWatchdogTask?.cancel()
        progressWatchdogTask = Task { @MainActor [weak self, weak player] in
            guard let self, let player else {
                return
            }

            var lastObservedSeconds = player.currentTime().seconds
            var lastProgressAt = Date()

            while !Task.isCancelled {
                try? await Task.sleep(for: VideoPlaybackWatchdogPolicy.sampleInterval)
                guard !Task.isCancelled,
                      self.isCurrentPlayer(player, generation: generation) else {
                    return
                }

                let isVisible = self.isReadyForPlayback && self.playbackPhase == .visible
                let currentSeconds = player.currentTime().seconds
                if !isVisible || self.isPaused || self.isAudioInterrupted || self.didFinishPlayback {
                    lastObservedSeconds = currentSeconds
                    lastProgressAt = Date()
                    continue
                }

                if currentSeconds.isFinite,
                   lastObservedSeconds.isFinite,
                   currentSeconds < lastObservedSeconds - 0.1 {
                    // An intentional seek or source replacement starts a fresh sample
                    // window and must never be interpreted as a stall.
                    lastObservedSeconds = currentSeconds
                    lastProgressAt = Date()
                    continue
                }

                if VideoPlaybackWatchdogPolicy.madeProgress(
                    previousSeconds: lastObservedSeconds,
                    currentSeconds: currentSeconds
                ) {
                    lastObservedSeconds = currentSeconds
                    lastProgressAt = Date()
                    if self.stallEpisodeStartedAt != nil {
                        self.finishObservedStall(
                            player: player,
                            url: url,
                            generation: generation
                        )
                    }
                    continue
                }

                let actualDuration = self.finiteSeconds(player.currentItem?.duration)
                if let actualDuration,
                   VideoPlaybackCompletionPolicy.isAtEnd(
                       currentSeconds: currentSeconds,
                       durationSeconds: actualDuration
                   ) {
                    self.scheduleCompletionFallbackIfNeeded(
                        player: player,
                        currentSeconds: currentSeconds,
                        durationSeconds: actualDuration
                    )
                    lastProgressAt = Date()
                    continue
                }

                let secondsWithoutProgress = Date().timeIntervalSince(lastProgressAt)
                guard self.sameItemRecoveryTask == nil,
                      self.rebuildTask == nil,
                      self.stallRecoveryTask == nil,
                      self.stallEpisodeStartedAt == nil,
                      VideoPlaybackWatchdogPolicy.shouldDeclareStall(
                          isVisible: isVisible,
                          isPaused: self.isPaused,
                          didFinish: self.didFinishPlayback,
                          secondsWithoutProgress: secondsWithoutProgress
                      ) else {
                    continue
                }

                self.confirmObservedStall(
                    player: player,
                    url: url,
                    generation: generation,
                    reason: "progress_watchdog",
                    startedAt: lastProgressAt
                )
            }
        }
    }

    private func publishProgress(currentTime: CMTime, player: AVPlayer) {
        guard isReadyForPlayback,
              playbackPhase == .visible,
              !didFinishPlayback,
              let durationSeconds = finiteSeconds(player.currentItem?.duration) ?? expectedDurationSeconds,
              durationSeconds > 0 else {
            return
        }

        let currentSeconds = currentTime.seconds.isFinite ? max(0, currentTime.seconds) : 0
        let progress = min(max(currentSeconds / durationSeconds, 0), 1)
        scheduleCompletionFallbackIfNeeded(
            player: player,
            currentSeconds: currentSeconds,
            durationSeconds: finiteSeconds(player.currentItem?.duration)
        )
        guard progress >= 0.995 || abs(progress - lastPublishedProgress) >= 0.001 else {
            return
        }

        lastPublishedProgress = progress
        onProgress(progress)
    }

    private func finishPlayback(player: AVPlayer, url: URL) {
        guard !didFinishPlayback else {
            return
        }

        guard isReadyForPlayback, playbackPhase == .visible else {
            player.pause()
            MediaPerformance.mark(
                playbackEvent(
                    "video_ended_before_first_frame attempt=\(playbackRetryCount) url=\(url.lastPathComponent)"
                )
            )
            recoverOrFail(
                player: player,
                url: url,
                reason: "ended_before_first_frame"
            )
            return
        }

        didFinishPlayback = true
        progressWatchdogTask?.cancel()
        progressWatchdogTask = nil
        completionFallbackTask?.cancel()
        completionFallbackTask = nil
        playbackPhase = .finished
        lastPublishedProgress = 1
        onProgress(1)
        MediaPerformance.mark(
            playbackEvent("video_ended url=\(url.lastPathComponent)")
        )
        MediaPerformance.flushUploadEvents()
        onFinished()
    }

    private func scheduleCompletionFallbackIfNeeded(
        player: AVPlayer,
        currentSeconds: TimeInterval? = nil,
        durationSeconds: TimeInterval? = nil
    ) {
        guard completionFallbackTask == nil,
              !didFinishPlayback,
              !isPaused,
              isReadyForPlayback,
              playbackPhase == .visible else {
            return
        }

        let resolvedCurrent = currentSeconds ?? player.currentTime().seconds
        let resolvedDuration = durationSeconds ??
            finiteSeconds(player.currentItem?.duration)
        guard let resolvedDuration,
              VideoPlaybackCompletionPolicy.isAtEnd(
                  currentSeconds: resolvedCurrent,
                  durationSeconds: resolvedDuration
              ) else {
            return
        }

        let generation = playbackGeneration
        completionFallbackTask = Task { @MainActor [weak self, weak player] in
            try? await Task.sleep(for: VideoPlaybackCompletionPolicy.graceDelay)
            guard let self,
                  let player,
                  !Task.isCancelled,
                  self.isCurrentPlayer(player, generation: generation),
                  !self.isPaused,
                  !self.didFinishPlayback else {
                self?.completionFallbackTask = nil
                return
            }

            self.completionFallbackTask = nil
            let current = player.currentTime().seconds
            let duration = self.finiteSeconds(player.currentItem?.duration)
            guard let duration,
                  VideoPlaybackCompletionPolicy.isAtEnd(
                      currentSeconds: current,
                      durationSeconds: duration
                  ),
                  let url = self.activeURL else {
                return
            }

            MediaPerformance.mark(
                self.playbackEvent(
                    "video_completion_fallback current_ms=\(Int(max(0, current) * 1_000)) duration_ms=\(Int(duration * 1_000)) url=\(url.lastPathComponent)"
                )
            )
            self.finishPlayback(player: player, url: url)
        }
    }

    private func handlePlaybackFailure(player: AVPlayer, url: URL, reason: String, error: Error? = nil) {
        logPlaybackFailure(player: player, url: url, reason: reason, error: error)
        recoverOrFail(
            player: player,
            url: url,
            reason: reason,
            refreshSourceBeforeRebuild: true
        )
    }

    private func recoverOrFail(
        player: AVPlayer,
        url: URL,
        reason: String,
        refreshSourceBeforeRebuild: Bool = true
    ) {
        guard self.player === player,
              !hasTerminalPlaybackFailure,
              sameItemRecoveryTask == nil,
              rebuildTask == nil else {
            return
        }

        if let target = ExactVideoQualityPolicy.target(in: activePlaybackURL),
           switchExactRendition(player: player, target: ExactVideoQualityPolicy.fallback(after: target), reason: reason) {
            return
        }

        completionFallbackTask?.cancel()
        completionFallbackTask = nil
        qualityRampTask?.cancel()
        qualityRampTask = nil
        progressWatchdogTask?.cancel()
        progressWatchdogTask = nil
        didRelaxStreamingHints = false
        MediaPlaybackQuality.applyStreamingHints(
            for: player.currentItem,
            playbackURL: activePlaybackURL,
            profile: .cold
        )

        let recoveryAction = VideoPlaybackRecoveryPolicy.action(
            // A bandwidth-focused Cloudflare startup manifest intentionally has
            // one rendition. If that rendition cannot keep up, seeking the same
            // item cannot downshift; rebuild immediately on the adaptive manifest.
            itemIsReady: isReadyForPlayback &&
                player.currentItem?.status == .readyToPlay &&
                !MediaPlaybackQuality.isStartupQualityLocked(activePlaybackURL),
            currentItemRecoveryCount: sameItemRecoveryCount,
            playerRebuildCount: playbackRetryCount
        )

        if recoveryAction == .recoverCurrentItem {
            beginSameItemRecovery(
                player: player,
                url: url,
                reason: reason,
                refreshSourceBeforeRebuild: refreshSourceBeforeRebuild
            )
            return
        }

        if recoveryAction == .rebuildPlayer,
           rebuildPlayerIfPossible(
               player: player,
               url: url,
               reason: reason,
               refreshSourceBeforeRebuild: refreshSourceBeforeRebuild
           ) {
            return
        }

        markTerminalPlaybackFailure(player: player, url: url, reason: reason)
    }

    private func beginSameItemRecovery(
        player: AVPlayer,
        url: URL,
        reason: String,
        refreshSourceBeforeRebuild: Bool
    ) {
        sameItemRecoveryCount += 1
        let generation = playbackGeneration
        let recoveryAttempt = sameItemRecoveryCount
        stallRecoveryTask?.cancel()
        stallRecoveryTask = nil
        sameItemRecoveryTask = Task { @MainActor in
            let recoveryStartedAt = Date()
            let initialSeconds = player.currentTime().seconds
            let targetSeconds = initialSeconds.isFinite ? max(0, initialSeconds) : 0
            player.pause()

            let didSeek = await Self.seek(player: player, to: targetSeconds)
            guard !Task.isCancelled,
                  self.isCurrentPlayer(player, generation: generation) else { return }
            guard didSeek,
                  self.isCurrentPlayer(player, generation: generation),
                  !self.isPaused,
                  !self.isAudioInterrupted else {
                self.sameItemRecoveryTask = nil
                if self.isCurrentPlayer(player, generation: generation),
                   !self.isPaused,
                   !self.isAudioInterrupted {
                    self.rebuildOrFailAfterSameItemRecovery(
                        player: player,
                        url: url,
                        reason: reason,
                        refreshSourceBeforeRebuild: refreshSourceBeforeRebuild
                    )
                }
                return
            }

            player.play()
            for _ in 0..<50 {
                guard !Task.isCancelled,
                      self.isCurrentPlayer(player, generation: generation) else {
                    return
                }

                if self.isPaused || self.isAudioInterrupted {
                    player.pause()
                    self.sameItemRecoveryTask = nil
                    return
                }

                let currentSeconds = player.currentTime().seconds
                let advanced = currentSeconds.isFinite &&
                    currentSeconds >= targetSeconds + VideoStallRecoveryPolicy.minimumRecoveryAdvanceSeconds
                if advanced {
                    self.sameItemRecoveryTask = nil
                    MediaPerformance.measure(
                        self.playbackEvent(
                            "video_recovered reason=\(reason) strategy=same_item attempt=\(recoveryAttempt) url=\(url.lastPathComponent)"
                        ),
                        since: recoveryStartedAt
                    )
                    self.updatePlaybackState(for: player)
                    self.startQualityRampMonitoring(
                        player: player,
                        generation: generation
                    )
                    self.startProgressWatchdog(
                        player: player,
                        url: url,
                        generation: generation
                    )
                    return
                }

                try? await Task.sleep(for: .milliseconds(50))
            }

            guard !Task.isCancelled,
                  self.isCurrentPlayer(player, generation: generation) else {
                return
            }
            self.sameItemRecoveryTask = nil
            self.rebuildOrFailAfterSameItemRecovery(
                player: player,
                url: url,
                reason: reason,
                refreshSourceBeforeRebuild: refreshSourceBeforeRebuild
            )
        }
    }

    private func rebuildOrFailAfterSameItemRecovery(
        player: AVPlayer,
        url: URL,
        reason: String,
        refreshSourceBeforeRebuild: Bool
    ) {
        guard !rebuildPlayerIfPossible(
            player: player,
            url: url,
            reason: "\(reason)_same_item_failed",
            refreshSourceBeforeRebuild: refreshSourceBeforeRebuild
        ) else {
            return
        }

        markTerminalPlaybackFailure(player: player, url: url, reason: reason)
    }

    private func markTerminalPlaybackFailure(player: AVPlayer, url: URL, reason: String) {
        guard self.player === player else {
            return
        }

        player.pause()
        player.isMuted = true
        revealTask?.cancel()
        revealTask = nil
        seekTask?.cancel()
        seekTask = nil
        stallConfirmationTask?.cancel()
        stallConfirmationTask = nil
        stallRecoveryTask?.cancel()
        stallRecoveryTask = nil
        stallEpisodeStartedAt = nil
        sameItemRecoveryTask?.cancel()
        sameItemRecoveryTask = nil
        rebuildTask?.cancel()
        rebuildTask = nil
        completionFallbackTask?.cancel()
        completionFallbackTask = nil
        progressWatchdogTask?.cancel()
        progressWatchdogTask = nil
        didFinishPlayback = true
        playbackPhase = .idle
        isReadyForPlayback = false
        hasTerminalPlaybackFailure = true
        if let startupInterval {
            MediaPerformance.cancelInterval(startupInterval, reason: "terminal_\(reason)")
            self.startupInterval = nil
        }
        MediaPerformance.mark(
            playbackEvent(
                "video_terminal_failure reason=\(reason) rebuilds=\(playbackRetryCount) same_item_recoveries=\(sameItemRecoveryCount) url=\(url.lastPathComponent)"
            )
        )
        MediaPerformance.flushUploadEvents()
    }

    @discardableResult
    private func rebuildPlayerIfPossible(
        player: AVPlayer,
        url: URL,
        reason: String,
        refreshSourceBeforeRebuild: Bool
    ) -> Bool {
        if let target = ExactVideoQualityPolicy.target(in: activePlaybackURL), self.player === player {
            return switchExactRendition(player: player, target: ExactVideoQualityPolicy.fallback(after: target), reason: reason)
        }
        guard self.player === player,
              !didFinishPlayback,
              let retryIdentity = activeIdentity,
              let retryURL = activeURL,
              playbackRetryCount < VideoPlaybackRecoveryPolicy.maximumPlayerRebuilds else {
            return false
        }

        let resumeTimeSeconds = isReadyForPlayback ? player.currentTime().seconds : nil
        let expectedDuration = expectedDurationSeconds
        let publishedProgress = lastPublishedProgress
        let shouldUseAdaptiveFallback = MediaPlaybackQuality.isStartupQualityLocked(activePlaybackURL) ||
            ExactVideoQualityPolicy.supports(retryURL)
        playbackRetryCount += 1
        let resumeMilliseconds = resumeTimeSeconds.flatMap { $0.isFinite ? Int(max(0, $0) * 1_000) : nil } ?? 0
        let rebuildAttempt = playbackRetryCount
        MediaPerformance.mark(
            playbackEvent(
                "video_retry reason=\(reason) strategy=rebuild attempt=\(rebuildAttempt) resume_ms=\(resumeMilliseconds) url=\(url.lastPathComponent) fallback=\(retryURL.lastPathComponent) refresh_requested=\(refreshSourceBeforeRebuild)"
            )
        )
        cleanupCurrentPlayer(reason: nil)
        activeIdentity = retryIdentity
        activeURL = retryURL
        expectedDurationSeconds = expectedDuration
        isReadyForPlayback = false
        hasTerminalPlaybackFailure = false
        layerReadyForDisplay = false
        didFinishPlayback = false
        lastPublishedProgress = publishedProgress
        let fallbackSource = StoryVideoPlaybackSource(
            identity: retryIdentity,
            url: retryURL,
            durationSeconds: expectedDuration
        )
        rebuildTask = Task { @MainActor in
            let refreshedSource = refreshSourceBeforeRebuild
                ? await self.refreshSource()
                : nil
            guard !Task.isCancelled,
                  self.activeIdentity == retryIdentity else {
                return
            }

            let nextSource: StoryVideoPlaybackSource
            if let refreshedSource,
               refreshedSource.identity == retryIdentity {
                nextSource = refreshedSource
            } else {
                nextSource = fallbackSource
            }
            self.activeURL = nextSource.url
            self.rebuildTask = nil
            MediaPerformance.mark(
                self.playbackEvent(
                    "video_retry reason=\(reason) strategy=rebuild_ready attempt=\(rebuildAttempt) refreshed=\(refreshedSource != nil) url=\(nextSource.url.lastPathComponent)"
                )
            )
            self.startPlayback(
                source: nextSource,
                playerPool: nil,
                resumeTimeSeconds: resumeTimeSeconds,
                allowsStartupQualityLock: !shouldUseAdaptiveFallback
            )
        }
        return true
    }

    /// Exact manifests cannot switch variants inside AVPlayer. Replace once at
    /// the current position; a 720 failure releases the full adaptive ladder.
    @discardableResult
    private func switchExactRendition(player: AVPlayer, target: Int, reason: String) -> Bool {
        guard self.player === player, !didFinishPlayback,
              let identity = activeIdentity, let url = activeURL,
              ExactVideoQualityPolicy.supports(url) else { return false }
        let position = isReadyForPlayback ? player.currentTime().seconds : revealTargetSeconds
        let duration = expectedDurationSeconds
        let progress = lastPublishedProgress
        let source = StoryVideoPlaybackSource(identity: identity, url: url, durationSeconds: duration,
            pixelWidth: expectedPixelWidth, pixelHeight: expectedPixelHeight)
        MediaPerformance.mark(playbackEvent("video_quality_ramp result=selection target=\(target) reason=\(reason) position_ms=\(Int(max(0, position.isFinite ? position : 0) * 1000))"))
        cleanupCurrentPlayer(reason: nil, preserveVisibleFrame: true)
        activeIdentity = identity
        activeURL = url
        expectedDurationSeconds = duration
        lastPublishedProgress = progress
        qualityHealthySince = nil
        startPlayback(source: source, playerPool: nil,
            resumeTimeSeconds: position.isFinite ? position : 0,
            allowsStartupQualityLock: target != 0, exactQualityTarget: target)
        return true
    }

    private func logPlaybackFailure(player: AVPlayer, url: URL, reason: String, error: Error? = nil) {
        let nsError = (error ?? player.currentItem?.error) as NSError?
        var event = "video_stalled reason=\(reason) url=\(url.lastPathComponent)"

        if let nsError {
            event += " domain=\(nsError.domain) code=\(nsError.code)"
        }

        if let statusCode = player.currentItem?.errorLog()?.events.last?.errorStatusCode, statusCode > 0 {
            event += " status=\(statusCode)"
        }

        MediaPerformance.mark(playbackEvent(event))
    }

    private func logAccessLogIfNeeded(reason: String) {
        guard !didUploadAccessLog,
              shouldUploadQoE,
              let events = player?.currentItem?.accessLog()?.events,
              let event = events.last else {
            return
        }

        didUploadAccessLog = true
        let observedBitrate = Int(max(0, event.observedBitrate).rounded())
        let indicatedBitrate = Int(max(0, event.indicatedBitrate).rounded())
        let transferDurationMs = Int(events.reduce(0) { $0 + max(0, $1.transferDuration) } * 1000)
        let watchedMs = Int(events.reduce(0) { $0 + max(0, $1.durationWatched) } * 1000)
        let downloadedMs = Int(events.reduce(0) { $0 + max(0, $1.segmentsDownloadedDuration) } * 1000)
        let transferredBytes = events.reduce(Int64(0)) { $0 + max(0, $1.numberOfBytesTransferred) }
        let uri = accessLogURIIdentifier(event.uri)
        let presentationSize = player?.currentItem?.presentationSize ?? .zero
        let presentationWidth = Int(max(0, presentationSize.width).rounded())
        let presentationHeight = Int(max(0, presentationSize.height).rounded())


        MediaPerformance.mark(
            playbackEvent(
                "video_access_log reason=\(reason) observedBitrate=\(observedBitrate) indicatedBitrate=\(indicatedBitrate) width=\(presentationWidth) height=\(presentationHeight) stalls=\(event.numberOfStalls) transferDurationMs=\(transferDurationMs) watchedMs=\(watchedMs) downloadedMs=\(downloadedMs) bytes=\(transferredBytes) uri=\(uri)"
            )
        )
    }

    private func startQualityRampMonitoring(player: AVPlayer, generation: Int) {
        qualityRampTask?.cancel()
        qualityRampTask = nil

        guard activePlaybackURL?.pathExtension.lowercased() == "m3u8" else {
            return
        }

        let startedAt = Date()
        qualityRampStartedAt = startedAt
        let initiallyRelaxed = didRelaxStreamingHints
        qualityRampTask = Task { @MainActor [weak self, weak player] in
            var recovery = VideoQualityRecoveryState(isRelaxed: initiallyRelaxed)
            var lastAllowed: Bool?
            while !Task.isCancelled {
                // Only borrow the controller synchronously. The polling task must
                // not keep a discarded viewer alive across its suspension point.
                guard let player,
                      self?.sampleQualityRecovery(player: player, generation: generation,
                          recovery: &recovery, lastAllowed: &lastAllowed) == true else { return }
                do {
                    try await Task.sleep(for: VideoQualityRampPolicy.observationInterval(elapsed: Date().timeIntervalSince(startedAt)))
                } catch { return }
            }
        }
    }

    private func sampleQualityRecovery(player: AVPlayer, generation: Int,
        recovery: inout VideoQualityRecoveryState, lastAllowed: inout Bool?) -> Bool {
        guard isVisible, !didFinishPlayback, isCurrentPlayer(player, generation: generation),
              let startedAt = qualityRampStartedAt else { return false }
        let item = player.currentItem
        let currentSeconds = player.currentTime().seconds
        let durationSeconds = finiteSeconds(item?.duration) ??
            expectedDurationSeconds
        let remainingSeconds: TimeInterval? = durationSeconds.flatMap { duration -> TimeInterval? in
            guard duration.isFinite, currentSeconds.isFinite else {
                return nil
            }
            return max(0, duration - currentSeconds)
        }
        let bufferedAheadSeconds = bufferedAheadSeconds(
            item: item,
            currentSeconds: currentSeconds
        )

        let hasHealthyBuffer = VideoQualityRampPolicy.shouldRelaxStreamingHints(
            isPlaybackLikelyToKeepUp: item?.isPlaybackLikelyToKeepUp == true,
            bufferedAheadSeconds: bufferedAheadSeconds,
            remainingSeconds: remainingSeconds
        )
        let allowed = NetworkQualityMonitor.shared.allowsStreamingHintRelaxation
        if hasHealthyBuffer && !isPaused && player.timeControlStatus == .playing {
            if qualityHealthySince == nil { qualityHealthySince = Date() }
        } else { qualityHealthySince = nil }
        if activeURL.map(ExactVideoQualityPolicy.supports) == true,
           ExactVideoQualityPolicy.shouldUpgrade(target: ExactVideoQualityPolicy.target(in: activePlaybackURL),
            healthySeconds: qualityHealthySince.map { Date().timeIntervalSince($0) } ?? 0,
            remaining: remainingSeconds, throughput: NetworkQualityMonitor.shared.measuredThroughputBitsPerSecond,
            allowed: allowed, alreadyAttempted: didAttemptQualityUpgrade) {
            didAttemptQualityUpgrade = true
            switchExactRendition(player: player, target: 1080, reason: "healthy_recovery")
            return false
        }
        if lastAllowed != allowed {
            // A prerolled item must leave its small speculative buffer
            // budget when it becomes visible, including on cellular.
            item?.preferredForwardBufferDuration = NetworkQualityMonitor.shared.activeForwardBufferDuration
            lastAllowed = allowed
        }
        let action = recovery.observe(allowed: allowed, healthy: hasHealthyBuffer,
            advancing: !isPaused && !isAudioInterrupted && player.timeControlStatus == .playing)
        switch action {
        case .relax:
            MediaPlaybackQuality.relaxStreamingHints(for: item, playbackURL: activePlaybackURL)
        case .restrict:
            MediaPlaybackQuality.applyStreamingHints(for: item, playbackURL: activePlaybackURL, profile: .cold)
        case .none:
            break
        }
        didRelaxStreamingHints = recovery.isRelaxed

        let size = item?.presentationSize ?? .zero
        qualityRampLastSize = size
        if shouldUploadQoE, !didUpload720p,
           min(size.width, size.height) >= 720, max(size.width, size.height) >= 1280 {
            didUpload720p = true
            MediaPerformance.measure(playbackEvent("video_quality_ramp result=reached target=720p width=\(Int(size.width)) height=\(Int(size.height))"), since: playbackStartedAt ?? startedAt)
        }
        if shouldUploadQoE,
           VideoQualityRampPolicy.hasReached1080p(size) {
            logQualityRampIfNeeded(result: "reached")
        }
        return true
    }

    private func bufferedAheadSeconds(
        item: AVPlayerItem?,
        currentSeconds: TimeInterval
    ) -> TimeInterval {
        guard currentSeconds.isFinite else {
            return 0
        }

        return item?.loadedTimeRanges
            .map(\.timeRangeValue)
            .compactMap { range -> TimeInterval? in
                let start = range.start.seconds
                let end = start + range.duration.seconds
                guard start.isFinite,
                      end.isFinite,
                      currentSeconds + 0.05 >= start,
                      currentSeconds <= end else {
                    return nil
                }
                return max(0, end - currentSeconds)
            }
            .max() ?? 0
    }

    private func logQualityRampIfNeeded(result: String) {
        guard shouldUploadQoE,
              !didUploadQualityRamp,
              let startedAt = qualityRampStartedAt else {
            return
        }

        didUploadQualityRamp = true
        let event = player?.currentItem?.accessLog()?.events.last
        let width = Int(max(0, qualityRampLastSize.width).rounded())
        let height = Int(max(0, qualityRampLastSize.height).rounded())
        let indicatedBitrate = Int(max(0, event?.indicatedBitrate ?? 0).rounded())
        let observedBitrate = Int(max(0, event?.observedBitrate ?? 0).rounded())
        let startupMilliseconds = playbackStartedAt.map {
            Int(max(0, Date().timeIntervalSince($0)) * 1_000)
        } ?? 0
        MediaPerformance.measure(
            playbackEvent(
                "video_quality_ramp result=\(result) target=1080p width=\(width) height=\(height) indicatedBitrate=\(indicatedBitrate) observedBitrate=\(observedBitrate) startup_ms=\(startupMilliseconds) \(startupMetadata)"
            ),
            since: playbackStartedAt ?? startedAt
        )
    }

    private func accessLogURIIdentifier(_ uri: String?) -> String {
        guard let uri, !uri.isEmpty else {
            return "unknown"
        }

        if let url = URL(string: uri) {
            let lastPathComponent = url.lastPathComponent
            if !lastPathComponent.isEmpty {
                return String(lastPathComponent.prefix(80))
            }
        }

        return String(uri.prefix(80)).replacingOccurrences(of: " ", with: "_")
    }

    private func playbackEvent(_ event: String) -> String {
        let mediaIdentifier = activeIdentity.map(telemetryMediaIdentifier) ?? "unknown"
        let delivery = (activePlaybackURL ?? activeURL).map(playbackDelivery(for:)) ?? "unknown"
        return "\(event) playback=\(playbackAttemptId) generation=\(playbackGeneration) media=\(mediaIdentifier) delivery=\(delivery) startup_state=\(startupState)"
    }

    private func telemetryMediaIdentifier(_ value: String) -> String {
        // Playback identities can contain signed paths. A short stable digest keeps
        // events correlatable without uploading credentials or storage details.
        SHA256.hash(data: Data(value.utf8))
            .prefix(8)
            .map { String(format: "%02x", $0) }
            .joined()
    }

    private func timeControlStatusToken(_ status: AVPlayer.TimeControlStatus) -> String {
        switch status {
        case .paused:
            return "paused"
        case .waitingToPlayAtSpecifiedRate:
            return "waiting"
        case .playing:
            return "playing"
        @unknown default:
            return "unknown"
        }
    }

    private func releaseHeldFrame() {
        heldFrame?.player.pause()
        heldFrame?.player.replaceCurrentItem(with: nil)
        heldFrame?.surface.attach(nil)
        heldFrame = nil
    }

    private func cleanupCurrentPlayer(reason: String?, preserveVisibleFrame: Bool = false) {
        if preserveVisibleFrame {
            if isReadyForPlayback, let player, let displaySurface {
                releaseHeldFrame()
                player.pause()
                player.isMuted = true
                heldFrame = HeldFrame(player: player, surface: displaySurface)
            }
        } else { releaseHeldFrame() }
        NetworkQualityMonitor.shared.clearActivePlayback(identity: activeIdentity)
        if let accessLogObserver { NotificationCenter.default.removeObserver(accessLogObserver); self.accessLogObserver = nil }
        playbackGeneration += 1
        playTask?.cancel()
        playTask = nil
        revealTask?.cancel()
        revealTask = nil
        seekTask?.cancel()
        seekTask = nil
        stallConfirmationTask?.cancel()
        stallConfirmationTask = nil
        stallRecoveryTask?.cancel()
        stallRecoveryTask = nil
        stallEpisodeStartedAt = nil
        sameItemRecoveryTask?.cancel()
        sameItemRecoveryTask = nil
        rebuildTask?.cancel()
        rebuildTask = nil
        completionFallbackTask?.cancel()
        completionFallbackTask = nil
        progressWatchdogTask?.cancel()
        progressWatchdogTask = nil
        let qualityRampResult = reason.map { "interrupted_\($0)" } ?? "interrupted"
        logQualityRampIfNeeded(result: qualityRampResult)
        qualityRampTask?.cancel()
        qualityRampTask = nil

        if let stallObserver {
            NotificationCenter.default.removeObserver(stallObserver)
            self.stallObserver = nil
        }
        if let playbackFailureObserver {
            NotificationCenter.default.removeObserver(playbackFailureObserver)
            self.playbackFailureObserver = nil
        }
        if let playbackEndObserver {
            NotificationCenter.default.removeObserver(playbackEndObserver)
            self.playbackEndObserver = nil
        }
        if let audioInterruptionObserver {
            NotificationCenter.default.removeObserver(audioInterruptionObserver)
            self.audioInterruptionObserver = nil
        }
        timeControlStatusObservation?.invalidate()
        timeControlStatusObservation = nil
        wasPlayingBeforeAudioInterruption = false
        isAudioInterrupted = false

        removeTimeObserver()

        logAccessLogIfNeeded(reason: reason ?? "cleanup")

        if let reason, let activeURL {
            MediaPerformance.mark(
                playbackEvent(
                    "video_dismissed reason=\(reason) url=\(activeURL.lastPathComponent)"
                )
            )
        }
        if let startupInterval {
            MediaPerformance.cancelInterval(startupInterval, reason: reason ?? "cleanup")
            self.startupInterval = nil
        }

        player?.pause()
        player?.cancelPendingPrerolls()
        player?.currentItem?.cancelPendingSeeks()
        if heldFrame?.player !== player {
            player?.replaceCurrentItem(with: nil)
            displaySurface?.attach(nil)
        }
        displaySurface = nil
        player = nil
        isReadyForPlayback = false
        hasTerminalPlaybackFailure = false
        layerReadyForDisplay = false
        didFinishPlayback = false
        didRelaxStreamingHints = false
        lastPublishedProgress = 0
        playbackStartedAt = nil
        qualityRampStartedAt = nil
        qualityRampLastSize = .zero
        activePlaybackURL = nil
        expectedDurationSeconds = nil
        needsRewindForNextVisit = false
        startupMetadata = ""
        playbackPhase = .idle
        revealTargetSeconds = 0
        hasCompletedPreroll = false
        shouldStartImmediatelyAfterPreroll = false
        shouldPlayWhileAwaitingFirstFrame = false
    }

    private func removeTimeObserver() {
        if let timeObserver, let timeObserverPlayer {
            timeObserverPlayer.removeTimeObserver(timeObserver)
        }
        timeObserver = nil
        timeObserverPlayer = nil
    }

    private func isCurrentPlayback(generation: Int, identity: String) -> Bool {
        guard playbackGeneration == generation,
              let activeIdentity else {
            return false
        }

        return activeIdentity == identity
    }

    private var activePlaybackSource: StoryVideoPlaybackSource? {
        guard let activeIdentity, let activeURL else {
            return nil
        }

        return StoryVideoPlaybackSource(
            identity: activeIdentity,
            url: activeURL,
            durationSeconds: expectedDurationSeconds
        )
    }

    private func isCurrentPlayer(_ player: AVPlayer, generation: Int) -> Bool {
        playbackGeneration == generation && self.player === player
    }

    private static func seek(player: AVPlayer, to seconds: TimeInterval) async -> Bool {
        let target = CMTime(
            seconds: max(0, seconds),
            preferredTimescale: 600
        )

        return await withCheckedContinuation { continuation in
            player.seek(
                to: target,
                toleranceBefore: .zero,
                toleranceAfter: .zero
            ) { didFinish in
                continuation.resume(returning: didFinish)
            }
        }
    }

    private func waitUntilReadyToPreroll(
        player: AVPlayer,
        generation: Int,
        timeout: Duration = .seconds(4)
    ) async -> Bool {
        let timeoutSeconds = Double(timeout.components.seconds) +
            Double(timeout.components.attoseconds) / 1_000_000_000_000_000_000
        var elapsedUnpausedSeconds: TimeInterval = 0

        while elapsedUnpausedSeconds < timeoutSeconds {
            guard !Task.isCancelled,
                  isCurrentPlayer(player, generation: generation),
                  let item = player.currentItem else {
                return false
            }

            if player.status == .failed || item.status == .failed {
                return false
            }

            if player.status == .readyToPlay, item.status == .readyToPlay {
                return true
            }

            try? await Task.sleep(for: .milliseconds(25))
            if !isPaused {
                elapsedUnpausedSeconds += 0.025
            }
        }

        return player.status == .readyToPlay &&
            player.currentItem?.status == .readyToPlay &&
            isCurrentPlayer(player, generation: generation)
    }

    private func finiteSeconds(_ time: CMTime?) -> Double? {
        guard let time, time.isNumeric else {
            return nil
        }

        let seconds = time.seconds
        guard seconds.isFinite, seconds > 0 else {
            return nil
        }

        return seconds
    }
}
