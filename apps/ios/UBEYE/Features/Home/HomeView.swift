import SwiftUI
import AVKit

@MainActor
final class FeedStore: ObservableObject {
    @Published var feed: MobileFeedResponse?
    @Published var isLoading = false
    @Published var error: String?
    private var storyStackPrefetchTask: Task<Void, Never>?
    private var lastNetworkLoadAt: Date?
    private var uploadedStoryOverrides: [StoryUploadResponse] = []
    private let foregroundRefreshCooldown: TimeInterval = 45

    func load(api: APIClient, showsLoading: Bool = true, useDiskCache: Bool = true) async {
        let restoreStartedAt = Date()
        if showsLoading, feed == nil {
            isLoading = true
        }
        error = nil

        if useDiskCache, feed == nil, let cached = await api.cachedMobileFeed(allowExpired: true) {
            feed = cached
            applyUploadedStoryOverridesIfNeeded()
            MediaPerformance.measure("feed_disk_restore", since: restoreStartedAt)
            if let feed {
                MediaPreheater.preheat(feed: feed)
            }
            let storyIds = storyStackPrefetchIds(from: feed ?? cached)
            restoreInitialStoryStacks(ids: storyIds, api: api, refresh: false)
        }

        let networkStartedAt = Date()
        do {
            let response = try await api.mobileFeed()
            lastNetworkLoadAt = Date()
            feed = response
            applyUploadedStoryOverridesIfNeeded()
            MediaPerformance.measure("feed_load", since: networkStartedAt)
            if let feed {
                MediaPreheater.preheat(feed: feed)
            }
            restoreInitialStoryStacks(
                ids: storyStackPrefetchIds(from: feed ?? response),
                api: api,
                refresh: true
            )
            scheduleStoryStackPrefetch(
                ids: storyStackPrefetchIds(from: feed ?? response),
                api: api,
                refresh: true
            )
        } catch {
            if feed == nil {
                self.error = error.localizedDescription
            } else {
                MediaPerformance.mark("feed_refresh_failed")
            }
        }
        if showsLoading {
            isLoading = false
        }
    }

    func refreshIfStale(api: APIClient) async {
        guard shouldRefreshAfterForeground else {
            if let feed {
                restoreInitialStoryStacks(ids: storyStackPrefetchIds(from: feed), api: api, refresh: false)
            }
            return
        }

        await load(api: api, showsLoading: false, useDiskCache: false)
    }

    func warmStoryOpen(storyId: String, in feed: MobileFeedResponse, api: APIClient) {
        let ids = storyStackPrefetchIds(from: feed)
        let adjacentIds = adjacentStoryIds(to: storyId, in: ids)
        api.warmStoryOpening(storyId: storyId, adjacentIds: adjacentIds)
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

    private func applyUploadedStoryOverridesIfNeeded() {
        guard let current = feed, !uploadedStoryOverrides.isEmpty else {
            return
        }

        feed = uploadedStoryOverrides.reduce(current) { partialFeed, response in
            feedWithUploadedStory(response, in: partialFeed)
        }
    }

    private func feedWithUploadedStory(_ response: StoryUploadResponse, in current: MobileFeedResponse) -> MobileFeedResponse {
        let thumbnailUrl =
            response.asset.thumbnailUrl ??
            (response.asset.assetKind == .image ? response.asset.mediaUrl : nil)
        if let thumbnailUrl {
            MediaImageCache.shared.preheat([thumbnailUrl], limit: 1)
        }

        let pendingStory = StoryCard(
            id: response.storyId,
            creator: current.myStory.owner.name,
            handle: current.myStory.owner.handle,
            assetKind: response.asset.assetKind,
            mediaUrl: response.asset.mediaUrl,
            thumbnailUrl: thumbnailUrl,
            renditions: nil,
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
            discoverTiles: current.discoverTiles,
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

    private func restoreInitialStoryStacks(ids: [String], api: APIClient, refresh: Bool) {
        let initialIds = Array(ids.prefix(4))
        guard !initialIds.isEmpty else {
            return
        }

        Task { @MainActor [api] in
            let restoredStoryCount = await api.restoreCachedStoryStacks(ids: initialIds, limit: 4)
            MediaPerformance.mark("media_cache_summary feed=visible restored_story_stacks=\(restoredStoryCount)")
            api.prefetchStoryStacks(ids: initialIds, refresh: refresh, limit: 4)
        }
    }

    private func scheduleStoryStackPrefetch(ids: [String], api: APIClient, refresh: Bool) {
        storyStackPrefetchTask?.cancel()
        storyStackPrefetchTask = Task { @MainActor [weak self, api] in
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else {
                return
            }

            api.prefetchStoryStacks(ids: ids, refresh: refresh)
            self?.storyStackPrefetchTask = nil
        }
    }

    private func adjacentStoryIds(to storyId: String, in ids: [String]) -> [String] {
        guard let index = ids.firstIndex(of: storyId) else {
            return Array(ids.prefix(3).filter { $0 != storyId })
        }

        let lowerBound = max(ids.startIndex, index - 2)
        let upperBound = min(ids.index(before: ids.endIndex), index + 2)
        return ids[lowerBound...upperBound].filter { $0 != storyId }
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
        let myStoryItems = current.myStory.items.filter { $0.id != storyId }
        let myStoryWasDeleted = myStoryItems.count != current.myStory.items.count
        let latestMyStoryItem = myStoryItems.last
        let myStory = myStoryWasDeleted
            ? MyStorySummary(
                owner: current.myStory.owner,
                hasActiveStory: !myStoryItems.isEmpty,
                liveCount: myStoryItems.count,
                latestThumbnailUrl: latestMyStoryItem.flatMap {
                    $0.assetKind == .image ? $0.mediaUrl : $0.thumbnailUrl
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
            discoverTiles: discoverTiles,
            suggestedAccounts: current.suggestedAccounts,
            myStory: myStory
        )
    }
}

struct HomeView: View {
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var pendingStoryUploads: PendingStoryUploadStore
    @EnvironmentObject private var storyUploadNotice: StoryUploadNoticeStore
    @Environment(\.scenePhase) private var scenePhase
    var uploadedStoryRegistrations: [StoryUploadResponse] = []
    var onSearchTap: () -> Void = {}
    var onDiscoverTap: () -> Void = {}
    var onPendingUploadRetried: (StoryUploadResponse) -> Void = { _ in }
    @StateObject private var store = FeedStore()
    @State private var selectedStory: StoryRoute?
    @State private var selectedDiscoverCreator: DiscoverCreator?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header

                    if store.isLoading && store.feed == nil {
                        ProgressView()
                            .tint(.ubeyeRed)
                            .frame(maxWidth: .infinity, minHeight: 160)
                    } else if let error = store.error, store.feed == nil {
                        EmptyStateView(title: "Could not load stories", message: error, systemImage: "wifi.exclamationmark")
                    }

                    if let feed = store.feed {
                        let displayFeed = pendingStoryUploads.feedByMergingPendingUploads(into: feed)

                        followingStoriesSection(displayFeed)

                        discoverSection(displayFeed)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .padding(.bottom, 104)
            }
            .refreshable {
                await store.load(api: api, useDiskCache: false)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .ubeyeScreen()
            .overlay(alignment: .top) {
                uploadNoticeBanner
                    .padding(.horizontal, 16)
                    .padding(.top, 74)
                    .allowsHitTesting(false)
            }
            .animation(.snappy, value: storyUploadNotice.state)
            .task {
                await store.load(api: api)
            }
            .task(id: uploadedStoryRegistrationKey) {
                applyUploadedStoryRegistrations()
            }
            .onReceive(NotificationCenter.default.publisher(for: .followingQueueDidChange)) { _ in
                Task {
                    api.invalidateStoryStacks()
                    await store.load(api: api, useDiskCache: false)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .storyUploadDidRegister)) { notification in
                guard let response = notification.object as? StoryUploadResponse else {
                    return
                }

                store.registerUploadedStory(response)
                if response.processingStatus == "ready" {
                    Task {
                        await store.load(api: api, showsLoading: false, useDiskCache: false)
                    }
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .storyUploadDidComplete)) { _ in
                Task {
                    api.invalidateStoryStacks(ids: ["my-story"])
                    await store.load(api: api, useDiskCache: false)
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
                    await store.load(api: api, showsLoading: false, useDiskCache: false)
                }
            }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active, store.feed != nil else {
                    return
                }

                Task {
                    await store.refreshIfStale(api: api)
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
        }
    }

    private var uploadedStoryRegistrationKey: String {
        uploadedStoryRegistrations.map(\.storyId).joined(separator: ",")
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
        if storyUploadNotice.state != nil {
            HStack(spacing: 10) {
                UploadNoticeIcon(
                    systemImage: storyUploadNotice.systemImage,
                    isSpinning: storyUploadNotice.isProcessing
                )

                VStack(alignment: .leading, spacing: 2) {
                    Text(storyUploadNotice.title)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Color.ubeyeInk)
                    Text(storyUploadNotice.message)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.ubeyeMuted)
                        .lineLimit(2)
                }

                Spacer(minLength: 8)

                if let progressLabel = uploadNoticeProgressLabel {
                    Text(progressLabel)
                        .font(.system(size: 14, weight: .black))
                        .monospacedDigit()
                        .foregroundStyle(Color.ubeyeRed)
                        .frame(minWidth: 48, minHeight: 28)
                        .background(.white, in: Capsule())
                        .overlay(
                            Capsule()
                                .stroke(Color.ubeyeBorder.opacity(0.72), lineWidth: 1)
                        )
                        .accessibilityLabel("Upload progress \(progressLabel)")
                }
            }
            .padding(12)
            .background(Color.ubeyeSubtle, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(Color.ubeyeBorder, lineWidth: 1)
            )
        }
    }

    private var uploadNoticeProgressLabel: String? {
        guard case .posting = storyUploadNotice.state,
              let upload = pendingStoryUploads.latestVisibleUpload,
              upload.showsUploadProgressPercent else {
            return nil
        }

        return upload.progressPercentLabel
    }

    private struct UploadNoticeIcon: View {
        let systemImage: String
        let isSpinning: Bool

        var body: some View {
            TimelineView(.animation(paused: !isSpinning)) { context in
                Image(systemName: systemImage)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .rotationEffect(.degrees(rotationDegrees(at: context.date)))
                    .frame(width: 30, height: 30)
                    .background(
                        Color.ubeyeRed,
                        in: Circle()
                    )
            }
        }

        private func rotationDegrees(at date: Date) -> Double {
            guard isSpinning else {
                return 0
            }
            return date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1) * 360
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
                        pendingUpload: pendingStoryUploads.latestVisibleUpload
                    ) {
                        if let pendingUpload = pendingStoryUploads.latestVisibleUpload, pendingUpload.isFailed {
                            retryPendingUpload(pendingUpload)
                        } else if feed.myStory.hasActiveStory {
                            store.warmStoryOpen(storyId: "my-story", in: feed, api: api)
                            selectedStory = StoryRoute(id: "my-story", source: .ownStory)
                        }
                    }

                    ForEach(feed.followingStories) { story in
                        StoryThumb(story: story)
                            .onAppear {
                                api.prefetchStoryStacks(ids: [story.id], limit: 1)
                            }
                            .onTapGesture {
                                store.warmStoryOpen(storyId: story.id, in: feed, api: api)
                                selectedStory = StoryRoute(id: story.id, source: .homeFollowing)
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
                    onTap: openDiscoverTile
                )
                .zIndex(0)
            }
        }
    }

    private func prefetchDiscoverTile(_ tile: DiscoverTile) {
        api.prefetchStoryStacks(ids: [tile.activeStoryId ?? tile.id], limit: 1)
    }

    private func openDiscoverTile(_ tile: DiscoverTile) {
        let storyId = tile.activeStoryId ?? tile.id
        if let feed = store.feed {
            store.warmStoryOpen(storyId: storyId, in: feed, api: api)
        }
        selectedStory = StoryRoute(id: storyId, source: .discover)
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
            await store.load(api: api)
            return true
        } catch {
            store.error = error.localizedDescription
            return false
        }
    }

    private func retryPendingUpload(_ upload: PendingStoryUpload) {
        storyUploadNotice.showPosting()
        Task {
            do {
                let response = try await pendingStoryUploads.retry(id: upload.id, api: api)
                onPendingUploadRetried(response)
            } catch {
                MediaPerformance.mark("pending_story_upload_retry_failed id=\(upload.id)")
            }
        }
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
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack(alignment: .bottomLeading) {
                CachedAsyncImage(url: myStory.latestThumbnailUrl) { image in
                    image.resizable().scaledToFill()
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
                    StoryThumbnailOverlayView(overlays: overlays, fontSize: 9, horizontalPadding: 6, verticalPadding: 3)
                        .frame(width: 132, height: 192)
                }

                if let pendingUpload {
                    pendingStatus(upload: pendingUpload)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                        .padding(9)
                }

                HStack(spacing: 7) {
                    Circle()
                        .fill(Color.ubeyeRed)
                        .frame(width: 8, height: 8)
                    Text("My Story")
                        .font(.system(size: 15, weight: .bold))
                        .lineLimit(1)
                }
                .foregroundStyle(.white)
                .padding(12)
            }
            .frame(width: 132, height: 192)
            .ubeyeMediaCardChrome()
        }
        .buttonStyle(.plain)
        .accessibilityLabel(myStory.hasActiveStory ? "Play My Story" : "My Story")
        .accessibilityHint(
            myStory.hasActiveStory
                ? "Opens your story playback."
                : "No active story to play."
        )
    }

    private func pendingStatus(upload: PendingStoryUpload) -> some View {
        HStack(spacing: 6) {
            ZStack {
                Circle()
                    .stroke(.white.opacity(0.24), lineWidth: 2)
                Circle()
                    .trim(from: 0, to: upload.isFailed ? 1 : upload.displayProgress)
                    .stroke(
                        upload.isFailed ? Color.ubeyeRed : .white,
                        style: StrokeStyle(lineWidth: 2, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))

                Image(systemName: upload.isFailed ? "exclamationmark" : "arrow.up")
                    .font(.system(size: 8, weight: .black))
                    .foregroundStyle(.white)
            }
            .frame(width: 18, height: 18)

            Text(upload.statusLabel)
                .font(.system(size: 10, weight: .black))
                .lineLimit(1)
                .minimumScaleFactor(0.72)
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

private struct MyStoryCardSkeleton: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color.ubeyeSubtle,
                    Color.ubeyeBorder.opacity(0.72),
                    Color.ubeyeSubtle.opacity(0.92)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            VStack(alignment: .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(.white.opacity(0.62))
                    .frame(width: 72, height: 10)
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(.white.opacity(0.42))
                    .frame(width: 48, height: 10)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
            .padding(12)
        }
        .accessibilityHidden(true)
    }
}

struct StoryThumb: View {
    let story: StoryCard

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            CachedAsyncImage(url: story.thumbnailUrl ?? story.mediaUrl) { image in
                image.resizable().scaledToFill()
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
                StoryThumbnailOverlayView(overlays: overlays, fontSize: 9, horizontalPadding: 6, verticalPadding: 3)
                    .frame(width: 132, height: 192)
            }

            VStack(alignment: .leading, spacing: 5) {
                Text(story.creator)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .lineLimit(2)
            }
            .padding(10)
            .frame(width: 132, height: 192, alignment: .bottomLeading)
        }
        .frame(width: 132, height: 192)
        .ubeyeMediaCardChrome()
    }
}

struct DiscoverGrid: View {
    let tiles: [DiscoverTile]
    var onAppear: (DiscoverTile) -> Void = { _ in }
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
            LinearGradient(
                colors: [
                    Color.ubeyeSubtle,
                    Color.ubeyeBorder.opacity(0.72),
                    Color.ubeyeSubtle.opacity(0.92)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            VStack(alignment: .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(.white.opacity(0.62))
                    .frame(width: 78, height: 10)
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(.white.opacity(0.42))
                    .frame(width: 52, height: 10)
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

struct StoryViewer: View {
    let stories: [StoryCard]
    @Environment(\.dismiss) private var dismiss
    @State private var index = 0

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()

            if let story = stories[safe: index] {
                StoryMediaView(story: story)
                    .ignoresSafeArea()

                VStack(alignment: .leading, spacing: 4) {
                    Text(story.creator)
                        .font(.headline)
                    Text(story.title)
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.72))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                .padding(22)
            }

            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.headline)
                    .padding(12)
                    .background(.black.opacity(0.45), in: Circle())
            }
            .foregroundStyle(.white)
            .padding()
        }
    }
}

struct StoryMediaView: View {
    let story: StoryCard

    var body: some View {
        if story.isProcessingVideo {
            ZStack {
                if let thumbnailUrl = story.thumbnailUrl {
                    CachedAsyncImage(url: thumbnailUrl) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Color.black
                    }
                } else {
                    Color.black
                }

                ProgressView()
                    .tint(.white)
            }
        } else if story.assetKind == .video {
            AutoPlayVideoPlayer(url: story.mediaUrl, thumbnailUrl: story.thumbnailUrl)
        } else {
            CachedAsyncImage(url: story.mediaUrl) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                ProgressView().tint(.white)
            }
        }
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
