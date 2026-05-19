import SwiftUI
import AVKit

@MainActor
final class FeedStore: ObservableObject {
    @Published var feed: MobileFeedResponse?
    @Published var isLoading = false
    @Published var error: String?
    private var storyStackPrefetchTask: Task<Void, Never>?

    func load(api: APIClient, showsLoading: Bool = true, useDiskCache: Bool = true) async {
        let restoreStartedAt = Date()
        if showsLoading {
            isLoading = true
        }
        error = nil

        if useDiskCache, feed == nil, let cached = await api.cachedMobileFeed(allowExpired: true) {
            feed = cached
            MediaPerformance.measure("feed_disk_restore", since: restoreStartedAt)
            MediaPreheater.preheat(feed: cached)
            let storyIds = storyStackPrefetchIds(from: cached)
            let restoredStoryCount = await api.restoreCachedStoryStacks(ids: storyIds)
            MediaPerformance.mark("media_cache_summary feed=disk restored_story_stacks=\(restoredStoryCount)")
        }

        let networkStartedAt = Date()
        do {
            let response = try await api.mobileFeed()
            feed = response
            MediaPerformance.measure("feed_load", since: networkStartedAt)
            MediaPreheater.preheat(feed: response)
            scheduleStoryStackPrefetch(
                ids: storyStackPrefetchIds(from: response),
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

    private func storyStackPrefetchIds(from feed: MobileFeedResponse) -> [String] {
        var ids: [String] = []

        if feed.myStory.hasActiveStory {
            ids.append("my-story")
        }

        ids.append(contentsOf: feed.verticalFollowingStories.prefix(4).map(\.id))
        ids.append(contentsOf: feed.discoverTiles.prefix(4).map { $0.activeStoryId ?? $0.id })

        return ids
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
}

struct HomeView: View {
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var storyUploadNotice: StoryUploadNoticeStore
    @Environment(\.scenePhase) private var scenePhase
    var onSearchTap: () -> Void = {}
    var onDiscoverTap: () -> Void = {}
    @StateObject private var store = FeedStore()
    @State private var selectedStory: StoryRoute?
    @State private var selectedDiscoverCreator: DiscoverCreator?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header
                    uploadNoticeBanner

                    if store.isLoading && store.feed == nil {
                        ProgressView()
                            .tint(.ubeyeRed)
                            .frame(maxWidth: .infinity, minHeight: 160)
                    } else if let error = store.error, store.feed == nil {
                        EmptyStateView(title: "Could not load stories", message: error, systemImage: "wifi.exclamationmark")
                    }

                    if let feed = store.feed {
                        followingStoriesSection(feed)

                        discoverSection(feed)
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
            .task {
                await store.load(api: api)
            }
            .onReceive(NotificationCenter.default.publisher(for: .followingQueueDidChange)) { _ in
                Task {
                    api.invalidateStoryStacks()
                    await store.load(api: api, useDiskCache: false)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .storyUploadDidComplete)) { _ in
                Task {
                    api.invalidateStoryStacks(ids: ["my-story"])
                    await store.load(api: api, useDiskCache: false)
                }
            }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active, store.feed != nil else {
                    return
                }

                Task {
                    await store.load(api: api, showsLoading: false, useDiskCache: false)
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
            }
            .padding(12)
            .background(Color.ubeyeSubtle, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(Color.ubeyeBorder, lineWidth: 1)
            )
        }
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
                    MyStoryHomeCard(myStory: feed.myStory) {
                        if feed.myStory.hasActiveStory {
                            selectedStory = StoryRoute(id: "my-story", source: .ownStory)
                        }
                    }

                    ForEach(feed.followingStories) { story in
                        StoryThumb(story: story)
                            .onAppear {
                                api.prefetchStoryStacks(ids: [story.id], limit: 1)
                            }
                            .onTapGesture {
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
        selectedStory = StoryRoute(id: tile.activeStoryId ?? tile.id, source: .discover)
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

                if let overlay = thumbnailOverlay {
                    MyStoryThumbnailOverlay(overlay: overlay)
                        .frame(width: 132, height: 192)
                }

                Image(systemName: "plus")
                    .font(.system(size: 16, weight: .medium))
                    .frame(width: 30, height: 30)
                    .foregroundStyle(.white)
                    .background(Color.ubeyeInk, in: Circle())
                    .overlay(Circle().stroke(Color.white, lineWidth: 1.5))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    .padding(9)

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
    }

    private var thumbnailOverlay: StoryTextOverlay? {
        myStory.latestTextOverlays?.first {
            !$0.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
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

private struct MyStoryThumbnailOverlay: View {
    let overlay: StoryTextOverlay

    var body: some View {
        GeometryReader { proxy in
            HStack(spacing: 3) {
                if overlay.kind == "link" {
                    Image(systemName: "link")
                        .font(.system(size: 7, weight: .bold))
                }

                Text(overlay.label)
                    .font(.system(size: 9, weight: .bold))
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(.black.opacity(0.46), in: Capsule())
            .position(
                x: proxy.size.width * CGFloat(min(max(overlay.positionX, 8), 92) / 100),
                y: proxy.size.height * CGFloat(min(max(overlay.positionY, 8), 82) / 100)
            )
        }
        .allowsHitTesting(false)
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
        if story.assetKind == .video {
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
