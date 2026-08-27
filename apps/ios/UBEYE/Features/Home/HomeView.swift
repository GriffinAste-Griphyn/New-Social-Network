import SwiftUI

enum HomeFeedMediaPresentationPolicy {
    static let visibleFollowingThumbnailCount = 2
    static let visibleDiscoverThumbnailCount = 2

    static func requiredThumbnailURLs(for feed: MobileFeedResponse) -> [URL] {
        requiredThumbnailURLs(
            myStoryURL: feed.myStory.latestThumbnailUrl,
            followingURLs: feed.followingStories.map { $0.playbackThumbnailUrl ?? $0.playbackMediaUrl },
            discoverURLs: feed.discoverTiles.map { $0.thumbnailUrl ?? $0.imageUrl }
        )
    }

    static func requiredThumbnailURLs(
        myStoryURL: URL?,
        followingURLs: [URL?],
        discoverURLs: [URL?]
    ) -> [URL] {
        let candidates = [myStoryURL]
            + Array(followingURLs.prefix(visibleFollowingThumbnailCount))
            + Array(discoverURLs.prefix(visibleDiscoverThumbnailCount))
        var seen = Set<URL>()
        return candidates.compactMap { $0 }.filter { seen.insert($0).inserted }
    }
}

enum FeedMediaCommitPolicy {
    enum Decision: Equatable {
        case commit
        case deferUntilReady
    }

    static func decision(
        hasPresentedFeed: Bool,
        preparation: MediaImagePreparationResult
    ) -> Decision {
        if preparation.isComplete || !hasPresentedFeed {
            return .commit
        }
        return .deferUntilReady
    }
}

@MainActor
final class FeedStore: ObservableObject {
    @Published var feed: MobileFeedResponse?
    @Published var isLoading = false
    @Published private(set) var isLoadingNextPage = false
    @Published var error: String?
    @Published private(set) var refreshError: String?
    @Published private(set) var nextPageError: String?
    @Published private(set) var authenticationFailed = false
    private var storyStackPrefetchTask: Task<Void, Never>?
    private var lastNetworkLoadAt: Date?
    private var uploadedStoryOverrides: [StoryUploadResponse] = []
    private let foregroundRefreshCooldown: TimeInterval = 45
    private let diskMediaPreparationTimeout: Duration = .milliseconds(700)
    private let networkMediaPreparationTimeout: Duration = .milliseconds(1_200)
    private let deferredMediaPreparationTimeout: Duration = .seconds(20)
    private var loadGeneration = 0
    private var deferredFeedCommitTask: Task<Void, Never>?

    func load(
        api: APIClient,
        mediaEngine: MediaEngine,
        showsLoading: Bool = true,
        useDiskCache: Bool = true
    ) async {
        loadGeneration &+= 1
        let generation = loadGeneration
        deferredFeedCommitTask?.cancel()
        deferredFeedCommitTask = nil

        if showsLoading, feed == nil {
            isLoading = true
        }
        error = nil
        refreshError = nil
        authenticationFailed = false
        var cachedFallback: MobileFeedResponse?

        let restoreInterval = useDiskCache && feed == nil
            ? MediaPerformance.beginInterval("feed_disk_restore source=disk")
            : nil
        if useDiskCache, feed == nil, let cached = await api.cachedMobileFeed(allowExpired: true) {
            let candidate = feedApplyingUploadedStoryOverrides(to: cached)
            cachedFallback = candidate
            let preparation = await prepareForPresentation(
                candidate,
                source: "disk",
                timeout: diskMediaPreparationTimeout
            )
            guard isCurrentLoad(generation) else {
                return
            }

            let cachedStoryIds = storyStackPrefetchIds(from: candidate)
            mediaEngine.prepareInitialStoryStacks(
                ids: cachedStoryIds,
                embeddedStacks: candidate.initialStoryStacks
            )

            if preparation.isComplete {
                commitFeed(candidate, source: "disk", preparation: preparation)
                if let restoreInterval {
                    MediaPerformance.endInterval(restoreInterval, event: "feed_disk_restore source=disk")
                }
                mediaEngine.preheat(feed: candidate, priority: .visible)
                let storyIds = storyStackPrefetchIds(from: candidate)
                restoreInitialStoryStacks(ids: storyIds, api: api, mediaEngine: mediaEngine, refresh: false)
            } else {
                if let restoreInterval {
                    MediaPerformance.cancelInterval(restoreInterval, reason: "media_not_ready")
                }
                MediaPerformance.mark(
                    "feed_media_deferred source=disk ready=\(preparation.readyCount) requested=\(preparation.requestedCount)"
                )
            }
        } else if let restoreInterval {
            MediaPerformance.cancelInterval(restoreInterval, reason: "miss")
        }

        let networkInterval = MediaPerformance.beginInterval("feed_load source=network")
        do {
            let response = try await api.mobileFeed()
            guard isCurrentLoad(generation) else {
                return
            }
            lastNetworkLoadAt = Date()
            let candidate = feedApplyingUploadedStoryOverrides(to: response)
            let responseStoryIds = storyStackPrefetchIds(from: candidate)
            mediaEngine.prepareInitialStoryStacks(
                ids: responseStoryIds,
                embeddedStacks: candidate.initialStoryStacks
            )

            let preparation = await prepareForPresentation(
                candidate,
                source: "network",
                timeout: networkMediaPreparationTimeout
            )
            guard isCurrentLoad(generation) else {
                return
            }

            if FeedMediaCommitPolicy.decision(
                hasPresentedFeed: feed != nil,
                preparation: preparation
            ) == .commit {
                commitFeed(candidate, source: "network", preparation: preparation)
                mediaEngine.preheat(feed: candidate, priority: .visible)
            } else {
                MediaPerformance.mark(
                    "feed_media_deferred source=network ready=\(preparation.readyCount) requested=\(preparation.requestedCount)"
                )
                scheduleDeferredFeedCommit(
                    candidate,
                    generation: generation,
                    mediaEngine: mediaEngine
                )
            }
            MediaPerformance.endInterval(networkInterval, event: "feed_load source=network")
            restoreInitialStoryStacks(
                ids: storyStackPrefetchIds(from: candidate),
                api: api,
                mediaEngine: mediaEngine,
                refresh: true
            )
            scheduleStoryStackPrefetch(
                ids: storyStackPrefetchIds(from: candidate),
                api: api,
                mediaEngine: mediaEngine,
                refresh: true
            )
        } catch {
            guard isCurrentLoad(generation) else {
                return
            }
            MediaPerformance.cancelInterval(networkInterval, reason: "failed")
            if let statusCode = (error as? APIClientError)?.statusCode {
                authenticationFailed = statusCode == 401 || statusCode == 403
            }
            if feed == nil, let cachedFallback {
                let preparation = await prepareForPresentation(
                    cachedFallback,
                    source: "disk_fallback",
                    timeout: .milliseconds(300)
                )
                guard isCurrentLoad(generation) else {
                    return
                }
                commitFeed(cachedFallback, source: "disk_fallback", preparation: preparation)
                mediaEngine.preheat(feed: cachedFallback, priority: .visible)
            } else if feed == nil {
                self.error = error.localizedDescription
            } else {
                MediaPerformance.mark("feed_refresh_failed")
                refreshError = error.localizedDescription
            }
        }
        if showsLoading, isCurrentLoad(generation) {
            isLoading = false
        }
    }

    func refreshIfStale(api: APIClient, mediaEngine: MediaEngine) async {
        guard shouldRefreshAfterForeground else {
            if let feed {
                restoreInitialStoryStacks(
                    ids: storyStackPrefetchIds(from: feed),
                    api: api,
                    mediaEngine: mediaEngine,
                    refresh: false
                )
            }
            return
        }

        await load(api: api, mediaEngine: mediaEngine, showsLoading: false, useDiskCache: false)
    }

    func loadNextPage(api: APIClient, mediaEngine: MediaEngine) async {
        guard !isLoadingNextPage,
              let current = feed,
              let cursor = current.nextCursor,
              !cursor.isEmpty else {
            return
        }

        isLoadingNextPage = true
        nextPageError = nil
        defer { isLoadingNextPage = false }

        do {
            let page = try await api.mobileFeed(cursor: cursor)
            let existingStories = current.followingTimelineStories ?? current.followingStories
            let existingIds = Set(existingStories.map(\.id))
            let appendedStories = page.verticalFollowingStories.filter { !existingIds.contains($0.id) }
            let mergedStories = existingStories + appendedStories

            feed = MobileFeedResponse(
                ok: current.ok,
                session: current.session,
                followingProfiles: current.followingProfiles,
                followingStories: current.followingStories,
                followingTimelineStories: mergedStories,
                nextCursor: page.nextCursor,
                discoverTiles: current.discoverTiles,
                initialStoryStacks: current.initialStoryStacks,
                suggestedAccounts: current.suggestedAccounts,
                myStory: current.myStory
            )
            appendedStories.forEach { story in
                mediaEngine.prefetchStoryStacks(
                    ids: [story.id],
                    api: api,
                    priority: .background,
                    limit: 1
                )
            }
        } catch {
            MediaPerformance.mark("feed_refresh_failed source=next_page")
            nextPageError = error.localizedDescription
        }
    }

    func warmStoryOpen(storyId: String, in feed: MobileFeedResponse, api: APIClient, mediaEngine: MediaEngine) {
        let ids = storyStackPrefetchIds(from: feed)
        let adjacentIds = adjacentStoryIds(to: storyId, in: ids)
        mediaEngine.warmStoryOpen(storyId: storyId, adjacentIds: adjacentIds, api: api)
    }

    func registerUploadedStory(_ response: StoryUploadResponse) {
        saveUploadedStoryOverride(response)
        guard let current = feed else {
            return
        }

        feed = feedWithUploadedStory(response, in: current)
    }

    private func saveUploadedStoryOverride(_ response: StoryUploadResponse) {
        uploadedStoryOverrides.removeAll { $0.storyId == response.storyId }
        uploadedStoryOverrides.append(response)
    }

    private func feedApplyingUploadedStoryOverrides(to current: MobileFeedResponse) -> MobileFeedResponse {
        guard !uploadedStoryOverrides.isEmpty else {
            return current
        }

        let resolvedStoryIds = Set(
            current.myStory.items.compactMap { story in
                story.isProcessingVideo ? nil : story.id
            }
        )
        uploadedStoryOverrides.removeAll { response in
            resolvedStoryIds.contains(response.storyId)
        }

        return uploadedStoryOverrides.reduce(current) { partialFeed, response in
            feedWithUploadedStory(response, in: partialFeed)
        }
    }

    private func prepareForPresentation(
        _ candidate: MobileFeedResponse,
        source: String,
        timeout: Duration
    ) async -> MediaImagePreparationResult {
        let urls = HomeFeedMediaPresentationPolicy.requiredThumbnailURLs(for: candidate)
        let interval = MediaPerformance.beginInterval("feed_media_preparation source=\(source)")
        let result = await MediaImageCache.shared.prepareForPresentation(urls, timeout: timeout)
        MediaPerformance.endInterval(
            interval,
            event: "feed_media_preparation source=\(source) ready=\(result.readyCount) requested=\(result.requestedCount) timed_out=\(result.timedOut)"
        )
        return result
    }

    private func commitFeed(
        _ candidate: MobileFeedResponse,
        source: String,
        preparation: MediaImagePreparationResult
    ) {
        let isInitialCommit = feed == nil
        withTransaction(Transaction(animation: nil)) {
            feed = candidate
        }
        MediaPerformance.mark(
            "feed_media_commit source=\(source) initial=\(isInitialCommit) ready=\(preparation.readyCount) requested=\(preparation.requestedCount)"
        )
    }

    private func scheduleDeferredFeedCommit(
        _ candidate: MobileFeedResponse,
        generation: Int,
        mediaEngine: MediaEngine
    ) {
        deferredFeedCommitTask?.cancel()
        deferredFeedCommitTask = Task { @MainActor [weak self, mediaEngine] in
            guard let self else {
                return
            }

            let preparation = await prepareForPresentation(
                candidate,
                source: "network_deferred",
                timeout: deferredMediaPreparationTimeout
            )
            guard !Task.isCancelled, isCurrentLoad(generation), preparation.isComplete else {
                return
            }

            let resolvedCandidate = feedApplyingUploadedStoryOverrides(to: candidate)
            commitFeed(resolvedCandidate, source: "network_deferred", preparation: preparation)
            mediaEngine.preheat(feed: resolvedCandidate, priority: .visible)
            deferredFeedCommitTask = nil
        }
    }

    private func isCurrentLoad(_ generation: Int) -> Bool {
        !Task.isCancelled && loadGeneration == generation
    }

    func markUploadedStoryLive(_ storyId: String) {
        uploadedStoryOverrides.removeAll { $0.storyId == storyId }
    }

    private func feedWithUploadedStory(_ response: StoryUploadResponse, in current: MobileFeedResponse) -> MobileFeedResponse {
        let thumbnailUrl =
            response.asset.renditions?.playback.thumbnailUrl ??
            response.asset.thumbnailUrl ??
            (response.asset.assetKind == .image ? response.asset.renditions?.playback.mediaUrl ?? response.asset.mediaUrl : nil)
        if let thumbnailUrl {
            MediaImageCache.shared.preheat([thumbnailUrl], limit: 1)
        }

        let pendingStory = StoryCard(
            id: response.storyId,
            creator: current.myStory.owner.name,
            handle: current.myStory.owner.handle,
            assetKind: response.asset.assetKind,
            mediaUrl: response.asset.renditions?.playback.mediaUrl ?? response.asset.mediaUrl,
            thumbnailUrl: thumbnailUrl,
            placeholderUrl: response.asset.renditions?.playback.placeholderUrl ?? response.asset.placeholderUrl ?? thumbnailUrl,
            renditions: response.asset.renditions,
            title: response.asset.assetKind == .video && response.processingStatus != "ready"
                ? "Video processing"
                : "Story",
            processingStatus: response.processingStatus,
            textOverlays: response.textOverlays ?? [],
            durationSeconds: response.asset.assetKind == .video ? 10 : nil,
            lastUploadedAt: nil,
            progressPercent: nil,
            timelineSegmentCount: nil
        )
        let myStoryItems = (current.myStory.items.filter { $0.id != response.storyId } + [pendingStory])
        let myStory = MyStorySummary(
            owner: current.myStory.owner,
            hasActiveStory: true,
            liveCount: max(current.myStory.liveCount, myStoryItems.count),
            latestThumbnailUrl: thumbnailUrl,
            latestAssetKind: response.asset.assetKind,
            latestTextOverlays: response.textOverlays ?? [],
            expiresSoonLabel: current.myStory.expiresSoonLabel,
            items: myStoryItems
        )

        return MobileFeedResponse(
            ok: current.ok,
            session: current.session,
            followingProfiles: current.followingProfiles,
            followingStories: current.followingStories,
            followingTimelineStories: current.followingTimelineStories,
            nextCursor: current.nextCursor,
            discoverTiles: current.discoverTiles,
            initialStoryStacks: current.initialStoryStacks,
            suggestedAccounts: current.suggestedAccounts,
            myStory: myStory
        )
    }

    private var shouldRefreshAfterForeground: Bool {
        guard let lastNetworkLoadAt else {
            return true
        }

        return Date().timeIntervalSince(lastNetworkLoadAt) >= foregroundRefreshCooldown
    }

    private func storyStackPrefetchIds(from feed: MobileFeedResponse) -> [String] {
        var ids: [String] = []

        if feed.myStory.hasActiveStory {
            ids.append("my-story")
        }

        ids.append(contentsOf: feed.verticalFollowingStories.prefix(8).map(\.id))
        ids.append(contentsOf: feed.discoverTiles.prefix(8).map { $0.activeStoryId ?? $0.id })

        return ids
    }

    private func restoreInitialStoryStacks(ids: [String], api: APIClient, mediaEngine: MediaEngine, refresh: Bool) {
        let initialIds = Array(ids.prefix(4))
        guard !initialIds.isEmpty else {
            return
        }

        mediaEngine.restoreAndPrefetchStoryStacks(
            ids: initialIds,
            api: api,
            priority: .visible,
            refresh: refresh,
            limit: 4
        )
    }

    private func scheduleStoryStackPrefetch(ids: [String], api: APIClient, mediaEngine: MediaEngine, refresh: Bool) {
        storyStackPrefetchTask?.cancel()
        storyStackPrefetchTask = Task { @MainActor [weak self, api, mediaEngine] in
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else {
                return
            }

            mediaEngine.prefetchStoryStacks(
                ids: ids,
                api: api,
                priority: .background,
                refresh: refresh
            )
            self?.storyStackPrefetchTask = nil
        }
    }

    private func adjacentStoryIds(to storyId: String, in ids: [String]) -> [String] {
        guard let index = ids.firstIndex(of: storyId) else {
            return Array(ids.prefix(3).filter { $0 != storyId })
        }

        var seen = Set<Int>()
        return [index + 1, index - 1, index + 2]
            .filter { candidate in
                ids.indices.contains(candidate) && seen.insert(candidate).inserted
            }
            .map { ids[$0] }
    }

    func removeDeletedStory(_ storyId: String) {
        uploadedStoryOverrides.removeAll { $0.storyId == storyId }

        guard let current = feed else {
            return
        }

        let followingStories = current.followingStories.filter { $0.id != storyId }
        let followingTimelineStories = current.followingTimelineStories?.filter { $0.id != storyId }
        let discoverTiles = current.discoverTiles.filter { tile in
            tile.id != storyId && tile.activeStoryId != storyId
        }
        let initialStoryStacks = current.initialStoryStacks?.filter { key, response in
            key != storyId && !response.story.items.contains { $0.id == storyId }
        }
        let myStoryItems = current.myStory.items.filter { $0.id != storyId }
        let myStoryWasDeleted = myStoryItems.count != current.myStory.items.count
        let latestMyStoryItem = myStoryItems.last
        let myStory = myStoryWasDeleted
            ? MyStorySummary(
                owner: current.myStory.owner,
                hasActiveStory: !myStoryItems.isEmpty,
                liveCount: myStoryItems.count,
            latestThumbnailUrl: latestMyStoryItem.flatMap {
                    $0.assetKind == .image ? $0.playbackMediaUrl : $0.playbackThumbnailUrl
                },
                latestAssetKind: latestMyStoryItem?.assetKind,
                latestTextOverlays: latestMyStoryItem?.textOverlays ?? [],
                expiresSoonLabel: myStoryItems.isEmpty ? nil : current.myStory.expiresSoonLabel,
                items: myStoryItems
            )
            : current.myStory

        feed = MobileFeedResponse(
            ok: current.ok,
            session: current.session,
            followingProfiles: current.followingProfiles,
            followingStories: followingStories,
            followingTimelineStories: followingTimelineStories,
            nextCursor: current.nextCursor,
            discoverTiles: discoverTiles,
            initialStoryStacks: initialStoryStacks,
            suggestedAccounts: current.suggestedAccounts,
            myStory: myStory
        )
    }
}

struct HomeView: View {
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var mediaEngine: MediaEngine
    @EnvironmentObject private var pendingStoryUploads: PendingStoryUploadStore
    @EnvironmentObject private var storyUploadNotice: StoryUploadNoticeStore
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject private var resourceMonitor = UBEYEResourceMonitor.shared
    var uploadedStoryRegistrations: [StoryUploadResponse] = []
    var onSearchTap: () -> Void = {}
    var onDiscoverTap: () -> Void = {}
    var onPendingUploadRetried: (StoryUploadResponse) -> Void = { _ in }
    @StateObject private var store = FeedStore()
    @State private var selectedStory: StoryRoute?
    @State private var selectedDiscoverCreator: DiscoverCreator?
    @State private var selectedFailedUpload: PendingStoryUpload?
    @State private var navigationPath = NavigationPath()
    @State private var followingPrefetchTracker = DirectionalPrefetchTracker()
    @State private var discoverPrefetchTracker = DirectionalPrefetchTracker()
    @SceneStorage("ubeye.home-scroll-anchor") private var homeScrollAnchor: String?

    var body: some View {
        NavigationStack(path: $navigationPath) {
            ScrollViewReader { scrollProxy in
                ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header
                        .id("home-feed-top")

                    uploadNoticeBanner

                    if let refreshError = store.refreshError, store.feed != nil {
                        InlineNotice(message: "Couldn’t refresh. \(refreshError)", isError: true)
                    }

                    if store.isLoading && store.feed == nil {
                        HomeFeedLoadingSkeleton()
                    } else if let error = store.error, store.feed == nil {
                        EmptyStateView(title: "Could not load stories", message: error, systemImage: "wifi.exclamationmark")
                    }

                    if let feed = store.feed {
                        let displayFeed = pendingStoryUploads.feedByMergingPendingUploads(into: feed)

                        followingStoriesSection(displayFeed)
                            .id("home-following")

                        discoverSection(displayFeed)
                            .id("home-discover")
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .padding(.bottom, 104)
                .scrollTargetLayout()
            }
            .scrollPosition(id: $homeScrollAnchor, anchor: .top)
            .refreshable {
                await store.load(api: api, mediaEngine: mediaEngine, useDiskCache: false)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .ubeyeScreen()
            .onChange(of: pendingUploadFailureKey, initial: true) { _, failureKey in
                guard failureKey != nil,
                      let upload = pendingStoryUploads.latestVisibleUpload,
                      upload.isFailed else {
                    return
                }

                storyUploadNotice.showFailed(message: upload.displayErrorMessage)
            }
            .task {
                await store.load(api: api, mediaEngine: mediaEngine)
            }
            .onChange(of: store.authenticationFailed) { _, authenticationFailed in
                guard authenticationFailed else {
                    return
                }

                auth.handleAuthenticationFailure(api: api)
            }
            .task(id: uploadedStoryRegistrationKey) {
                applyUploadedStoryRegistrations()
            }
            .onReceive(NotificationCenter.default.publisher(for: .followingQueueDidChange)) { _ in
                Task {
                    api.invalidateStoryStacks()
                    await store.load(api: api, mediaEngine: mediaEngine, useDiskCache: false)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .storyUploadDidRegister)) { notification in
                guard let response = notification.object as? StoryUploadResponse else {
                    return
                }

                store.registerUploadedStory(response)
                if response.processingStatus == "ready" {
                    Task {
                        await store.load(api: api, mediaEngine: mediaEngine, showsLoading: false, useDiskCache: false)
                    }
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .storyUploadDidComplete)) { notification in
                if let storyId = notification.object as? String {
                    store.markUploadedStoryLive(storyId)
                }

                Task {
                    api.invalidateStoryStacks(ids: ["my-story"])
                    await store.load(api: api, mediaEngine: mediaEngine, useDiskCache: false)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .storyDidDelete)) { notification in
                let storyId = notification.object as? String
                if let storyId {
                    store.removeDeletedStory(storyId)
                }

                Task {
                    api.invalidateMobileFeedCache()
                    api.invalidateStoryStacks(ids: ["my-story"] + [storyId].compactMap { $0 })
                    await store.load(api: api, mediaEngine: mediaEngine, showsLoading: false, useDiskCache: false)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .appTabReselected)) { notification in
                guard notification.object as? String == AppTab.home.rawValue else {
                    return
                }

                navigationPath = NavigationPath()
                homeScrollAnchor = "home-feed-top"
                withAnimation(.snappy(duration: 0.28)) {
                    scrollProxy.scrollTo("home-feed-top", anchor: .top)
                }
                Task {
                    await store.load(
                        api: api,
                        mediaEngine: mediaEngine,
                        showsLoading: false,
                        useDiskCache: false
                    )
                }
            }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active, store.feed != nil else {
                    return
                }

                Task {
                    await store.refreshIfStale(api: api, mediaEngine: mediaEngine)
                }
            }
            .fullScreenCover(item: $selectedStory) { route in
                StoryStackViewer(route: route)
            }
            .fullScreenCover(item: $selectedDiscoverCreator) { creator in
                DiscoverCreatorProfileView(
                    creator: creator,
                    isFollowing: false,
                    onFollow: {
                        await followDiscoverCreator(creator)
                    }
                )
            }
            .alert(item: $selectedFailedUpload) { upload in
                Alert(
                    title: Text("Story upload failed"),
                    message: Text(upload.displayErrorMessage),
                    primaryButton: .default(Text("Retry")) {
                        retryPendingUpload(upload)
                    },
                    secondaryButton: .destructive(Text("Remove")) {
                        pendingStoryUploads.remove(id: upload.id)
                        if pendingStoryUploads.latestVisibleUpload == nil {
                            storyUploadNotice.state = nil
                        }
                    }
                )
            }
            }
        }
    }

    private var uploadedStoryRegistrationKey: String {
        uploadedStoryRegistrations.map(\.storyId).joined(separator: ",")
    }

    private var pendingUploadFailureKey: String? {
        guard let upload = pendingStoryUploads.latestVisibleUpload,
              upload.isFailed else {
            return nil
        }

        return "\(upload.id)|\(upload.retryCount)|\(upload.errorMessage ?? "")"
    }

    private func applyUploadedStoryRegistrations() {
        for response in uploadedStoryRegistrations {
            store.registerUploadedStory(response)
        }
    }

    private var header: some View {
        ZStack {
            Text("Stories")
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(Color.ubeyeInk)
                .frame(maxWidth: .infinity)

            HStack(spacing: 12) {
                UBEYEWordmark(compact: true)

                Spacer()

                Button(action: onSearchTap) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 18, weight: .semibold))
                        .frame(width: 38, height: 38)
                        .foregroundStyle(Color.ubeyeInk)
                        .background(Color.ubeyeSubtle, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Search creators")

                TopAvatarSpacer()
            }
        }
        .padding(.bottom, 2)
    }

    @ViewBuilder
    private var uploadNoticeBanner: some View {
        if let batchSummary = pendingStoryUploads.latestBatchSummary {
            StoryBatchUploadProgressCard(
                summary: batchSummary,
                onFailedUploadTapped: { upload in
                    selectedFailedUpload = upload
                }
            )
            .transition(.move(edge: .top).combined(with: .opacity))
        } else if storyUploadNotice.state != nil {
            StoryUploadNoticeBanner(
                title: uploadNoticeTitle,
                message: storyUploadNotice.message,
                systemImage: storyUploadNotice.systemImage,
                progress: uploadNoticeProgress,
                showsIndeterminateProgress: storyUploadNotice.state == .processing
            )
            .transition(.move(edge: .top).combined(with: .opacity))
            .animation(.snappy(duration: 0.3), value: storyUploadNotice.state)
        }
    }

    private var uploadNoticeTitle: String {
        guard storyUploadNotice.state == .posting else {
            return storyUploadNotice.title
        }

        guard let upload = pendingStoryUploads.latestVisibleUpload else {
            return storyUploadNotice.title
        }

        if upload.state == .completing {
            return "Finishing upload…"
        }

        return "Uploading · \(Int((upload.displayProgress * 100).rounded()))%"
    }

    private var uploadNoticeProgress: Double? {
        switch storyUploadNotice.state {
        case .posting:
            pendingStoryUploads.latestVisibleUpload?.displayProgress ?? 0
        case .posted:
            1
        case .processing, .delayed, .review, .failed, nil:
            nil
        }
    }

    private func followingStoriesSection(_ feed: MobileFeedResponse) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            NavigationLink {
                FollowingManagementView()
            } label: {
                SectionHeader(title: "Following", actionTitle: nil, showsChevron: true)
            }
            .buttonStyle(.plain)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    MyStoryHomeCard(
                        myStory: feed.myStory,
                        pendingUpload: pendingStoryUploads.latestVisibleUpload,
                        onPress: {
                            guard feed.myStory.hasActiveStory else {
                                return
                            }
                            store.warmStoryOpen(
                                storyId: "my-story",
                                in: feed,
                                api: api,
                                mediaEngine: mediaEngine
                            )
                        }
                    ) {
                        if let pendingUpload = pendingStoryUploads.latestVisibleUpload, pendingUpload.isFailed {
                            selectedFailedUpload = pendingUpload
                        } else if feed.myStory.hasActiveStory {
                            store.warmStoryOpen(
                                storyId: "my-story",
                                in: feed,
                                api: api,
                                mediaEngine: mediaEngine
                            )
                            selectedStory = StoryRoute(id: "my-story", source: .ownStory)
                        }
                    }

                    ForEach(feed.followingStories) { story in
                        StoryThumb(
                            story: story,
                            onPress: {
                                store.warmStoryOpen(
                                    storyId: story.id,
                                    in: feed,
                                    api: api,
                                    mediaEngine: mediaEngine
                                )
                            }
                        ) {
                            store.warmStoryOpen(
                                storyId: story.id,
                                in: feed,
                                api: api,
                                mediaEngine: mediaEngine
                            )
                            selectedStory = StoryRoute(id: story.id, source: .homeFollowing)
                        }
                        .onAppear {
                            prefetchFollowingStory(story, in: feed)
                        }
                    }
                }
                .padding(.trailing, UBEYEMetrics.screenInset)
            }

            if feed.followingStories.isEmpty && feed.followingProfiles.isEmpty {
                Text("Follow people you want in your story feed.")
                    .font(.subheadline)
                    .foregroundStyle(Color.ubeyeMuted)
            }
        }
    }

    private func retryPendingUpload(_ upload: PendingStoryUpload) {
        UBEYEFeedback.impact(.medium)
        storyUploadNotice.showPosting()
        Task {
            do {
                let response = try await pendingStoryUploads.retry(id: upload.id, api: api)
                UBEYEFeedback.success()
                onPendingUploadRetried(response)
            } catch {
                UBEYEFeedback.error()
                MediaPerformance.mark("pending_story_upload_retry_failed id=\(upload.id)")
                storyUploadNotice.showFailed(
                    message: pendingStoryUploads.upload(id: upload.id)?.displayErrorMessage
                        ?? error.localizedDescription
                )
            }
        }
    }

    @ViewBuilder
    private func discoverSection(_ feed: MobileFeedResponse) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(action: onDiscoverTap) {
                SectionHeader(title: "Discover", actionTitle: nil, showsChevron: true)
            }
            .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
            .contentShape(Rectangle())
            .buttonStyle(.plain)
            .accessibilityLabel("Open Discover")
            .zIndex(1)

            if !feed.discoverTiles.isEmpty {
                DiscoverGrid(
                    tiles: feed.discoverTiles,
                    onAppear: prefetchDiscoverTile,
                    onPress: prewarmDiscoverTile,
                    onTap: openDiscoverTile
                )
                .zIndex(0)
            }
        }
    }

    private func prefetchDiscoverTile(_ tile: DiscoverTile) {
        guard let feed = store.feed,
              let visibleIndex = feed.discoverTiles.firstIndex(where: { $0.id == tile.id }) else {
            return
        }
        let intent = discoverPrefetchTracker.record(
            visibleIndex: visibleIndex,
            itemCount: feed.discoverTiles.count,
            mode: resourceMonitor.mode
        )
        let ids = intent.indices.map { index in
            let candidate = feed.discoverTiles[index]
            return candidate.activeStoryId ?? candidate.id
        }
        mediaEngine.updatePredictiveStoryIntent(
            ids: ids,
            api: api,
            direction: intent.direction,
            velocityItemsPerSecond: intent.velocityItemsPerSecond
        )
        let imageURLs = intent.indices.compactMap { index in
            feed.discoverTiles[index].thumbnailUrl ?? feed.discoverTiles[index].imageUrl
        }
        MediaImageCache.shared.updatePredictivePreheat(imageURLs)
    }

    private func prefetchFollowingStory(_ story: StoryCard, in feed: MobileFeedResponse) {
        guard let visibleIndex = feed.followingStories.firstIndex(where: { $0.id == story.id }) else {
            return
        }
        let intent = followingPrefetchTracker.record(
            visibleIndex: visibleIndex,
            itemCount: feed.followingStories.count,
            mode: resourceMonitor.mode
        )
        let stories = intent.indices.map { feed.followingStories[$0] }
        mediaEngine.updatePredictiveStoryIntent(
            ids: stories.map(\.id),
            api: api,
            direction: intent.direction,
            velocityItemsPerSecond: intent.velocityItemsPerSecond
        )
        MediaImageCache.shared.updatePredictivePreheat(
            stories.compactMap { $0.playbackPlaceholderUrl ?? $0.playbackThumbnailUrl }
        )
    }

    private func openDiscoverTile(_ tile: DiscoverTile) {
        let storyId = tile.activeStoryId ?? tile.id
        if let feed = store.feed {
            store.warmStoryOpen(
                storyId: storyId,
                in: feed,
                api: api,
                mediaEngine: mediaEngine
            )
        }
        selectedStory = StoryRoute(id: storyId, source: .discover)
    }

    private func prewarmDiscoverTile(_ tile: DiscoverTile) {
        let storyId = tile.activeStoryId ?? tile.id
        guard let feed = store.feed else {
            return
        }
        store.warmStoryOpen(
            storyId: storyId,
            in: feed,
            api: api,
            mediaEngine: mediaEngine
        )
    }

    private func followDiscoverCreator(_ creator: DiscoverCreator) async -> Bool {
        struct Body: Encodable {
            let creatorId: String
        }

        do {
            let _: BasicOkResponse = try await api.post(
                "/api/mobile/follows",
                body: Body(creatorId: creator.id)
            )
            NotificationCenter.default.post(name: .followingQueueDidChange, object: nil)
            await store.load(api: api, mediaEngine: mediaEngine)
            return true
        } catch {
            store.error = error.localizedDescription
            return false
        }
    }

}

private struct HomeFeedLoadingSkeleton: View {
    private let discoverColumns = [
        GridItem(.flexible(), spacing: 10),
        GridItem(.flexible(), spacing: 10)
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: "Following", actionTitle: nil, showsChevron: true)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(0..<4, id: \.self) { _ in
                            HomeStoryCardLoadingSkeleton()
                        }
                    }
                    .padding(.trailing, UBEYEMetrics.screenInset)
                }
            }

            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: "Discover", actionTitle: nil, showsChevron: true)

                LazyVGrid(columns: discoverColumns, spacing: 10) {
                    ForEach(0..<4, id: \.self) { _ in
                        HomeDiscoverCardLoadingSkeleton()
                    }
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading stories")
    }
}

private struct HomeStoryCardLoadingSkeleton: View {
    var body: some View {
        ZStack(alignment: .bottomLeading) {
            UBEYESkeletonBlock()

            VStack(alignment: .leading, spacing: 8) {
                UBEYESkeletonLine(width: 72, height: 10)
                UBEYESkeletonLine(width: 48, height: 10)
            }
            .padding(12)
        }
        .frame(width: 132, height: 192)
        .ubeyeMediaCardChrome()
    }
}

private struct HomeDiscoverCardLoadingSkeleton: View {
    var body: some View {
        ZStack(alignment: .bottomLeading) {
            UBEYESkeletonBlock()

            VStack(alignment: .leading, spacing: 8) {
                UBEYESkeletonLine(width: 86, height: 10)
                UBEYESkeletonLine(width: 56, height: 10)
            }
            .padding(12)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 252)
        .ubeyeMediaCardChrome()
    }
}

struct SectionHeader: View {
    let title: String
    let actionTitle: String?
    var showsChevron = false

    var body: some View {
        HStack {
            Text(title)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Color.ubeyeInk)
            if showsChevron {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Color.ubeyeMuted.opacity(0.45))
            }
            Spacer()
            if let actionTitle {
                Text(actionTitle)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Color.ubeyeRed)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 4)
    }
}

struct MyStoryHomeCard: View {
    let myStory: MyStorySummary
    var pendingUpload: PendingStoryUpload?
    var onPress: () -> Void = {}
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack(alignment: .bottomLeading) {
                CachedAsyncImage(url: myStory.latestThumbnailUrl) { image in
                    StoryCardThumbnailImage(image: image)
                } placeholder: {
                    MyStoryCardSkeleton()
                }
                .frame(width: 132, height: 192)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                LinearGradient(
                    colors: [.clear, .black.opacity(0.72)],
                    startPoint: .center,
                    endPoint: .bottom
                )
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                if let overlays = myStory.latestTextOverlays, !overlays.isEmpty {
                    StoryThumbnailOverlayView(overlays: overlays, fontSize: 6, horizontalPadding: 3.5, verticalPadding: 2)
                        .frame(width: 132, height: 192)
                }

                if isAwaitingReady {
                    Color.black.opacity(0.08)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .allowsHitTesting(false)
                }

                if pendingUpload?.isFailed == true {
                    failedUploadBadge
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                        .padding(9)
                }

                HStack(spacing: 7) {
                    Circle()
                        .fill(Color.ubeyeRed)
                        .frame(width: 8, height: 8)
                    Text("My Story")
                        .font(.system(size: 14, weight: .semibold, design: .default))
                        .lineLimit(1)
                }
                .foregroundStyle(.white)
                .padding(12)
            }
            .frame(width: 132, height: 192)
            .ubeyeMediaCardChrome()
        }
        .buttonStyle(.plain)
        .storyPressPrewarm(onPress)
        .accessibilityLabel(cardAccessibilityLabel)
        .accessibilityHint(
            myStory.hasActiveStory
                ? "Opens your story playback."
                : "No active story to play."
        )
    }

    private var isAwaitingReady: Bool {
        pendingUpload?.isFailed == false || myStory.items.last?.isProcessingVideo == true
    }

    private var cardAccessibilityLabel: String {
        if let pendingUpload {
            if pendingUpload.isFailed {
                return "My Story, upload failed"
            }
            return "My Story, upload in progress"
        }
        if myStory.items.last?.isProcessingVideo == true {
            return "My Story, video processing"
        }
        return myStory.hasActiveStory ? "Play My Story" : "My Story"
    }

    private var failedUploadBadge: some View {
        HStack(spacing: 6) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 13, weight: .bold))
            Text("Upload failed")
                .font(.system(size: 10, weight: .black))
                .lineLimit(1)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 7)
        .frame(height: 28)
        .background(.black.opacity(0.54), in: Capsule())
        .overlay(
            Capsule()
                .stroke(.white.opacity(0.16), lineWidth: 1)
        )
    }

}

private struct StoryBatchUploadProgressCard: View {
    let summary: PendingStoryUploadBatchSummary
    let onFailedUploadTapped: (PendingStoryUpload) -> Void

    private var headerTitle: String {
        if summary.failedCount > 0 {
            return "\(summary.failedCount) of \(summary.totalCount) need attention"
        }
        return "Posting \(summary.totalCount) stories"
    }

    private var headerMessage: String {
        if summary.completedCount > 0 {
            return "\(summary.completedCount) posted · Uploads continue in background"
        }
        return "Uploads continue in background"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack(spacing: 10) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 32, height: 32)
                    .background(Color.ubeyeRed, in: Circle())

                VStack(alignment: .leading, spacing: 2) {
                    Text(headerTitle)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Color.ubeyeInk)
                        .contentTransition(.numericText())
                    Text(headerMessage)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color.ubeyeMuted)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                Text("\(Int((summary.progress * 100).rounded()))%")
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.ubeyeInk)
                    .contentTransition(.numericText())
            }

            ProgressView(value: summary.progress, total: 1)
                .progressViewStyle(.linear)
                .tint(Color.ubeyeRed)

            HStack(spacing: 5) {
                ForEach(0..<max(summary.totalCount, 0), id: \.self) { offset in
                    let upload = upload(at: offset + 1)
                    ProgressView(value: upload?.displayProgress ?? 1, total: 1)
                        .progressViewStyle(.linear)
                        .tint(upload?.isFailed == true ? Color.ubeyeRed.opacity(0.45) : Color.ubeyeRed)
                        .accessibilityLabel("Story \(offset + 1)")
                        .accessibilityValue(upload?.statusLabel ?? "Posted")
                }
            }

            if let failedUpload = summary.uploads.first(where: \.isFailed) {
                Button {
                    onFailedUploadTapped(failedUpload)
                } label: {
                    Label("Retry failed story", systemImage: "arrow.clockwise")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Color.ubeyeRed)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens retry options")
            }
        }
        .padding(12)
        .background(Color.ubeyeSubtle, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Color.ubeyeBorder, lineWidth: 1)
        )
        .animation(.easeInOut(duration: 0.25), value: summary.progress)
        .accessibilityElement(children: .contain)
    }

    private func upload(at position: Int) -> PendingStoryUpload? {
        summary.uploads.first { $0.batchPosition == position }
    }
}

private struct StoryUploadNoticeBanner: View {
    let title: String
    let message: String
    let systemImage: String
    let progress: Double?
    let showsIndeterminateProgress: Bool

    private var showsProgress: Bool {
        progress != nil || showsIndeterminateProgress
    }

    var body: some View {
        VStack(spacing: 9) {
            HStack(spacing: 10) {
                Image(systemName: systemImage)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 30, height: 30)
                    .background(Color.ubeyeRed, in: Circle())

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Color.ubeyeInk)
                        .contentTransition(.numericText())
                    Text(message)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.ubeyeMuted)
                        .lineLimit(2)
                }

                Spacer(minLength: 8)
            }

            if showsProgress {
                Group {
                    if showsIndeterminateProgress {
                        ProgressView()
                    } else {
                        ProgressView(value: progress ?? 0, total: 1)
                    }
                }
                .progressViewStyle(.linear)
                .tint(Color.ubeyeRed)
                .animation(.easeInOut(duration: 0.25), value: progress)
            }
        }
        .padding(12)
        .background(Color.ubeyeSubtle, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Color.ubeyeBorder, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

private struct MyStoryCardSkeleton: View {
    var body: some View {
        UBEYESkeletonBlock()
            .accessibilityHidden(true)
    }
}

struct StoryThumb: View {
    let story: StoryCard
    var onPress: () -> Void = {}
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack(alignment: .bottomLeading) {
                CachedAsyncImage(url: story.playbackThumbnailUrl ?? story.playbackMediaUrl) { image in
                    StoryCardThumbnailImage(image: image)
                } placeholder: {
                    Color.ubeyeSubtle
                }
                .frame(width: 132, height: 192)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                LinearGradient(
                    colors: [.clear, .black.opacity(0.78)],
                    startPoint: .center,
                    endPoint: .bottom
                )
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                if let overlays = story.textOverlays, !overlays.isEmpty {
                    StoryThumbnailOverlayView(overlays: overlays, fontSize: 6, horizontalPadding: 3.5, verticalPadding: 2)
                        .frame(width: 132, height: 192)
                }

                Text(story.creator)
                    .font(.system(size: 14, weight: .semibold, design: .default))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .padding(12)
                    .frame(width: 132, height: 192, alignment: .bottomLeading)
            }
            .frame(width: 132, height: 192)
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .ubeyeMediaCardChrome()
        }
        .buttonStyle(.plain)
        .storyPressPrewarm(onPress)
        .accessibilityLabel("\(story.creator)'s story")
    }
}

struct StoryCardThumbnailImage: View {
    let image: Image

    var body: some View {
        image
            .resizable()
            .scaledToFill()
    }
}

struct DiscoverGrid: View {
    let tiles: [DiscoverTile]
    var onAppear: (DiscoverTile) -> Void = { _ in }
    var onPress: (DiscoverTile) -> Void = { _ in }
    let onTap: (DiscoverTile) -> Void

    private let columns = [
        GridItem(.flexible(), spacing: 10),
        GridItem(.flexible(), spacing: 10)
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 10) {
            ForEach(tiles) { tile in
                Button {
                    onTap(tile)
                } label: {
                    ZStack(alignment: .bottomLeading) {
                        CachedAsyncImage(url: tile.thumbnailUrl ?? tile.imageUrl) { image in
                            image.resizable().scaledToFill()
                        } placeholder: {
                            DiscoverCardSkeleton()
                        }
                        .frame(height: 252)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                        LinearGradient(
                            colors: [.clear, .black.opacity(0.76)],
                            startPoint: .center,
                            endPoint: .bottom
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                        VStack(alignment: .leading, spacing: 0) {
                            Text(tile.title)
                                .font(.system(size: 18, weight: .bold))
                                .lineLimit(3)
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                    }
                    .foregroundStyle(.white)
                    .ubeyeMediaCardChrome()
                }
                .buttonStyle(.plain)
                .storyPressPrewarm {
                    onPress(tile)
                }
                .id(tile.id)
                .onAppear {
                    onAppear(tile)
                }
            }
        }
    }

}

private struct DiscoverCardSkeleton: View {
    var body: some View {
        ZStack {
            UBEYESkeletonBlock()

            VStack(alignment: .leading, spacing: 8) {
                UBEYESkeletonLine(width: 78, height: 10)
                UBEYESkeletonLine(width: 52, height: 10)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
            .padding(12)
        }
        .accessibilityHidden(true)
    }
}

struct SuggestedAccountCard: View {
    let account: SuggestedAccount

    var body: some View {
        HStack(spacing: 12) {
            RemoteAvatar(url: account.imageUrl, size: 48, name: account.name)

            VStack(alignment: .leading, spacing: 3) {
                Text(account.name)
                    .font(.headline)
                    .lineLimit(1)
                Text("@\(account.handle) - \(account.reason)")
                    .font(.caption)
                    .foregroundStyle(Color.ubeyeMuted)
                    .lineLimit(1)
                Text(account.monetization)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(Color.ubeyeRed)
                    .lineLimit(1)
            }

            Spacer()

            UBEYEPill(title: account.storyStreak, systemImage: "flame.fill", tint: .ubeyeRed)
        }
        .padding(12)
        .ubeyeCard()
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
