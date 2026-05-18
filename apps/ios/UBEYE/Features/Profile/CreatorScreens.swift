import SwiftUI

@MainActor
final class CreatorStatsScreenStore: ObservableObject {
    @Published var stats: CreatorStatsResponse.Stats?
    @Published var isLoading = false
    @Published var error: String?

    func load(api: APIClient, queryItems: [URLQueryItem] = []) async {
        isLoading = true
        error = nil
        do {
            let response: CreatorStatsResponse = try await api.get("/api/mobile/creator/stats", queryItems: queryItems)
            stats = response.stats
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}

struct CreatorStatsDashboardView: View {
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.dismiss) private var dismiss
    @StateObject private var store = CreatorStatsScreenStore()
    @State private var range = "Week"
    @State private var startDate = Calendar.current.date(byAdding: .day, value: -30, to: Date()) ?? Date()
    @State private var endDate = Date()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ExpoScreenHeader(
                    eyebrow: "Creator",
                    title: "Stats",
                    subtitle: "@\(auth.account?.handle ?? DesignFixtures.accountHandle)",
                    avatarUrl: auth.account?.avatarUrl ?? DesignFixtures.accountAvatar,
                    avatarName: auth.account?.displayName ?? DesignFixtures.accountName,
                    onBack: { dismiss() }
                )

                ExpoSegmentedControl(items: ["Day", "Week", "Month", "All"], selected: $range)

                if range == "All" {
                    customDateRangeControls
                }

                if store.isLoading && store.stats == nil {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 80)
                } else if let error = store.error, store.stats == nil {
                    EmptyStateView(title: "Stats unavailable", message: error, systemImage: "chart.bar.xaxis")
                        .padding(.vertical, 36)
                } else if let stats = store.stats {
                    statsContent(stats)
                }
            }
            .padding(16)
            .padding(.bottom, 24)
        }
        .navigationBarBackButtonHidden()
        .toolbar(.hidden, for: .navigationBar)
        .ubeyeScreen()
        .task(id: statsLoadKey) {
            await store.load(api: api, queryItems: rangeQueryItems)
        }
        .refreshable {
            await store.load(api: api, queryItems: rangeQueryItems)
        }
    }

    private var twoColumns: [GridItem] {
        [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]
    }

    private var customDateRangeControls: some View {
        VStack(spacing: 12) {
            DatePicker("Start", selection: $startDate, displayedComponents: .date)
            DatePicker("End", selection: $endDate, in: startDate..., displayedComponents: .date)
        }
        .font(.system(size: 15, weight: .semibold))
        .padding(14)
        .background(.white, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.ubeyeBorder, lineWidth: 1))
    }

    private func statsContent(_ stats: CreatorStatsResponse.Stats) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            LazyVGrid(columns: twoColumns, spacing: 10) {
                ExpoMetricCard(title: "Followers", value: formattedNumber(stats.followerCount), subtitle: "\(formattedNumber(stats.followingCount)) following", systemImage: "person.2")
                ExpoMetricCard(title: "Views", value: formattedNumber(stats.totalViews), subtitle: "\(formattedNumber(stats.uniqueViewers)) unique", systemImage: "eye")
                ExpoMetricCard(title: "Completion", value: "\(stats.completionRate)%", subtitle: "\(formattedNumber(stats.completedViews)) complete", systemImage: "chart.xyaxis.line")
                ExpoMetricCard(title: "Comments", value: formattedNumber(stats.comments), subtitle: "\(formattedNumber(stats.replies)) replies", systemImage: "ellipsis.message")
            }

            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Earnings and payouts")
                            .font(.system(size: 20, weight: .bold))
                        Text("Story earnings by ledger status.")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(Color.ubeyeMuted)
                    }
                    Spacer()
                    if let nextAvailableAt = stats.earnings.nextAvailableAt {
                        Text("Available \(shortDate(nextAvailableAt))")
                            .font(.caption.weight(.bold))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 7)
                            .background(Color.ubeyeSubtle, in: Capsule())
                    }
                }

                LazyVGrid(columns: twoColumns, spacing: 12) {
                    ledgerMetric("Total earned", ubeyeCurrency(stats.earnings.totalCents), "All ledger entries", "wallet.pass")
                    ledgerMetric("Pending", ubeyeCurrency(stats.earnings.pendingCents), "Under review or clearing", "hourglass")
                    ledgerMetric("Available", ubeyeCurrency(stats.earnings.availableCents), "Ready for payout", "checkmark")
                    ledgerMetric("Paid out", ubeyeCurrency(stats.earnings.paidCents), "Settled to Stripe", "creditcard")
                }
            }
            .padding(14)
            .ubeyeCard()
        }
    }

    private func ledgerMetric(_ title: String, _ value: String, _ subtitle: String, _ icon: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.ubeyeMuted)
                Spacer()
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .bold))
                    .frame(width: 30, height: 30)
                    .foregroundStyle(Color.ubeyeMuted)
                    .background(Color.ubeyeSubtle, in: Circle())
            }
            Text(value)
                .font(.system(size: 23, weight: .bold))
                .minimumScaleFactor(0.62)
            Text(subtitle)
                .font(.caption.weight(.medium))
                .foregroundStyle(Color.ubeyeMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, minHeight: 118, alignment: .topLeading)
    }

    private var rangeQueryItems: [URLQueryItem] {
        let calendar = Calendar.current
        let now = Date()
        let from: Date
        let to: Date

        switch range {
        case "Day":
            from = calendar.startOfDay(for: now)
            to = now
        case "Week":
            from = calendar.date(byAdding: .day, value: -7, to: now) ?? now
            to = now
        case "Month":
            from = calendar.date(byAdding: .month, value: -1, to: now) ?? now
            to = now
        default:
            from = calendar.startOfDay(for: startDate)
            to = calendar.date(bySettingHour: 23, minute: 59, second: 59, of: endDate) ?? endDate
        }

        return [
            URLQueryItem(name: "from", value: ISO8601DateFormatter.ubeyeInternet.string(from: from)),
            URLQueryItem(name: "to", value: ISO8601DateFormatter.ubeyeInternet.string(from: to))
        ]
    }

    private var statsLoadKey: String {
        "\(range)-\(startDate.timeIntervalSince1970)-\(endDate.timeIntervalSince1970)"
    }

    private func formattedNumber(_ value: Int) -> String {
        value.formatted(.number)
    }

    private func shortDate(_ value: String) -> String {
        guard let date = ISO8601DateFormatter.ubeyeInternet.date(from: value) else {
            return value
        }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }
}

struct EarningsView: View {
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.dismiss) private var dismiss
    @StateObject private var store = CreatorStatsScreenStore()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ExpoScreenHeader(
                    eyebrow: "Creator",
                    title: "Earnings",
                    subtitle: "@\(auth.account?.handle ?? DesignFixtures.accountHandle)",
                    avatarUrl: auth.account?.avatarUrl ?? DesignFixtures.accountAvatar,
                    avatarName: auth.account?.displayName ?? DesignFixtures.accountName,
                    onBack: { dismiss() }
                )

                if store.isLoading && store.stats == nil {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 80)
                } else if let error = store.error, store.stats == nil {
                    EmptyStateView(title: "Earnings unavailable", message: error, systemImage: "wallet.pass")
                        .padding(.vertical, 36)
                } else if let stats = store.stats {
                    earningsContent(stats)
                }
            }
            .padding(16)
        }
        .navigationBarBackButtonHidden()
        .toolbar(.hidden, for: .navigationBar)
        .ubeyeScreen()
        .task {
            await store.load(api: api)
        }
        .refreshable {
            await store.load(api: api)
        }
    }

    private var twoColumns: [GridItem] {
        [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]
    }

    private func earningsContent(_ stats: CreatorStatsResponse.Stats) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            LazyVGrid(columns: twoColumns, spacing: 10) {
                ExpoMetricCard(title: "Available", value: ubeyeCurrency(stats.earnings.availableCents))
                ExpoMetricCard(title: "Pending", value: ubeyeCurrency(stats.earnings.pendingCents))
                ExpoMetricCard(title: "Paid", value: ubeyeCurrency(stats.earnings.paidCents))
                ExpoMetricCard(title: "Reversed", value: ubeyeCurrency(stats.earnings.reversedCents))
            }

            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Story ledger")
                        .font(.system(size: 20, weight: .bold))
                    Spacer()
                    Text("\(ubeyeCurrency(stats.earnings.totalCents)) lifetime")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Color.ubeyeMuted)
                }
                .padding(.bottom, 10)
                Divider()

                if stats.stories.isEmpty {
                    EmptyStateView(
                        title: "No story earnings",
                        message: "Story-level earnings appear here after posts receive eligible activity.",
                        systemImage: "wallet.pass"
                    )
                    .frame(maxWidth: .infinity, minHeight: 180)
                } else {
                    ForEach(stats.stories) { story in
                        earningsStoryRow(story)
                        if story.id != stats.stories.last?.id {
                            Divider().padding(.leading, 68)
                        }
                    }
                }
            }
            .padding(14)
            .ubeyeCard()
        }
    }

    private func earningsStoryRow(_ story: CreatorStatsResponse.Stats.Story) -> some View {
        HStack(spacing: 14) {
            ExpoStoryImage(url: story.thumbnailUrl ?? story.mediaUrl)
                .frame(width: 54, height: 54)

            VStack(alignment: .leading, spacing: 5) {
                Text(storyTitle(story))
                    .font(.system(size: 16, weight: .bold))
                    .lineLimit(1)
                Text("\(formattedStoryDate(story.createdAt)) · \(story.views.formatted(.number)) views")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Color.ubeyeMuted)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 5) {
                Text(ubeyeCurrency(story.earningsCents))
                    .font(.system(size: 15, weight: .bold))
                Text("\(ubeyeCurrency(story.paidEarningsCents)) paid")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Color.ubeyeMuted)
            }
        }
        .padding(.vertical, 16)
    }

    private func storyTitle(_ story: CreatorStatsResponse.Stats.Story) -> String {
        let trimmed = (story.caption ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Story post" : trimmed
    }

    private func formattedStoryDate(_ value: String) -> String {
        guard let date = ISO8601DateFormatter.ubeyeInternet.date(from: value) else {
            return value
        }

        return date.formatted(.dateTime.month(.abbreviated).day())
    }
}

struct PayoutsView: View {
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    @StateObject private var store = PayoutsStore()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ExpoScreenHeader(
                    eyebrow: "Creator",
                    title: "Payouts",
                    subtitle: "@\(auth.account?.handle ?? DesignFixtures.accountHandle)",
                    avatarUrl: auth.account?.avatarUrl ?? DesignFixtures.accountAvatar,
                    avatarName: auth.account?.displayName ?? DesignFixtures.accountName,
                    onBack: { dismiss() }
                )

                if store.isLoading && store.stripe == nil {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 80)
                } else if let error = store.error, store.stripe == nil {
                    EmptyStateView(title: "Payouts unavailable", message: error, systemImage: "creditcard")
                        .padding(.vertical, 36)
                } else if let stripe = store.stripe {
                    payoutsContent(stripe)
                }
            }
            .padding(16)
        }
        .navigationBarBackButtonHidden()
        .toolbar(.hidden, for: .navigationBar)
        .ubeyeScreen()
        .task {
            await store.load(api: api)
        }
        .refreshable {
            await store.load(api: api)
        }
    }

    private var twoColumns: [GridItem] {
        [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]
    }

    private func payoutsContent(_ stripe: StripeConnectStatusResponse) -> some View {
        let earnings = stripe.earnings
        let status = stripe.status
        let isReady = status?.connected == true && status?.chargesEnabled == true && status?.payoutsEnabled == true

        return VStack(alignment: .leading, spacing: 18) {
            HStack {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Payout account")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.ubeyeMuted)
                    Text(isReady ? "Ready" : "Action needed")
                        .font(.system(size: 28, weight: .bold))
                    Text(isReady ? "Stripe payouts are enabled." : "Finish Stripe setup to receive payouts.")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color.ubeyeMuted)
                }
                Spacer()
                Circle()
                    .fill(isReady ? Color.green : Color.ubeyeYellow)
                    .frame(width: 24, height: 24)
            }
            .padding(16)
            .ubeyeCard()

            LazyVGrid(columns: twoColumns, spacing: 10) {
                ExpoMetricCard(title: "Available", value: ubeyeCurrency(earnings?.availableCents))
                ExpoMetricCard(title: "Pending", value: ubeyeCurrency(earnings?.pendingCents))
                ExpoMetricCard(title: "Paid", value: ubeyeCurrency(earnings?.paidCents))
                ExpoMetricCard(title: "Reversed", value: ubeyeCurrency(earnings?.reversedCents))
            }

            VStack(spacing: 16) {
                if let onboardingUrl = status?.onboardingUrl {
                    Button {
                        openURL(onboardingUrl)
                    } label: {
                        Label("Continue Stripe setup", systemImage: "creditcard")
                            .font(.system(size: 16, weight: .bold))
                            .frame(maxWidth: .infinity)
                            .frame(height: 50)
                            .foregroundStyle(.white)
                            .background(Color.ubeyePurple)
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }

                if let dashboardUrl = status?.dashboardUrl {
                    Button {
                        openURL(dashboardUrl)
                    } label: {
                        Label("Open Stripe dashboard", systemImage: "arrow.up.forward.app")
                            .font(.system(size: 16, weight: .bold))
                            .frame(maxWidth: .infinity)
                            .frame(height: 50)
                            .foregroundStyle(Color.ubeyeInk)
                            .background(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.ubeyeBorder, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }

                Button {
                    Task { await store.load(api: api) }
                } label: {
                    Label("Sync payout status", systemImage: "arrow.triangle.2.circlepath")
                        .font(.system(size: 16, weight: .bold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .foregroundStyle(Color.ubeyeInk)
                        .background(Color.ubeyeSubtle)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            .padding(14)
            .ubeyeCard()
        }
    }
}

@MainActor
private final class PayoutsStore: ObservableObject {
    @Published var stripe: StripeConnectStatusResponse?
    @Published var isLoading = false
    @Published var error: String?

    func load(api: APIClient) async {
        isLoading = true
        error = nil
        do {
            stripe = try await api.get(
                "/api/mobile/stripe/connect/status",
                queryItems: [URLQueryItem(name: "sync", value: "1")]
            )
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}

struct FollowersView: View {
    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @StateObject private var store = FollowersStore()
    @State private var selected = "Followers"

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ExpoScreenHeader(
                    eyebrow: "Audience",
                    title: "Followers",
                    subtitle: "\(store.followers.count) followers · \(store.following.count) following",
                    onBack: { dismiss() }
                )

                ExpoSegmentedControl(items: ["Followers", "Following"], selected: $selected)

                if store.isLoading && store.followers.isEmpty && store.following.isEmpty {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 80)
                } else if let error = store.error {
                    EmptyStateView(title: "Followers unavailable", message: error, systemImage: "person.2")
                        .padding(.vertical, 36)
                } else if displayedProfiles.isEmpty {
                    EmptyStateView(
                        title: selected == "Followers" ? "No followers yet" : "Not following anyone yet",
                        message: selected == "Followers" ? "Followers will appear here." : "Creators you follow will appear here.",
                        systemImage: "person.2"
                    )
                    .padding(.vertical, 36)
                } else {
                    VStack(spacing: 0) {
                        ForEach(displayedProfiles) { profile in
                            followerRow(profile)
                            if profile.id != displayedProfiles.last?.id {
                                Divider().padding(.leading, 76)
                            }
                        }
                    }
                    .padding(.vertical, 8)
                    .ubeyeCard()
                }
            }
            .padding(16)
        }
        .navigationBarBackButtonHidden()
        .toolbar(.hidden, for: .navigationBar)
        .ubeyeScreen()
        .task {
            await store.load(api: api)
        }
        .refreshable {
            await store.load(api: api)
        }
    }

    private var displayedProfiles: [FollowingProfile] {
        selected == "Followers" ? store.followers : store.following
    }

    private func followerRow(_ profile: FollowingProfile) -> some View {
        HStack(spacing: 12) {
            RemoteAvatar(url: profile.imageUrl, size: 48, name: profile.name)
            VStack(alignment: .leading, spacing: 3) {
                Text(profile.name)
                    .font(.system(size: 16, weight: .bold))
                Text("@\(profile.handle)")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Color.ubeyeMuted)
            }
            Spacer()
            Text(selected == "Followers" ? "Follower" : "Following")
                .font(.system(size: 13, weight: .bold))
                .frame(width: 96, height: 38)
                .foregroundStyle(Color.ubeyeInk)
                .background(Color.ubeyeSubtle, in: Capsule())
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }
}

@MainActor
private final class FollowersStore: ObservableObject {
    @Published var followers: [FollowingProfile] = []
    @Published var following: [FollowingProfile] = []
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
}

@MainActor
final class MyStoryStatsStore: ObservableObject {
    @Published var stats: CreatorStatsResponse.Stats?
    @Published var isLoading = false
    @Published var error: String?

    func load(api: APIClient) async {
        isLoading = true
        error = nil
        do {
            let response: CreatorStatsResponse = try await api.get("/api/mobile/creator/stats")
            stats = response.stats
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}

struct MyStoryStatsView: View {
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.dismiss) private var dismiss
    @StateObject private var store = MyStoryStatsStore()
    @State private var selectedIndex = 0

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ExpoScreenHeader(
                    eyebrow: "Creator",
                    title: "My Story Stats",
                    subtitle: "@\(auth.account?.handle ?? DesignFixtures.accountHandle)",
                    avatarUrl: auth.account?.avatarUrl ?? DesignFixtures.accountAvatar,
                    avatarName: auth.account?.displayName ?? DesignFixtures.accountName,
                    onBack: { dismiss() }
                )

                if store.isLoading && store.stats == nil {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 80)
                } else if let error = store.error, store.stats == nil {
                    EmptyStateView(title: "Story stats unavailable", message: error, systemImage: "chart.bar.xaxis")
                        .padding(.vertical, 36)
                } else if let stats = store.stats, stats.stories.isEmpty {
                    EmptyStateView(
                        title: "No stories yet",
                        message: "Post a story and this screen will show its views, completion, replies, and earnings.",
                        systemImage: "photo.stack"
                    )
                    .padding(.vertical, 36)
                } else if let stats = store.stats {
                    selectedStoryContent(stats)
                }
            }
            .padding(16)
            .padding(.bottom, 24)
        }
        .navigationBarBackButtonHidden()
        .toolbar(.hidden, for: .navigationBar)
        .ubeyeScreen()
        .task {
            await store.load(api: api)
            selectNewestStory()
        }
        .refreshable {
            await store.load(api: api)
            selectNewestStory()
        }
    }

    private func selectedStoryContent(_ stats: CreatorStatsResponse.Stats) -> some View {
        let stories = orderedStories(stats)
        let selectedStory = stories[min(selectedIndex, max(stories.count - 1, 0))]

        return VStack(alignment: .leading, spacing: 18) {
            storyCarousel(stories)
            storyPager(stories)
            storySummary(story: selectedStory, stats: stats)
            individualStats(story: selectedStory)
        }
    }

    private func storyCarousel(_ stories: [CreatorStatsResponse.Stats.Story]) -> some View {
        ZStack {
            if selectedIndex > 0 {
                MyStoryStatsSidePreview(story: stories[selectedIndex - 1], side: .left)
            }

            if selectedIndex < stories.count - 1 {
                MyStoryStatsSidePreview(story: stories[selectedIndex + 1], side: .right)
            }

            TabView(selection: $selectedIndex) {
                ForEach(Array(stories.enumerated()), id: \.element.id) { index, story in
                    MyStoryStatsMediaCard(story: story, isActive: index == selectedIndex)
                        .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .animation(.easeInOut(duration: 0.2), value: selectedIndex)
            .frame(height: 526)
            .padding(.horizontal, 28)
        }
        .frame(height: 526)
        .clipped()
    }

    private func storyPager(_ stories: [CreatorStatsResponse.Stats.Story]) -> some View {
        HStack(spacing: 12) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    selectedIndex = max(0, selectedIndex - 1)
                }
            } label: {
                Label("Previous", systemImage: "chevron.left")
                    .font(.system(size: 14, weight: .bold))
                    .frame(width: 120, height: 46)
                    .background(.white, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.ubeyeBorder, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(selectedIndex == 0)
            .opacity(selectedIndex == 0 ? 0.45 : 1)

            Spacer()

            VStack(spacing: 2) {
                Text("\(selectedIndex + 1)/\(stories.count)")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Color.ubeyeInk)
                Text("Swipe")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(Color.ubeyeMuted)
            }

            Spacer()

            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    selectedIndex = min(stories.count - 1, selectedIndex + 1)
                }
            } label: {
                Label("Next", systemImage: "chevron.right")
                    .font(.system(size: 14, weight: .bold))
                    .frame(width: 120, height: 46)
                    .background(.white, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.ubeyeBorder, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(selectedIndex == stories.count - 1)
            .opacity(selectedIndex == stories.count - 1 ? 0.45 : 1)
        }
    }

    private func storySummary(story: CreatorStatsResponse.Stats.Story, stats: CreatorStatsResponse.Stats) -> some View {
        HStack(spacing: 10) {
            summaryPill(title: "Stories", value: "\(stats.totalStories)")
            summaryPill(title: "Live", value: "\(stats.liveStories)")
            summaryPill(title: "All views", value: abbreviatedNumber(stats.totalViews))
        }
        .padding(12)
        .background(.white, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.ubeyeBorder, lineWidth: 1))
    }

    private func summaryPill(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased())
                .font(.caption2.weight(.bold))
                .foregroundStyle(Color.ubeyeMuted)
            Text(value)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Color.ubeyeInk)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func individualStats(story: CreatorStatsResponse.Stats.Story) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Individual stats")
                        .font(.system(size: 20, weight: .bold))
                    Text("\(story.status.lowercased()) · \(formattedStoryDate(story.createdAt))")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color.ubeyeMuted)
                }
                Spacer()
                Text(story.assetKind.rawValue.uppercased())
                    .font(.caption.weight(.bold))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .foregroundStyle(Color.ubeyeMuted)
                    .background(Color.ubeyeSubtle, in: Capsule())
            }

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 14) {
                ExpoMetricCard(
                    title: "VIEWS",
                    value: formattedNumber(story.views),
                    subtitle: "\(formattedNumber(story.uniqueViewers)) unique",
                    systemImage: "eye",
                    background: Color.ubeyeSubtle
                )
                ExpoMetricCard(
                    title: "COMPLETION",
                    value: "\(story.completionRate)%",
                    subtitle: "\(formattedNumber(story.completedViews)) complete",
                    systemImage: "chart.xyaxis.line",
                    background: Color.ubeyeSubtle
                )
                ExpoMetricCard(
                    title: "REPLIES",
                    value: formattedNumber(story.replies),
                    subtitle: "\(formattedNumber(story.comments)) comments",
                    systemImage: "ellipsis.message",
                    background: Color.ubeyeSubtle
                )
                ExpoMetricCard(
                    title: "EARNED",
                    value: ubeyeCurrency(story.earningsCents),
                    subtitle: "\(ubeyeCurrency(story.paidEarningsCents)) paid",
                    systemImage: "dollarsign",
                    background: Color.ubeyeSubtle
                )
                ExpoMetricCard(
                    title: "AVG WATCH",
                    value: "\(story.averageViewedSeconds.formatted(.number.precision(.fractionLength(1))))s",
                    subtitle: "per view",
                    systemImage: "timer",
                    background: Color.ubeyeSubtle
                )
                ExpoMetricCard(
                    title: "PENDING",
                    value: ubeyeCurrency(story.pendingEarningsCents),
                    subtitle: "earnings review",
                    systemImage: "hourglass",
                    background: Color.ubeyeSubtle
                )
            }
        }
        .padding(14)
        .ubeyeCard()
    }

    private func formattedStoryDate(_ value: String) -> String {
        guard let date = ISO8601DateFormatter.ubeyeInternet.date(from: value) else {
            return value
        }

        return date.formatted(.dateTime.month(.abbreviated).day().hour().minute())
    }

    private func formattedNumber(_ value: Int) -> String {
        value.formatted(.number)
    }

    private func abbreviatedNumber(_ value: Int) -> String {
        value.formatted(.number.notation(.compactName))
    }

    private func orderedStories(_ stats: CreatorStatsResponse.Stats) -> [CreatorStatsResponse.Stats.Story] {
        stats.stories.sorted { left, right in
            storyDate(left) < storyDate(right)
        }
    }

    private func storyDate(_ story: CreatorStatsResponse.Stats.Story) -> Date {
        ISO8601DateFormatter.ubeyeInternet.date(from: story.createdAt) ?? .distantPast
    }

    private func selectNewestStory() {
        guard let stats = store.stats else {
            return
        }

        selectedIndex = max(orderedStories(stats).count - 1, 0)
    }
}

private struct MyStoryStatsMediaCard: View {
    let story: CreatorStatsResponse.Stats.Story
    var isActive = true

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Color.black.opacity(0.92)

            MyStoryStatsMedia(story: story)
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            LinearGradient(
                colors: [.clear, .black.opacity(0.78)],
                startPoint: .center,
                endPoint: .bottom
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            statusBadge
                .position(x: 56, y: 34)

            if story.assetKind == .video {
                Image(systemName: "play.fill")
                    .font(.system(size: 22, weight: .bold))
                    .frame(width: 58, height: 58)
                    .foregroundStyle(.white)
                    .background(.black.opacity(0.32), in: Circle())
                    .overlay(Circle().stroke(.white.opacity(0.28), lineWidth: 1))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text(storyTitle)
                    .font(.system(size: 28, weight: .bold))
                    .lineLimit(2)
                    .minimumScaleFactor(0.82)
                Text(formattedDate)
                    .font(.subheadline.weight(.bold))
            }
            .foregroundStyle(.white)
            .padding(24)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 506)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(.white.opacity(0.86), lineWidth: 1.5)
        )
        .shadow(color: .black.opacity(isActive ? 0.32 : 0.16), radius: isActive ? 30 : 16, x: 0, y: isActive ? 22 : 10)
        .shadow(color: .black.opacity(isActive ? 0.12 : 0.06), radius: 8, x: 0, y: 3)
        .padding(.vertical, 10)
    }

    private var statusBadge: some View {
        Text(story.status.uppercased())
            .font(.caption.weight(.bold))
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .foregroundStyle(.white)
            .background(.black.opacity(0.34), in: Capsule())
    }

    private var storyTitle: String {
        let trimmed = (story.caption ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Story post" : trimmed
    }

    private var formattedDate: String {
        guard let date = ISO8601DateFormatter.ubeyeInternet.date(from: story.createdAt) else {
            return story.createdAt
        }

        return date.formatted(.dateTime.month(.wide).day().hour().minute())
    }
}

private struct MyStoryStatsMedia: View {
    let story: CreatorStatsResponse.Stats.Story

    var body: some View {
        CachedAsyncImage(url: story.assetKind == .video ? story.thumbnailUrl ?? story.mediaUrl : story.mediaUrl) { image in
            image
                .resizable()
                .scaledToFit()
        } placeholder: {
            LinearGradient(
                colors: [Color.ubeyeSubtle, Color.ubeyeMuted.opacity(0.22)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct MyStoryStatsSidePreview: View {
    enum Side {
        case left
        case right
    }

    let story: CreatorStatsResponse.Stats.Story
    let side: Side

    var body: some View {
        ZStack {
            MyStoryStatsMedia(story: story)
            LinearGradient(
                colors: [.black.opacity(0.32), .black.opacity(0.12)],
                startPoint: side == .left ? .leading : .trailing,
                endPoint: side == .left ? .trailing : .leading
            )
        }
        .frame(width: 118, height: 472)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(.white.opacity(0.7), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.18), radius: 18, x: 0, y: 12)
        .scaleEffect(0.94)
        .opacity(0.78)
        .offset(x: side == .left ? -164 : 164, y: 8)
    }
}

private extension ISO8601DateFormatter {
    static let ubeyeInternet: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

struct CreatorDetailUnavailableView: View {
    @Environment(\.dismiss) private var dismiss
    let creator: FixtureCreator

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 18) {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 18, weight: .bold))
                        .frame(width: 42, height: 42)
                        .foregroundStyle(.white)
                        .background(Color.black.opacity(0.25), in: Circle())
                }
                .buttonStyle(.plain)

                Spacer()

                Image(systemName: "bell")
                    .font(.system(size: 18, weight: .bold))
                    .frame(width: 42, height: 42)
                    .background(Color.black.opacity(0.25), in: Circle())
                Image(systemName: "arrowshape.turn.up.right")
                    .font(.system(size: 18, weight: .bold))
                    .frame(width: 42, height: 42)
                    .background(Color.black.opacity(0.25), in: Circle())
                Image(systemName: "ellipsis")
                    .font(.system(size: 18, weight: .bold))
                    .frame(width: 42, height: 42)
                    .background(Color.black.opacity(0.25), in: Circle())
            }
            .padding(16)
            .padding(.top, 8)

            Spacer()
            Text("Creator unavailable")
                .font(.system(size: 20, weight: .bold))
            Spacer()
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.ubeyeNavy.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }
}
