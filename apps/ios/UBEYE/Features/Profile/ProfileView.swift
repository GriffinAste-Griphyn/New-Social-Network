import PhotosUI
import SwiftUI
import UIKit

@MainActor
final class ProfileStore: ObservableObject {
    @Published var stats: CreatorStatsResponse?
    @Published var stripe: StripeConnectStatusResponse?
    @Published var error: String?

    func load(api: APIClient) async {
        do {
            async let statsResponse: CreatorStatsResponse = api.get("/api/mobile/creator/stats")
            async let stripeResponse: StripeConnectStatusResponse = api.get(
                "/api/mobile/stripe/connect/status",
                queryItems: [URLQueryItem(name: "sync", value: "1")]
            )
            stats = try await statsResponse
            stripe = try await stripeResponse
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct ProfileView: View {
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var auth: AuthStore
    @StateObject private var store = ProfileStore()
    @State private var avatarPickerItem: PhotosPickerItem?
    @State private var isUploadingAvatar = false
    @State private var isShowingDeleteConfirmation = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    profileHeader

                    if let error = store.error {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }

                    EarningsPanel(earnings: store.stripe?.earnings ?? store.stats?.stats.earnings)
                    PayoutPanel(status: store.stripe?.status)

                    accountActions
                }
                .padding(18)
            }
            .navigationTitle("Profile")
            .ubeyeScreen()
            .task {
                await store.load(api: api)
            }
            .refreshable {
                await store.load(api: api)
            }
            .onChange(of: avatarPickerItem) { _, item in
                Task { await uploadAvatar(item) }
            }
            .confirmationDialog(
                "Delete this account?",
                isPresented: $isShowingDeleteConfirmation,
                titleVisibility: .visible
            ) {
                Button("Delete account", role: .destructive) {
                    Task { await deleteAccount() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This removes the signed-in account from the backend.")
            }
        }
    }

    private var profileHeader: some View {
        let account = auth.account

        return HStack(spacing: 14) {
            PhotosPicker(selection: $avatarPickerItem, matching: .images) {
                ZStack(alignment: .bottomTrailing) {
                    AsyncImage(url: account?.avatarUrl) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Circle().fill(.white.opacity(0.1))
                    }
                    .frame(width: 72, height: 72)
                    .clipShape(Circle())

                    Image(systemName: isUploadingAvatar ? "hourglass" : "camera.fill")
                        .font(.caption.bold())
                        .foregroundStyle(.white)
                        .frame(width: 26, height: 26)
                        .background(Color.ubeyeRed, in: Circle())
                }
            }
            .disabled(isUploadingAvatar)

            VStack(alignment: .leading, spacing: 4) {
                Text(account?.displayName ?? "Account")
                    .font(.title2.bold())
                Text("@\(account?.handle ?? "account")")
                    .foregroundStyle(.white.opacity(0.65))
                Text(account?.email ?? "")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.5))
            }
        }
    }

    private var accountActions: some View {
        VStack(spacing: 10) {
            Button {
                auth.signOut(api: api)
            } label: {
                Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)

            Button(role: .destructive) {
                isShowingDeleteConfirmation = true
            } label: {
                Label("Delete account", systemImage: "trash")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
        .tint(.red)
    }

    private func uploadAvatar(_ item: PhotosPickerItem?) async {
        guard let item,
              let data = try? await item.loadTransferable(type: Data.self),
              let image = UIImage(data: data) else {
            return
        }

        isUploadingAvatar = true
        do {
            let response = try await api.uploadAvatar(image: image)
            auth.updateAccount({ account in
                if let displayName = response.user.displayName {
                    account.displayName = displayName
                }
                if let handle = response.user.handle {
                    account.handle = handle
                }
                account.avatarUrl = response.user.avatarUrl
            }, api: api)
        } catch {
            store.error = error.localizedDescription
        }
        isUploadingAvatar = false
    }

    private func deleteAccount() async {
        do {
            try await api.deleteAccount()
            auth.signOut(api: api)
        } catch {
            store.error = error.localizedDescription
        }
    }
}

struct EarningsPanel: View {
    let earnings: CreatorStatsResponse.Earnings?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Earnings")
                .font(.headline)
            HStack {
                metric("Available", cents: earnings?.availableCents ?? 0)
                metric("Pending", cents: earnings?.pendingCents ?? 0)
                metric("Paid", cents: earnings?.paidCents ?? 0)
            }
        }
        .padding(16)
        .background(Color.ubeyePanel)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func metric(_ label: String, cents: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(currency(cents))
                .font(.title3.bold())
            Text(label)
                .font(.caption)
                .foregroundStyle(.white.opacity(0.62))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func currency(_ cents: Int) -> String {
        let dollars = Double(cents) / 100
        return dollars.formatted(.currency(code: "USD"))
    }
}

struct PayoutPanel: View {
    let status: StripeConnectStatusResponse.Status?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Payouts")
                .font(.headline)
            Text(statusText)
                .foregroundStyle(.white.opacity(0.72))
            if let url = status?.onboardingUrl ?? status?.dashboardUrl {
                Link(status?.onboardingUrl == nil ? "Open dashboard" : "Finish onboarding", destination: url)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Color.ubeyeRed)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color.ubeyePanel)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var statusText: String {
        guard let status else {
            return "Payout status is loading."
        }

        if status.payoutsEnabled == true {
            return "Payouts are enabled."
        }

        if status.connected == true {
            return "Stripe is connected. Finish any remaining requirements."
        }

        return "Connect Stripe to receive creator payouts."
    }
}
