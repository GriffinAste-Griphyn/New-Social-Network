import SwiftUI

@MainActor
final class RepliesStore: ObservableObject {
    @Published var inbox: StoryInteractionInboxResponse?
    @Published var isLoading = false
    @Published var error: String?

    func load(api: APIClient) async {
        isLoading = true
        error = nil
        do {
            inbox = try await api.get("/api/mobile/stories/inbox/interactions")
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}

struct RepliesView: View {
    @EnvironmentObject private var api: APIClient
    @StateObject private var store = RepliesStore()
    @State private var selectedStory: StoryRoute?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Replies")
                            .font(.system(size: 30, weight: .black, design: .rounded))
                        Text("Story replies and comments you received or sent.")
                            .font(.subheadline)
                            .foregroundStyle(Color.ubeyeMuted)
                    }

                    if let error = store.error {
                        InlineNotice(message: error, isError: true)
                    }

                    if store.isLoading && store.inbox == nil {
                        ProgressView()
                            .tint(.ubeyeRed)
                            .frame(maxWidth: .infinity, minHeight: 160)
                    } else if let inbox = store.inbox {
                        if inbox.interactions.isEmpty && inbox.sentInteractions.isEmpty {
                            EmptyStateView(
                                title: "No replies yet",
                                message: "Replies to your stories will show up here.",
                                systemImage: "paperplane"
                            )
                        } else {
                            if !inbox.interactions.isEmpty {
                                SectionHeader(title: "Received", actionTitle: nil)
                                VStack(spacing: 10) {
                                    ForEach(inbox.interactions) { interaction in
                                        ReceivedReplyRow(interaction: interaction) {
                                            selectedStory = StoryRoute(id: interaction.storyId)
                                        }
                                    }
                                }
                            }

                            if !inbox.sentInteractions.isEmpty {
                                SectionHeader(title: "Sent", actionTitle: nil)
                                VStack(spacing: 10) {
                                    ForEach(inbox.sentInteractions) { interaction in
                                        SentReplyRow(interaction: interaction) {
                                            selectedStory = StoryRoute(id: interaction.storyId)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(16)
            }
            .navigationTitle("Replies")
            .navigationBarTitleDisplayMode(.inline)
            .ubeyeScreen()
            .task {
                await store.load(api: api)
            }
            .refreshable {
                await store.load(api: api)
            }
            .fullScreenCover(item: $selectedStory) { route in
                StoryStackViewer(route: route)
            }
        }
    }
}

struct ReceivedReplyRow: View {
    let interaction: StoryInteractionEvent
    let action: () -> Void

    var body: some View {
        ReplyRowShell(
            avatarUrl: interaction.actor.imageUrl,
            name: interaction.actor.name,
            handle: interaction.actor.handle,
            title: "Replied to your story",
            message: interaction.body ?? interaction.reaction ?? "Reply",
            storyThumbnailUrl: interaction.story.thumbnailUrl ?? interaction.story.mediaUrl,
            createdAt: interaction.createdAt,
            action: action
        )
    }
}

struct SentReplyRow: View {
    let interaction: SentStoryInteractionEvent
    let action: () -> Void

    var body: some View {
        ReplyRowShell(
            avatarUrl: interaction.target.imageUrl,
            name: interaction.target.name,
            handle: interaction.target.handle,
            title: "Sent to @\(interaction.target.handle)",
            message: interaction.body ?? interaction.reaction ?? "Reply",
            storyThumbnailUrl: interaction.story.thumbnailUrl ?? interaction.story.mediaUrl,
            createdAt: interaction.createdAt,
            action: action
        )
    }
}

private struct ReplyRowShell: View {
    let avatarUrl: URL?
    let name: String
    let handle: String
    let title: String
    let message: String
    let storyThumbnailUrl: URL?
    let createdAt: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                RemoteAvatar(url: avatarUrl, size: 48, name: name)

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.headline)
                        .lineLimit(1)
                    Text("@\(handle)")
                        .font(.caption)
                        .foregroundStyle(Color.ubeyeMuted)
                        .lineLimit(1)
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(Color.ubeyeInk)
                        .lineLimit(2)
                    Text(createdAt)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color.ubeyeMuted)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                AsyncImage(url: storyThumbnailUrl) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Color.ubeyeSubtle
                }
                .frame(width: 52, height: 70)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            .padding(12)
            .ubeyeCard()
        }
        .buttonStyle(.plain)
    }
}
