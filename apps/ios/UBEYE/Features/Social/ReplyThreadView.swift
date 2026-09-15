import SwiftUI

struct ReplyThreadView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: RepliesStore
    let thread: ReplyThreadData
    let onQuote: (QuotedStoryReply) -> Void
    let onDelete: (String) async -> Void

    init(thread: ReplyThreadData, store: RepliesStore, onQuote: @escaping (QuotedStoryReply) -> Void,
         onDelete: @escaping (String) async -> Void) {
        self.thread = thread
        self.store = store
        self.onQuote = onQuote
        self.onDelete = onDelete
    }

    private var visibleItems: [ReplyThreadItem] { store.thread(id: thread.id)?.items ?? [] }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Button { dismiss() } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 18, weight: .bold))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Back to replies")
                RemoteAvatar(url: thread.creator.imageUrl, size: 42, name: thread.creator.name)
                Text(thread.creator.handle).font(.headline).lineLimit(1)
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            if let error = store.error { InlineNotice(message: error, isError: true).padding(.horizontal, 16) }
            ScrollView {
                LazyVStack(spacing: 14) {
                    if visibleItems.isEmpty {
                        EmptyStateView(title: "No replies here", message: "Replies in this conversation will appear here.", systemImage: "bubble.left")
                    }
                    ForEach(visibleItems) { item in
                        ReplyThreadStoryCard(item: item, onQuote: { quote(item) }, onDelete: {
                            Task { await onDelete(item.id) }
                        })
                        .disabled(store.deletingReplyIds.contains(item.id))
                    }
                }
                .padding(16)
            }
            .defaultScrollAnchor(.bottom)
            .scrollIndicators(.hidden)
            if let quotable = visibleItems.last(where: { $0.quotedReply != nil }) {
                Button { quote(quotable) } label: {
                    Label("Quote latest reply in a story", systemImage: "quote.bubble")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(UBEYEPressButtonStyle())
                .padding(12)
            }
        }
        .foregroundStyle(Color.ubeyeInk)
        .background(Color.ubeyeBackground.ignoresSafeArea())
        .navigationBarBackButtonHidden()
        .toolbar(.hidden, for: .navigationBar)
    }

    private func quote(_ item: ReplyThreadItem) {
        guard let quotedReply = item.quotedReply else { return }
        dismiss()
        onQuote(quotedReply)
    }
}

private struct ReplyThreadStoryCard: View {
    let item: ReplyThreadItem
    let onQuote: () -> Void
    let onDelete: () -> Void

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
                            .frame(width: 44, height: 44)
                            .background(Color.ubeyeSubtle, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Quote reply")
                }

                Button(role: .destructive, action: onDelete) {
                    Image(systemName: "trash")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Color.ubeyeRed)
                        .frame(width: 44, height: 44)
                        .background(Color.ubeyeRed.opacity(0.08), in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Delete reply")
            }
            .padding(.horizontal, 12)
            .padding(.top, 10)

            ZStack(alignment: .bottomLeading) {
                ZStack(alignment: .bottom) {
                    ReplyStoryMedia(url: item.thumbnailUrl ?? item.mediaUrl)
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

                ReplyMessageOverlay(message: item.message)
                    .frame(maxWidth: 214, alignment: .leading)
                    .padding(.leading, 24)
                    .padding(.bottom, 24)
            }
            .frame(maxWidth: .infinity, minHeight: 318, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 12)
            .padding(.bottom, 14)
        }
        .background(Color.white, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.ubeyeBorder.opacity(0.9), lineWidth: 1)
        )
        .shadow(color: Color.ubeyeInk.opacity(0.055), radius: 10, y: 3)
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

    var body: some View {
        ZStack {
            Color.ubeyeSubtle

            CachedAsyncImage(url: url) { image in
                image
                    .resizable()
                    .scaledToFill()
            } placeholder: {
                UBEYESkeletonBlock()
            }
        }
    }
}
