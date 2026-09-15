import Foundation
import SwiftUI

extension Error {
    var isCancellation: Bool {
        if self is CancellationError {
            return true
        }

        let nsError = self as NSError
        return nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled
    }
}

struct RepliesView: View {
    @EnvironmentObject private var api: APIClient
    @StateObject private var store = RepliesStore()
    @StateObject private var refreshController = TabRefreshController()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var selectedSegment = "Received"
    @State private var navigationPath = NavigationPath()
    var onQuoteReply: (QuotedStoryReply) -> Void = { _ in }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            ScrollViewReader { scrollProxy in
                ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(alignment: .center) {
                        Text("Replies")
                            .font(.system(size: 30, weight: .semibold))
                        Spacer()
                        TopAvatarSpacer()
                    }
                    .id("replies-top")

                    ExpoSegmentedControl(items: ["Received", "Sent"], selected: $selectedSegment)

                    if let error = store.error {
                        InlineNotice(message: error, isError: true)
                    }

                    if store.isLoading && store.inbox == nil {
                        RepliesLoadingSkeleton()
                    } else if displayedReplyThreads.isEmpty {
                        EmptyStateView(
                            title: selectedSegment == "Sent" ? "No sent replies" : "No replies yet",
                            message: selectedSegment == "Sent"
                                ? "Replies you send to stories will stay organized here."
                                : "When someone replies to your story, the conversation will appear here.",
                            systemImage: selectedSegment == "Sent" ? "paperplane" : "bubble.left.and.bubble.right"
                        )
                        .padding(.top, 18)
                    } else {
                        LazyVStack(spacing: 10) {
                            ForEach(displayedReplyThreads) { thread in
                                NavigationLink(
                                    destination: ReplyThreadView(
                                        thread: thread,
                                        store: store,
                                        onQuote: onQuoteReply,
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
            .activeTabRefresh(refreshController) { _ in await store.load(api: api) }
            .onReceive(NotificationCenter.default.publisher(for: .replyInboxDidChange)) { _ in refreshController.request() }
            .refreshable {
                await store.load(api: api)
            }
            .onChange(of: selectedSegment) { _, _ in
                UBEYEFeedback.selection()
            }
            .onReceive(NotificationCenter.default.publisher(for: .appTabReselected)) { notification in
                guard notification.object as? String == AppTab.replies.rawValue else {
                    return
                }

                navigationPath = NavigationPath()
                withAnimation(reduceMotion ? nil : .snappy(duration: 0.28)) {
                    scrollProxy.scrollTo("replies-top", anchor: .top)
                }
                Task {
                    await store.load(api: api)
                }
            }
            }
        }
    }

    private var displayedReplyThreads: [ReplyThreadData] {
        selectedSegment == "Sent" ? store.sentThreads : store.receivedThreads
    }
}

private struct RepliesLoadingSkeleton: View {
    var body: some View {
        VStack(spacing: 10) {
            ForEach(0..<4, id: \.self) { index in
                ReplyCardLoadingSkeleton(messageWidth: messageWidth(for: index))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading replies")
    }

    private func messageWidth(for index: Int) -> CGFloat {
        switch index {
        case 0:
            return 214
        case 1:
            return 176
        case 2:
            return 232
        default:
            return 196
        }
    }
}

private struct ReplyCardLoadingSkeleton: View {
    let messageWidth: CGFloat

    var body: some View {
        HStack(spacing: 12) {
            UBEYESkeletonCircle(size: 48)

            VStack(alignment: .leading, spacing: 7) {
                UBEYESkeletonLine(width: 126, height: 13)
                UBEYESkeletonLine(width: 154, height: 9)
                UBEYESkeletonLine(width: messageWidth, height: 11)
            }

            Spacer(minLength: 8)

            UBEYESkeletonLine(width: 10, height: 15)
        }
        .padding(14)
        .ubeyeCard()
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

func displayTimestamp(_ value: String) -> String {
    guard let date = parseReplyDate(value) else {
        return value
    }

    return DateFormatter.ubeyeReplyTime.string(from: date)
}

func parseReplyDate(_ value: String) -> Date? {
    ISO8601DateFormatter.ubeyeWithFractionalSeconds.date(from: value) ??
        ISO8601DateFormatter.ubeye.date(from: value)
}

extension Array where Element == ReplyThreadItem {
    func sortedByCreatedAt() -> [ReplyThreadItem] {
        var dated: [(item: ReplyThreadItem, date: Date)] = map { item in
            (item: item, date: parseReplyDate(item.createdAt) ?? Date.distantPast)
        }
        dated.sort { left, right in
            if left.date == right.date { return left.item.id < right.item.id }
            return left.date < right.date
        }
        return dated.map { $0.item }
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
