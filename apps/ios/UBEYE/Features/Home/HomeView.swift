import SwiftUI
import AVKit

@MainActor
final class FeedStore: ObservableObject {
    @Published var feed: MobileFeedResponse?
    @Published var isLoading = false
    @Published var error: String?

    func load(api: APIClient) async {
        isLoading = true
        error = nil
        do {
            let response: MobileFeedResponse = try await api.postEmpty("/api/mobile/feed")
            feed = response
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}

struct HomeView: View {
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var auth: AuthStore
    @StateObject private var store = FeedStore()
    @State private var selectedStory: StoryRoute?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header

                    if store.isLoading && store.feed == nil {
                        ProgressView()
                            .tint(.ubeyeRed)
                            .frame(maxWidth: .infinity, minHeight: 160)
                    } else if let error = store.error, store.feed == nil {
                        EmptyStateView(title: "Could not load stories", message: error, systemImage: "wifi.exclamationmark")
                    }

                    if let feed = store.feed {
                        followingStoriesSection(feed)

                        SectionHeader(title: "Discover", actionTitle: nil)
                        DiscoverGrid(tiles: feed.discoverTiles) { tile in
                            selectedStory = StoryRoute(id: tile.id)
                        }
                    }
                }
                .padding(.horizontal, 18)
                .padding(.top, 22)
                .padding(.bottom, 32)
            }
            .refreshable {
                await store.load(api: api)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .ubeyeScreen()
            .task {
                await store.load(api: api)
            }
            .fullScreenCover(item: $selectedStory) { route in
                StoryStackViewer(route: route)
            }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Button {} label: {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 29, weight: .regular))
                    .frame(width: 56, height: 56)
                    .foregroundStyle(Color.ubeyeMuted)
                    .background(Color.ubeyeSubtle, in: Circle())
            }
            .buttonStyle(.plain)

            Spacer()

            Text("Stories")
                .font(.system(size: 27, weight: .black, design: .rounded))
                .foregroundStyle(Color.ubeyeInk)

            Spacer()

            NavigationLink {
                ProfileView()
            } label: {
                ZStack {
                    Circle().fill(Color.ubeyeRed)
                    Text(profileInitials)
                        .font(.system(size: 18, weight: .black, design: .rounded))
                        .foregroundStyle(.white)
                }
                .frame(width: 56, height: 56)
            }
            .buttonStyle(.plain)
        }
    }

    private var profileInitials: String {
        let name = auth.account?.displayName ?? auth.account?.handle ?? "U"
        let parts = name.split(separator: " ")
        let letters = parts.prefix(2).compactMap { $0.first }
        let value = String(letters).uppercased()
        return value.isEmpty ? "U" : value
    }

    private func followingStoriesSection(_ feed: MobileFeedResponse) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "Following", actionTitle: nil, showsChevron: true)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    MyStoryHomeCard(myStory: feed.myStory) {
                        if feed.myStory.hasActiveStory {
                            selectedStory = StoryRoute(id: "my-story")
                        }
                    }

                    ForEach(feed.followingStories) { story in
                        StoryThumb(story: story)
                            .onTapGesture {
                                selectedStory = StoryRoute(id: story.id)
                            }
                    }
                }
                .padding(.trailing, 18)
            }

            if feed.followingStories.isEmpty && feed.followingProfiles.isEmpty {
                Text("Follow people you want in your story feed.")
                    .font(.subheadline)
                    .foregroundStyle(Color.ubeyeMuted)
            }
        }
    }

    private func followingRail(_ feed: MobileFeedResponse) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 14) {
                MyStoryBubble(myStory: feed.myStory) {
                    if feed.myStory.hasActiveStory {
                        selectedStory = StoryRoute(id: "my-story")
                    }
                }

                ForEach(feed.followingProfiles) { profile in
                    FollowingBubble(profile: profile)
                }
            }
            .padding(.vertical, 2)
        }
    }

    private func horizontalStories(_ stories: [StoryCard]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(stories) { story in
                    StoryThumb(story: story)
                        .onTapGesture {
                            selectedStory = StoryRoute(id: story.id)
                        }
                }
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
                .font(.system(size: 25, weight: .black, design: .rounded))
                .foregroundStyle(Color.ubeyeInk)
            if showsChevron {
                Image(systemName: "chevron.right")
                    .font(.system(size: 19, weight: .bold))
                    .foregroundStyle(Color.ubeyeMuted.opacity(0.45))
            }
            Spacer()
            if let actionTitle {
                Text(actionTitle)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Color.ubeyeRed)
            }
        }
        .padding(.top, 4)
    }
}

struct MyStoryHomeCard: View {
    let myStory: MyStorySummary
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack(alignment: .bottomLeading) {
                AsyncImage(url: myStory.latestThumbnailUrl) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    LinearGradient(
                        colors: [Color.ubeyeSubtle, Color.ubeyeYellow.opacity(0.45)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                }
                .frame(width: 140, height: 212)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                LinearGradient(
                    colors: [.clear, .black.opacity(0.72)],
                    startPoint: .center,
                    endPoint: .bottom
                )
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                Image(systemName: "plus")
                    .font(.system(size: 20, weight: .medium))
                    .frame(width: 38, height: 38)
                    .foregroundStyle(.white)
                    .background(Color.ubeyeInk, in: Circle())
                    .overlay(Circle().stroke(Color.white, lineWidth: 2))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    .padding(10)

                HStack(spacing: 7) {
                    Circle()
                        .fill(Color.ubeyeRed)
                        .frame(width: 8, height: 8)
                    Text("My Story")
                        .font(.system(size: 17, weight: .black, design: .rounded))
                        .lineLimit(1)
                }
                .foregroundStyle(.white)
                .padding(12)
            }
            .frame(width: 140, height: 212)
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(Color.ubeyeInk, lineWidth: 2)
            )
        }
        .buttonStyle(.plain)
    }
}

struct MyStoryBubble: View {
    let myStory: MyStorySummary
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 7) {
                ZStack(alignment: .bottomTrailing) {
                    RemoteAvatar(url: myStory.owner.imageUrl, size: 64, name: myStory.owner.name)
                        .padding(3)
                        .background(
                            Circle()
                                .fill(myStory.hasActiveStory ? Color.ubeyeRed : Color.ubeyeSubtle)
                        )

                    Image(systemName: "plus")
                        .font(.system(size: 11, weight: .black))
                        .frame(width: 22, height: 22)
                        .foregroundStyle(.white)
                        .background(Color.ubeyeRed, in: Circle())
                        .overlay(Circle().stroke(Color.white, lineWidth: 2))
                }

                Text("My Story")
                    .font(.caption.weight(.bold))
                    .lineLimit(1)
                Text(myStory.hasActiveStory ? "\(myStory.liveCount) live" : "Add")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Color.ubeyeMuted)
            }
            .frame(width: 78)
        }
        .buttonStyle(.plain)
    }
}

struct FollowingBubble: View {
    let profile: FollowingProfile

    var body: some View {
        VStack(spacing: 7) {
            RemoteAvatar(url: profile.imageUrl, size: 64, name: profile.name)
                .padding(3)
                .background(
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [.ubeyeRed, .ubeyePurple, .ubeyeYellow],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                )
            Text(profile.name)
                .font(.caption.weight(.bold))
                .lineLimit(1)
            Text("@\(profile.handle)")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Color.ubeyeMuted)
                .lineLimit(1)
        }
        .frame(width: 78)
    }
}

struct StoryThumb: View {
    let story: StoryCard

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            AsyncImage(url: story.thumbnailUrl ?? story.mediaUrl) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Color.ubeyeSubtle
            }
            .frame(width: 148, height: 212)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

            LinearGradient(
                colors: [.clear, .black.opacity(0.78)],
                startPoint: .center,
                endPoint: .bottom
            )
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

            VStack(alignment: .leading, spacing: 5) {
                Image(systemName: "star.fill")
                    .font(.system(size: 10, weight: .black))
                    .frame(width: 20, height: 20)
                    .foregroundStyle(Color.ubeyeInk)
                    .background(Color.yellow, in: Circle())
                Text(story.creator)
                    .font(.system(size: 18, weight: .black, design: .rounded))
                    .lineLimit(2)
                Text(story.title)
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                    .foregroundStyle(.white.opacity(0.74))
            }
            .padding(10)
            .frame(width: 148, height: 212, alignment: .bottomLeading)
        }
        .frame(width: 148, height: 212)
    }
}

struct DiscoverGrid: View {
    let tiles: [DiscoverTile]
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
                        AsyncImage(url: tile.thumbnailUrl ?? tile.imageUrl) { image in
                            image.resizable().scaledToFill()
                        } placeholder: {
                            Color.ubeyeSubtle
                        }
                        .frame(height: 318)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                        LinearGradient(
                            colors: [.clear, .black.opacity(0.76)],
                            startPoint: .center,
                            endPoint: .bottom
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                        VStack(alignment: .leading, spacing: 7) {
                            Image(systemName: "star.fill")
                                .font(.system(size: 10, weight: .black))
                                .frame(width: 20, height: 20)
                                .foregroundStyle(Color.ubeyeInk)
                                .background(Color.yellow, in: Circle())
                            Text(tile.title)
                                .font(.system(size: 24, weight: .black, design: .rounded))
                                .lineLimit(3)
                            if let subtitle = tile.subtitle {
                                Text(subtitle)
                                    .font(.system(size: 17, weight: .bold, design: .rounded))
                                    .foregroundStyle(.white.opacity(0.74))
                            }
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                    }
                    .foregroundStyle(.white)
                }
                .buttonStyle(.plain)
            }
        }
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
            VideoPlayer(player: AVPlayer(url: story.mediaUrl))
        } else {
            AsyncImage(url: story.mediaUrl) { image in
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
