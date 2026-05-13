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

    func toggleFollow(profile: FollowingProfile, api: APIClient) async {
        struct Body: Encodable {
            let creatorId: String
        }

        do {
            if followedIds.contains(profile.id) {
                let _: BasicOkResponse = try await api.delete("/api/mobile/follows", body: Body(creatorId: profile.id))
                followedIds.remove(profile.id)
            } else {
                let _: BasicOkResponse = try await api.post("/api/mobile/follows", body: Body(creatorId: profile.id))
                followedIds.insert(profile.id)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct DiscoverView: View {
    @EnvironmentObject private var api: APIClient
    @StateObject private var store = DiscoverStore()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Discover")
                            .font(.system(size: 30, weight: .black, design: .rounded))
                        Text("Find creators and bring the same UBEYE following graph into the Swift app.")
                            .font(.subheadline)
                            .foregroundStyle(Color.ubeyeMuted)
                    }
                    .padding(.bottom, 4)

                    if let error = store.error {
                        InlineNotice(message: error, isError: true)
                    }

                    if store.isLoading && store.profiles.isEmpty {
                        ProgressView()
                            .tint(.ubeyeRed)
                            .frame(maxWidth: .infinity, minHeight: 140)
                    }

                    ForEach(store.profiles) { profile in
                        CreatorRow(
                            profile: profile,
                            isFollowing: store.followedIds.contains(profile.id)
                        ) {
                            Task { await store.toggleFollow(profile: profile, api: api) }
                        }
                    }
                }
                .padding(16)
            }
            .searchable(text: $store.query, prompt: "Search creators")
            .onSubmit(of: .search) {
                Task { await store.search(api: api) }
            }
            .navigationBarTitleDisplayMode(.inline)
            .ubeyeScreen()
            .task {
                await store.load(api: api)
            }
        }
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
