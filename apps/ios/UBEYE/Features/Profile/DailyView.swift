import AVFoundation
import SwiftUI
import UIKit

@MainActor
final class DailyStore: ObservableObject {
    @Published var response: DailyStatusResponse?
    @Published var isLoading = false
    @Published var isStarting = false
    @Published var error: String?

    var daily: DailySummary? { response?.daily }
    var activeSession: DailySession? { response?.activeSession }
    var entry: DailyEntry? { response?.entry }

    func load(api: APIClient) async {
        isLoading = true
        error = nil

        do {
            response = try await api.dailyStatus()
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    func start(api: APIClient) async -> DailySession? {
        isStarting = true
        error = nil

        do {
            response = try await api.startDaily()
        } catch {
            self.error = error.localizedDescription
        }

        isStarting = false
        return response?.activeSession
    }

    func apply(_ response: DailyStatusResponse) {
        self.response = response
    }
}

struct DailyView: View {
    @EnvironmentObject private var api: APIClient
    @StateObject private var store = DailyStore()
    @State private var playerSession: DailySession?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if store.isLoading && store.response == nil {
                    DailyLoadingSkeleton()
                } else {
                    headerCard

                    if let error = store.error {
                        InlineNotice(message: error, isError: true)
                    }

                    statusCard
                    rulesCard
                }
            }
            .padding(16)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .navigationTitle("The Daily")
        .navigationBarTitleDisplayMode(.inline)
        .ubeyeScreen()
        .task {
            await store.load(api: api)
        }
        .refreshable {
            await store.load(api: api)
        }
        .fullScreenCover(item: $playerSession) { session in
            DailyAdPlayerView(session: session) { response in
                store.apply(response)
            }
            .environmentObject(api)
        }
    }

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Image(systemName: "play.rectangle.on.rectangle.fill")
                    .font(.system(size: 18, weight: .bold))
                    .frame(width: 44, height: 44)
                    .foregroundStyle(.white)
                    .background(Color.ubeyeNavy, in: Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text("The Daily")
                        .font(.system(size: 24, weight: .bold))
                    Text("Watch 5 sponsor videos for one daily entry")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Color.ubeyeMuted)
                }

                Spacer()
            }

            HStack(spacing: 10) {
                dailyMetric("Pool", ubeyeCurrency(store.daily?.estimatedPoolCents), "75% share")
                dailyMetric("Winners", "\(store.daily?.winnerCount ?? 5)", "equal split")
                dailyMetric("Draw", store.daily?.drawLabel ?? "9:10 PM ET", "daily")
            }
        }
        .padding(16)
        .ubeyeCard()
    }

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(statusTitle)
                        .font(.system(size: 18, weight: .bold))
                    Text(statusSubtitle)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Color.ubeyeMuted)
                }

                Spacer()

                if store.isLoading || store.isStarting {
                    DailyStatusActivitySkeleton()
                }
            }

            Button {
                Task { await startOrResume() }
            } label: {
                Label(primaryActionTitle, systemImage: primaryActionIcon)
                    .font(.system(size: 14, weight: .bold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 46)
                    .foregroundStyle(.white)
                    .background(primaryActionDisabled ? Color.ubeyeMuted.opacity(0.45) : Color.ubeyeNavy, in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(primaryActionDisabled)

            if store.entry != nil {
                InlineNotice(
                    message: "You are entered into today's Daily pool. Winners are drawn at 9:10 PM ET.",
                    isError: false
                )
            }
        }
        .padding(16)
        .ubeyeCard()
    }

    private var rulesCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Eligibility", systemImage: "checkmark.shield")
                .font(.system(size: 17, weight: .bold))

            VStack(alignment: .leading, spacing: 8) {
                ruleLine("US only and 18+ at launch.")
                ruleLine("One entry per eligible user per Daily period.")
                ruleLine("Daily period runs 9:00 PM ET to 9:00 PM ET.")
                ruleLine("Apple is not a sponsor of, involved in, or responsible for The Daily, entries, drawings, or payouts.")
            }

            if let rulesURL {
                Link(destination: rulesURL) {
                    Label("Official rules summary", systemImage: "doc.text")
                        .font(.system(size: 14, weight: .bold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 42)
                        .foregroundStyle(Color.ubeyeInk)
                        .background(Color.ubeyeSubtle, in: Capsule())
                }
            }
        }
        .padding(16)
        .ubeyeCard()
    }

    private var statusTitle: String {
        switch store.daily?.status {
        case "entered":
            "Entered today"
        case "in_progress":
            "Daily in progress"
        default:
            "Ready when you are"
        }
    }

    private var statusSubtitle: String {
        switch store.daily?.status {
        case "entered":
            "Your entry is recorded for this Daily pool."
        case "in_progress":
            "Resume from the saved sponsor video."
        default:
            "Opt in, watch 5 full-screen videos, and receive one entry."
        }
    }

    private var primaryActionTitle: String {
        switch store.daily?.status {
        case "entered":
            "Entered"
        case "in_progress":
            "Resume The Daily"
        default:
            "Start The Daily"
        }
    }

    private var primaryActionIcon: String {
        switch store.daily?.status {
        case "entered":
            "checkmark.circle.fill"
        case "in_progress":
            "play.fill"
        default:
            "play.rectangle.fill"
        }
    }

    private var primaryActionDisabled: Bool {
        store.isLoading || store.isStarting || store.daily?.status == "entered"
    }

    private var rulesURL: URL? {
        guard let path = store.daily?.officialRulesUrl else {
            return nil
        }

        return URL(string: path, relativeTo: api.baseURL)?.absoluteURL
    }

    private func dailyMetric(_ title: String, _ value: String, _ subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption.weight(.medium))
                .foregroundStyle(Color.ubeyeMuted)
            Text(value)
                .font(.system(size: 16, weight: .bold))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            Text(subtitle)
                .font(.caption2.weight(.medium))
                .foregroundStyle(Color.ubeyeMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.ubeyeSubtle, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func ruleLine(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "checkmark")
                .font(.caption.weight(.bold))
                .foregroundStyle(Color.ubeyeNavy)
                .frame(width: 18, height: 18)
            Text(text)
                .font(.caption.weight(.medium))
                .foregroundStyle(Color.ubeyeMuted)
        }
    }

    private func startOrResume() async {
        if let session = store.activeSession {
            playerSession = session
            return
        }

        if let session = await store.start(api: api) {
            playerSession = session
        }
    }
}

private struct DailyLoadingSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            DailyHeaderLoadingCard()
            DailyStatusLoadingCard()
            DailyRulesLoadingCard()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading The Daily")
    }
}

private struct DailyHeaderLoadingCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                UBEYESkeletonCircle(size: 44)

                VStack(alignment: .leading, spacing: 7) {
                    UBEYESkeletonLine(width: 104, height: 16)
                    UBEYESkeletonLine(width: 214, height: 10)
                }

                Spacer(minLength: 0)
            }

            HStack(spacing: 10) {
                ForEach(0..<3, id: \.self) { index in
                    DailyMetricLoadingTile(widths: metricWidths(for: index))
                }
            }
        }
        .padding(16)
        .ubeyeCard()
    }

    private func metricWidths(for index: Int) -> DailyMetricLoadingTile.Widths {
        switch index {
        case 0:
            return DailyMetricLoadingTile.Widths(title: 30, value: 62, subtitle: 54)
        case 1:
            return DailyMetricLoadingTile.Widths(title: 46, value: 24, subtitle: 58)
        default:
            return DailyMetricLoadingTile.Widths(title: 28, value: 72, subtitle: 34)
        }
    }
}

private struct DailyMetricLoadingTile: View {
    struct Widths {
        let title: CGFloat
        let value: CGFloat
        let subtitle: CGFloat
    }

    let widths: Widths

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            UBEYESkeletonLine(width: widths.title, height: 8)
            UBEYESkeletonLine(width: widths.value, height: 13)
            UBEYESkeletonLine(width: widths.subtitle, height: 8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.ubeyeSubtle, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

private struct DailyStatusLoadingCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 7) {
                    UBEYESkeletonLine(width: 142, height: 15)
                    UBEYESkeletonLine(width: 236, height: 10)
                }

                Spacer(minLength: 0)

                DailyStatusActivitySkeleton()
            }

            UBEYESkeletonBlock(cornerRadius: 23)
                .frame(height: 46)
        }
        .padding(16)
        .ubeyeCard()
    }
}

private struct DailyRulesLoadingCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                UBEYESkeletonCircle(size: 22)
                UBEYESkeletonLine(width: 96, height: 14)
            }

            VStack(alignment: .leading, spacing: 10) {
                ForEach(0..<4, id: \.self) { index in
                    HStack(alignment: .top, spacing: 8) {
                        UBEYESkeletonCircle(size: 18)
                        UBEYESkeletonLine(width: ruleWidth(for: index), height: 10)
                    }
                }
            }

            UBEYESkeletonBlock(cornerRadius: 21)
                .frame(height: 42)
        }
        .padding(16)
        .ubeyeCard()
    }

    private func ruleWidth(for index: Int) -> CGFloat {
        switch index {
        case 0:
            return 176
        case 1:
            return 230
        case 2:
            return 206
        default:
            return 256
        }
    }
}

private struct DailyStatusActivitySkeleton: View {
    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(Color.ubeyeRed.opacity(0.74))
                .frame(width: 6, height: 6)
            UBEYESkeletonLine(width: 34, height: 7)
        }
        .accessibilityHidden(true)
    }
}

private struct DailyAdPlayerView: View {
    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @State private var session: DailySession
    @State private var currentIndex: Int
    @State private var player: AVPlayer?
    @State private var timeObserver: Any?
    @State private var positionMs: Int
    @State private var durationMs: Int?
    @State private var isAdvancing = false
    @State private var error: String?
    let onFinished: (DailyStatusResponse) -> Void

    init(session: DailySession, onFinished: @escaping (DailyStatusResponse) -> Void) {
        let resolvedIndex = min(max(session.currentAdIndex, 0), max(session.ads.count - 1, 0))
        _session = State(initialValue: session)
        _currentIndex = State(initialValue: resolvedIndex)
        _positionMs = State(initialValue: session.currentPositionMs)
        _durationMs = State(initialValue: session.ads[safe: resolvedIndex]?.durationMs)
        self.onFinished = onFinished
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            DailyPlayerLayer(player: player)
                .ignoresSafeArea()
                .onTapGesture {
                    Task { await clickthrough() }
                }

            VStack {
                topChrome
                Spacer()
                bottomChrome
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
        }
        .statusBarHidden()
        .onAppear {
            loadCurrentAd()
        }
        .onDisappear {
            removeTimeObserver()
            player?.pause()
        }
        .onChange(of: currentIndex) { _, _ in
            loadCurrentAd()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                player?.play()
            } else {
                player?.pause()
                Task { await persist(event: "exited") }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .AVPlayerItemDidPlayToEndTime)) { _ in
            Task { await completeCurrentAd() }
        }
    }

    private var currentAd: DailyAd? {
        session.ads[safe: currentIndex]
    }

    private var topChrome: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                Button {
                    Task {
                        await persist(event: "exited")
                        dismiss()
                    }
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .bold))
                        .frame(width: 38, height: 38)
                        .foregroundStyle(.white)
                        .background(.black.opacity(0.45), in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Exit The Daily")

                VStack(alignment: .leading, spacing: 4) {
                    Text("Ad \(currentIndex + 1) of \(max(session.ads.count, 1))")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.white)
                    ProgressView(value: progress)
                        .tint(.white)
                        .background(.white.opacity(0.22), in: Capsule())
                }

                Text(remainingLabel)
                    .font(.caption.monospacedDigit().weight(.bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 10)
                    .frame(height: 30)
                    .background(.black.opacity(0.45), in: Capsule())
            }

            if let error {
                Text(error)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color.ubeyeRed.opacity(0.85), in: Capsule())
            }
        }
    }

    private var bottomChrome: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let currentAd {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Ad")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.white.opacity(0.72))
                    Text(currentAd.brandName)
                        .font(.system(size: 26, weight: .bold))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                }

                Button {
                    Task { await clickthrough() }
                } label: {
                    Label(currentAd.ctaText, systemImage: "arrow.up.forward")
                        .font(.system(size: 15, weight: .bold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                        .foregroundStyle(Color.ubeyeInk)
                        .background(.white, in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.bottom, 18)
    }

    private var progress: Double {
        guard let durationMs, durationMs > 0 else {
            return 0
        }

        return min(1, max(0, Double(positionMs) / Double(durationMs)))
    }

    private var remainingLabel: String {
        guard let durationMs, durationMs > 0 else {
            return "--"
        }

        let remainingMs = max(0, durationMs - positionMs)
        return "\(Int(ceil(Double(remainingMs) / 1000)))s"
    }

    private func loadCurrentAd() {
        removeTimeObserver()
        error = nil
        guard let ad = currentAd else {
            dismiss()
            return
        }

        let item = AVPlayerItem(url: ad.videoUrl)
        let nextPlayer = AVPlayer(playerItem: item)
        nextPlayer.actionAtItemEnd = .pause
        nextPlayer.automaticallyWaitsToMinimizeStalling = true
        player = nextPlayer
        positionMs = resumePositionMs(for: ad)
        durationMs = ad.durationMs

        if positionMs > 0 {
            nextPlayer.seek(
                to: CMTime(seconds: Double(positionMs) / 1000, preferredTimescale: 600),
                toleranceBefore: .zero,
                toleranceAfter: .zero
            )
        }

        installTimeObserver(for: nextPlayer)
        nextPlayer.play()
        Task { await persist(event: "started") }
    }

    private func resumePositionMs(for ad: DailyAd) -> Int {
        if session.currentAdIndex == currentIndex {
            return session.currentPositionMs
        }

        return ad.lastPositionMs ?? 0
    }

    private func installTimeObserver(for player: AVPlayer) {
        let interval = CMTime(seconds: 0.5, preferredTimescale: 600)
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { time in
            positionMs = max(0, Int(time.seconds * 1000))
            if let seconds = player.currentItem?.duration.seconds, seconds.isFinite, seconds > 0 {
                durationMs = Int(seconds * 1000)
            }

            if positionMs > 0, positionMs % 3000 < 600 {
                Task { await persist(event: "heartbeat") }
            }
        }
    }

    private func removeTimeObserver() {
        if let timeObserver, let player {
            player.removeTimeObserver(timeObserver)
        }

        timeObserver = nil
    }

    private func persist(event: String) async {
        guard currentAd != nil else {
            return
        }

        do {
            let response = try await api.recordDailyProgress(
                sessionId: session.id,
                position: currentIndex,
                positionMs: positionMs,
                durationMs: durationMs,
                event: event
            )
            if let updatedSession = response.activeSession {
                session = updatedSession
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func completeCurrentAd() async {
        guard !isAdvancing else {
            return
        }

        isAdvancing = true
        player?.pause()

        do {
            let response = try await api.recordDailyProgress(
                sessionId: session.id,
                position: currentIndex,
                positionMs: durationMs ?? positionMs,
                durationMs: durationMs,
                event: "completed"
            )

            if response.entry != nil || response.activeSession?.status == "completed" {
                onFinished(response)
                dismiss()
                return
            }

            if let updatedSession = response.activeSession {
                session = updatedSession
            }

            currentIndex = min(currentIndex + 1, max(session.ads.count - 1, 0))
            positionMs = 0
        } catch {
            self.error = error.localizedDescription
        }

        isAdvancing = false
    }

    private func clickthrough() async {
        guard let ad = currentAd else {
            return
        }

        player?.pause()

        do {
            let response = try await api.recordDailyClick(
                sessionId: session.id,
                position: currentIndex,
                positionMs: positionMs
            )
            openURL(response.destinationUrl)
        } catch {
            self.error = error.localizedDescription
            openURL(ad.destinationUrl)
        }
    }
}

private struct DailyPlayerLayer: UIViewRepresentable {
    let player: AVPlayer?

    func makeUIView(context: Context) -> PlayerView {
        let view = PlayerView()
        view.playerLayer.videoGravity = .resizeAspectFill
        view.playerLayer.backgroundColor = UIColor.black.cgColor
        return view
    }

    func updateUIView(_ uiView: PlayerView, context: Context) {
        uiView.player = player
    }

    final class PlayerView: UIView {
        override static var layerClass: AnyClass {
            AVPlayerLayer.self
        }

        var playerLayer: AVPlayerLayer {
            layer as! AVPlayerLayer
        }

        var player: AVPlayer? {
            get { playerLayer.player }
            set { playerLayer.player = newValue }
        }
    }
}
