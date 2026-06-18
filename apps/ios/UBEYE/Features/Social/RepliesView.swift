import SwiftUI

@MainActor
final class RepliesStore: ObservableObject {
    @Published var inbox: StoryInteractionInboxResponse?
    @Published var isLoading = false
    @Published var error: String?
    @Published var deletingReplyIds: Set<String> = []

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

    func deleteReply(id: String, api: APIClient) async {
        guard !deletingReplyIds.contains(id) else {
            return
        }

        let previousInbox = inbox
        deletingReplyIds.insert(id)
        error = nil
        removeReply(id: id)

        do {
            try await api.deleteStoryInteraction(id: id)
        } catch {
            inbox = previousInbox
            self.error = error.localizedDescription
        }

        deletingReplyIds.remove(id)
    }

    private func removeReply(id: String) {
        guard let inbox else {
            return
        }

        self.inbox = StoryInteractionInboxResponse(
            ok: inbox.ok,
            interactions: inbox.interactions.filter { $0.id != id },
            sentInteractions: inbox.sentInteractions.filter { $0.id != id }
        )
    }
}

struct RepliesView: View {
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var storyPresenter: StoryPresentationCoordinator
    @StateObject private var store = RepliesStore()
    @State private var selectedSegment = "Received"
    var onQuoteReply: (QuotedStoryReply) -> Void = { _ in }

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
                                NavigationLink(
                                    destination: ReplyThreadView(
                                        thread: thread,
                                        onQuote: onQuoteReply,
                                        onWarmStory: { item in
                                            warmStory(item.storyId)
                                        },
                                        onOpenStory: openStory,
                                        onDelete: { interactionId in
                                            await store.deleteReply(id: interactionId, api: api)
                                        }
                                    )
                                ) {
                                    ExpoReplyCard(
                                        row: thread.row,
                                        isDeleting: store.deletingReplyIds.contains(thread.id)
                                    )
                                }
                                .buttonStyle(.plain)
                                .disabled(store.deletingReplyIds.contains(thread.id))
                                .contextMenu {
                                    Button(role: .destructive) {
                                        Task {
                                            await store.deleteReply(id: thread.id, api: api)
                                        }
                                    } label: {
                                        Label("Delete Reply", systemImage: "trash")
                                    }
                                }
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

    private func openStory(_ item: ReplyThreadItem) {
        warmStory(item.storyId)
        storyPresenter.present(
            StoryOpeningContext(
                route: StoryRoute(id: item.storyId, source: .replies),
                thumbnailUrl: item.thumbnailUrl ?? item.mediaUrl,
                transitionId: StoryTransitionIdentity.story(item.storyId)
            )
        )
    }

    private func warmStory(_ storyId: String) {
        api.warmStoryOpening(storyId: storyId)
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
    var isDeleting = false

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

            if isDeleting {
                ProgressView()
                    .tint(.ubeyeRed)
            } else {
                Image(systemName: "chevron.right")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Color.ubeyeMuted.opacity(0.65))
            }
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
    let storyId: String
    let title: String
    let message: String
    let createdAt: String
    let assetKind: SocialAssetKind
    let mediaUrl: URL?
    let thumbnailUrl: URL?
    let quotedReply: QuotedStoryReply?

    init(
        id: String,
        storyId: String,
        title: String,
        message: String,
        createdAt: String,
        assetKind: SocialAssetKind,
        mediaUrl: URL?,
        thumbnailUrl: URL?,
        quotedReply: QuotedStoryReply?
    ) {
        self.id = id
        self.storyId = storyId
        self.title = title
        self.message = message
        self.createdAt = createdAt
        self.assetKind = assetKind
        self.mediaUrl = mediaUrl
        self.thumbnailUrl = thumbnailUrl
        self.quotedReply = quotedReply
    }

    init(received interaction: StoryInteractionEvent) {
        let message = interaction.body ?? interaction.reaction ?? "Sent a photo reply."
        self.init(
            id: interaction.id,
            storyId: interaction.storyId,
            title: "\(interaction.actor.name) replied to your Story",
            message: message,
            createdAt: interaction.createdAt,
            assetKind: interaction.story.assetKind,
            mediaUrl: interaction.story.mediaUrl,
            thumbnailUrl: interaction.story.thumbnailUrl,
            quotedReply: QuotedStoryReply(
                id: interaction.id,
                actorName: interaction.actor.name,
                actorHandle: interaction.actor.handle,
                actorAvatarUrl: interaction.actor.imageUrl,
                message: message
            )
        )
    }

    init(sent interaction: SentStoryInteractionEvent) {
        self.init(
            id: interaction.id,
            storyId: interaction.storyId,
            title: "You replied to \(interaction.target.name)'s Story",
            message: interaction.body ?? interaction.reaction ?? "Sent a reply.",
            createdAt: interaction.createdAt,
            assetKind: interaction.story.assetKind,
            mediaUrl: interaction.story.mediaUrl,
            thumbnailUrl: interaction.story.thumbnailUrl,
            quotedReply: nil
        )
    }
}

struct ReplyThreadView: View {
    @Environment(\.dismiss) private var dismiss
    let thread: ReplyThreadData
    let onQuote: (QuotedStoryReply) -> Void
    let onWarmStory: (ReplyThreadItem) -> Void
    let onOpenStory: (ReplyThreadItem) -> Void
    let onDelete: (String) async -> Void
    @State private var message = ""
    @State private var visibleItems: [ReplyThreadItem]

    init(
        thread: ReplyThreadData,
        onQuote: @escaping (QuotedStoryReply) -> Void,
        onWarmStory: @escaping (ReplyThreadItem) -> Void,
        onOpenStory: @escaping (ReplyThreadItem) -> Void,
        onDelete: @escaping (String) async -> Void
    ) {
        self.thread = thread
        self.onQuote = onQuote
        self.onWarmStory = onWarmStory
        self.onOpenStory = onOpenStory
        self.onDelete = onDelete
        _visibleItems = State(initialValue: thread.items)
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
                    storyId: story?.id ?? row.id,
                    title: "\(creator.name) replied to your Story",
                    message: row.message,
                    createdAt: row.timestamp,
                    assetKind: .image,
                    mediaUrl: story?.imageUrl,
                    thumbnailUrl: story?.imageUrl,
                    quotedReply: nil
                )
            ]
        )
        self.onQuote = { _ in }
        self.onWarmStory = { _ in }
        self.onOpenStory = { _ in }
        self.onDelete = { _ in }
        _visibleItems = State(initialValue: self.thread.items)
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
                        ForEach(visibleItems) { item in
                            ReplyThreadStoryCard(
                                item: item,
                                onPressStart: {
                                    onWarmStory(item)
                                },
                                onOpenStory: {
                                    onOpenStory(item)
                                },
                                onQuote: {
                                    quote(item)
                                },
                                onDelete: {
                                    delete(item)
                                }
                            )
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
                .onChange(of: visibleItems.count) { _, _ in
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

    private func quote(_ item: ReplyThreadItem) {
        guard let quotedReply = item.quotedReply else {
            return
        }

        dismiss()
        onQuote(quotedReply)
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        guard let last = visibleItems.last else {
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

    private func delete(_ item: ReplyThreadItem) {
        withAnimation(.snappy) {
            visibleItems.removeAll { $0.id == item.id }
        }

        Task {
            await onDelete(item.id)
            await MainActor.run {
                if visibleItems.isEmpty {
                    dismiss()
                }
            }
        }
    }
}

private struct ReplyThreadStoryCard: View {
    let item: ReplyThreadItem
    let onPressStart: () -> Void
    let onOpenStory: () -> Void
    let onQuote: () -> Void
    let onDelete: () -> Void
    @Environment(\.storyTransitionNamespace) private var storyTransitionNamespace

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
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

                if item.quotedReply != nil {
                    Button(action: onQuote) {
                        Image(systemName: "quote.bubble")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Color.ubeyeInk)
                            .frame(width: 30, height: 30)
                            .background(Color.ubeyeSubtle, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Quote reply")
                }

                Button(role: .destructive, action: onDelete) {
                    Image(systemName: "trash")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Color.ubeyeRed)
                        .frame(width: 30, height: 30)
                        .background(Color.ubeyeRed.opacity(0.08), in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Delete reply")
            }
            .padding(.horizontal, 12)
            .padding(.top, 10)

            ZStack(alignment: .bottomLeading) {
                InstantStoryButton(action: onOpenStory, onPressStart: onPressStart) {
                    ZStack(alignment: .bottom) {
                        ReplyStoryMedia(url: item.thumbnailUrl ?? item.mediaUrl, assetKind: item.assetKind)
                            .frame(width: 218, height: 318)

                        LinearGradient(
                            colors: [
                                .black.opacity(0),
                                .black.opacity(0.48),
                                .black.opacity(0.70)
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                        .frame(height: 145)
                        .frame(maxHeight: .infinity, alignment: .bottom)
                    }
                    .frame(width: 218, height: 318)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .storyMatchedGeometry(
                        id: StoryTransitionIdentity.story(item.storyId),
                        namespace: storyTransitionNamespace
                    )
                }

                ReplyMessageOverlay(message: item.message)
                    .frame(width: 214, alignment: .leading)
                    .offset(x: 148, y: -32)
            }
            .frame(maxWidth: .infinity, minHeight: 318, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 12)
            .padding(.bottom, 14)
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

private struct ReplyMessageOverlay: View {
    let message: String

    var body: some View {
        Text(message)
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(.white)
            .multilineTextAlignment(.leading)
            .lineLimit(5)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.black.opacity(0.78), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(.white.opacity(0.22), lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.28), radius: 12, y: 6)
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
