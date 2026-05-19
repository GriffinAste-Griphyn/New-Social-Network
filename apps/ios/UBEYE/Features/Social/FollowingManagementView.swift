import SwiftUI

extension Notification.Name {
    static let followingQueueDidChange = Notification.Name("ubeye.followingQueueDidChange")
    static let storyUploadDidComplete = Notification.Name("ubeye.storyUploadDidComplete")
    static let storyDidDelete = Notification.Name("ubeye.storyDidDelete")
}

@MainActor
final class FollowingManagementStore: ObservableObject {
    @Published var followers: [FollowingProfile] = []
    @Published var following: [FollowingProfile] = []
    @Published var removingIds = Set<String>()
    @Published var isLoading = false
    @Published var error: String?

    func load(api: APIClient) async {
        isLoading = true
        error = nil
        do {
            let response: FollowProfilesResponse = try await api.get("/api/mobile/follows/profiles")
            followers = response.followers
            following = response.following
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func removeFromFollowing(_ profile: FollowingProfile, api: APIClient) async {
        struct Body: Encodable {
            let creatorId: String
        }

        removingIds.insert(profile.id)
        error = nil
        defer {
            removingIds.remove(profile.id)
        }

        do {
            let _: BasicOkResponse = try await api.delete("/api/mobile/follows", body: Body(creatorId: profile.id))
            following.removeAll { $0.id == profile.id }
            NotificationCenter.default.post(name: .followingQueueDidChange, object: nil)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct FollowingManagementView: View {
    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @StateObject private var store = FollowingManagementStore()
    @State private var selectedTab: FollowManagementTab = .following
    @State private var pendingRemoval: FollowingProfile?
    @State private var isConfirmingRemoval = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                tabs

                if let error = store.error {
                    InlineNotice(message: error, isError: true)
                }

                content
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 32)
        }
        .refreshable {
            await store.load(api: api)
        }
        .toolbar(.hidden, for: .navigationBar)
        .ubeyeScreen()
        .task {
            await store.load(api: api)
        }
        .confirmationDialog(
            "Remove from Following?",
            isPresented: $isConfirmingRemoval,
            titleVisibility: .visible
        ) {
            if let profile = pendingRemoval {
                Button("Remove @\(profile.handle)", role: .destructive) {
                    pendingRemoval = nil
                    Task {
                        await store.removeFromFollowing(profile, api: api)
                    }
                }
            }
            Button("Cancel", role: .cancel) {
                pendingRemoval = nil
            }
        } message: {
            if let profile = pendingRemoval {
                Text("\(profile.name) will no longer appear in your Following queue.")
            }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 17, weight: .bold))
                    .frame(width: 38, height: 38)
                    .foregroundStyle(Color.ubeyeInk)
                    .background(Color.ubeyeSubtle, in: Circle())
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 2) {
                Text("Manage")
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(Color.ubeyeInk)
                Text("Following queue")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.ubeyeMuted)
            }

            Spacer()
        }
    }

    private var tabs: some View {
        Picker("Follow list", selection: $selectedTab) {
            ForEach(FollowManagementTab.allCases) { tab in
                Text(tab.label(count: count(for: tab))).tag(tab)
            }
        }
        .pickerStyle(.segmented)
    }

    @ViewBuilder
    private var content: some View {
        if store.isLoading && profiles.isEmpty {
            ProgressView()
                .tint(.ubeyeRed)
                .frame(maxWidth: .infinity, minHeight: 180)
        } else if profiles.isEmpty {
            EmptyStateView(
                title: selectedTab.emptyTitle,
                message: selectedTab.emptyMessage,
                systemImage: selectedTab.emptySystemImage
            )
            .frame(maxWidth: .infinity, minHeight: 220)
        } else {
            LazyVStack(spacing: 10) {
                ForEach(profiles) { profile in
                    FollowManagementRow(
                        profile: profile,
                        showsRemove: selectedTab == .following,
                        isRemoving: store.removingIds.contains(profile.id)
                    ) {
                        pendingRemoval = profile
                        isConfirmingRemoval = true
                    }
                }
            }
        }
    }

    private var profiles: [FollowingProfile] {
        switch selectedTab {
        case .following:
            return store.following
        case .followers:
            return store.followers
        }
    }

    private func count(for tab: FollowManagementTab) -> Int {
        switch tab {
        case .following:
            return store.following.count
        case .followers:
            return store.followers.count
        }
    }
}

private enum FollowManagementTab: String, CaseIterable, Identifiable {
    case following = "Following"
    case followers = "Followers"

    var id: String { rawValue }

    func label(count: Int) -> String {
        "\(rawValue) \(count)"
    }

    var emptyTitle: String {
        switch self {
        case .following:
            return "No following yet"
        case .followers:
            return "No followers yet"
        }
    }

    var emptyMessage: String {
        switch self {
        case .following:
            return "Follow creators to add them to your queue."
        case .followers:
            return "People who follow you will show up here."
        }
    }

    var emptySystemImage: String {
        switch self {
        case .following:
            return "person.crop.circle.badge.plus"
        case .followers:
            return "person.2"
        }
    }
}

private struct FollowManagementRow: View {
    let profile: FollowingProfile
    let showsRemove: Bool
    let isRemoving: Bool
    let removeAction: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            RemoteAvatar(url: profile.imageUrl, size: 50, name: profile.name)

            VStack(alignment: .leading, spacing: 3) {
                Text(profile.name)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Color.ubeyeInk)
                    .lineLimit(1)
                Text("@\(profile.handle)")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.ubeyeMuted)
                    .lineLimit(1)
            }

            Spacer(minLength: 12)

            if showsRemove {
                Button(action: removeAction) {
                    HStack(spacing: 6) {
                        if isRemoving {
                            ProgressView()
                                .controlSize(.mini)
                                .tint(Color.ubeyeInk)
                        }
                        Text(isRemoving ? "Removing" : "Remove")
                    }
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Color.ubeyeInk)
                    .padding(.horizontal, 12)
                    .frame(height: 34)
                    .background(Color.ubeyeSubtle, in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(isRemoving)
            }
        }
        .padding(12)
        .background(.white, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Color.ubeyeBorder, lineWidth: 1)
        )
    }
}
