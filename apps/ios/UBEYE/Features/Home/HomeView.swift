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
                VStack(alignment: .leading, spacing: 22) {
                    header

                    if store.isLoading && store.feed == nil {
                        ProgressView()
                            .tint(.white)
                            .frame(maxWidth: .infinity, minHeight: 160)
                    } else if let error = store.error, store.feed == nil {
                        EmptyStateView(title: "Could not load stories", message: error, systemImage: "wifi.exclamationmark")
                    }

                    if let feed = store.feed {
                        MyStoryCard(myStory: feed.myStory)
                            .onTapGesture {
                                if feed.myStory.hasActiveStory {
                                    selectedStory = StoryRoute(id: "my-story")
                                }
                            }

                        if !feed.followingStories.isEmpty {
                            sectionTitle("Following")
                            horizontalStories(feed.followingStories)
                        }

                        sectionTitle("Discover")
                        DiscoverGrid(tiles: feed.discoverTiles) { tile in
                            selectedStory = StoryRoute(id: tile.id)
                        }
                    }
                }
                .padding(18)
            }
            .refreshable {
                await store.load(api: api)
            }
            .navigationTitle("UBEYE")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink {
                        SettingsView()
                    } label: {
                        Image(systemName: "gearshape")
                    }
                }
            }
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
        VStack(alignment: .leading, spacing: 6) {
            Text("For You")
                .font(.largeTitle.bold())
            Text("@\(auth.account?.handle ?? "account")")
                .foregroundStyle(.white.opacity(0.65))
        }
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(.title3.bold())
            .padding(.top, 4)
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

struct MyStoryCard: View {
    let myStory: MyStorySummary

    var body: some View {
        HStack(spacing: 14) {
            AsyncImage(url: myStory.latestThumbnailUrl) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Color.white.opacity(0.08)
            }
            .frame(width: 72, height: 96)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

            VStack(alignment: .leading, spacing: 6) {
                Text("My Story")
                    .font(.headline)
                Text(myStory.hasActiveStory ? "\(myStory.liveCount) live" : "No active story")
                    .foregroundStyle(.white.opacity(0.68))
                if let label = myStory.expiresSoonLabel {
                    Text(label)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.ubeyeRed)
                }
            }
            Spacer()
        }
        .padding(14)
        .background(Color.ubeyePanel)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

struct StoryThumb: View {
    let story: StoryCard

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            AsyncImage(url: story.thumbnailUrl ?? story.mediaUrl) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Color.white.opacity(0.08)
            }
            .frame(width: 124, height: 172)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                Text(story.creator)
                    .font(.subheadline.bold())
                    .lineLimit(1)
                Text(story.title)
                    .font(.caption)
                    .lineLimit(1)
                    .foregroundStyle(.white.opacity(0.74))
            }
            .padding(10)
            .frame(maxWidth: 124, alignment: .leading)
            .background(.linearGradient(colors: [.clear, .black.opacity(0.78)], startPoint: .top, endPoint: .bottom))
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
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
                            Color.white.opacity(0.08)
                        }
                        .frame(height: 220)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

                        VStack(alignment: .leading, spacing: 2) {
                            Text(tile.title)
                                .font(.headline)
                            if let subtitle = tile.subtitle {
                                Text(subtitle)
                                    .font(.caption)
                                    .foregroundStyle(.white.opacity(0.74))
                            }
                        }
                        .padding(12)
                    }
                }
                .buttonStyle(.plain)
            }
        }
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
