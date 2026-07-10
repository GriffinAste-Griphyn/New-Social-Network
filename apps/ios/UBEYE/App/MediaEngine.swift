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
                prepare(stack: cached.story, around: 0, activeURL: nil)
            }
            MediaPerformance.mark("media_engine_story_open_warm id=\(storyId) restored=\(restoredCount) candidates=\(ids.count)")
            api.prefetchStoryStacks(ids: ids, refresh: false, limit: warmLimit)
        }
    }

    func prepare(stack: StoryStack, around index: Int, activeURL: URL?) {
        MediaPreheater.preheat(stack: stack, around: index)
        storyVideoPlaybackPool.prepare(
            urls: adjacentVideoUrls(in: stack, around: index),
            activeURL: activeURL
        )
    }

    func storyViewerDidAppear() {
        idleCleanupTask?.cancel()
        idleCleanupTask = nil
        backgroundPrefetchTask?.cancel()
        backgroundPrefetchTask = nil
    }

    func storyViewerDidDisappear() {
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

    private func adjacentVideoUrls(in stack: StoryStack, around itemIndex: Int) -> [URL] {
        orderedNearbyStoryItems(in: stack, around: itemIndex)
            .filter(\.isPlayableVideo)
            .map(\.playbackMediaUrl)
    }

    private func orderedNearbyStoryItems(in stack: StoryStack, around itemIndex: Int) -> [StoryStackItem] {
        guard stack.items.indices.contains(itemIndex) else {
            return []
        }

        var seen = Set<Int>()
        return [itemIndex, itemIndex + 1, itemIndex - 1]
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
    }

    private struct Preparation {
        let id: UUID
        let task: Task<Void, Never>
    }

    private var preparedPlayers: [URL: PreparedPlayer] = [:]
    private var prepareTasks: [URL: Preparation] = [:]
    private var desiredURLs = Set<URL>()
    private let playerBuilder: (URL) async -> PreparedPlayer?
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
        self.playerBuilder = playerBuilder
        preparedPlayerLimitOverride = max(0, maxPreparedPlayers)
    }

    func takePreparedPlayer(
        for url: URL,
        waitUpTo waitDuration: Duration = .milliseconds(180)
    ) async -> PreparedPlayer? {
        let waitStartedAt = Date()

        if let prepared = await checkOutPreparedPlayer(for: url) {
            logPoolWait(result: "hit", url: url, startedAt: waitStartedAt)
            return prepared
        }

        guard let preparation = prepareTasks[url] else {
            desiredURLs.remove(url)
            logPoolWait(result: "miss", url: url, startedAt: waitStartedAt)
            return nil
        }

        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: waitDuration)

        while clock.now < deadline {
            guard !Task.isCancelled else {
                cancelPreparation(preparation, for: url)
                desiredURLs.remove(url)
                return nil
            }

            if let prepared = await checkOutPreparedPlayer(for: url) {
                logPoolWait(result: "handoff", url: url, startedAt: waitStartedAt)
                return prepared
            }

            guard prepareTasks[url]?.id == preparation.id else {
                break
            }

            try? await Task.sleep(for: .milliseconds(10))
        }

        if let prepared = await checkOutPreparedPlayer(for: url) {
            logPoolWait(result: "handoff", url: url, startedAt: waitStartedAt)
            return prepared
        }

        cancelPreparation(preparation, for: url)
        desiredURLs.remove(url)
        logPoolWait(result: "timeout", url: url, startedAt: waitStartedAt)
        return nil
    }

    func prepare(urls: [URL], activeURL: URL?) {
        let desiredUrls = Self.prioritizedURLs(
            urls: urls,
            activeURL: activeURL,
            limit: maxPreparedPlayers
        )

        var nextDesiredURLs = Set(desiredUrls)
        if let activeURL,
           preparedPlayers[activeURL] != nil || prepareTasks[activeURL] != nil {
            // Preserve a player that was warmed immediately before navigation long
            // enough for the active viewer to claim it. It does not consume the
            // adjacent-player budget and is removed by takePreparedPlayer.
            nextDesiredURLs.insert(activeURL)
        }

        desiredURLs = nextDesiredURLs
        prune(keeping: desiredURLs)

        for url in desiredUrls where url != activeURL && preparedPlayers[url] == nil && prepareTasks[url] == nil {
            let preparationID = UUID()
            let task = Task { @MainActor [weak self] in
                guard let self else {
                    return
                }

                let prepareInterval = MediaPerformance.beginInterval("video_player_prepared url=\(url.lastPathComponent)")
                guard let prepared = await self.playerBuilder(url),
                      !Task.isCancelled else {
                    MediaPerformance.cancelInterval(prepareInterval, reason: "failed_or_cancelled")
                    self.finishPreparation(id: preparationID, for: url)
                    return
                }

                self.finishPreparation(id: preparationID, for: url)
                guard self.desiredURLs.contains(url) else {
                    prepared.player.pause()
                    MediaPerformance.cancelInterval(prepareInterval, reason: "no_longer_adjacent")
                    return
                }

                self.preparedPlayers[url] = prepared
                MediaPerformance.endInterval(
                    prepareInterval,
                    event: "video_player_prepared url=\(url.lastPathComponent)",
                    upload: false
                )
                self.prune(keeping: self.desiredURLs)
            }
            prepareTasks[url] = Preparation(id: preparationID, task: task)
        }
    }

    static func prioritizedURLs(urls: [URL], activeURL: URL?, limit: Int) -> [URL] {
        guard limit > 0 else {
            return []
        }

        var seen = Set<URL>()
        var prioritized: [URL] = []

        for url in urls where url != activeURL && seen.insert(url).inserted {
            prioritized.append(url)
        }

        return Array(prioritized.prefix(limit))
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
        desiredURLs.removeAll()
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
        item.preferredForwardBufferDuration = 3

        let player = AVPlayer(playerItem: item)
        player.actionAtItemEnd = .pause
        player.automaticallyWaitsToMinimizeStalling = true
        // Loading the asset above is enough to warm AVFoundation. Explicit preroll is
        // unsafe until AVPlayer itself reaches readyToPlay and raises an Objective-C
        // exception (which Swift cannot catch) when preparation is still asynchronous.
        player.pause()

        return PreparedPlayer(
            player: player,
            playbackURL: resolved.playbackURL,
            cacheState: resolved.cacheState
        )
    }

    private static func resolvePlaybackURL(for url: URL) async -> (playbackURL: URL, cacheState: String) {
        if url.pathExtension.lowercased() == "m3u8",
           let localPlaybackURL = HLSAssetDownloadCoordinator.shared.localAssetURL(for: url) {
            return (localPlaybackURL, "hls_download")
        }

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

    private func checkOutPreparedPlayer(for url: URL) async -> PreparedPlayer? {
        guard let prepared = preparedPlayers.removeValue(forKey: url) else {
            return nil
        }

        desiredURLs.remove(url)
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
            MediaPerformance.mark("video_player_pool_seek_failed url=\(url.lastPathComponent)")
            return nil
        }

        MediaPerformance.mark("video_player_pool_hit url=\(url.lastPathComponent)")
        return prepared
    }

    private static func seekToStart(_ player: AVPlayer) async -> Bool {
        await withCheckedContinuation { continuation in
            player.seek(
                to: .zero,
                toleranceBefore: .zero,
                toleranceAfter: .zero
            ) { didFinish in
                continuation.resume(returning: didFinish)
            }
        }
    }

    private func finishPreparation(id: UUID, for url: URL) {
        guard prepareTasks[url]?.id == id else {
            return
        }

        prepareTasks[url] = nil
    }

    private func cancelPreparation(_ preparation: Preparation, for url: URL) {
        guard prepareTasks[url]?.id == preparation.id else {
            return
        }

        preparation.task.cancel()
        prepareTasks[url] = nil
    }

    private func logPoolWait(result: String, url: URL, startedAt: Date) {
        let waitMilliseconds = Int(max(0, Date().timeIntervalSince(startedAt) * 1_000))
        MediaPerformance.mark(
            "video_player_pool_wait result=\(result) wait_ms=\(waitMilliseconds) url=\(url.lastPathComponent)"
        )
    }

    private func prune(keeping desiredSet: Set<URL>) {
        for url in Array(prepareTasks.keys) where !desiredSet.contains(url) {
            prepareTasks[url]?.task.cancel()
            prepareTasks[url] = nil
        }

        for url in Array(preparedPlayers.keys) where !desiredSet.contains(url) {
            preparedPlayers[url]?.player.pause()
            preparedPlayers[url] = nil
        }

        // desiredSet is already bounded to the configured adjacent-player limit,
        // plus at most one transient active player awaiting handoff.
    }
}
