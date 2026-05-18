import SwiftUI

struct FollowingView: View {
    @EnvironmentObject private var api: APIClient
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var store = FeedStore()
    @State private var selectedStory: StoryRoute?

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    header

                    if store.isLoading && store.feed == nil {
                        ProgressView()
                            .tint(.ubeyeRed)
                            .frame(maxWidth: .infinity, minHeight: 220)
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
                                FollowingStoryFeedCard(story: story) {
                                    selectedStory = StoryRoute(
                                        id: story.id,
                                        source: .followingFeed
                                    )
                                }
                                .onAppear {
                                    api.prefetchStoryStacks(ids: [story.id], limit: 1)
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, UBEYEMetrics.screenInset)
                .padding(.top, 16)
                .padding(.bottom, 108)
            }
            .refreshable {
                await store.load(api: api, useDiskCache: false)
            }
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
                    await store.load(api: api, showsLoading: false, useDiskCache: false)
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
        }
    }

    private var header: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Following")
                    .font(.system(size: 30, weight: .bold))
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

private struct FollowingStoryFeedCard: View {
    let story: StoryCard
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack(alignment: .bottomLeading) {
                CachedAsyncImage(url: story.thumbnailUrl ?? story.mediaUrl) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    FollowingStoryCardSkeleton()
                }
                .frame(maxWidth: .infinity)
                .aspectRatio(1.08, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                LinearGradient(
                    colors: [.clear, .black.opacity(0.12), .black.opacity(0.82)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                if let overlay = story.primaryTextOverlay {
                    FollowingStoryOverlayChip(overlay: overlay)
                }

                VStack(alignment: .leading, spacing: 10) {
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

                    Text(story.title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.9))
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                .padding(16)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
            }
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(story.creator)'s story")
    }
}

private struct FollowingStoryCardSkeleton: View {
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

            VStack(alignment: .leading, spacing: 9) {
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(.white.opacity(0.62))
                    .frame(width: 112, height: 12)
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(.white.opacity(0.42))
                    .frame(width: 72, height: 10)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
            .padding(16)
        }
        .accessibilityHidden(true)
    }
}

private struct FollowingStoryOverlayChip: View {
    let overlay: StoryTextOverlay

    var body: some View {
        GeometryReader { proxy in
            HStack(spacing: 4) {
                if overlay.kind == "link" {
                    Image(systemName: "link")
                        .font(.system(size: 8, weight: .bold))
                }

                Text(overlay.label)
                    .font(.system(size: 11, weight: .bold))
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(.black.opacity(0.42), in: Capsule())
            .position(
                x: proxy.size.width * CGFloat(min(max(overlay.positionX, 10), 90) / 100),
                y: proxy.size.height * CGFloat(min(max(overlay.positionY, 10), 84) / 100)
            )
        }
        .allowsHitTesting(false)
    }
}

private extension StoryCard {
    var primaryTextOverlay: StoryTextOverlay? {
        textOverlays?.first {
            !$0.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

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
