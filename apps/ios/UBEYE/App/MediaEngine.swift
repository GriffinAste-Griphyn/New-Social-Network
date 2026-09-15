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
    private var storyOpenWarmTask: Task<Void, Never>?
    private var storyOpenGeneration = 0
    private var predictiveIntentKey: String?
    private var predictiveIntentAt = Date.distantPast
    private(set) var viewerNavigationDirection = 1
    private var offlineHLSPreheatTask: Task<Void, Never>?
    private var memoryWarningObserver: NSObjectProtocol?
    private var playbackBudgetObserver: NSObjectProtocol?
    private var crossStackWarmTask: Task<Void, Never>?
    private var crossStackGeneration = 0
    private var upcomingStacks: [StoryStack] = []
    private var latestInitialWarmSources: [StoryVideoPlaybackSource] = []
    private var latestViewerIntent: (stack: StoryStack, index: Int, identity: String?)?
    private var lastFeedPreheatKey: String?
    private var lastFeedPreheatAt = Date.distantPast
    private var isStoryViewerActive = false
    private var lastStoryOpenWarm: (id: String, at: Date)?

    init() {
        playbackBudgetObserver = NotificationCenter.default.addObserver(forName: NetworkQualityMonitor.playbackBudgetChanged, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                let budget = NetworkQualityMonitor.shared.workBudget
                if budget.images > 0 {
                    MediaImageCache.shared.resumeSpeculativePreheats()
                } else { MediaImageCache.shared.suspendSpeculativePreheats() }
                if budget.stacks == 0 {
                    self.crossStackWarmTask?.cancel()
                    self.visibleStackWarmTask?.cancel()
                }
                if budget.players == 0 {
                    self.storyVideoPlaybackPool.suspendSpeculativePreparations(activeIdentity: self.latestViewerIntent?.identity)
                }
                if budget.persistentVideos == 0 {
                    Task(priority: .utility) { await MediaVideoPreheater.shared.cancelSpeculativePreheats() }
                }
                if budget.offlineHLS == 0 {
                    self.offlineHLSPreheatTask?.cancel()
                    Task(priority: .utility) { await HLSOfflineCache.shared.suspendSpeculativeDownloads() }
                }
                if !StoryUploadPriority.shared.isUploading, !self.isStoryViewerActive {
                    self.storyVideoPlaybackPool.prepare(sources: self.latestInitialWarmSources, activeIdentity: nil)
                    self.scheduleOfflineHLSPreheat(sources: self.latestInitialWarmSources)
                }
                guard self.isStoryViewerActive, let intent = self.latestViewerIntent else { return }
                self.prepare(stack: intent.stack, around: intent.index, activeIdentity: intent.identity, promoteActiveIfNeeded: false)
            }
        }
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
        storyOpenWarmTask?.cancel()
        visibleStackWarmTask?.cancel()
        backgroundPrefetchTask?.cancel()
        crossStackWarmTask?.cancel()
        offlineHLSPreheatTask?.cancel()
        idleCleanupTask?.cancel()
        if let playbackBudgetObserver { NotificationCenter.default.removeObserver(playbackBudgetObserver) }
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

        guard !isStoryViewerActive, UBEYEResourceMonitor.shared.allowsSpeculativeMedia else { return }
        let limit = min(uniqueIds.count, NetworkQualityMonitor.shared.stackPreheatLimit)
        let candidates = Array(uniqueIds.prefix(limit))
        let key = direction.rawValue + "|" + candidates.joined(separator: "|")
        guard key != predictiveIntentKey || Date().timeIntervalSince(predictiveIntentAt) >= 0.25 else { return }
        predictiveIntentKey = key
        predictiveIntentAt = Date()
        visibleStackWarmTask?.cancel()
        backgroundPrefetchTask?.cancel()
        MediaPerformance.mark("prefetch_intent kind=story direction=\(direction.rawValue) velocity=\(String(format: "%.2f", velocityItemsPerSecond)) count=\(limit)")
        visibleStackWarmTask = Task { @MainActor [weak self, api] in
            guard let self else { return }
            _ = await api.restoreCachedStoryStacks(ids: candidates, limit: limit)
            guard !Task.isCancelled, !isStoryViewerActive,
                  UBEYEResourceMonitor.shared.allowsSpeculativeMedia else { return }
            // Fast scrolling settles before starting network/decoder work; disk restoration remains immediate.
            if velocityItemsPerSecond.isFinite, abs(velocityItemsPerSecond) >= 4 {
                try? await Task.sleep(for: .milliseconds(100))
            }
            guard !Task.isCancelled, !isStoryViewerActive,
                  UBEYEResourceMonitor.shared.allowsSpeculativeMedia else { return }
            await prepareVisibleStoryStacks(ids: candidates, api: api)
            guard !Task.isCancelled, !isStoryViewerActive,
                  UBEYEResourceMonitor.shared.allowsSpeculativeMedia else { return }
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
        guard !isStoryViewerActive, !storyId.isEmpty else { return }
        idleCleanupTask?.cancel()

        if let lastStoryOpenWarm,
           lastStoryOpenWarm.id == storyId,
           Date().timeIntervalSince(lastStoryOpenWarm.at) < 0.5 {
            return
        }
        lastStoryOpenWarm = (storyId, Date())
        warmUpcomingStacks(ids: adjacentIds, api: api)

        let ids = uniqueNonEmptyIds([storyId] + adjacentIds)

        guard !ids.isEmpty else {
            return
        }

        storyOpenWarmTask?.cancel()
        storyOpenGeneration += 1
        let generation = storyOpenGeneration
        storyOpenWarmTask = Task { @MainActor [weak self, api] in
            guard let self else { return }
            let warmLimit = min(NetworkQualityMonitor.shared.stackPreheatLimit, 8)
            let restoredCount = await api.restoreCachedStoryStacks(ids: ids, limit: warmLimit)
            guard !Task.isCancelled, generation == storyOpenGeneration, !isStoryViewerActive else { return }
            let cached = await api.cachedStoryStackForDisplay(storyId: storyId)
            guard !Task.isCancelled, generation == storyOpenGeneration, !isStoryViewerActive else { return }
            if let cached { prepare(stack: cached.story, around: 0, activeIdentity: nil) }
            MediaPerformance.mark("media_engine_story_open_warm id=\(storyId) restored=\(restoredCount) candidates=\(ids.count)")
            api.prefetchStoryStacks(ids: ids, refresh: false, limit: warmLimit)
            storyOpenWarmTask = nil
        }
    }

    func recordViewerNavigation(delta: Int) {
        if delta != 0 { viewerNavigationDirection = delta > 0 ? 1 : -1 }
    }

    // Publish navigation intent before SwiftUI activates the destination. Budget
    // notifications during player attachment must protect the destination, not
    // the player that was visible in the preceding frame.
    func commitViewerIntent(stack: StoryStack, index: Int, activeIdentity: String?) {
        latestViewerIntent = (stack, index, activeIdentity)
    }

    private func cancelStoryOpenWarm() {
        storyOpenWarmTask?.cancel()
        storyOpenWarmTask = nil
        storyOpenGeneration += 1
    }

    func prepareInitialStoryStacks(
        ids: [String],
        embeddedStacks: [String: StoryStackResponse]?
    ) {
        guard !isStoryViewerActive,
              let embeddedStacks else {
            return
        }

        let playerLimit = min(NetworkQualityMonitor.shared.retainedPreparedPlayerLimit, 3)
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

        latestInitialWarmSources = sources
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
        latestViewerIntent = (stack, index, activeIdentity)
        MediaPreheater.preheat(
            stack: stack,
            around: index,
            preheatVideoAssets: false,
            direction: viewerNavigationDirection,
            additionalItems: index >= stack.items.count - 2 ? upcomingStacks.compactMap { $0.items.first } : []
        )
        let sources = Self.viewerVideoSources(stack: stack, around: index, upcomingStacks: upcomingStacks, mode: UBEYEResourceMonitor.shared.mode, direction: viewerNavigationDirection)
        storyVideoPlaybackPool.prepare(
            sources: sources,
            activeIdentity: activeIdentity,
            promoteActiveIfNeeded: promoteActiveIfNeeded
        )
        scheduleOfflineHLSPreheat(
            sources: sources.filter { $0.identity != activeIdentity }
        )
    }

    func storyViewerDidAppear(storyId: String) {
        cancelStoryOpenWarm()
        viewerNavigationDirection = 1
        if lastStoryOpenWarm?.id != storyId {
            upcomingStacks = []
            crossStackWarmTask?.cancel()
            crossStackWarmTask = nil
            crossStackGeneration += 1
        }
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
        cancelStoryOpenWarm()
        lastStoryOpenWarm = nil
        isStoryViewerActive = false
        latestViewerIntent = nil
        crossStackWarmTask?.cancel()
        crossStackWarmTask = nil
        crossStackGeneration += 1
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
        cancelStoryOpenWarm()
        lastStoryOpenWarm = nil
        predictiveIntentKey = nil
        latestViewerIntent = nil
        latestInitialWarmSources = []
        upcomingStacks = []
        crossStackWarmTask?.cancel()
        crossStackWarmTask = nil
        crossStackGeneration += 1
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

    private func warmUpcomingStacks(ids: [String], api: APIClient) {
        crossStackWarmTask?.cancel()
        crossStackGeneration += 1
        let generation = crossStackGeneration
        upcomingStacks = []
        let candidates = Array(uniqueNonEmptyIds(ids).prefix(2))
        guard !candidates.isEmpty, UBEYEResourceMonitor.shared.allowsSpeculativeMedia, !NetworkQualityMonitor.shared.isActivePlaybackBuffering else { return }
        crossStackWarmTask = Task { @MainActor [weak self, api] in
            guard let self else { return }
            for id in candidates {
                guard !Task.isCancelled, generation == crossStackGeneration, UBEYEResourceMonitor.shared.allowsSpeculativeMedia, !NetworkQualityMonitor.shared.isActivePlaybackBuffering else { return }
                let cached = await api.cachedStoryStackForDisplay(storyId: id)
                let response: StoryStackResponse?
                if let cached { response = cached }
                else { response = try? await api.storyStack(storyId: id, refresh: false) }
                guard !Task.isCancelled, generation == crossStackGeneration, UBEYEResourceMonitor.shared.allowsSpeculativeMedia, !NetworkQualityMonitor.shared.isActivePlaybackBuffering else { return }
                if let response { upcomingStacks.append(response.story) }
                if isStoryViewerActive, let intent = latestViewerIntent {
                    prepare(stack: intent.stack, around: intent.index, activeIdentity: intent.identity, promoteActiveIfNeeded: false)
                }
            }
            crossStackWarmTask = nil
        }
    }

    static func viewerVideoSources(stack: StoryStack, around index: Int, upcomingStacks: [StoryStack], mode: UBEYEAdaptiveMode = .standard, direction: Int = 1) -> [StoryVideoPlaybackSource] {
        let indices = StoryWarmOrder.indices(active: index, count: stack.items.count, mode: mode, direction: direction)
        var items = indices.map { stack.items[$0] }
        if mode == .standard, direction >= 0, index >= stack.items.count - 2 {
            // The next creator remains ahead of the opposite-direction fallback.
            let insertion = max(0, items.count - (index > 0 ? 1 : 0))
            items.insert(contentsOf: upcomingStacks.compactMap { $0.items.first(where: \.isPlayableVideo) }, at: insertion)
        }
        return items.filter(\.isPlayableVideo).map(\.playbackSource)
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
        guard !Task.isCancelled, !isStoryViewerActive, UBEYEResourceMonitor.shared.allowsSpeculativeMedia else {
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
            [itemIndex, itemIndex + 1, itemIndex + 2, itemIndex + 3, itemIndex - 1]
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
    static let preparationAvailable = Notification.Name("ubeye.videoPreparationAvailable")
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
        let displaySurface: AspectFitPlayerView
        let preparationMilliseconds: Int

        @MainActor
        init(
            player: AVPlayer,
            playbackURL: URL,
            cacheState: String,
            wasPrerolled: Bool = false,
            handoffStage: HandoffStage? = nil,
            displaySurface: AspectFitPlayerView? = nil,
            preparationMilliseconds: Int = 0
        ) {
            self.player = player
            self.playbackURL = playbackURL
            self.cacheState = cacheState
            self.wasPrerolled = wasPrerolled
            self.handoffStage = handoffStage ?? (wasPrerolled ? .prerolled : .ready)
            self.displaySurface = displaySurface ?? AspectFitPlayerView(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
            self.displaySurface.attach(player)
            self.preparationMilliseconds = preparationMilliseconds
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
    private final class CheckedOutPlayer {
        weak var player: AVPlayer?
        init(_ player: AVPlayer) { self.player = player }
    }
    private var checkedOutPlayers: [String: CheckedOutPlayer] = [:]
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
        waitUpTo waitDuration: Duration = defaultHandoffWait,
        completedOnly: Bool = false
    ) async -> PreparedPlayer? {
        if completedOnly { return await checkOutPreparedPlayer(for: source.identity) }
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

    private func hasCheckedOutPlayer(for identity: String) -> Bool {
        if let player = checkedOutPlayers[identity]?.player, player.currentItem != nil { return true }
        checkedOutPlayers[identity] = nil
        return false
    }

    func hasPreparation(for identity: String) -> Bool {
        preparedPlayers[identity] != nil || stagedPlayers[identity] != nil || prepareTasks[identity] != nil
    }

    func suspendSpeculativePreparations(activeIdentity: String?) {
        for identity in Array(prepareTasks.keys) where identity != activeIdentity && !acquiringIdentities.contains(identity) {
            if let preparation = prepareTasks[identity] { cancelPreparation(preparation, for: identity) }
        }
    }

    func prepare(
        sources: [StoryVideoPlaybackSource],
        activeIdentity: String?,
        promoteActiveIfNeeded: Bool = true,
        suspendNewWork: Bool = false
    ) {
        checkedOutPlayers = checkedOutPlayers.filter { $0.value.player?.currentItem != nil }
        let desiredSources = Self.prioritizedSources(
            sources: sources,
            activeIdentity: activeIdentity,
            limit: preparedPlayerLimitOverride.map { min($0, 3) } ?? NetworkQualityMonitor.shared.retainedPreparedPlayerLimit
        )
        let suspendsNewWork = suspendNewWork || maxPreparedPlayers == 0
        let preparationIdentities = Set(desiredSources.prefix(suspendsNewWork ? 0 : maxPreparedPlayers).map(\.identity))

        var nextDesiredIdentities = Set(desiredSources.map(\.identity))
        let promotedActiveSource = promoteActiveIfNeeded
            ? activeIdentity.flatMap { identity in
                sources.first(where: { $0.identity == identity })
            }
            : nil
        if let activeIdentity {
            if promotedActiveSource != nil ||
                preparedPlayers[activeIdentity] != nil ||
                stagedPlayers[activeIdentity] != nil ||
                prepareTasks[activeIdentity] != nil {
                // Retaining an existing destination is independent of permission to
                // start a new active preparation. Visibility/budget observers can run
                // before the destination controller checks out its staged player.
                // Preserve a player that was warmed immediately before navigation long
                // enough for the active viewer to claim it. If launch warming missed,
                // promote the exact active source now. It does not consume the adjacent
                // player budget and is removed by takePreparedPlayer.
                nextDesiredIdentities.insert(activeIdentity)
            }
        }

        desiredIdentities = nextDesiredIdentities
        prune(keeping: desiredIdentities)
        // Keep completed players, but cancel speculative work outside the current
        // start budget. A one-player upload budget must not start three retained slots.
        for identity in Array(prepareTasks.keys) where identity != activeIdentity &&
            !acquiringIdentities.contains(identity) && !preparationIdentities.contains(identity) {
            if let preparation = prepareTasks[identity] { cancelPreparation(preparation, for: identity) }
        }

        let sourcesToPrepare = ([promotedActiveSource].compactMap { $0 } + desiredSources)
        for source in sourcesToPrepare {
            let identity = source.identity
            guard identity == activeIdentity || preparationIdentities.contains(identity) else { continue }
            guard !hasCheckedOutPlayer(for: identity),
                  preparedPlayers[identity] == nil,
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
                    if self.checkedOutPlayers[identity]?.player !== prepared.player {
                        prepared.player.cancelPendingPrerolls()
                        prepared.player.pause()
                        prepared.player.replaceCurrentItem(with: nil)
                        prepared.displaySurface.attach(nil)
                    }
                    MediaPerformance.cancelInterval(
                        prepareInterval,
                        reason: "staged_handoff_or_cancelled"
                    )
                    return
                }

                self.finishPreparation(id: preparationID, for: identity)
                self.stagedPlayers[identity] = nil
                guard self.desiredIdentities.contains(identity) || self.acquiringIdentities.contains(identity) else {
                    prepared.player.cancelPendingPrerolls()
                    prepared.player.pause()
                    prepared.player.replaceCurrentItem(with: nil)
                    MediaPerformance.cancelInterval(prepareInterval, reason: "no_longer_adjacent")
                    return
                }

                self.preparedPlayers[identity] = prepared
                NotificationCenter.default.post(name: Self.preparationAvailable, object: self, userInfo: ["identity": identity])
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
            prepared.player.cancelPendingPrerolls()
            prepared.player.pause()
            prepared.player.replaceCurrentItem(with: nil)
        }
        preparedPlayers.removeAll()
        for staged in stagedPlayers.values {
            staged.prepared.player.cancelPendingPrerolls()
            staged.prepared.player.pause()
            staged.prepared.player.replaceCurrentItem(with: nil)
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
        let preparationStartedAt = Date()
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
        if #available(iOS 26.0, *) { player.networkResourcePriority = .low }
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
            let completed = await player.preroll(atRate: 1)
            player.pause()
            if let target = ExactVideoQualityPolicy.target(in: playbackURL) {
                let buffered = item.loadedTimeRanges.map(\.timeRangeValue).filter {
                    $0.start.seconds <= 0.05
                }.map { $0.start.seconds + $0.duration.seconds }.max() ?? 0
                wasPrerolled = completed && ExactVideoQualityPolicy.isReady(size: item.presentationSize,
                    target: target, sourceWidth: source.pixelWidth, sourceHeight: source.pixelHeight,
                    buffered: buffered, remaining: source.durationSeconds)
            } else { wasPrerolled = completed }
        } else {
            wasPrerolled = false
        }

        return PreparedPlayer(
            player: player,
            playbackURL: playbackURL,
            cacheState: resolved.cacheState,
            wasPrerolled: wasPrerolled,
            handoffStage: wasPrerolled ? .prerolled : .ready,
            displaySurface: staged.displaySurface,
            preparationMilliseconds: Int(max(0, Date().timeIntervalSince(preparationStartedAt) * 1_000))
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
        checkedOutPlayers[identity] = CheckedOutPlayer(prepared.player)
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
            prepared.player.replaceCurrentItem(with: nil)
            prepared.displaySurface.attach(nil)
            checkedOutPlayers[identity] = nil
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
            ) ? .prerolled : .ready,
            displaySurface: prepared.displaySurface,
            preparationMilliseconds: prepared.preparationMilliseconds
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
        checkedOutPlayers[identity] = CheckedOutPlayer(staged.prepared.player)
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
        stagedPlayers[identity]?.prepared.player.replaceCurrentItem(with: nil)
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
            stagedPlayers[identity]?.prepared.player.replaceCurrentItem(with: nil)
            stagedPlayers[identity] = nil
        }

        for identity in Array(preparedPlayers.keys) where !retainedIdentities.contains(identity) {
            preparedPlayers[identity]?.player.cancelPendingPrerolls()
            preparedPlayers[identity]?.player.pause()
            preparedPlayers[identity]?.player.replaceCurrentItem(with: nil)
            preparedPlayers[identity] = nil
        }

        // desiredSet is already bounded to the configured adjacent-player limit,
        // plus at most one transient active player awaiting handoff.
    }
}
