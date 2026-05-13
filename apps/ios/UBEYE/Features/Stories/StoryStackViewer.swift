import AVKit
import SwiftUI

struct StoryRoute: Identifiable, Hashable {
    let id: String
}

@MainActor
final class StoryStackStore: ObservableObject {
    @Published var stack: StoryStack?
    @Published var isLoading = false
    @Published var error: String?
    @Published var replyText = ""
    @Published var isSendingReply = false
    @Published var isPerformingAction = false

    private var impressionStartedAt = Date()
    private var lastImpressionStoryId: String?

    func load(storyId: String, api: APIClient) async {
        isLoading = true
        error = nil
        do {
            let response: StoryStackResponse = try await api.get("/api/mobile/stories/\(storyId)")
            stack = response.story
            impressionStartedAt = Date()
            lastImpressionStoryId = response.story.items.first?.id
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func markActiveItem(_ item: StoryStackItem) {
        if lastImpressionStoryId != item.id {
            impressionStartedAt = Date()
            lastImpressionStoryId = item.id
        }
    }

    func recordImpression(item: StoryStackItem, completed: Bool, api: APIClient) async {
        let viewedMs = max(0, Int(Date().timeIntervalSince(impressionStartedAt) * 1000))
        try? await api.recordStoryImpression(storyId: item.id, viewedMs: viewedMs, completed: completed)
    }

    func sendReply(item: StoryStackItem, api: APIClient) async {
        let trimmed = replyText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return
        }

        isSendingReply = true
        error = nil
        do {
            let _: StoryInteractionResponse = try await api.sendStoryReply(storyId: item.id, body: trimmed, reaction: nil)
            replyText = ""
        } catch {
            self.error = error.localizedDescription
        }
        isSendingReply = false
    }

    func sendReaction(_ reaction: String, item: StoryStackItem, api: APIClient) async {
        isSendingReply = true
        error = nil
        do {
            let _: StoryInteractionResponse = try await api.sendStoryReply(storyId: item.id, body: nil, reaction: reaction)
        } catch {
            self.error = error.localizedDescription
        }
        isSendingReply = false
    }

    func delete(item: StoryStackItem, api: APIClient) async -> Bool {
        isPerformingAction = true
        defer { isPerformingAction = false }
        do {
            let _: BasicOkResponse = try await api.delete("/api/mobile/stories/\(item.id)", body: EmptyPayload())
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func report(item: StoryStackItem, api: APIClient) async {
        isPerformingAction = true
        defer { isPerformingAction = false }
        do {
            let _: SafetyReportResponse = try await api.submitReport(
                targetKind: "story",
                targetId: item.id,
                reason: "spam",
                details: nil
            )
        } catch {
            self.error = error.localizedDescription
        }
    }

    func blockCreator(api: APIClient) async -> Bool {
        guard let creatorId = stack?.creatorId else {
            return false
        }

        isPerformingAction = true
        defer { isPerformingAction = false }
        do {
            try await api.blockUser(userId: creatorId, reason: "Blocked from story viewer")
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }
}

private struct EmptyPayload: Encodable {}

struct StoryStackViewer: View {
    let route: StoryRoute
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.dismiss) private var dismiss
    @StateObject private var store = StoryStackStore()
    @State private var index = 0

    private let reactions = ["😂", "😍", "🔥", "👏", "😮"]

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if store.isLoading && store.stack == nil {
                ProgressView()
                    .tint(.white)
            } else if let error = store.error, store.stack == nil {
                EmptyStateView(title: "Story unavailable", message: error, systemImage: "exclamationmark.triangle")
                    .padding()
            } else if let stack = store.stack, let item = stack.items[safe: index] {
                media(item)
                    .ignoresSafeArea()
                    .onAppear {
                        store.markActiveItem(item)
                    }
                    .onDisappear {
                        Task { await store.recordImpression(item: item, completed: false, api: api) }
                    }

                storyChrome(stack: stack, item: item)
            }
        }
        .task {
            await store.load(storyId: route.id, api: api)
        }
    }

    @ViewBuilder
    private func media(_ item: StoryStackItem) -> some View {
        if item.assetKind == .video {
            AutoPlayVideoPlayer(url: item.mediaUrl)
        } else {
            AsyncImage(url: item.mediaUrl) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                ProgressView().tint(.white)
            }
        }
    }

    private func storyChrome(stack: StoryStack, item: StoryStackItem) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                AsyncImage(url: stack.avatarUrl) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Circle().fill(.white.opacity(0.18))
                }
                .frame(width: 38, height: 38)
                .clipShape(Circle())

                VStack(alignment: .leading, spacing: 2) {
                    Text(stack.creator)
                        .font(.headline)
                    Text(item.postedAt)
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.65))
                }

                Spacer()

                Menu {
                    if isOwnStack(stack) {
                        Button(role: .destructive) {
                            Task {
                                if await store.delete(item: item, api: api) {
                                    dismiss()
                                }
                            }
                        } label: {
                            Label("Delete story", systemImage: "trash")
                        }
                    } else {
                        Button {
                            Task { await store.report(item: item, api: api) }
                        } label: {
                            Label("Report story", systemImage: "flag")
                        }
                        Button(role: .destructive) {
                            Task {
                                if await store.blockCreator(api: api) {
                                    dismiss()
                                }
                            }
                        } label: {
                            Label("Block creator", systemImage: "hand.raised")
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.title3)
                        .frame(width: 38, height: 38)
                }

                Button {
                    Task { await store.recordImpression(item: item, completed: false, api: api) }
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.headline)
                        .frame(width: 38, height: 38)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 18)
            .foregroundStyle(.white)

            Spacer()

            VStack(spacing: 14) {
                if let overlay = item.textOverlays?.first, !overlay.label.isEmpty {
                    Text(overlay.label)
                        .font(.title3.bold())
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(.black.opacity(0.42), in: Capsule())
                } else if !item.title.isEmpty {
                    Text(item.title)
                        .font(.headline)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(.black.opacity(0.42), in: Capsule())
                }

                if isOwnStack(stack), let stats = item.stats {
                    ownerStats(stats)
                } else {
                    replyComposer(item)
                }

                HStack {
                    Button {
                        move(-1, item: item)
                    } label: {
                        Image(systemName: "chevron.left")
                            .frame(width: 44, height: 44)
                    }
                    .disabled(index == 0)

                    Spacer()

                    Button {
                        move(1, item: item)
                    } label: {
                        Image(systemName: "chevron.right")
                            .frame(width: 44, height: 44)
                    }
                    .disabled(index >= (store.stack?.items.count ?? 1) - 1)
                }
                .font(.title3.bold())
                .foregroundStyle(.white)
                .padding(.horizontal, 8)
            }
            .padding(16)
        }
    }

    private func replyComposer(_ item: StoryStackItem) -> some View {
        VStack(spacing: 10) {
            HStack {
                ForEach(reactions, id: \.self) { reaction in
                    Button(reaction) {
                        Task { await store.sendReaction(reaction, item: item, api: api) }
                    }
                    .font(.title2)
                }
                Spacer()
            }

            HStack(spacing: 10) {
                TextField("Reply", text: $store.replyText)
                    .padding(.horizontal, 14)
                    .frame(height: 46)
                    .background(.white.opacity(0.14), in: Capsule())
                    .foregroundStyle(.white)
                Button {
                    Task { await store.sendReply(item: item, api: api) }
                } label: {
                    Image(systemName: store.isSendingReply ? "hourglass" : "paperplane.fill")
                        .frame(width: 46, height: 46)
                        .background(Color.ubeyeRed, in: Circle())
                }
                .disabled(store.isSendingReply)
            }
        }
    }

    private func ownerStats(_ stats: StoryStackItem.Stats) -> some View {
        HStack {
            stat("Views", stats.views)
            stat("Replies", stats.replies)
            stat("Earned", stats.earningsCents / 100)
        }
        .padding(12)
        .background(.black.opacity(0.5), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func stat(_ label: String, _ value: Int) -> some View {
        VStack(spacing: 2) {
            Text("\(value)")
                .font(.headline)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.62))
        }
        .frame(maxWidth: .infinity)
    }

    private func move(_ delta: Int, item: StoryStackItem) {
        Task { await store.recordImpression(item: item, completed: delta > 0, api: api) }
        index = min(max(index + delta, 0), max((store.stack?.items.count ?? 1) - 1, 0))
        if let next = store.stack?.items[safe: index] {
            store.markActiveItem(next)
        }
    }

    private func isOwnStack(_ stack: StoryStack) -> Bool {
        stack.id == "my-story" || stack.handle.trimmingCharacters(in: CharacterSet(charactersIn: "@")) == auth.account?.handle
    }
}

struct AutoPlayVideoPlayer: View {
    let url: URL
    @State private var player: AVPlayer?

    var body: some View {
        VideoPlayer(player: player)
            .onAppear {
                let next = AVPlayer(url: url)
                player = next
                next.play()
            }
            .onDisappear {
                player?.pause()
                player = nil
            }
    }
}
