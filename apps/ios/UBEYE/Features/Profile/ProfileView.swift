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
                "/api/mobile/stripe/connect/status"
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
    @EnvironmentObject private var push: PushNotificationStore
    @Environment(\.dismiss) private var dismiss
    @StateObject private var store = ProfileStore()
    @State private var avatarPickerItem: PhotosPickerItem?
    @State private var isUploadingAvatar = false
    @State private var isShowingDeleteConfirmation = false
    @State private var activeSheet: ProfileSheet?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    profileSheetHeader
                    profileHeader

                    if let error = store.error {
                        InlineNotice(message: error, isError: true)
                    }

                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                        ExpoMetricCard(title: "Followers", value: profileCount(store.stats?.stats.followerCount))
                        ExpoMetricCard(title: "Following", value: profileCount(store.stats?.stats.followingCount))
                        ExpoMetricCard(title: "Available", value: ubeyeCurrency((store.stripe?.earnings ?? store.stats?.stats.earnings)?.availableCents))
                        ExpoMetricCard(title: "Paid", value: ubeyeCurrency((store.stripe?.earnings ?? store.stats?.stats.earnings)?.paidCents))
                    }

                    accountActions
                }
                .padding(16)
                .padding(.bottom, 24)
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
            .onChange(of: avatarPickerItem) { _, item in
                Task { await uploadAvatar(item) }
            }
            .alert(
                "Delete this account?",
                isPresented: $isShowingDeleteConfirmation,
            ) {
                Button("Cancel", role: .cancel) {}
                Button("Delete account", role: .destructive) {
                    Task { await deleteAccount() }
                }
            } message: {
                Text("This deletes your account and personal profile data from UBEYE. Some records may be retained where required for security, legal, fraud prevention, payment, tax, or accounting reasons.")
            }
            .sheet(item: $activeSheet) { sheet in
                switch sheet {
                case .adjustAvatar:
                    AvatarRepositionSheet(
                        currentAvatarUrl: auth.account?.avatarUrl,
                        displayName: auth.account?.displayName ?? DesignFixtures.accountName,
                        onSaved: applyAvatarResponse
                    )
                    .environmentObject(api)
                }
            }
        }
    }

    private var profileSheetHeader: some View {
        HStack {
            Spacer()

            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .bold))
                    .frame(width: 38, height: 38)
                    .foregroundStyle(Color.ubeyeInk)
                    .background(Color.ubeyeSubtle, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close account")
        }
    }

    private var profileHeader: some View {
        let account = auth.account

        return VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 14) {
                Button {
                    activeSheet = .adjustAvatar
                } label: {
                    ZStack(alignment: .bottomTrailing) {
                        RemoteAvatar(url: account?.avatarUrl, size: 72, name: account?.displayName ?? "")

                        Image(systemName: isUploadingAvatar ? "hourglass" : "crop")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 28, height: 28)
                            .background(Color.ubeyeNavy, in: Circle())
                            .overlay(Circle().stroke(.white, lineWidth: 2))
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Adjust profile photo")
                .disabled(isUploadingAvatar)

                VStack(alignment: .leading, spacing: 4) {
                    Text(account?.displayName ?? DesignFixtures.accountName)
                        .font(.system(size: 25, weight: .bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Text("@\(account?.handle ?? DesignFixtures.accountHandle)")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color.ubeyeMuted)
                }

                Spacer()
            }

            PhotosPicker(selection: $avatarPickerItem, matching: .images) {
                Label("Edit photo", systemImage: "camera")
                    .font(.system(size: 14, weight: .bold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .foregroundStyle(Color.ubeyeInk)
                    .background(Color.ubeyeSubtle, in: Capsule())
            }
            .disabled(isUploadingAvatar)

            Button {
                activeSheet = .adjustAvatar
            } label: {
                Label("Adjust photo", systemImage: "crop")
                    .font(.system(size: 14, weight: .bold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .foregroundStyle(Color.ubeyeInk)
                    .background(Color.ubeyeSubtle, in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(isUploadingAvatar)
        }
        .padding(16)
        .ubeyeCard()
    }

    private var accountActions: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Account")
                .font(.system(size: 18, weight: .bold))
                .padding(.horizontal, 16)
                .padding(.top, 16)
                .padding(.bottom, 8)
            Divider().padding(.horizontal, 16)

            NavigationLink(destination: CreatorStatsDashboardView()) {
                accountRow(icon: "chart.bar.xaxis", title: "Creator stats", subtitle: "Views, comments, and earnings")
            }
            NavigationLink(destination: EarningsView()) {
                accountRow(icon: "wallet.pass", title: "Earnings", subtitle: "Story ledger and balances")
            }
            NavigationLink(destination: PayoutsView()) {
                accountRow(icon: "creditcard", title: "Payouts", subtitle: "Stripe setup and settlement")
            }
            NavigationLink(destination: MyStoryStatsView()) {
                accountRow(icon: "photo.stack", title: "My Story Stats", subtitle: "Individual story performance")
            }
            NavigationLink(destination: FollowersView()) {
                accountRow(icon: "person.2", title: "Followers", subtitle: "Followers and following")
            }
            NavigationLink(destination: BlockedAccountsView()) {
                accountRow(icon: "person.crop.circle.badge.xmark", title: "Blocked accounts", subtitle: "Manage blocked users")
            }
            Link(destination: supportURL) {
                accountRow(icon: "envelope", title: "Contact support", subtitle: "griffin@ubeye.ai")
            }
            Button {
                Task { await push.requestAuthorizationAndRegister(api: api) }
            } label: {
                accountRow(icon: "bell.badge", title: notificationTitle, subtitle: notificationSubtitle)
            }
            Button {
                auth.signOut(api: api)
            } label: {
                accountRow(icon: "rectangle.portrait.and.arrow.right", title: "Log out", subtitle: "Sign out on this device", tint: .ubeyeRed)
            }
            Button {
                isShowingDeleteConfirmation = true
            } label: {
                accountRow(icon: "trash", title: "Delete account", subtitle: "Permanently remove this account", tint: .ubeyeRed)
            }
        }
        .ubeyeCard()
    }

    private var supportURL: URL {
        URL(string: "mailto:griffin@ubeye.ai?subject=UBEYE%20Support") ?? URL(string: "mailto:griffin@ubeye.ai")!
    }

    private var notificationTitle: String {
        push.isRegistered ? "Notifications enabled" : "Enable notifications"
    }

    private var notificationSubtitle: String {
        if push.isRegistered {
            return "Story and reply alerts are on"
        }

        return push.lastError ?? "Story and reply alerts"
    }

    private func accountRow(icon: String, title: String, subtitle: String, tint: Color = .ubeyeInk) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 17, weight: .bold))
                .frame(width: 40, height: 40)
                .foregroundStyle(tint)
                .background(Color.ubeyeSubtle, in: Circle())

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(tint)
                Text(subtitle)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Color.ubeyeMuted)
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Color.ubeyeMuted.opacity(0.65))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }

    private func profileCount(_ value: Int?) -> String {
        (value ?? 0).formatted(.number)
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
            applyAvatarResponse(response)
        } catch {
            store.error = error.localizedDescription
        }
        isUploadingAvatar = false
    }

    private func applyAvatarResponse(_ response: AvatarUploadResponse) {
        auth.updateAccount({ account in
            if let displayName = response.user.displayName {
                account.displayName = displayName
            }
            if let handle = response.user.handle {
                account.handle = handle
            }
            account.avatarUrl = response.user.avatarUrl
        }, api: api)
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

private enum ProfileSheet: Identifiable {
    case adjustAvatar

    var id: String {
        switch self {
        case .adjustAvatar:
            "adjustAvatar"
        }
    }
}

private struct AvatarRepositionSheet: View {
    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss
    let currentAvatarUrl: URL?
    let displayName: String
    let onSaved: (AvatarUploadResponse) -> Void

    @State private var sourceImage: UIImage?
    @State private var fallbackAvatarUrl: URL?
    @State private var zoom = 1.0
    @State private var offset = CGSize.zero
    @State private var committedOffset = CGSize.zero
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var error: String?

    private var editorSize: CGFloat {
        min(max(UIScreen.main.bounds.width - 48, 240), 300)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if isLoading {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 64)
                    } else if let sourceImage {
                        VStack(spacing: 18) {
                            AvatarCropEditor(
                                image: sourceImage,
                                viewportSize: editorSize,
                                zoom: $zoom,
                                offset: $offset,
                                committedOffset: $committedOffset
                            )

                            VStack(alignment: .leading, spacing: 8) {
                                Text("Zoom")
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(Color.ubeyeMuted)
                                Slider(
                                    value: Binding(
                                        get: { zoom },
                                        set: { nextZoom in
                                            zoom = nextZoom
                                            let clamped = clampedAvatarOffset(
                                                offset,
                                                image: sourceImage,
                                                viewportSize: editorSize,
                                                zoom: nextZoom
                                            )
                                            offset = clamped
                                            committedOffset = clamped
                                        }
                                    ),
                                    in: 1...3
                                )
                            }

                            VStack(alignment: .leading, spacing: 12) {
                                AvatarPositionControl(
                                    title: "Horizontal",
                                    systemImage: "arrow.left.and.right",
                                    value: Binding(
                                        get: { Double(offset.width) },
                                        set: { nextValue in
                                            let clamped = clampedAvatarOffset(
                                                CGSize(width: CGFloat(nextValue), height: offset.height),
                                                image: sourceImage,
                                                viewportSize: editorSize,
                                                zoom: zoom
                                            )
                                            offset = clamped
                                            committedOffset = clamped
                                        }
                                    ),
                                    limit: Double(
                                        avatarOffsetLimits(
                                            for: sourceImage,
                                            viewportSize: editorSize,
                                            zoom: zoom
                                        ).width
                                    )
                                )

                                AvatarPositionControl(
                                    title: "Vertical",
                                    systemImage: "arrow.up.and.down",
                                    value: Binding(
                                        get: { Double(offset.height) },
                                        set: { nextValue in
                                            let clamped = clampedAvatarOffset(
                                                CGSize(width: offset.width, height: CGFloat(nextValue)),
                                                image: sourceImage,
                                                viewportSize: editorSize,
                                                zoom: zoom
                                            )
                                            offset = clamped
                                            committedOffset = clamped
                                        }
                                    ),
                                    limit: Double(
                                        avatarOffsetLimits(
                                            for: sourceImage,
                                            viewportSize: editorSize,
                                            zoom: zoom
                                        ).height
                                    )
                                )
                            }

                            Button {
                                Task { await saveCrop(sourceImage) }
                            } label: {
                                Label(isSaving ? "Saving..." : "Save position", systemImage: "checkmark")
                                    .font(.system(size: 15, weight: .bold))
                                    .frame(maxWidth: .infinity)
                                    .frame(height: 48)
                                    .foregroundStyle(.white)
                                    .background(Color.ubeyeNavy, in: Capsule())
                            }
                            .buttonStyle(.plain)
                            .disabled(isSaving)
                        }
                    } else {
                        VStack(spacing: 14) {
                            RemoteAvatar(
                                url: fallbackAvatarUrl ?? currentAvatarUrl,
                                size: 96,
                                name: displayName
                            )

                            Text("Choose the original profile photo once, then you can reposition it here.")
                                .font(.callout.weight(.medium))
                                .multilineTextAlignment(.center)
                                .foregroundStyle(Color.ubeyeMuted)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 40)
                    }

                    if let error {
                        InlineNotice(message: error, isError: true)
                    }
                }
                .padding(16)
            }
            .navigationTitle("Adjust photo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                    .font(.system(size: 15, weight: .bold))
                }
            }
            .task {
                await loadSourceImage()
            }
        }
    }

    private func loadSourceImage() async {
        isLoading = true
        error = nil

        do {
            let source = try await api.getAvatarSource()
            fallbackAvatarUrl = source.fallbackAvatarUrl

            guard let sourceUrl = source.sourceUrl else {
                sourceImage = nil
                isLoading = false
                return
            }

            let (data, _) = try await URLSession.shared.data(from: sourceUrl)
            guard let image = UIImage(data: data) else {
                throw APIClientError.invalidResponse
            }

            sourceImage = image
            zoom = 1
            offset = .zero
            committedOffset = .zero
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    private func saveCrop(_ image: UIImage) async {
        isSaving = true
        error = nil

        do {
            let response = try await api.repositionAvatar(
                crop: avatarCrop(
                    for: image,
                    viewportSize: editorSize,
                    zoom: zoom,
                    offset: offset
                )
            )
            onSaved(response)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }

        isSaving = false
    }
}

private struct AvatarCropEditor: View {
    let image: UIImage
    let viewportSize: CGFloat
    @Binding var zoom: Double
    @Binding var offset: CGSize
    @Binding var committedOffset: CGSize

    var body: some View {
        ZStack {
            Color.black.opacity(0.9)

            Image(uiImage: image)
                .resizable()
                .frame(width: renderedSize.width, height: renderedSize.height)
                .offset(offset)

            Circle()
                .stroke(.white, lineWidth: 3)
                .shadow(color: .black.opacity(0.25), radius: 10)

            Circle()
                .stroke(.white.opacity(0.55), lineWidth: 1)
                .padding(viewportSize / 3)
        }
        .frame(width: viewportSize, height: viewportSize)
        .clipShape(Circle())
        .contentShape(Circle())
        .gesture(
            DragGesture()
                .onChanged { value in
                    let proposed = CGSize(
                        width: committedOffset.width + value.translation.width,
                        height: committedOffset.height + value.translation.height
                    )
                    offset = clampedAvatarOffset(
                        proposed,
                        image: image,
                        viewportSize: viewportSize,
                        zoom: zoom
                    )
                }
                .onEnded { _ in
                    let clamped = clampedAvatarOffset(
                        offset,
                        image: image,
                        viewportSize: viewportSize,
                        zoom: zoom
                    )
                    offset = clamped
                    committedOffset = clamped
                }
        )
        .frame(maxWidth: .infinity)
    }

    private var renderedSize: CGSize {
        let pixels = avatarImagePixelSize(image)
        let scale = avatarDisplayScale(
            for: image,
            viewportSize: viewportSize,
            zoom: zoom
        )

        return CGSize(width: pixels.width * scale, height: pixels.height * scale)
    }
}

private struct AvatarPositionControl: View {
    let title: String
    let systemImage: String
    @Binding var value: Double
    let limit: Double

    private var range: ClosedRange<Double> {
        limit > 0 ? -limit...limit : -1...1
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: systemImage)
                .font(.caption.weight(.bold))
                .foregroundStyle(Color.ubeyeMuted)
            Slider(value: $value, in: range)
                .disabled(limit <= 0)
        }
    }
}

private func avatarImagePixelSize(_ image: UIImage) -> CGSize {
    if let cgImage = image.cgImage {
        return CGSize(width: cgImage.width, height: cgImage.height)
    }

    return image.size
}

private func avatarDisplayScale(
    for image: UIImage,
    viewportSize: CGFloat,
    zoom: Double
) -> CGFloat {
    let pixels = avatarImagePixelSize(image)
    let baseScale = max(viewportSize / pixels.width, viewportSize / pixels.height)

    return baseScale * CGFloat(zoom)
}

private func avatarOffsetLimits(
    for image: UIImage,
    viewportSize: CGFloat,
    zoom: Double
) -> CGSize {
    let pixels = avatarImagePixelSize(image)
    let scale = avatarDisplayScale(for: image, viewportSize: viewportSize, zoom: zoom)

    return CGSize(
        width: max(0, ((pixels.width * scale) - viewportSize) / 2),
        height: max(0, ((pixels.height * scale) - viewportSize) / 2)
    )
}

private func clampedAvatarOffset(
    _ proposed: CGSize,
    image: UIImage,
    viewportSize: CGFloat,
    zoom: Double
) -> CGSize {
    let limits = avatarOffsetLimits(for: image, viewportSize: viewportSize, zoom: zoom)

    return CGSize(
        width: min(max(proposed.width, -limits.width), limits.width),
        height: min(max(proposed.height, -limits.height), limits.height)
    )
}

private func avatarCrop(
    for image: UIImage,
    viewportSize: CGFloat,
    zoom: Double,
    offset: CGSize
) -> AvatarCrop {
    let pixels = avatarImagePixelSize(image)
    let scale = avatarDisplayScale(for: image, viewportSize: viewportSize, zoom: zoom)
    let cropSize = min(pixels.width, pixels.height, viewportSize / scale)
    let centerX = pixels.width / 2 - (offset.width / scale)
    let centerY = pixels.height / 2 - (offset.height / scale)
    let originX = min(max(0, centerX - cropSize / 2), pixels.width - cropSize)
    let originY = min(max(0, centerY - cropSize / 2), pixels.height - cropSize)

    return AvatarCrop(
        originX: Double(originX),
        originY: Double(originY),
        width: Double(cropSize),
        height: Double(cropSize)
    )
}

private typealias BlockedAccountProfile = BlockedProfilesResponse.BlockedProfile

@MainActor
private final class BlockedAccountsStore: ObservableObject {
    @Published var blocked: [BlockedAccountProfile] = []
    @Published var unblockingIds = Set<String>()
    @Published var isLoading = false
    @Published var error: String?

    func load(api: APIClient) async {
        isLoading = true
        error = nil
        do {
            let response = try await api.listBlockedProfiles()
            blocked = response.blocked
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func unblock(_ profile: BlockedAccountProfile, api: APIClient) async {
        unblockingIds.insert(profile.id)
        error = nil
        defer {
            unblockingIds.remove(profile.id)
        }

        do {
            try await api.unblockUser(userId: profile.id)
            blocked.removeAll { $0.id == profile.id }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct BlockedAccountsView: View {
    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @StateObject private var store = BlockedAccountsStore()
    @State private var pendingUnblock: BlockedAccountProfile?
    @State private var isConfirmingUnblock = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header

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
            "Unblock this account?",
            isPresented: $isConfirmingUnblock,
            titleVisibility: .visible
        ) {
            if let profile = pendingUnblock {
                Button("Unblock @\(profile.handle ?? "account")") {
                    pendingUnblock = nil
                    Task {
                        await store.unblock(profile, api: api)
                    }
                }
            }
            Button("Cancel", role: .cancel) {
                pendingUnblock = nil
            }
        } message: {
            if let profile = pendingUnblock {
                Text("\(profile.name ?? "This account") can appear in Discover and interact with you again.")
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
                Text("Blocked")
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(Color.ubeyeInk)
                Text("Accounts you have blocked")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.ubeyeMuted)
            }

            Spacer()
        }
    }

    @ViewBuilder
    private var content: some View {
        if store.isLoading && store.blocked.isEmpty {
            ProgressView()
                .tint(.ubeyeRed)
                .frame(maxWidth: .infinity, minHeight: 180)
        } else if store.blocked.isEmpty {
            EmptyStateView(
                title: "No blocked accounts",
                message: "Accounts you block will show up here.",
                systemImage: "person.crop.circle.badge.xmark"
            )
            .frame(maxWidth: .infinity, minHeight: 220)
        } else {
            LazyVStack(spacing: 10) {
                ForEach(store.blocked) { profile in
                    BlockedAccountRow(
                        profile: profile,
                        isUnblocking: store.unblockingIds.contains(profile.id)
                    ) {
                        pendingUnblock = profile
                        isConfirmingUnblock = true
                    }
                }
            }
        }
    }
}

private struct BlockedAccountRow: View {
    let profile: BlockedAccountProfile
    let isUnblocking: Bool
    let unblockAction: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            RemoteAvatar(url: profile.imageUrl, size: 50, name: profile.name ?? profile.handle ?? "Blocked")

            VStack(alignment: .leading, spacing: 3) {
                Text(profile.name ?? "Blocked account")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Color.ubeyeInk)
                    .lineLimit(1)
                if let handle = profile.handle {
                    Text("@\(handle)")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.ubeyeMuted)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 12)

            Button(action: unblockAction) {
                HStack(spacing: 6) {
                    if isUnblocking {
                        ProgressView()
                            .controlSize(.mini)
                            .tint(Color.ubeyeInk)
                    }
                    Text(isUnblocking ? "Unblocking" : "Unblock")
                }
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Color.ubeyeInk)
                .padding(.horizontal, 12)
                .frame(height: 34)
                .background(Color.ubeyeSubtle, in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(isUnblocking)
        }
        .padding(12)
        .background(.white, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Color.ubeyeBorder, lineWidth: 1)
        )
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
        .ubeyeCard()
    }

    private func metric(_ label: String, cents: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(currency(cents))
                .font(.title3.bold())
            Text(label)
                .font(.caption)
                .foregroundStyle(Color.ubeyeMuted)
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
                .foregroundStyle(Color.ubeyeMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .ubeyeCard()
    }

    private var statusText: String {
        guard let status else {
            return "Payout status is loading."
        }

        if status.payoutsEnabled == true {
            return "Payout account is connected. UBEYE reviews approved earnings before settlement."
        }

        if status.connected == true {
            return "Stripe is connected. Complete payout setup on ubeye.ai/creator/payouts."
        }

        return "Manage payout setup on ubeye.ai/creator/payouts from desktop."
    }
}
