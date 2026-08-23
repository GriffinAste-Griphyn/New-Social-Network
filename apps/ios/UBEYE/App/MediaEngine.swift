import AVFoundation
import SwiftUI
import UIKit

enum MediaPreheatPriority: String {
    case active
    case next
    case previous
    case visible
    case background
}

@MainActor
final class MediaEngine: ObservableObject {
    let storyVideoPlaybackPool = StoryVideoPlaybackPool()

    private var idleCleanupTask: Task<Void, Never>?
    private var backgroundPrefetchTask: Task<Void, Never>?
    private var memoryWarningObserver: NSObjectProtocol?
    private var lastFeedPreheatKey: String?
    private var lastFeedPreheatAt = Date.distantPast
    private var isStoryViewerActive = false

    init() {
        memoryWarningObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.removeAll(reason: "memory_warning")
            }
        }
    }

    deinit {
        if let memoryWarningObserver {
            NotificationCenter.default.removeObserver(memoryWarningObserver)
        }
    }

    func preheat(feed: MobileFeedResponse, priority: MediaPreheatPriority) {
        let feedKey = ([feed.myStory.items.map(\.id)] + [feed.verticalFollowingStories.map(\.id), feed.followingStories.map(\.id), feed.discoverTiles.map(\.id)])
            .flatMap { $0 }
            .joined(separator: "|")
        guard feedKey != lastFeedPreheatKey || Date().timeIntervalSince(lastFeedPreheatAt) > 0.15 else {
            return
        }

        lastFeedPreheatKey = feedKey
        lastFeedPreheatAt = Date()
        MediaPreheater.preheat(feed: feed)
        MediaPerformance.mark("media_engine_preheat_feed priority=\(priority.rawValue)")
    }

    func prefetchStoryStacks(
        ids: [String],
        api: APIClient,
        priority: MediaPreheatPriority,
        refresh: Bool = false,
        limit: Int = 6
    ) {
        let uniqueIds = uniqueNonEmptyIds(ids)
        guard !uniqueIds.isEmpty else {
            return
        }

        let resolvedLimit = prefetchLimit(priority: priority, requestedLimit: limit)
        MediaPerformance.mark(
            "media_engine_prefetch_stacks priority=\(priority.rawValue) refresh=\(refresh) count=\(uniqueIds.count) limit=\(resolvedLimit)"
        )

        if priority == .background {
            backgroundPrefetchTask?.cancel()
            backgroundPrefetchTask = Task { @MainActor [weak self, api] in
                let delayMs = NetworkQualityMonitor.shared.isConstrained ? 900 : 350
                try? await Task.sleep(for: .milliseconds(delayMs))
                guard !Task.isCancelled else {
                    return
                }

                api.prefetchStoryStacks(ids: uniqueIds, refresh: refresh, limit: resolvedLimit)
                self?.backgroundPrefetchTask = nil
            }
            return
        }

        api.prefetchStoryStacks(ids: uniqueIds, refresh: refresh, limit: resolvedLimit)
    }

    func restoreAndPrefetchStoryStacks(
        ids: [String],
        api: APIClient,
        priority: MediaPreheatPriority,
        refresh: Bool,
        limit: Int
    ) {
        let uniqueIds = Array(uniqueNonEmptyIds(ids).prefix(limit))
        guard !uniqueIds.isEmpty else {
            return
        }

        Task { @MainActor [weak self, api] in
            guard let self else {
                return
            }

            let restoredCount = await api.restoreCachedStoryStacks(ids: uniqueIds, limit: limit)
            MediaPerformance.mark(
                "media_engine_restore_stacks priority=\(priority.rawValue) restored=\(restoredCount) candidates=\(uniqueIds.count)"
            )
            prefetchStoryStacks(
                ids: uniqueIds,
                api: api,
                priority: priority,
                refresh: refresh,
                limit: limit
            )
        }
    }

    func warmStoryOpen(storyId: String, adjacentIds: [String], api: APIClient) {
        idleCleanupTask?.cancel()

        let ids = uniqueNonEmptyIds([storyId] + adjacentIds)

        guard !ids.isEmpty else {
            return
        }

        Task { @MainActor [weak self, api] in
            guard let self else {
                return
            }

            let warmLimit = min(NetworkQualityMonitor.shared.stackPreheatLimit, 8)
            let restoredCount = await api.restoreCachedStoryStacks(ids: ids, limit: warmLimit)
            if let cached = await api.cachedStoryStackForDisplay(storyId: storyId) {
                prepare(stack: cached.story, around: 0, activeIdentity: nil)
            }
            MediaPerformance.mark("media_engine_story_open_warm id=\(storyId) restored=\(restoredCount) candidates=\(ids.count)")
            api.prefetchStoryStacks(ids: ids, refresh: false, limit: warmLimit)
        }
    }

    func prepare(stack: StoryStack, around index: Int, activeIdentity: String?) {
        MediaPreheater.preheat(
            stack: stack,
            around: index,
            preheatVideoAssets: !NetworkQualityMonitor.shared.isConstrained
        )
        storyVideoPlaybackPool.prepare(
            sources: adjacentVideoSources(in: stack, around: index),
            activeIdentity: activeIdentity
        )
    }

    func storyViewerDidAppear() {
        isStoryViewerActive = true
        idleCleanupTask?.cancel()
        idleCleanupTask = nil
        backgroundPrefetchTask?.cancel()
        backgroundPrefetchTask = nil
    }

    func storyViewerDidDisappear() {
        isStoryViewerActive = false
        idleCleanupTask?.cancel()
        idleCleanupTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(15))
            guard !Task.isCancelled else {
                return
            }

            self?.storyVideoPlaybackPool.removeAll()
        }
    }

    func removeAll() {
        removeAll(reason: "manual")
    }

    private func removeAll(reason: String) {
        idleCleanupTask?.cancel()
        idleCleanupTask = nil
        backgroundPrefetchTask?.cancel()
        backgroundPrefetchTask = nil
        storyVideoPlaybackPool.removeAll()
        MediaImageCache.shared.removeAll()
        MediaPerformance.mark("media_engine_clear reason=\(reason)")
    }

    private func adjacentVideoSources(
        in stack: StoryStack,
        around itemIndex: Int
    ) -> [StoryVideoPlaybackSource] {
        orderedNearbyStoryItems(in: stack, around: itemIndex)
            .filter(\.isPlayableVideo)
            .map(\.playbackSource)
    }

    private func orderedNearbyStoryItems(in stack: StoryStack, around itemIndex: Int) -> [StoryStackItem] {
        guard stack.items.indices.contains(itemIndex) else {
            return []
        }

        var seen = Set<Int>()
        return [itemIndex, itemIndex + 1, itemIndex - 1, itemIndex + 2]
            .filter { index in
                stack.items.indices.contains(index) && seen.insert(index).inserted
            }
            .map { stack.items[$0] }
    }

    private func uniqueNonEmptyIds(_ ids: [String]) -> [String] {
        var seen = Set<String>()
        return ids
            .filter { !$0.isEmpty }
            .filter { seen.insert($0).inserted }
    }

    private func prefetchLimit(priority: MediaPreheatPriority, requestedLimit: Int) -> Int {
        let networkLimit = NetworkQualityMonitor.shared.stackPreheatLimit
        let priorityLimit: Int

        switch priority {
        case .active:
            priorityLimit = 3
        case .next, .previous:
            priorityLimit = 5
        case .visible:
            priorityLimit = 8
        case .background:
            priorityLimit = NetworkQualityMonitor.shared.isConstrained ? 3 : 10
        }

        return min(requestedLimit, priorityLimit, networkLimit)
    }
}

@MainActor
final class StoryVideoPlaybackPool: ObservableObject {
    struct PreparedPlayer {
        let player: AVPlayer
        let playbackURL: URL
        let cacheState: String
        let wasPrerolled: Bool

        init(
            player: AVPlayer,
            playbackURL: URL,
            cacheState: String,
            wasPrerolled: Bool = false
        ) {
            self.player = player
            self.playbackURL = playbackURL
            self.cacheState = cacheState
            self.wasPrerolled = wasPrerolled
        }
    }

    private struct Preparation {
        let id: UUID
        let task: Task<Void, Never>
    }

    private var preparedPlayers: [String: PreparedPlayer] = [:]
    private var prepareTasks: [String: Preparation] = [:]
    private var desiredIdentities = Set<String>()
    private var acquiringIdentities = Set<String>()
    private let playerBuilder: (URL) async -> PreparedPlayer?
    private let preparedPlayerLimitOverride: Int?
    private var maxPreparedPlayers: Int {
        min(preparedPlayerLimitOverride ?? NetworkQualityMonitor.shared.preparedPlayerLimit, 4)
    }

    init() {
        playerBuilder = Self.buildPreparedPlayer
        preparedPlayerLimitOverride = nil
    }

    init(
        maxPreparedPlayers: Int,
        playerBuilder: @escaping (URL) async -> PreparedPlayer?
    ) {
        self.playerBuilder = playerBuilder
        preparedPlayerLimitOverride = max(0, maxPreparedPlayers)
    }

    func takePreparedPlayer(
        for source: StoryVideoPlaybackSource,
        waitUpTo waitDuration: Duration = .milliseconds(180)
    ) async -> PreparedPlayer? {
        let waitStartedAt = Date()
        let identity = source.identity
        acquiringIdentities.insert(identity)
        defer {
            acquiringIdentities.remove(identity)
            prune(keeping: desiredIdentities)
        }

        if let prepared = await checkOutPreparedPlayer(for: identity) {
            logPoolWait(result: "hit", url: source.url, startedAt: waitStartedAt)
            return prepared
        }

        guard let preparation = prepareTasks[identity] else {
            desiredIdentities.remove(identity)
            logPoolWait(result: "miss", url: source.url, startedAt: waitStartedAt)
            return nil
        }

        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: waitDuration)

        while clock.now < deadline {
            guard !Task.isCancelled else {
                cancelPreparation(preparation, for: identity)
                desiredIdentities.remove(identity)
                return nil
            }

            if let prepared = await checkOutPreparedPlayer(for: identity) {
                logPoolWait(result: "handoff", url: source.url, startedAt: waitStartedAt)
                return prepared
            }

            guard prepareTasks[identity]?.id == preparation.id else {
                break
            }

            try? await Task.sleep(for: .milliseconds(10))
        }

        if let prepared = await checkOutPreparedPlayer(for: identity) {
            logPoolWait(result: "handoff", url: source.url, startedAt: waitStartedAt)
            return prepared
        }

        cancelPreparation(preparation, for: identity)
        desiredIdentities.remove(identity)
        logPoolWait(result: "timeout", url: source.url, startedAt: waitStartedAt)
        return nil
    }

    func takePreparedPlayer(
        for url: URL,
        waitUpTo waitDuration: Duration = .milliseconds(180)
    ) async -> PreparedPlayer? {
        await takePreparedPlayer(
            for: .urlBacked(url),
            waitUpTo: waitDuration
        )
    }

    func prepare(
        sources: [StoryVideoPlaybackSource],
        activeIdentity: String?
    ) {
        let desiredSources = Self.prioritizedSources(
            sources: sources,
            activeIdentity: activeIdentity,
            limit: maxPreparedPlayers
        )

        var nextDesiredIdentities = Set(desiredSources.map(\.identity))
        if let activeIdentity {
            if preparedPlayers[activeIdentity] != nil || prepareTasks[activeIdentity] != nil {
                // Preserve a player that was warmed immediately before navigation long
                // enough for the active viewer to claim it. It does not consume the
                // adjacent-player budget and is removed by takePreparedPlayer.
                nextDesiredIdentities.insert(activeIdentity)
            }
        }

        desiredIdentities = nextDesiredIdentities
        prune(keeping: desiredIdentities)

        for source in desiredSources {
            let identity = source.identity
            guard activeIdentity != identity,
                  preparedPlayers[identity] == nil,
                  prepareTasks[identity] == nil else {
                continue
            }

            let preparationID = UUID()
            let task = Task { @MainActor [weak self] in
                guard let self else {
                    return
                }

                let prepareInterval = MediaPerformance.beginInterval("video_player_prepared url=\(source.url.lastPathComponent)")
                guard let prepared = await self.playerBuilder(source.url),
                      !Task.isCancelled else {
                    MediaPerformance.cancelInterval(prepareInterval, reason: "failed_or_cancelled")
                    self.finishPreparation(id: preparationID, for: identity)
                    return
                }

                self.finishPreparation(id: preparationID, for: identity)
                guard self.desiredIdentities.contains(identity) || self.acquiringIdentities.contains(identity) else {
                    prepared.player.pause()
                    MediaPerformance.cancelInterval(prepareInterval, reason: "no_longer_adjacent")
                    return
                }

                self.preparedPlayers[identity] = prepared
                MediaPerformance.endInterval(
                    prepareInterval,
                    event: "video_player_prepared preroll=\(prepared.wasPrerolled ? "ready" : "asset_only") url=\(source.url.lastPathComponent)",
                    upload: false
                )
                self.prune(keeping: self.desiredIdentities)
            }
            prepareTasks[identity] = Preparation(id: preparationID, task: task)
        }
    }

    func prepare(urls: [URL], activeURL: URL?) {
        prepare(
            sources: urls.map(StoryVideoPlaybackSource.urlBacked),
            activeIdentity: activeURL.map {
                StoryVideoPlaybackSource.urlBacked($0).identity
            }
        )
    }

    static func prioritizedSources(
        sources: [StoryVideoPlaybackSource],
        activeIdentity: String?,
        limit: Int
    ) -> [StoryVideoPlaybackSource] {
        guard limit > 0 else {
            return []
        }

        var seen = Set<String>()
        var prioritized: [StoryVideoPlaybackSource] = []

        for source in sources {
            guard source.identity != activeIdentity,
                  seen.insert(source.identity).inserted else {
                continue
            }
            prioritized.append(source)
        }

        return Array(prioritized.prefix(limit))
    }

    static func prioritizedURLs(urls: [URL], activeURL: URL?, limit: Int) -> [URL] {
        prioritizedSources(
            sources: urls.map(StoryVideoPlaybackSource.urlBacked),
            activeIdentity: activeURL.map {
                StoryVideoPlaybackSource.urlBacked($0).identity
            },
            limit: limit
        ).map(\.url)
    }

    func removeAll() {
        for preparation in prepareTasks.values {
            preparation.task.cancel()
        }
        prepareTasks.removeAll()

        for prepared in preparedPlayers.values {
            prepared.player.pause()
        }
        preparedPlayers.removeAll()
        desiredIdentities.removeAll()
        acquiringIdentities.removeAll()
    }

    nonisolated static func canonicalURL(for url: URL) -> URL {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url
        }

        components.queryItems = components.queryItems?
            .filter {
                let name = $0.name.lowercased()
                return name != "token" && name != "v"
            }
            .sorted {
                if $0.name == $1.name {
                    return ($0.value ?? "") < ($1.value ?? "")
                }
                return $0.name < $1.name
            }

        return components.url ?? url
    }

    private static func buildPreparedPlayer(for url: URL) async -> PreparedPlayer? {
        let resolved = await resolvePlaybackURL(for: url)
        let asset = AVURLAsset(url: resolved.playbackURL)

        do {
            guard try await asset.load(.isPlayable) else {
                return nil
            }
            _ = try? await asset.load(.duration)
        } catch {
            MediaPerformance.mark("video_player_prepare_failed url=\(url.lastPathComponent)")
            return nil
        }

        let item = AVPlayerItem(asset: asset)
        configureStreamingHints(for: item, playbackURL: resolved.playbackURL)
        item.preferredForwardBufferDuration = 2
        item.canUseNetworkResourcesForLiveStreamingWhilePaused = true

        let player = AVPlayer(playerItem: item)
        player.actionAtItemEnd = .pause
        player.automaticallyWaitsToMinimizeStalling = true
        player.pause()
        let isReadyToPreroll = await waitUntilReadyToPreroll(player: player, item: item)
        let wasPrerolled: Bool
        if isReadyToPreroll, !Task.isCancelled {
            wasPrerolled = await player.preroll(atRate: 1)
            player.pause()
        } else {
            wasPrerolled = false
        }

        return PreparedPlayer(
            player: player,
            playbackURL: resolved.playbackURL,
            cacheState: resolved.cacheState,
            wasPrerolled: wasPrerolled
        )
    }

    static func canPreroll(
        playerStatus: AVPlayer.Status,
        itemStatus: AVPlayerItem.Status
    ) -> Bool {
        playerStatus == .readyToPlay && itemStatus == .readyToPlay
    }

    private static func waitUntilReadyToPreroll(
        player: AVPlayer,
        item: AVPlayerItem,
        timeout: Duration = .seconds(2)
    ) async -> Bool {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: timeout)

        while clock.now < deadline {
            guard !Task.isCancelled else {
                return false
            }

            if player.status == .failed || item.status == .failed {
                return false
            }

            if canPreroll(playerStatus: player.status, itemStatus: item.status) {
                return true
            }

            try? await Task.sleep(for: .milliseconds(25))
        }

        return canPreroll(playerStatus: player.status, itemStatus: item.status)
    }

    private static func resolvePlaybackURL(for url: URL) async -> (playbackURL: URL, cacheState: String) {
        let canPersistVideo = await MediaFileDiskCache.shared.supportsPersistence(url: url, kind: .video)

        if canPersistVideo,
           let cachedPlaybackURL = await MediaFileDiskCache.shared.cachedFileURL(for: url) {
            return (cachedPlaybackURL, "hit")
        }

        return (url, "miss")
    }

    private static func configureStreamingHints(for item: AVPlayerItem, playbackURL: URL) {
        guard playbackURL.pathExtension.lowercased() == "m3u8" else {
            return
        }

        item.preferredPeakBitRate = MediaPlaybackQuality.preferredStreamingPeakBitRate
        item.preferredMaximumResolution = MediaPlaybackQuality.preferredStreamingMaximumResolution
    }

    private func checkOutPreparedPlayer(for identity: String) async -> PreparedPlayer? {
        guard let prepared = preparedPlayers.removeValue(forKey: identity) else {
            return nil
        }

        desiredIdentities.remove(identity)
        prepared.player.pause()
        let currentSeconds = prepared.player.currentTime().seconds
        let didSeek: Bool
        if !currentSeconds.isFinite || abs(currentSeconds) <= 0.001 {
            didSeek = true
        } else {
            didSeek = await Self.seekToStart(prepared.player)
        }

        guard didSeek, !Task.isCancelled else {
            prepared.player.pause()
            MediaPerformance.mark("video_player_pool_seek_failed url=\(prepared.playbackURL.lastPathComponent)")
            return nil
        }

        MediaPerformance.mark(
            "video_player_pool_hit preroll=\(prepared.wasPrerolled ? "ready" : "asset_only") url=\(prepared.playbackURL.lastPathComponent)"
        )
        return prepared
    }

    private static func seekToStart(_ player: AVPlayer) async -> Bool {
        await withCheckedContinuation { continuation in
            let tolerance = CMTime(seconds: 0.1, preferredTimescale: 600)
            player.seek(
                to: .zero,
                toleranceBefore: .zero,
                toleranceAfter: tolerance
            ) { didFinish in
                continuation.resume(returning: didFinish)
            }
        }
    }

    private func finishPreparation(id: UUID, for identity: String) {
        guard prepareTasks[identity]?.id == id else {
            return
        }

        prepareTasks[identity] = nil
    }

    private func cancelPreparation(_ preparation: Preparation, for identity: String) {
        guard prepareTasks[identity]?.id == preparation.id else {
            return
        }

        preparation.task.cancel()
        prepareTasks[identity] = nil
    }

    private func logPoolWait(result: String, url: URL, startedAt: Date) {
        let waitMilliseconds = Int(max(0, Date().timeIntervalSince(startedAt) * 1_000))
        MediaPerformance.mark(
            "video_player_pool_wait result=\(result) wait_ms=\(waitMilliseconds) url=\(url.lastPathComponent)"
        )
    }

    private func prune(keeping desiredSet: Set<String>) {
        let retainedIdentities = desiredSet.union(acquiringIdentities)

        for identity in Array(prepareTasks.keys) where !retainedIdentities.contains(identity) {
            prepareTasks[identity]?.task.cancel()
            prepareTasks[identity] = nil
        }

        for identity in Array(preparedPlayers.keys) where !retainedIdentities.contains(identity) {
            preparedPlayers[identity]?.player.pause()
            preparedPlayers[identity] = nil
        }

        // desiredSet is already bounded to the configured adjacent-player limit,
        // plus at most one transient active player awaiting handoff.
    }
}
