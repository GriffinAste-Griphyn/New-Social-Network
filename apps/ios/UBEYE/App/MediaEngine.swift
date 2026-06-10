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

            let restoredCount = await api.restoreCachedStoryStacks(ids: ids, limit: 4)
            if let cached = await api.cachedStoryStackForDisplay(storyId: storyId) {
                prepare(stack: cached.story, around: 0, activeURL: nil)
            }
            MediaPerformance.mark("media_engine_story_open_warm id=\(storyId) restored=\(restoredCount) candidates=\(ids.count)")
            api.prefetchStoryStacks(ids: ids, refresh: false, limit: 4)
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
        MediaPerformance.mark("media_engine_clear reason=\(reason)")
    }

    private func adjacentVideoUrls(in stack: StoryStack, around itemIndex: Int) -> [URL] {
        let lowerBound = max(itemIndex - 1, 0)
        let upperBound = min(itemIndex + 2, max(stack.items.count - 1, 0))

        guard lowerBound <= upperBound else {
            return []
        }

        return stack.items[lowerBound...upperBound].flatMap { item in
            MediaPlaybackQuality.preloadURLs(for: item)
        }
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
            priorityLimit = 2
        case .next, .previous:
            priorityLimit = 3
        case .visible:
            priorityLimit = 4
        case .background:
            priorityLimit = NetworkQualityMonitor.shared.isConstrained ? 2 : 6
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

    private var preparedPlayers: [URL: PreparedPlayer] = [:]
    private var prepareTasks: [URL: Task<Void, Never>] = [:]
    private let maxPreparedPlayers = 3

    func hasPreparedPlayer(for url: URL) -> Bool {
        preparedPlayers[url] != nil
    }

    func takePreparedPlayer(for url: URL) -> PreparedPlayer? {
        prepareTasks[url]?.cancel()
        prepareTasks[url] = nil

        guard let prepared = preparedPlayers.removeValue(forKey: url) else {
            return nil
        }

        prepared.player.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero)
        MediaPerformance.mark("video_player_pool_hit url=\(url.lastPathComponent)")
        return prepared
    }

    func prepare(urls: [URL], activeURL: URL?) {
        var seen = Set<URL>()
        let desiredUrls = urls
            .filter { seen.insert($0).inserted }
            .filter { $0 != activeURL }
            .prefix(maxPreparedPlayers)

        let desiredSet = Set(desiredUrls)
        prune(keeping: desiredSet)

        for url in desiredUrls where preparedPlayers[url] == nil && prepareTasks[url] == nil {
            prepareTasks[url] = Task { @MainActor [weak self] in
                guard let self else {
                    return
                }

                let prepareInterval = MediaPerformance.beginInterval("video_player_prepared url=\(url.lastPathComponent)")
                guard let prepared = await Self.buildPreparedPlayer(for: url),
                      !Task.isCancelled else {
                    MediaPerformance.cancelInterval(prepareInterval, reason: "failed_or_cancelled")
                    self.prepareTasks[url] = nil
                    return
                }

                self.preparedPlayers[url] = prepared
                self.prepareTasks[url] = nil
                MediaPerformance.endInterval(
                    prepareInterval,
                    event: "video_player_prepared url=\(url.lastPathComponent)",
                    upload: false
                )
                self.prune(keeping: desiredSet)
            }
        }
    }

    func removeAll() {
        for task in prepareTasks.values {
            task.cancel()
        }
        prepareTasks.removeAll()

        for prepared in preparedPlayers.values {
            prepared.player.pause()
        }
        preparedPlayers.removeAll()
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
        item.preferredForwardBufferDuration = resolved.playbackURL.pathExtension.lowercased() == "m3u8" ? 6 : 3

        let player = AVPlayer(playerItem: item)
        player.actionAtItemEnd = .pause
        player.automaticallyWaitsToMinimizeStalling = true
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

    private func prune(keeping desiredSet: Set<URL>) {
        for url in Array(prepareTasks.keys) where !desiredSet.contains(url) {
            prepareTasks[url]?.cancel()
            prepareTasks[url] = nil
        }

        for url in Array(preparedPlayers.keys) where !desiredSet.contains(url) {
            preparedPlayers[url]?.player.pause()
            preparedPlayers[url] = nil
        }

        guard preparedPlayers.count > maxPreparedPlayers else {
            return
        }

        for url in Array(preparedPlayers.keys) where preparedPlayers.count > maxPreparedPlayers {
            preparedPlayers[url]?.player.pause()
            preparedPlayers[url] = nil
        }
    }
}
