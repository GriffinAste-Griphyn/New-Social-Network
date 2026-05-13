import SwiftUI

struct FollowingView: View {
    @EnvironmentObject private var api: APIClient
    @StateObject private var feed = FeedStore()
    @State private var selectedStory: StoryRoute?

    var body: some View {
        NavigationStack {
            Group {
                if feed.isLoading && feed.feed == nil {
                    ProgressView()
                        .tint(.white)
                } else if let profiles = feed.feed?.followingProfiles, profiles.isEmpty {
                    EmptyStateView(
                        title: "No follows yet",
                        message: "Follow creators from Discover to build this tab.",
                        systemImage: "person.crop.circle.badge.plus"
                    )
                } else {
                    List {
                        if let stories = feed.feed?.followingStories, !stories.isEmpty {
                            Section("Live stories") {
                                ForEach(stories) { story in
                                    Button {
                                        selectedStory = StoryRoute(id: story.id)
                                    } label: {
                                        HStack(spacing: 12) {
                                            AsyncImage(url: story.thumbnailUrl ?? story.mediaUrl) { image in
                                                image.resizable().scaledToFill()
                                            } placeholder: {
                                                Color.white.opacity(0.1)
                                            }
                                            .frame(width: 52, height: 70)
                                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                                            VStack(alignment: .leading) {
                                                Text(story.creator)
                                                    .font(.headline)
                                                Text(story.title)
                                                    .font(.subheadline)
                                                    .foregroundStyle(.white.opacity(0.65))
                                            }
                                        }
                                    }
                                    .listRowBackground(Color.ubeyeInk)
                                }
                            }
                        }

                        Section("Creators") {
                            ForEach(feed.feed?.followingProfiles ?? []) { profile in
                                CreatorStaticRow(profile: profile)
                                    .listRowBackground(Color.ubeyeInk)
                            }
                        }
                    }
                    .scrollContentBackground(.hidden)
                }
            }
            .navigationTitle("Following")
            .ubeyeScreen()
            .task {
                await feed.load(api: api)
            }
            .refreshable {
                await feed.load(api: api)
            }
            .fullScreenCover(item: $selectedStory) { route in
                StoryStackViewer(route: route)
            }
        }
    }
}

struct CreatorStaticRow: View {
    let profile: FollowingProfile

    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: profile.imageUrl) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Circle().fill(.white.opacity(0.1))
            }
            .frame(width: 44, height: 44)
            .clipShape(Circle())

            VStack(alignment: .leading) {
                Text(profile.name)
                    .font(.headline)
                Text("@\(profile.handle)")
                    .foregroundStyle(.white.opacity(0.64))
            }
        }
        .foregroundStyle(.white)
    }
}
