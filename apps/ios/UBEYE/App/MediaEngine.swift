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
    private var visibleStackWarmTask: Task<Void, Never>?
    private var offlineHLSPreheatTask: Task<Void, Never>?
    private var memoryWarningObserver: NSObjectProtocol?
    private var lastFeedPreheatKey: String?
    private var lastFeedPreheatAt = Date.distantPast
    private var isStoryViewerActive = false
    private var lastStoryOpenWarm: (id: String, at: Date)?

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

    func updatePredictiveStoryIntent(
        ids: [String],
        api: APIClient,
        direction: DirectionalPrefetchIntent.Direction,
        velocityItemsPerSecond: Double
    ) {
        let uniqueIds = uniqueNonEmptyIds(ids)
        guard !uniqueIds.isEmpty else { return }

        visibleStackWarmTask?.cancel()
        backgroundPrefetchTask?.cancel()
        let mode = UBEYEResourceMonitor.shared.mode
        let limit = min(uniqueIds.count, NetworkQualityMonitor.shared.stackPreheatLimit)
        MediaPerformance.mark(
            "prefetch_intent kind=story direction=\(direction.rawValue) velocity=\(String(format: "%.2f", velocityItemsPerSecond)) count=\(limit) mode=\(mode.rawValue)"
        )

        visibleStackWarmTask = Task { @MainActor [weak self, api] in
            guard let self else { return }
            let candidates = Array(uniqueIds.prefix(limit))
            _ = await api.restoreCachedStoryStacks(ids: candidates, limit: limit)
            guard !Task.isCancelled else { return }
            if mode != .critical {
                await prepareVisibleStoryStacks(ids: candidates, api: api)
            }
            guard !Task.isCancelled else { return }
            api.prefetchStoryStacks(ids: candidates, refresh: false, limit: limit)
            visibleStackWarmTask = nil
        }
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

        visibleStackWarmTask?.cancel()
        visibleStackWarmTask = Task { @MainActor [weak self, api] in
            guard let self else {
                return
            }

            let restoredCount = await api.restoreCachedStoryStacks(ids: uniqueIds, limit: limit)
            guard !Task.isCancelled else {
                return
            }
            MediaPerformance.mark(
                "media_engine_restore_stacks priority=\(priority.rawValue) restored=\(restoredCount) candidates=\(uniqueIds.count)"
            )
            await prepareVisibleStoryStacks(ids: uniqueIds, api: api)
            guard !Task.isCancelled else {
                return
            }
            prefetchStoryStacks(
                ids: uniqueIds,
                api: api,
                priority: priority,
                refresh: refresh,
                limit: limit
            )
            visibleStackWarmTask = nil
        }
    }

    func warmStoryOpen(storyId: String, adjacentIds: [String], api: APIClient) {
        idleCleanupTask?.cancel()

        if let lastStoryOpenWarm,
           lastStoryOpenWarm.id == storyId,
           Date().timeIntervalSince(lastStoryOpenWarm.at) < 0.5 {
            return
        }
        lastStoryOpenWarm = (storyId, Date())

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

    func prepareInitialStoryStacks(
        ids: [String],
        embeddedStacks: [String: StoryStackResponse]?
    ) {
        guard !isStoryViewerActive,
              let embeddedStacks else {
            return
        }

        let playerLimit = min(NetworkQualityMonitor.shared.preparedPlayerLimit, 3)
        guard playerLimit > 0 else {
            return
        }

        let orderedStacks = uniqueNonEmptyIds(ids).compactMap {
            embeddedStacks[$0]?.story
        }
        let sources = Self.initialVideoSources(
            in: orderedStacks,
            limit: playerLimit
        )
        guard !sources.isEmpty else {
            return
        }

        storyVideoPlaybackPool.prepare(sources: sources, activeIdentity: nil)
        scheduleOfflineHLSPreheat(sources: sources)
        MediaPerformance.mark(
            "media_engine_embedded_video_warm candidates=\(sources.count) limit=\(playerLimit)"
        )
    }

    func prepare(
        stack: StoryStack,
        around index: Int,
        activeIdentity: String?,
        promoteActiveIfNeeded: Bool = true
    ) {
        MediaPreheater.preheat(
            stack: stack,
            around: index,
            preheatVideoAssets: false
        )
        let sources = adjacentVideoSources(in: stack, around: index)
        storyVideoPlaybackPool.prepare(
            sources: sources,
            activeIdentity: activeIdentity,
            promoteActiveIfNeeded: promoteActiveIfNeeded
        )
        scheduleOfflineHLSPreheat(
            sources: sources.filter { $0.identity != activeIdentity }
        )
    }

    func storyViewerDidAppear() {
        isStoryViewerActive = true
        idleCleanupTask?.cancel()
        idleCleanupTask = nil
        backgroundPrefetchTask?.cancel()
        backgroundPrefetchTask = nil
        visibleStackWarmTask?.cancel()
        visibleStackWarmTask = nil
        offlineHLSPreheatTask?.cancel()
        offlineHLSPreheatTask = nil
        Task(priority: .utility) {
            await HLSOfflineCache.shared.suspendSpeculativeDownloads()
        }
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
        visibleStackWarmTask?.cancel()
        visibleStackWarmTask = nil
        offlineHLSPreheatTask?.cancel()
        offlineHLSPreheatTask = nil
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

    private func prepareVisibleStoryStacks(ids: [String], api: APIClient) async {
        guard !isStoryViewerActive else {
            return
        }

        let playerLimit = min(NetworkQualityMonitor.shared.preparedPlayerLimit, 3)
        guard playerLimit > 0 else {
            MediaPerformance.mark("media_engine_visible_video_warm disabled")
            return
        }

        var stacks: [StoryStack] = []
        for id in ids {
            guard !Task.isCancelled else {
                return
            }
            if let cached = await api.cachedStoryStackForDisplay(storyId: id) {
                stacks.append(cached.story)
            }
        }

        let sources = Self.initialVideoSources(in: stacks, limit: playerLimit)
        guard !Task.isCancelled, !isStoryViewerActive else {
            return
        }
        guard !sources.isEmpty else {
            MediaPerformance.mark("media_engine_visible_video_warm candidates=0")
            return
        }

        storyVideoPlaybackPool.prepare(sources: sources, activeIdentity: nil)
        scheduleOfflineHLSPreheat(sources: sources)
        MediaPerformance.mark(
            "media_engine_visible_video_warm candidates=\(sources.count) limit=\(playerLimit)"
        )
    }

    private func scheduleOfflineHLSPreheat(
        sources: [StoryVideoPlaybackSource]
    ) {
        guard !sources.isEmpty,
              UBEYEResourceMonitor.shared.mode == .standard else {
            return
        }

        offlineHLSPreheatTask?.cancel()
        offlineHLSPreheatTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(5))
            guard let self,
                  !Task.isCancelled,
                  !isStoryViewerActive else {
                return
            }
            let limit = NetworkQualityMonitor.shared.offlineHLSPreheatLimit
            let maximumAssets = NetworkQualityMonitor.shared.offlineHLSCacheMaxAssets
            guard limit > 0, maximumAssets > 0 else {
                offlineHLSPreheatTask = nil
                return
            }
            await HLSOfflineCache.shared.preheat(
                sources,
                limit: limit,
                policy: .init(maximumAssets: maximumAssets)
            )
            offlineHLSPreheatTask = nil
        }
    }

    static func initialVideoSources(
        in stacks: [StoryStack],
        limit: Int
    ) -> [StoryVideoPlaybackSource] {
        guard limit > 0 else {
            return []
        }

        var seen = Set<String>()
        var sources: [StoryVideoPlaybackSource] = []
        for stack in stacks {
            guard let source = stack.items
                .prefix(3)
                .first(where: \.isPlayableVideo)?
                .playbackSource,
                  seen.insert(source.identity).inserted else {
                continue
            }

            sources.append(source)
            if sources.count == limit {
                break
            }
        }
        return sources
    }

    private func orderedNearbyStoryItems(in stack: StoryStack, around itemIndex: Int) -> [StoryStackItem] {
        guard stack.items.indices.contains(itemIndex) else {
            return []
        }

        let candidates: [Int] = switch UBEYEResourceMonitor.shared.mode {
        case .standard:
            [itemIndex, itemIndex + 1, itemIndex - 1, itemIndex + 2]
        case .constrained:
            [itemIndex, itemIndex + 1]
        case .critical:
            [itemIndex]
        }
        var seen = Set<Int>()
        return candidates
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
    nonisolated static let defaultHandoffWait: Duration = .milliseconds(300)

    struct PreparedPlayer {
        enum HandoffStage: String {
            case staged
            case ready
            case prerolled
        }

        let player: AVPlayer
        let playbackURL: URL
        let cacheState: String
        let wasPrerolled: Bool
        let handoffStage: HandoffStage

        init(
            player: AVPlayer,
            playbackURL: URL,
            cacheState: String,
            wasPrerolled: Bool = false,
            handoffStage: HandoffStage? = nil
        ) {
            self.player = player
            self.playbackURL = playbackURL
            self.cacheState = cacheState
            self.wasPrerolled = wasPrerolled
            self.handoffStage = handoffStage ?? (wasPrerolled ? .prerolled : .ready)
        }
    }

    private struct Preparation {
        let id: UUID
        let task: Task<Void, Never>
    }

    private struct StagedPlayer {
        let preparationID: UUID
        let prepared: PreparedPlayer
    }

    private var preparedPlayers: [String: PreparedPlayer] = [:]
    private var stagedPlayers: [String: StagedPlayer] = [:]
    private var prepareTasks: [String: Preparation] = [:]
    private var desiredIdentities = Set<String>()
    private var acquiringIdentities = Set<String>()
    private let playerBuilder: (
        StoryVideoPlaybackSource,
        @escaping @MainActor (PreparedPlayer) -> Void
    ) async -> PreparedPlayer?
    private let preparedPlayerLimitOverride: Int?
    private var maxPreparedPlayers: Int {
        min(preparedPlayerLimitOverride ?? NetworkQualityMonitor.shared.preparedPlayerLimit, 3)
    }

    init() {
        playerBuilder = Self.buildPreparedPlayer
        preparedPlayerLimitOverride = nil
    }

    init(
        maxPreparedPlayers: Int,
        playerBuilder: @escaping (URL) async -> PreparedPlayer?
    ) {
        self.playerBuilder = { source, _ in
            await playerBuilder(source.url)
        }
        preparedPlayerLimitOverride = max(0, maxPreparedPlayers)
    }

    init(
        maxPreparedPlayers: Int,
        stagedPlayerBuilder: @escaping (
            StoryVideoPlaybackSource,
            @escaping @MainActor (PreparedPlayer) -> Void
        ) async -> PreparedPlayer?
    ) {
        playerBuilder = stagedPlayerBuilder
        preparedPlayerLimitOverride = max(0, maxPreparedPlayers)
    }

    func takePreparedPlayer(
        for source: StoryVideoPlaybackSource,
        waitUpTo waitDuration: Duration = defaultHandoffWait
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

        if let staged = await checkOutStagedPlayer(for: identity) {
            logPoolWait(result: "staged_handoff", url: source.url, startedAt: waitStartedAt)
            return staged
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

            if let staged = await checkOutStagedPlayer(for: identity) {
                logPoolWait(result: "staged_handoff", url: source.url, startedAt: waitStartedAt)
                return staged
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

        if let staged = await checkOutStagedPlayer(for: identity) {
            logPoolWait(result: "staged_handoff", url: source.url, startedAt: waitStartedAt)
            return staged
        }

        // A timed-out preparation must not continue downloading beside the active
        // player's fresh request. That duplicate HLS traffic can starve both players
        // and was the source of intermittent mid-story stalls after rapid navigation.
        cancelPreparation(preparation, for: identity)
        desiredIdentities.remove(identity)
        logPoolWait(result: "timeout_cancelled", url: source.url, startedAt: waitStartedAt)
        return nil
    }

    func takePreparedPlayer(
        for url: URL,
        waitUpTo waitDuration: Duration = defaultHandoffWait
    ) async -> PreparedPlayer? {
        await takePreparedPlayer(
            for: .urlBacked(url),
            waitUpTo: waitDuration
        )
    }

    func prepare(
        sources: [StoryVideoPlaybackSource],
        activeIdentity: String?,
        promoteActiveIfNeeded: Bool = true
    ) {
        let desiredSources = Self.prioritizedSources(
            sources: sources,
            activeIdentity: activeIdentity,
            limit: maxPreparedPlayers
        )

        var nextDesiredIdentities = Set(desiredSources.map(\.identity))
        let promotedActiveSource = promoteActiveIfNeeded
            ? activeIdentity.flatMap { identity in
                sources.first(where: { $0.identity == identity })
            }
            : nil
        if promoteActiveIfNeeded, let activeIdentity {
            if promotedActiveSource != nil ||
                preparedPlayers[activeIdentity] != nil ||
                stagedPlayers[activeIdentity] != nil ||
                prepareTasks[activeIdentity] != nil {
                // Preserve a player that was warmed immediately before navigation long
                // enough for the active viewer to claim it. If launch warming missed,
                // promote the exact active source now. It does not consume the adjacent
                // player budget and is removed by takePreparedPlayer.
                nextDesiredIdentities.insert(activeIdentity)
            }
        }

        desiredIdentities = nextDesiredIdentities
        prune(keeping: desiredIdentities)

        let sourcesToPrepare = ([promotedActiveSource].compactMap { $0 } + desiredSources)
        for source in sourcesToPrepare {
            let identity = source.identity
            guard preparedPlayers[identity] == nil,
                  stagedPlayers[identity] == nil,
                  prepareTasks[identity] == nil else {
                continue
            }

            let preparationID = UUID()
            let task = Task { @MainActor [weak self] in
                guard let self else {
                    return
                }

                let prepareStartedAt = Date()
                let prepareInterval = MediaPerformance.beginInterval("video_player_prepared url=\(source.url.lastPathComponent)")
                let prepared = await self.playerBuilder(source) { [weak self] staged in
                    self?.publishStagedPlayer(
                        staged,
                        for: identity,
                        preparationID: preparationID,
                        startedAt: prepareStartedAt,
                        sourceURL: source.url
                    )
                }
                guard let prepared else {
                    MediaPerformance.cancelInterval(prepareInterval, reason: "failed_or_cancelled")
                    self.finishPreparation(id: preparationID, for: identity)
                    return
                }

                guard !Task.isCancelled,
                      self.prepareTasks[identity]?.id == preparationID else {
                    MediaPerformance.cancelInterval(
                        prepareInterval,
                        reason: "staged_handoff_or_cancelled"
                    )
                    return
                }

                self.finishPreparation(id: preparationID, for: identity)
                self.stagedPlayers[identity] = nil
                guard self.desiredIdentities.contains(identity) || self.acquiringIdentities.contains(identity) else {
                    prepared.player.pause()
                    MediaPerformance.cancelInterval(prepareInterval, reason: "no_longer_adjacent")
                    return
                }

                self.preparedPlayers[identity] = prepared
                MediaPerformance.endInterval(
                    prepareInterval,
                    event: "video_player_prepared preroll=\(prepared.wasPrerolled ? "ready" : "asset_only") url=\(source.url.lastPathComponent)",
                    upload: true
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
        for staged in stagedPlayers.values {
            staged.prepared.player.cancelPendingPrerolls()
            staged.prepared.player.pause()
        }
        stagedPlayers.removeAll()
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
                return name != "token" && name != "v" && name != "clientbandwidthhint"
            }
            .sorted {
                if $0.name == $1.name {
                    return ($0.value ?? "") < ($1.value ?? "")
                }
                return $0.name < $1.name
            }

        return components.url ?? url
    }

    private static func buildPreparedPlayer(
        for source: StoryVideoPlaybackSource,
        onStaged: @escaping @MainActor (PreparedPlayer) -> Void
    ) async -> PreparedPlayer? {
        let resolved = await resolvePlaybackURL(for: source)
        let playbackURL = MediaPlaybackQuality.startupPlaybackURL(
            for: resolved.playbackURL
        )
        let asset = AVURLAsset(url: playbackURL)

        let item = AVPlayerItem(asset: asset)
        configureStreamingHints(for: item, playbackURL: playbackURL)
        item.preferredForwardBufferDuration = NetworkQualityMonitor.shared.preparedForwardBufferDuration
        item.canUseNetworkResourcesForLiveStreamingWhilePaused = true

        let player = AVPlayer(playerItem: item)
        player.actionAtItemEnd = .pause
        player.automaticallyWaitsToMinimizeStalling = true
        player.pause()
        let staged = PreparedPlayer(
            player: player,
            playbackURL: playbackURL,
            cacheState: resolved.cacheState,
            handoffStage: .staged
        )
        onStaged(staged)

        guard !Task.isCancelled else {
            return staged
        }

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
            playbackURL: playbackURL,
            cacheState: resolved.cacheState,
            wasPrerolled: wasPrerolled,
            handoffStage: wasPrerolled ? .prerolled : .ready
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

    private static func resolvePlaybackURL(
        for source: StoryVideoPlaybackSource
    ) async -> (playbackURL: URL, cacheState: String) {
        if let localHLSURL = await HLSOfflineCache.shared.cachedPlaybackURL(for: source) {
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

    private static func configureStreamingHints(for item: AVPlayerItem, playbackURL: URL) {
        MediaPlaybackQuality.applyStreamingHints(
            for: item,
            playbackURL: playbackURL,
            profile: .prepared
        )
    }

    private func checkOutPreparedPlayer(for identity: String) async -> PreparedPlayer? {
        guard let prepared = preparedPlayers.removeValue(forKey: identity) else {
            return nil
        }

        desiredIdentities.remove(identity)
        prepared.player.pause()
        let currentSeconds = prepared.player.currentTime().seconds
        let neededSeek = currentSeconds.isFinite && abs(currentSeconds) > 0.001
        let didSeek: Bool
        if neededSeek {
            didSeek = await Self.seekToStart(prepared.player)
        } else {
            didSeek = true
        }

        guard didSeek, !Task.isCancelled else {
            prepared.player.pause()
            MediaPerformance.mark("video_player_pool_seek_failed url=\(prepared.playbackURL.lastPathComponent)")
            return nil
        }

        MediaPerformance.mark(
            "video_player_pool_hit preroll=\(Self.retainsPreroll(wasPrerolled: prepared.wasPrerolled, neededSeek: neededSeek) ? "ready" : "asset_only") url=\(prepared.playbackURL.lastPathComponent)"
        )
        return PreparedPlayer(
            player: prepared.player,
            playbackURL: prepared.playbackURL,
            cacheState: prepared.cacheState,
            wasPrerolled: Self.retainsPreroll(
                wasPrerolled: prepared.wasPrerolled,
                neededSeek: neededSeek
            ),
            handoffStage: Self.retainsPreroll(
                wasPrerolled: prepared.wasPrerolled,
                neededSeek: neededSeek
            ) ? .prerolled : .ready
        )
    }

    private func checkOutStagedPlayer(for identity: String) async -> PreparedPlayer? {
        guard let staged = stagedPlayers.removeValue(forKey: identity),
              prepareTasks[identity]?.id == staged.preparationID else {
            return nil
        }

        prepareTasks[identity]?.task.cancel()
        prepareTasks[identity] = nil
        desiredIdentities.remove(identity)
        staged.prepared.player.cancelPendingPrerolls()
        staged.prepared.player.pause()
        MediaPerformance.mark(
            "video_player_pool_hit handoff=staged preroll=required url=\(staged.prepared.playbackURL.lastPathComponent)"
        )
        return staged.prepared
    }

    private func publishStagedPlayer(
        _ prepared: PreparedPlayer,
        for identity: String,
        preparationID: UUID,
        startedAt: Date,
        sourceURL: URL
    ) {
        guard prepareTasks[identity]?.id == preparationID,
              desiredIdentities.contains(identity) || acquiringIdentities.contains(identity) else {
            prepared.player.pause()
            return
        }

        stagedPlayers[identity] = StagedPlayer(
            preparationID: preparationID,
            prepared: prepared
        )
        MediaPerformance.measure(
            "video_player_staged url=\(sourceURL.lastPathComponent)",
            since: startedAt
        )
    }

    static func retainsPreroll(wasPrerolled: Bool, neededSeek: Bool) -> Bool {
        wasPrerolled && !neededSeek
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
        stagedPlayers[identity]?.prepared.player.cancelPendingPrerolls()
        stagedPlayers[identity]?.prepared.player.pause()
        stagedPlayers[identity] = nil
    }

    private func logPoolWait(result: String, url: URL, startedAt: Date) {
        let waitMilliseconds = Int(max(0, Date().timeIntervalSince(startedAt) * 1_000))
        MediaPerformance.measure(
            "video_player_pool_wait result=\(result) wait_ms=\(waitMilliseconds) url=\(url.lastPathComponent)",
            since: startedAt
        )
    }

    private func prune(keeping desiredSet: Set<String>) {
        let retainedIdentities = desiredSet.union(acquiringIdentities)

        for identity in Array(prepareTasks.keys) where !retainedIdentities.contains(identity) {
            prepareTasks[identity]?.task.cancel()
            prepareTasks[identity] = nil
        }

        for identity in Array(stagedPlayers.keys) where !retainedIdentities.contains(identity) {
            stagedPlayers[identity]?.prepared.player.cancelPendingPrerolls()
            stagedPlayers[identity]?.prepared.player.pause()
            stagedPlayers[identity] = nil
        }

        for identity in Array(preparedPlayers.keys) where !retainedIdentities.contains(identity) {
            preparedPlayers[identity]?.player.pause()
            preparedPlayers[identity] = nil
        }

        // desiredSet is already bounded to the configured adjacent-player limit,
        // plus at most one transient active player awaiting handoff.
    }
}
