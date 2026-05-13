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
                        .tint(.ubeyeRed)
                } else if let profiles = feed.feed?.followingProfiles, profiles.isEmpty {
                    EmptyStateView(
                        title: "No follows yet",
                        message: "Follow creators from Discover to build this tab.",
                        systemImage: "person.crop.circle.badge.plus"
                    )
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Following")
                                    .font(.system(size: 30, weight: .black, design: .rounded))
                                Text("Creators and live stories from your UBEYE graph.")
                                    .font(.subheadline)
                                    .foregroundStyle(Color.ubeyeMuted)
                            }

                        if let stories = feed.feed?.followingStories, !stories.isEmpty {
                            SectionHeader(title: "Live stories", actionTitle: nil)
                            VStack(spacing: 10) {
                                ForEach(stories) { story in
                                    Button {
                                        selectedStory = StoryRoute(id: story.id)
                                    } label: {
                                        HStack(spacing: 12) {
                                            AsyncImage(url: story.thumbnailUrl ?? story.mediaUrl) { image in
                                                image.resizable().scaledToFill()
                                            } placeholder: {
                                                Color.ubeyeSubtle
                                            }
                                            .frame(width: 52, height: 70)
                                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                                            VStack(alignment: .leading) {
                                                Text(story.creator)
                                                    .font(.headline)
                                                Text(story.title)
                                                    .font(.subheadline)
                                                    .foregroundStyle(Color.ubeyeMuted)
                                            }

                                            Spacer()

                                            Image(systemName: "chevron.right")
                                                .font(.caption.bold())
                                                .foregroundStyle(Color.ubeyeMuted)
                                        }
                                        .padding(10)
                                        .ubeyeCard()
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }

                            SectionHeader(title: "Creators", actionTitle: nil)
                            VStack(spacing: 10) {
                                ForEach(feed.feed?.followingProfiles ?? []) { profile in
                                    CreatorStaticRow(profile: profile)
                                }
                            }
                        }
                        .padding(16)
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
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
            RemoteAvatar(url: profile.imageUrl, size: 46, name: profile.name)

            VStack(alignment: .leading) {
                Text(profile.name)
                    .font(.headline)
                Text("@\(profile.handle)")
                    .font(.subheadline)
                    .foregroundStyle(Color.ubeyeMuted)
            }

            Spacer()
        }
        .foregroundStyle(Color.ubeyeInk)
        .padding(12)
        .ubeyeCard()
    }
}
