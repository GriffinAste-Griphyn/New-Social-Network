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
    @State private var selectedSegment = "Received"

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(alignment: .center) {
                        Text("Replies")
                            .font(.system(size: 30, weight: .bold))
                        Spacer()
                        TopAvatarSpacer()
                    }

                    ExpoSegmentedControl(items: ["Received", "Sent"], selected: $selectedSegment)

                    if let error = store.error {
                        InlineNotice(message: error, isError: true)
                    }

                    if store.isLoading && store.inbox == nil {
                        ProgressView()
                            .tint(.ubeyeRed)
                            .frame(maxWidth: .infinity, minHeight: 160)
                    } else if displayedReplyThreads.isEmpty {
                        EmptyView()
                    } else {
                        VStack(spacing: 10) {
                            ForEach(displayedReplyThreads) { thread in
                                NavigationLink(destination: ReplyThreadView(thread: thread)) {
                                    ExpoReplyCard(row: thread.row)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .padding(16)
                .padding(.bottom, 22)
            }
            .scrollIndicators(.hidden)
            .toolbar(.hidden, for: .navigationBar)
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

    private var displayedReplyThreads: [ReplyThreadData] {
        if let inbox = store.inbox {
            if selectedSegment == "Sent" {
                return inbox.sentInteractions.map { interaction in
                    let creator = FixtureCreator(
                        id: interaction.target.id,
                        name: interaction.target.name,
                        handle: interaction.target.handle,
                        imageUrl: interaction.target.imageUrl,
                        initials: String(interaction.target.name.prefix(2)).uppercased(),
                        isFollowing: true
                    )
                    let row = ExpoReplyRowData(
                        id: interaction.id,
                        creator: creator,
                        timestamp: displayTimestamp(interaction.createdAt),
                        message: interaction.body ?? interaction.reaction ?? "Sent a reply."
                    )
                    let items = inbox.sentInteractions
                        .filter { $0.target.id == interaction.target.id }
                        .map { ReplyThreadItem(sent: $0) }
                        .sortedByCreatedAt()

                    return ReplyThreadData(id: interaction.id, creator: creator, row: row, items: items)
                }
            }

            if !inbox.interactions.isEmpty {
                return inbox.interactions.map { interaction in
                    let creator = FixtureCreator(
                        id: interaction.actor.id,
                        name: interaction.actor.name,
                        handle: interaction.actor.handle,
                        imageUrl: interaction.actor.imageUrl,
                        initials: String(interaction.actor.name.prefix(2)).uppercased(),
                        isFollowing: true
                    )
                    let row = ExpoReplyRowData(
                        id: interaction.id,
                        creator: creator,
                        timestamp: displayTimestamp(interaction.createdAt),
                        message: interaction.body ?? interaction.reaction ?? "Sent a photo reply."
                    )
                    let items = inbox.interactions
                        .filter { $0.actor.id == interaction.actor.id }
                        .map { ReplyThreadItem(received: $0) }
                        .sortedByCreatedAt()

                    return ReplyThreadData(id: interaction.id, creator: creator, row: row, items: items)
                }
            }
        }

        return []
    }

    private var displayedReplyRows: [ExpoReplyRowData] {
        if let inbox = store.inbox {
            if selectedSegment == "Sent" {
                return inbox.sentInteractions.map { interaction in
                    ExpoReplyRowData(
                        id: interaction.id,
                        creator: FixtureCreator(
                            id: interaction.target.id,
                            name: interaction.target.name,
                            handle: interaction.target.handle,
                            imageUrl: interaction.target.imageUrl,
                            initials: String(interaction.target.name.prefix(2)).uppercased(),
                            isFollowing: true
                        ),
                        timestamp: interaction.createdAt,
                        message: interaction.body ?? interaction.reaction ?? "Sent a reply."
                    )
                }
            }

            if !inbox.interactions.isEmpty {
                return inbox.interactions.map { interaction in
                    ExpoReplyRowData(
                        id: interaction.id,
                        creator: FixtureCreator(
                            id: interaction.actor.id,
                            name: interaction.actor.name,
                            handle: interaction.actor.handle,
                            imageUrl: interaction.actor.imageUrl,
                            initials: String(interaction.actor.name.prefix(2)).uppercased(),
                            isFollowing: true
                        ),
                        timestamp: interaction.createdAt,
                        message: interaction.body ?? interaction.reaction ?? "Sent a photo reply."
                    )
                }
            }
        }

        return []
    }
}

struct ExpoReplyRowData: Identifiable {
    let id: String
    let creator: FixtureCreator
    let timestamp: String
    let message: String
}

struct ExpoReplyCard: View {
    let row: ExpoReplyRowData

    var body: some View {
        HStack(spacing: 12) {
            RemoteAvatar(url: row.creator.imageUrl, size: 48, name: row.creator.name)

            VStack(alignment: .leading, spacing: 4) {
                Text(row.creator.name)
                    .font(.system(size: 16, weight: .bold))
                Text("@\(row.creator.handle) · \(row.timestamp)")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Color.ubeyeMuted)
                    .lineLimit(1)
                Text(row.message)
                    .font(.subheadline)
                    .foregroundStyle(Color.ubeyeInk)
                    .lineLimit(2)
            }

            Spacer(minLength: 8)

            Image(systemName: "chevron.right")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Color.ubeyeMuted.opacity(0.65))
        }
        .padding(14)
        .ubeyeCard()
    }
}

struct ReplyThreadData: Identifiable {
    let id: String
    let creator: FixtureCreator
    let row: ExpoReplyRowData
    let items: [ReplyThreadItem]
}

struct ReplyThreadItem: Identifiable, Hashable {
    let id: String
    let title: String
    let message: String
    let createdAt: String
    let assetKind: SocialAssetKind
    let mediaUrl: URL?
    let thumbnailUrl: URL?

    init(
        id: String,
        title: String,
        message: String,
        createdAt: String,
        assetKind: SocialAssetKind,
        mediaUrl: URL?,
        thumbnailUrl: URL?
    ) {
        self.id = id
        self.title = title
        self.message = message
        self.createdAt = createdAt
        self.assetKind = assetKind
        self.mediaUrl = mediaUrl
        self.thumbnailUrl = thumbnailUrl
    }

    init(received interaction: StoryInteractionEvent) {
        self.init(
            id: interaction.id,
            title: "\(interaction.actor.name) replied to your Story",
            message: interaction.body ?? interaction.reaction ?? "Sent a photo reply.",
            createdAt: interaction.createdAt,
            assetKind: interaction.story.assetKind,
            mediaUrl: interaction.story.mediaUrl,
            thumbnailUrl: interaction.story.thumbnailUrl
        )
    }

    init(sent interaction: SentStoryInteractionEvent) {
        self.init(
            id: interaction.id,
            title: "You replied to \(interaction.target.name)'s Story",
            message: interaction.body ?? interaction.reaction ?? "Sent a reply.",
            createdAt: interaction.createdAt,
            assetKind: interaction.story.assetKind,
            mediaUrl: interaction.story.mediaUrl,
            thumbnailUrl: interaction.story.thumbnailUrl
        )
    }
}

struct ReplyThreadView: View {
    @Environment(\.dismiss) private var dismiss
    let thread: ReplyThreadData
    @State private var message = ""

    init(thread: ReplyThreadData) {
        self.thread = thread
    }

    init(creator: FixtureCreator) {
        let row = ExpoReplyRowData(
            id: "fixture-thread-\(creator.id)",
            creator: creator,
            timestamp: "Now",
            message: "No story replies in this chat yet."
        )
        let story = DesignFixtures.stories.first
        self.thread = ReplyThreadData(
            id: row.id,
            creator: creator,
            row: row,
            items: [
                ReplyThreadItem(
                    id: row.id,
                    title: "\(creator.name) replied to your Story",
                    message: row.message,
                    createdAt: row.timestamp,
                    assetKind: .image,
                    mediaUrl: story?.imageUrl,
                    thumbnailUrl: story?.imageUrl
                )
            ]
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(Color.ubeyeInk)
                }
                .buttonStyle(.plain)

                RemoteAvatar(url: thread.creator.imageUrl, size: 42, name: thread.creator.name)
                Text(thread.creator.handle)
                    .font(.system(size: 18, weight: .bold))
                    .lineLimit(1)
                Spacer()
                Image(systemName: "camera")
                    .font(.system(size: 17, weight: .bold))
                    .frame(width: 38, height: 38)
                    .foregroundStyle(Color.ubeyeMuted)
                    .background(Color.ubeyeSubtle, in: Circle())
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(.white)

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 14) {
                        ForEach(thread.items) { item in
                            ReplyThreadStoryCard(item: item)
                                .id(item.id)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 14)
                    .padding(.bottom, 20)
                }
                .scrollIndicators(.hidden)
                .onAppear {
                    scrollToBottom(proxy)
                }
                .onChange(of: thread.items.count) { _, _ in
                    scrollToBottom(proxy)
                }
            }

            HStack(spacing: 14) {
                Image(systemName: "camera.fill")
                    .font(.system(size: 18, weight: .bold))
                    .frame(width: 46, height: 46)
                    .foregroundStyle(.white)
                    .background(Color.ubeyeNavy, in: Circle())

                TextField("Send a chat", text: $message)
                    .font(.system(size: 16, weight: .regular))
                    .padding(.horizontal, 16)
                    .frame(height: 44)
                    .background(Color.ubeyeSubtle, in: Capsule())
                    .overlay(Capsule().stroke(Color.ubeyeBorder, lineWidth: 1))

                Image(systemName: "face.smiling")
                    .font(.system(size: 21, weight: .semibold))
                    .foregroundStyle(Color.ubeyeMuted)
                Image(systemName: "photo.on.rectangle")
                    .font(.system(size: 21, weight: .semibold))
                    .foregroundStyle(Color.ubeyeMuted)
            }
            .padding(12)
            .background(.white)
            .overlay(alignment: .top) { Divider() }
        }
        .background(Color.ubeyeBackground.ignoresSafeArea())
        .navigationBarBackButtonHidden()
        .toolbar(.hidden, for: .navigationBar)
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        guard let last = thread.items.last else {
            return
        }

        Task {
            try? await Task.sleep(for: .milliseconds(120))
            await MainActor.run {
                withAnimation(.snappy) {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
        }
    }
}

private struct ReplyThreadStoryCard: View {
    let item: ReplyThreadItem

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(item.title)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Color.ubeyeInk)
                    .lineLimit(2)

                Spacer(minLength: 8)

                Text(displayTimestamp(item.createdAt))
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Color.ubeyeMuted.opacity(0.7))
                    .lineLimit(1)
            }
            .padding(.horizontal, 12)
            .padding(.top, 10)

            ZStack(alignment: .bottomTrailing) {
                ReplyStoryMedia(url: item.thumbnailUrl ?? item.mediaUrl, assetKind: item.assetKind)
                    .frame(width: 218, height: 318)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, 12)
                    .padding(.bottom, 14)

                Text(item.message)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Color.ubeyeInk)
                    .multilineTextAlignment(.leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(Color.ubeyeRed.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(Color.ubeyeRed.opacity(0.25), lineWidth: 1)
                    )
                    .padding(.trailing, 14)
                    .padding(.bottom, 46)
                    .frame(maxWidth: 220, alignment: .trailing)
            }
        }
        .background(Color.white, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(alignment: .leading) {
            Color.ubeyeRed
                .frame(width: 4)
                .clipShape(RoundedRectangle(cornerRadius: 2, style: .continuous))
        }
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Color.ubeyeBorder, lineWidth: 1)
        )
    }
}

private struct ReplyStoryMedia: View {
    let url: URL?
    let assetKind: SocialAssetKind

    var body: some View {
        ZStack {
            Color.ubeyeSubtle

            CachedAsyncImage(url: url) { image in
                image
                    .resizable()
                    .scaledToFill()
            } placeholder: {
                ProgressView()
                    .tint(.ubeyeRed)
            }

            if assetKind == .video {
                Image(systemName: "play.fill")
                    .font(.system(size: 18, weight: .bold))
                    .frame(width: 42, height: 42)
                    .foregroundStyle(.white)
                    .background(.black.opacity(0.42), in: Circle())
            }
        }
    }
}

private func displayTimestamp(_ value: String) -> String {
    guard let date = parseReplyDate(value) else {
        return value
    }

    return DateFormatter.ubeyeReplyTime.string(from: date)
}

private func parseReplyDate(_ value: String) -> Date? {
    ISO8601DateFormatter.ubeyeWithFractionalSeconds.date(from: value) ??
        ISO8601DateFormatter.ubeye.date(from: value)
}

private extension Array where Element == ReplyThreadItem {
    func sortedByCreatedAt() -> [ReplyThreadItem] {
        sorted { left, right in
            let leftDate = parseReplyDate(left.createdAt) ?? .distantPast
            let rightDate = parseReplyDate(right.createdAt) ?? .distantPast

            return leftDate < rightDate
        }
    }
}

private extension ISO8601DateFormatter {
    static let ubeye: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static let ubeyeWithFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

private extension DateFormatter {
    static let ubeyeReplyTime: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter
    }()
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

                CachedAsyncImage(url: storyThumbnailUrl) { image in
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
