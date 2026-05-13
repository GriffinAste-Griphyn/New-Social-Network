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
            List {
                if let error = store.error {
                    Text(error)
                        .foregroundStyle(.red)
                }

                ForEach(store.profiles) { profile in
                    CreatorRow(
                        profile: profile,
                        isFollowing: store.followedIds.contains(profile.id)
                    ) {
                        Task { await store.toggleFollow(profile: profile, api: api) }
                    }
                    .listRowBackground(Color.ubeyeInk)
                }
            }
            .searchable(text: $store.query, prompt: "Search creators")
            .onSubmit(of: .search) {
                Task { await store.search(api: api) }
            }
            .scrollContentBackground(.hidden)
            .navigationTitle("Discover")
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
            AsyncImage(url: profile.imageUrl) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Circle().fill(.white.opacity(0.1))
            }
            .frame(width: 48, height: 48)
            .clipShape(Circle())

            VStack(alignment: .leading, spacing: 2) {
                Text(profile.name)
                    .font(.headline)
                Text("@\(profile.handle)")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.64))
            }

            Spacer()

            Button(isFollowing ? "Following" : "Follow", action: action)
                .font(.caption.weight(.bold))
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(isFollowing ? .white.opacity(0.14) : Color.ubeyeRed)
                .clipShape(Capsule())
        }
        .foregroundStyle(.white)
        .padding(.vertical, 6)
    }
}
