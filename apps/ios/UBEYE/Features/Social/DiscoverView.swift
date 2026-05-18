import SwiftUI

@MainActor
final class DiscoverStore: ObservableObject {
    @Published var query = ""
    @Published var profiles: [FollowingProfile] = []
    @Published var followedIds = Set<String>()
    @Published var isLoading = false
    @Published var error: String?

    func load(api: APIClient) async {
        async let search: Void = search(api: api)
        async let follows: Void = loadFollows(api: api)
        _ = await (search, follows)
    }

    func search(api: APIClient) async {
        isLoading = true
        error = nil
        do {
            let response: DiscoverSearchResponse = try await api.get(
                "/api/mobile/discover/search",
                queryItems: [URLQueryItem(name: "q", value: query)]
            )
            profiles = response.profiles
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func loadFollows(api: APIClient) async {
        do {
            let response: FollowStateResponse = try await api.get("/api/mobile/follows")
            followedIds = Set(response.followedCreatorIds)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func follow(creatorId: String, api: APIClient) async -> Bool {
        struct Body: Encodable {
            let creatorId: String
        }

        if followedIds.contains(creatorId) {
            return true
        }

        do {
            let _: BasicOkResponse = try await api.post("/api/mobile/follows", body: Body(creatorId: creatorId))
            followedIds.insert(creatorId)
            NotificationCenter.default.post(name: .followingQueueDidChange, object: nil)
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }
}

struct DiscoverCreator: Identifiable, Hashable {
    let id: String
    let name: String
    let handle: String
    let imageUrl: URL?
    let activeStoryId: String?
    let isFollowing: Bool

    var hasActiveStory: Bool {
        activeStoryId != nil
    }
}

private enum DiscoverDestination: Identifiable {
    case profile(DiscoverCreator)

    var id: String {
        switch self {
        case .profile(let creator):
            return "profile-\(creator.id)"
        }
    }
}

struct DiscoverView: View {
    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss
    var searchFocusRequest = 0
    var embedsInNavigationStack = true
    var showsBackButton = false
    @StateObject private var store = DiscoverStore()
    @State private var destination: DiscoverDestination?
    @State private var handledSearchFocusRequest = 0
    @FocusState private var isSearchFocused: Bool

    var body: some View {
        if embedsInNavigationStack {
            NavigationStack {
                content
            }
        } else {
            content
        }
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header

                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Color.ubeyeMuted)
                    TextField("Search creators", text: $store.query)
                        .font(.system(size: 16, weight: .medium))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($isSearchFocused)
                        .onSubmit {
                            Task { await store.search(api: api) }
                        }

                    if !store.query.isEmpty {
                        Button {
                            store.query = ""
                            isSearchFocused = false
                            Task {
                                await store.search(api: api)
                            }
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 17, weight: .semibold))
                                .foregroundStyle(Color.ubeyeMuted.opacity(0.7))
                                .frame(width: 32, height: 32)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Clear search")
                        .transition(.opacity)
                    }
                }
                .padding(.horizontal, 14)
                .frame(height: 46)
                .background(.white)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.ubeyeBorder, lineWidth: 1))

                if let error = store.error {
                    InlineNotice(message: error, isError: true)
                }

                if store.isLoading && displayedCreators.isEmpty {
                    ProgressView()
                        .tint(.ubeyeRed)
                        .frame(maxWidth: .infinity, minHeight: 140)
                }

                if displayedCreators.isEmpty && !store.isLoading {
                    EmptyStateView(
                        title: store.query.isEmpty ? "No accounts yet" : "No accounts found",
                        message: store.query.isEmpty ? "" : "Try another name or handle.",
                        systemImage: "person.crop.circle.badge.questionmark"
                    )
                } else {
                    DiscoverCreatorList(creators: displayedCreators) { creator in
                        open(creator)
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
            focusSearchIfNeeded()
        }
        .onChange(of: searchFocusRequest) { _, _ in
            focusSearchIfNeeded()
        }
        .onReceive(NotificationCenter.default.publisher(for: .followingQueueDidChange)) { _ in
            Task {
                await store.loadFollows(api: api)
            }
        }
        .fullScreenCover(item: $destination) { destination in
            switch destination {
            case .profile(let creator):
                DiscoverCreatorProfileView(
                    creator: creator,
                    isFollowing: store.followedIds.contains(creator.id),
                    onFollow: {
                        await store.follow(creatorId: creator.id, api: api)
                    }
                )
            }
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            if showsBackButton {
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
                .accessibilityLabel("Back")
            }

            Text("Discover")
                .font(.system(size: 30, weight: .bold))
                .foregroundStyle(Color.ubeyeInk)

            Spacer()
            TopAvatarSpacer()
        }
    }

    private func focusSearchIfNeeded() {
        guard searchFocusRequest > handledSearchFocusRequest else {
            return
        }

        handledSearchFocusRequest = searchFocusRequest
        Task {
            try? await Task.sleep(for: .milliseconds(180))
            await MainActor.run {
                isSearchFocused = true
            }
        }
    }

    private var displayedCreators: [DiscoverCreator] {
        store.profiles.map { profile in
            DiscoverCreator(
                id: profile.id,
                name: profile.name,
                handle: profile.handle,
                imageUrl: profile.imageUrl,
                activeStoryId: profile.activeStoryId,
                isFollowing: store.followedIds.contains(profile.id)
            )
        }
    }

    private func open(_ creator: DiscoverCreator) {
        destination = .profile(creator)
    }
}

private struct DiscoverCreatorList: View {
    let creators: [DiscoverCreator]
    let onTap: (DiscoverCreator) -> Void

    var body: some View {
        VStack(spacing: 10) {
            ForEach(creators) { creator in
                Button {
                    onTap(creator)
                } label: {
                    DiscoverCreatorRow(creator: creator)
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

private struct DiscoverCreatorRow: View {
    let creator: DiscoverCreator

    var body: some View {
        HStack(spacing: 12) {
            RemoteAvatar(url: creator.imageUrl, size: 46, name: creator.name)

            VStack(alignment: .leading, spacing: 8) {
                Text(creator.name)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Color.ubeyeInk)
                    .lineLimit(1)

                Text("@\(creator.handle)")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.ubeyeMuted)
                    .lineLimit(1)
            }

            Spacer(minLength: 12)

            if creator.isFollowing {
                Text("Following")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Color.ubeyeMuted)
                    .padding(.horizontal, 12)
                    .frame(height: 30)
                    .background(Color.ubeyeSubtle, in: Capsule())
            }

            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Color.ubeyeMuted.opacity(0.45))
        }
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity)
        .frame(height: 74)
        .background(.white)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Color.ubeyeBorder, lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct DiscoverCreatorProfileView: View {
    @Environment(\.dismiss) private var dismiss
    let creator: DiscoverCreator
    let isFollowing: Bool
    let onFollow: () async -> Bool
    @State private var isSubmitting = false

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 18, weight: .bold))
                        .frame(width: 42, height: 42)
                        .foregroundStyle(Color.ubeyeInk)
                        .background(Color.ubeyeSubtle, in: Circle())
                }
                .buttonStyle(.plain)

                Spacer()
            }
            .padding(.horizontal, UBEYEMetrics.screenInset)
            .padding(.top, 12)

            Spacer(minLength: 32)

            VStack(spacing: 16) {
                RemoteAvatar(url: creator.imageUrl, size: 104, name: creator.name)
                    .overlay(Circle().stroke(Color.ubeyeBorder, lineWidth: 1))

                VStack(spacing: 5) {
                    Text(creator.name)
                        .font(.system(size: 28, weight: .bold))
                    Text("@\(creator.handle)")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Color.ubeyeMuted)
                }

                Button {
                    Task {
                        guard !isFollowing, !isSubmitting else { return }
                        isSubmitting = true
                        let didFollow = await onFollow()
                        isSubmitting = false
                        if didFollow {
                            dismiss()
                        }
                    }
                } label: {
                    HStack(spacing: 8) {
                        if isSubmitting {
                            ProgressView()
                                .controlSize(.small)
                                .tint(.white)
                        }
                        Text(isFollowing ? "Following" : "Follow")
                    }
                    .font(.system(size: 16, weight: .bold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .foregroundStyle(isFollowing ? Color.ubeyeInk : .white)
                    .background(isFollowing ? Color.ubeyeSubtle : Color.ubeyeRed, in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(isFollowing || isSubmitting)
                .padding(.top, 8)
            }
            .padding(.horizontal, 28)

            Spacer()
        }
        .foregroundStyle(Color.ubeyeInk)
        .ubeyeScreen()
    }
}

struct CreatorRow: View {
    let profile: FollowingProfile
    let isFollowing: Bool
    let action: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            RemoteAvatar(url: profile.imageUrl, size: 52, name: profile.name)

            VStack(alignment: .leading, spacing: 2) {
                Text(profile.name)
                    .font(.headline)
                Text("@\(profile.handle)")
                    .font(.subheadline)
                    .foregroundStyle(Color.ubeyeMuted)
            }

            Spacer()

            Button(isFollowing ? "Following" : "Follow", action: action)
                .font(.caption.weight(.bold))
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .foregroundStyle(isFollowing ? Color.ubeyeInk : .white)
                .background(isFollowing ? Color.ubeyeSubtle : Color.ubeyeRed)
                .clipShape(Capsule())
        }
        .foregroundStyle(Color.ubeyeInk)
        .padding(12)
        .ubeyeCard()
    }
}
