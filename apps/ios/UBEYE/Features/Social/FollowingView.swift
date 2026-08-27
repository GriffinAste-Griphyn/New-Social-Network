import SwiftUI

struct FollowingView: View {
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var mediaEngine: MediaEngine
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var store = FeedStore()
    @State private var selectedStory: StoryRoute?
    @State private var navigationPath = NavigationPath()

    var body: some View {
        NavigationStack(path: $navigationPath) {
            ScrollViewReader { scrollProxy in
                ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    header
                        .id("following-feed-top")

                    if let refreshError = store.refreshError, store.feed != nil {
                        InlineNotice(message: "Couldn’t refresh. \(refreshError)", isError: true)
                    }

                    if store.isLoading && store.feed == nil {
                        FollowingFeedLoadingSkeleton()
                    } else if let error = store.error, store.feed == nil {
                        EmptyStateView(
                            title: "Could not load following",
                            message: error,
                            systemImage: "wifi.exclamationmark"
                        )
                        .padding(.top, 24)
                    }

                    if let feed = store.feed {
                        let stories = feed.verticalFollowingStories

                        if stories.isEmpty {
                            EmptyStateView(
                                title: "No stories yet",
                                message: feed.followingProfiles.isEmpty
                                    ? "Follow creators to build your feed."
                                    : "New stories from people you follow will appear here.",
                                systemImage: "play.rectangle"
                            )
                            .padding(.top, 24)
                        } else {
                            ForEach(stories) { story in
                                FollowingStoryFeedCard(
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
                                    selectedStory = StoryRoute(id: story.id, source: .followingFeed)
                                }
                                .onAppear {
                                    mediaEngine.prefetchStoryStacks(
                                        ids: [story.id],
                                        api: api,
                                        priority: .visible,
                                        limit: 1
                                    )
                                    if story.id == stories.last?.id {
                                        Task {
                                            await store.loadNextPage(api: api, mediaEngine: mediaEngine)
                                        }
                                    }
                                }
                            }

                            if store.isLoadingNextPage {
                                ProgressView()
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 12)
                            } else if store.nextPageError != nil {
                                Button {
                                    UBEYEFeedback.selection()
                                    Task {
                                        await store.loadNextPage(api: api, mediaEngine: mediaEngine)
                                    }
                                } label: {
                                    Label("Retry loading more", systemImage: "arrow.clockwise")
                                        .font(.system(size: 14, weight: .bold))
                                        .frame(maxWidth: .infinity, minHeight: 46)
                                        .foregroundStyle(Color.ubeyeRed)
                                }
                                .buttonStyle(UBEYEPressButtonStyle())
                            }
                        }
                    }
                }
                .padding(.horizontal, UBEYEMetrics.screenInset)
                .padding(.top, 16)
                .padding(.bottom, 108)
            }
            .refreshable {
                await store.load(api: api, mediaEngine: mediaEngine, useDiskCache: false)
            }
            .toolbar(.hidden, for: .navigationBar)
            .ubeyeScreen()
            .task {
                await store.load(api: api, mediaEngine: mediaEngine)
            }
            .onReceive(NotificationCenter.default.publisher(for: .followingQueueDidChange)) { _ in
                Task {
                    api.invalidateStoryStacks()
                    await store.load(api: api, mediaEngine: mediaEngine, useDiskCache: false)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .storyUploadDidComplete)) { _ in
                Task {
                    await store.load(api: api, mediaEngine: mediaEngine, showsLoading: false, useDiskCache: false)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .storyDidDelete)) { notification in
                let storyId = notification.object as? String
                if let storyId {
                    store.removeDeletedStory(storyId)
                }

                Task {
                    api.invalidateMobileFeedCache()
                    api.invalidateStoryStacks(ids: [storyId].compactMap { $0 })
                    await store.load(api: api, mediaEngine: mediaEngine, showsLoading: false, useDiskCache: false)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .appTabReselected)) { notification in
                guard notification.object as? String == AppTab.following.rawValue else {
                    return
                }

                navigationPath = NavigationPath()
                withAnimation(.snappy(duration: 0.28)) {
                    scrollProxy.scrollTo("following-feed-top", anchor: .top)
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
                    await store.load(api: api, mediaEngine: mediaEngine, showsLoading: false, useDiskCache: false)
                }
            }
            .fullScreenCover(item: $selectedStory) { route in
                StoryStackViewer(route: route)
            }
            }
        }
    }

    private var header: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Following")
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(Color.ubeyeInk)

                if let count = store.feed?.verticalFollowingStories.count, count > 0 {
                    Text("\(count) live stor\(count == 1 ? "y" : "ies")")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.ubeyeMuted)
                }
            }

            Spacer()

            TopAvatarSpacer()
        }
        .padding(.bottom, 2)
    }
}

private struct FollowingFeedLoadingSkeleton: View {
    var body: some View {
        VStack(spacing: 14) {
            ForEach(0..<3, id: \.self) { _ in
                FollowingStoryLoadingCard()
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading following stories")
    }
}

private struct FollowingStoryLoadingCard: View {
    var body: some View {
        ZStack(alignment: .bottomLeading) {
            UBEYESkeletonBlock()
                .frame(maxWidth: .infinity)
                .frame(height: 238)

            HStack(alignment: .bottom, spacing: 10) {
                UBEYESkeletonCircle(size: 36)

                VStack(alignment: .leading, spacing: 8) {
                    UBEYESkeletonLine(width: 128, height: 13)
                    UBEYESkeletonLine(width: 82, height: 10)
                }

                Spacer(minLength: 12)
            }
            .padding(16)
        }
        .ubeyeMediaCardChrome()
    }
}

private struct FollowingStoryFeedCard: View {
    let story: StoryCard
    var onPress: () -> Void = {}
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack(alignment: .bottomLeading) {
                CachedAsyncImage(url: story.playbackThumbnailUrl ?? story.playbackMediaUrl) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    FollowingStoryCardSkeleton()
                }
                .frame(maxWidth: .infinity)
                .frame(height: 238)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                LinearGradient(
                    colors: [.clear, .black.opacity(0.12), .black.opacity(0.82)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                if let overlays = story.textOverlays, !overlays.isEmpty {
                    StoryThumbnailOverlayView(overlays: overlays, fontSize: 11, horizontalPadding: 8, verticalPadding: 5)
                }

                HStack(alignment: .bottom, spacing: 10) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(story.creator)
                            .font(.system(size: 20, weight: .bold))
                            .foregroundStyle(.white)
                            .lineLimit(2)

                        HStack(spacing: 6) {
                            Text(story.handle)
                            if let postedLabel = story.relativePostedLabel {
                                Circle()
                                    .fill(.white.opacity(0.58))
                                    .frame(width: 3, height: 3)
                                Text(postedLabel)
                            }
                        }
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.78))
                        .lineLimit(1)
                    }

                    Spacer(minLength: 12)

                    if story.assetKind == .video {
                        Image(systemName: "play.fill")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 34, height: 34)
                            .background(.white.opacity(0.18), in: Circle())
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
            }
            .ubeyeMediaCardChrome()
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .storyPressPrewarm(onPress)
        .accessibilityLabel("\(story.creator)'s story")
    }
}

private struct FollowingStoryCardSkeleton: View {
    var body: some View {
        ZStack {
            UBEYESkeletonBlock()

            VStack(alignment: .leading, spacing: 9) {
                UBEYESkeletonLine(width: 112, height: 12)
                UBEYESkeletonLine(width: 72, height: 10)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
            .padding(16)
        }
        .accessibilityHidden(true)
    }
}

private extension StoryCard {
    var relativePostedLabel: String? {
        guard let lastUploadedAt else {
            return nil
        }

        guard let date = Self.storyDateFormatter.date(from: lastUploadedAt)
            ?? Self.fallbackStoryDateFormatter.date(from: lastUploadedAt) else {
            return nil
        }

        let seconds = max(0, Date().timeIntervalSince(date))
        if seconds < 60 {
            return "Just now"
        }

        let minutes = Int(seconds / 60)
        if minutes < 60 {
            return "\(minutes)m"
        }

        let hours = Int(seconds / 3_600)
        return "\(max(1, min(hours, 23)))h"
    }

    static var storyDateFormatter: ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }

    static var fallbackStoryDateFormatter: ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }
}
