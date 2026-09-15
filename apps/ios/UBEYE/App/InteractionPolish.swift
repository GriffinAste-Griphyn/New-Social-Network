import Foundation
import QuartzCore
import SwiftUI
import UIKit

enum UBEYEAdaptiveMode: String, Equatable {
    case standard
    case constrained
    case critical
}

enum UBEYEAdaptivePolicy {
    static func mode(
        lowPowerMode: Bool,
        thermalState: ProcessInfo.ThermalState,
        recentMemoryPressure: Bool,
        limitedNetwork: Bool
    ) -> UBEYEAdaptiveMode {
        if recentMemoryPressure || thermalState == .serious || thermalState == .critical {
            return .critical
        }
        if lowPowerMode || thermalState == .fair || limitedNetwork {
            return .constrained
        }
        return .standard
    }

    static func storyBufferIndices(
        activeIndex: Int,
        itemCount: Int,
        mode: UBEYEAdaptiveMode
    ) -> [Int] {
        guard itemCount > 0, (0..<itemCount).contains(activeIndex) else {
            return []
        }

        let candidates: [Int] = switch mode {
        case .standard:
            [activeIndex, activeIndex + 1, activeIndex - 1]
        case .constrained:
            [activeIndex, activeIndex + 1]
        case .critical:
            [activeIndex]
        }

        var seen = Set<Int>()
        return candidates.filter {
            (0..<itemCount).contains($0) && seen.insert($0).inserted
        }
    }
}

@MainActor
final class UBEYEResourceMonitor: ObservableObject {
    static let shared = UBEYEResourceMonitor()

    @Published private(set) var isLowPowerModeEnabled: Bool
    @Published private(set) var thermalState: ProcessInfo.ThermalState
    @Published private(set) var hasRecentMemoryPressure = false

    private var memoryPressureResetTask: Task<Void, Never>?
    private var observers: [NSObjectProtocol] = []

    var mode: UBEYEAdaptiveMode {
        UBEYEAdaptivePolicy.mode(
            lowPowerMode: isLowPowerModeEnabled,
            thermalState: thermalState,
            recentMemoryPressure: hasRecentMemoryPressure,
            limitedNetwork: NetworkQualityMonitor.shared.isLimitedPath
        )
    }

    var allowsRichMotion: Bool { mode == .standard }
    var allowsSpeculativeMedia: Bool { mode != .critical && !StoryUploadPriority.shared.isUploading }

    private init(processInfo: ProcessInfo = .processInfo) {
        isLowPowerModeEnabled = processInfo.isLowPowerModeEnabled
        thermalState = processInfo.thermalState

        let center = NotificationCenter.default
        observers.append(
            center.addObserver(
                forName: Notification.Name.NSProcessInfoPowerStateDidChange,
                object: processInfo,
                queue: .main
            ) { [weak self] _ in
                Task { @MainActor in
                    self?.refreshPowerState()
                }
            }
        )
        observers.append(
            center.addObserver(
                forName: ProcessInfo.thermalStateDidChangeNotification,
                object: processInfo,
                queue: .main
            ) { [weak self] _ in
                Task { @MainActor in
                    self?.refreshPowerState()
                }
            }
        )
        observers.append(
            center.addObserver(
                forName: UIApplication.didReceiveMemoryWarningNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                Task { @MainActor in
                    self?.registerMemoryPressure()
                }
            }
        )
    }

    private func refreshPowerState() {
        let previousMode = mode
        isLowPowerModeEnabled = ProcessInfo.processInfo.isLowPowerModeEnabled
        thermalState = ProcessInfo.processInfo.thermalState
        reportModeChange(from: previousMode)
    }

    private func registerMemoryPressure() {
        let previousMode = mode
        hasRecentMemoryPressure = true
        reportModeChange(from: previousMode)
        memoryPressureResetTask?.cancel()
        memoryPressureResetTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(30))
            guard !Task.isCancelled, let self else { return }
            let previousMode = self.mode
            self.hasRecentMemoryPressure = false
            self.reportModeChange(from: previousMode)
        }
    }

    private func reportModeChange(from previousMode: UBEYEAdaptiveMode) {
        guard previousMode != mode else { return }
        NotificationCenter.default.post(name: NetworkQualityMonitor.playbackBudgetChanged, object: nil)
        MediaPerformance.mark(
            "resource_mode from=\(previousMode.rawValue) to=\(mode.rawValue) low_power=\(isLowPowerModeEnabled) thermal=\(thermalState.rawValue)"
        )
    }
}

enum UBEYEMotion {
    static func interactive(reduceMotion: Bool, mode: UBEYEAdaptiveMode) -> Animation {
        if reduceMotion {
            return .easeOut(duration: 0.1)
        }
        if mode == .critical {
            return .easeOut(duration: 0.14)
        }
        return .interactiveSpring(response: 0.3, dampingFraction: 0.84, blendDuration: 0.08)
    }

    static func reveal(reduceMotion: Bool, mode: UBEYEAdaptiveMode) -> Animation {
        if reduceMotion || mode != .standard {
            return .easeOut(duration: 0.12)
        }
        return .snappy(duration: 0.22, extraBounce: 0.04)
    }
}

enum GestureAxisIntent: Equatable {
    case undecided
    case horizontal
    case vertical
}

enum GestureIntentPolicy {
    static func axis(
        translation: CGSize,
        minimumDistance: CGFloat = 10,
        dominanceRatio: CGFloat = 1.12
    ) -> GestureAxisIntent {
        let horizontal = abs(translation.width)
        let vertical = abs(translation.height)
        guard max(horizontal, vertical) >= minimumDistance else {
            return .undecided
        }
        if vertical > horizontal * dominanceRatio {
            return .vertical
        }
        if horizontal > vertical * dominanceRatio {
            return .horizontal
        }
        return .undecided
    }
}

struct DirectionalPrefetchIntent: Equatable {
    enum Direction: String {
        case forward
        case backward
    }

    let direction: Direction
    let indices: [Int]
    let velocityItemsPerSecond: Double
}

struct DirectionalPrefetchTracker {
    private(set) var lastIndex: Int?
    private(set) var lastDate: Date?

    mutating func record(
        visibleIndex: Int,
        itemCount: Int,
        mode: UBEYEAdaptiveMode,
        now: Date = Date()
    ) -> DirectionalPrefetchIntent {
        let previousIndex = lastIndex
        let previousDate = lastDate
        let direction: DirectionalPrefetchIntent.Direction = if let previousIndex, visibleIndex < previousIndex {
            .backward
        } else {
            .forward
        }
        let elapsed = max(now.timeIntervalSince(previousDate ?? now), 0.001)
        let velocity = previousIndex.map { Double(abs(visibleIndex - $0)) / elapsed } ?? 0
        let depth: Int = switch mode {
        case .critical:
            1
        case .constrained:
            2
        case .standard:
            velocity >= 4 ? 4 : 3
        }
        let step = direction == .forward ? 1 : -1
        let indices = (0...depth)
            .map { visibleIndex + $0 * step }
            .filter { (0..<itemCount).contains($0) }

        lastIndex = visibleIndex
        lastDate = now
        return DirectionalPrefetchIntent(
            direction: direction,
            indices: indices,
            velocityItemsPerSecond: velocity
        )
    }
}

enum ProgressiveImageStage: Int, Comparable {
    case none = 0
    case placeholder = 1
    case thumbnail = 2
    case full = 3

    static func < (lhs: ProgressiveImageStage, rhs: ProgressiveImageStage) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

@MainActor
final class ProgressiveImageLoader: ObservableObject {
    @Published private(set) var image: UIImage?
    @Published private(set) var stage: ProgressiveImageStage = .none
    @Published private(set) var verticalContentOffsetFraction: CGFloat = 0
    private var generation = 0
    private var requestStage: ProgressiveImageStage = .none

    func load(
        placeholderURL: URL?,
        thumbnailURL: URL?,
        fullURL: URL?,
        correctsAsymmetricTransparentPadding: Bool = false,
        maxPixelDimension: CGFloat? = nil
    ) async {
        generation &+= 1
        let currentGeneration = generation
        let startedAt = Date()

        // SwiftUI can preserve this loader while the surrounding story changes.
        // Clear the previous rendition before awaiting the next one so a slow
        // request never flashes the prior story or reuses its alignment offset.
        image = nil
        stage = .none
        verticalContentOffsetFraction = 0
        requestStage = .none

        var bestStagesByURL: [URL: ProgressiveImageStage] = [:]
        for (stage, url) in [
            (ProgressiveImageStage.placeholder, placeholderURL),
            (.thumbnail, thumbnailURL),
            (.full, fullURL),
        ] {
            guard let url else { continue }
            bestStagesByURL[url] = max(bestStagesByURL[url] ?? .none, stage)
        }

        guard !bestStagesByURL.isEmpty else {
            image = nil
            stage = .none
            return
        }

        for candidate in bestStagesByURL.sorted(by: { $0.value < $1.value }) {
            if let cached = MediaImageCache.shared.cachedImage(for: candidate.key, maxPixelDimension: candidate.value == .full ? maxPixelDimension : MediaImagePixelBudget.thumbnail) {
                promote(
                    cached,
                    to: candidate.value,
                    generation: currentGeneration,
                    startedAt: startedAt,
                    correctsAsymmetricTransparentPadding: correctsAsymmetricTransparentPadding
                )
            }
        }
        if requestStage == .full { return }

        await withTaskGroup(of: (ProgressiveImageStage, UIImage?).self) { group in
            for (url, candidateStage) in bestStagesByURL {
                if MediaImageCache.shared.cachedImage(for: url, maxPixelDimension: candidateStage == .full ? maxPixelDimension : MediaImagePixelBudget.thumbnail) != nil { continue }
                group.addTask {
                    let loaded = await MediaImageCache.shared.loadImage(for: url, maxPixelDimension: candidateStage == .full ? maxPixelDimension : MediaImagePixelBudget.thumbnail)
                    return (candidateStage, loaded)
                }
            }

            for await (candidateStage, loaded) in group {
                guard !Task.isCancelled, currentGeneration == generation else {
                    group.cancelAll()
                    return
                }
                if let loaded {
                    promote(
                        loaded,
                        to: candidateStage,
                        generation: currentGeneration,
                        startedAt: startedAt,
                        correctsAsymmetricTransparentPadding: correctsAsymmetricTransparentPadding
                    )
                    if requestStage == .full {
                        group.cancelAll()
                    }
                }
            }
        }
    }

    private func promote(
        _ candidate: UIImage,
        to candidateStage: ProgressiveImageStage,
        generation candidateGeneration: Int,
        startedAt: Date,
        correctsAsymmetricTransparentPadding: Bool
    ) {
        guard candidateGeneration == generation, candidateStage >= requestStage else { return }
        image = candidate
        verticalContentOffsetFraction = correctsAsymmetricTransparentPadding
            ? StoryImageVerticalAlignmentPolicy.correctionFraction(for: candidate)
            : 0
        stage = candidateStage
        requestStage = candidateStage
        MediaPerformance.measure("image_ready stage=\(candidateStage)", since: startedAt)
    }
}

struct ProgressiveCachedImage<Content: View, Placeholder: View>: View {
    let placeholderURL: URL?
    let thumbnailURL: URL?
    let fullURL: URL?
    let correctsAsymmetricTransparentPadding: Bool
    private let content: (Image, ProgressiveImageStage, CGFloat) -> Content
    private let placeholder: () -> Placeholder
    private let onReady: (ProgressiveImageStage) -> Void
    @StateObject private var loader = ProgressiveImageLoader()

    init(
        placeholderURL: URL?,
        thumbnailURL: URL?,
        fullURL: URL?,
        correctsAsymmetricTransparentPadding: Bool = false,
        @ViewBuilder content: @escaping (Image, ProgressiveImageStage, CGFloat) -> Content,
        @ViewBuilder placeholder: @escaping () -> Placeholder,
        onReady: @escaping (ProgressiveImageStage) -> Void = { _ in }
    ) {
        self.placeholderURL = placeholderURL
        self.thumbnailURL = thumbnailURL
        self.fullURL = fullURL
        self.correctsAsymmetricTransparentPadding = correctsAsymmetricTransparentPadding
        self.content = content
        self.placeholder = placeholder
        self.onReady = onReady
    }

    private var loadKey: String {
        let urls = [placeholderURL, thumbnailURL, fullURL]
            .map { $0?.absoluteString ?? "-" }
            .joined(separator: "|")
        return "\(urls)|correct-padding:\(correctsAsymmetricTransparentPadding)"
    }

    private var cachedPresentation: (image: UIImage, stage: ProgressiveImageStage)? {
        for (url, stage) in [
            (fullURL, ProgressiveImageStage.full),
            (thumbnailURL, .thumbnail),
            (placeholderURL, .placeholder),
        ] {
            if let image = MediaImageCache.shared.cachedImage(for: url, maxPixelDimension: stage == .full ? nil : MediaImagePixelBudget.thumbnail) {
                return (image, stage)
            }
        }

        return nil
    }

    var body: some View {
        ZStack {
            placeholder()
            if let image = loader.image {
                content(
                    Image(uiImage: image),
                    loader.stage,
                    loader.verticalContentOffsetFraction
                )
            } else if let cachedPresentation {
                content(
                    Image(uiImage: cachedPresentation.image),
                    cachedPresentation.stage,
                    correctsAsymmetricTransparentPadding
                        ? StoryImageVerticalAlignmentPolicy.correctionFraction(
                            for: cachedPresentation.image
                        )
                        : 0
                )
            }
        }
        .transaction { transaction in
            // Thumbnail and full-size derivatives share identical geometry.
            // Replacing the view identity and cross-fading the stages exposed
            // both decoded frames during first load and made overlays appear to
            // jump. Keep one stable render node and promote pixels atomically.
            transaction.animation = nil
            transaction.disablesAnimations = true
        }
        .task(id: loadKey) {
            await loader.load(
                placeholderURL: placeholderURL,
                thumbnailURL: thumbnailURL,
                fullURL: fullURL,
                correctsAsymmetricTransparentPadding: correctsAsymmetricTransparentPadding
            )
        }
        .onChange(of: loader.stage) { _, stage in
            guard stage != .none else { return }
            onReady(stage)
        }
    }
}

@MainActor
final class UBEYEContextualHintStore {
    static let shared = UBEYEContextualHintStore()
    private let defaults = UserDefaults.standard

    func shouldShow(_ key: String) -> Bool {
        !defaults.bool(forKey: storageKey(key))
    }

    func markSeen(_ key: String) {
        defaults.set(true, forKey: storageKey(key))
    }

    private func storageKey(_ key: String) -> String {
        "ubeye.contextual-hint.\(key)"
    }
}

struct UBEYEContextualHint: View {
    let systemImage: String
    let message: String

    var body: some View {
        Label(message, systemImage: systemImage)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.white)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(.black.opacity(0.78), in: Capsule())
            .overlay(Capsule().stroke(.white.opacity(0.2), lineWidth: 1))
            .shadow(color: .black.opacity(0.24), radius: 12, y: 5)
            .accessibilityLabel(message)
    }
}

/// Callback cadence is a diagnostic signal, not a measurement of rendered GPU frames.
struct FramePacingAccumulator {
    private var previousTimestamp: TimeInterval?
    private var previousExpected: TimeInterval?
    private(set) var frames = 0
    private(set) var hitches = 0
    private(set) var elapsed: TimeInterval = 0
    private(set) var hitchTime: TimeInterval = 0
    private(set) var maximumGap: TimeInterval = 0
    private(set) var lastGap: TimeInterval = 0

    mutating func sample(timestamp: TimeInterval, expected: TimeInterval) -> Bool {
        guard timestamp.isFinite, expected.isFinite, expected > 0 else { return false }
        defer { previousTimestamp = timestamp; previousExpected = expected }
        guard let previousTimestamp, let previousExpected else { return false }
        let gap = timestamp - previousTimestamp
        // Suspension explicitly interrupts the sample stream; refresh changes start a new interval.
        guard gap > 0, abs(expected - previousExpected) < min(expected, previousExpected) * 0.2 else { return false }
        lastGap = gap
        frames += 1
        elapsed += gap
        maximumGap = max(maximumGap, gap)
        let hitch = gap > max(previousExpected * 1.75, 0.012)
        if hitch { hitches += 1; hitchTime += max(0, gap - previousExpected) }
        return hitch
    }
    mutating func interrupt() { previousTimestamp = nil; previousExpected = nil }
}

@MainActor
final class InteractionFrameMonitor: NSObject {
    static let shared = InteractionFrameMonitor()
    private var displayLink: CADisplayLink?
    private var activeSurfaces = Set<String>()
    private var cadence = FramePacingAccumulator()
    private var lastReportedHitchAt = Date.distantPast
    private var windowNetwork = "unknown"
    private var windowMode = UBEYEAdaptiveMode.standard
    private var lifecycleObserver: NSObjectProtocol?

    override init() {
        super.init()
        lifecycleObserver = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in self?.cadence.interrupt() }
        }
    }
    deinit {
        if let lifecycleObserver { NotificationCenter.default.removeObserver(lifecycleObserver) }
    }

    func start(surface: String) {
        if !activeSurfaces.contains(surface), !activeSurfaces.isEmpty { flush() }
        activeSurfaces.insert(surface)
        guard displayLink == nil else { return }
        cadence = FramePacingAccumulator()
        windowNetwork = NetworkQualityMonitor.shared.telemetryNetworkClass
        windowMode = UBEYEResourceMonitor.shared.mode
        let link = CADisplayLink(target: self, selector: #selector(tick(_:)))
        link.add(to: .main, forMode: .common)
        displayLink = link
    }
    func stop(surface: String) {
        guard activeSurfaces.contains(surface) else { return }
        flush()
        activeSurfaces.remove(surface)
        guard activeSurfaces.isEmpty else { return }
        displayLink?.invalidate()
        displayLink = nil
    }
    private func flush() {
        if cadence.frames >= 30 {
            let surfaces = activeSurfaces.sorted().joined(separator: ",")
            MediaPerformance.mark("frame_pacing surface=\(surfaces) frames=\(cadence.frames) hitches=\(cadence.hitches) elapsed_ms=\(Int(cadence.elapsed * 1000)) hitch_ms=\(Int(cadence.hitchTime * 1000)) max_gap_ms=\(Int(cadence.maximumGap * 1000)) mode=\(windowMode.rawValue) network_class=\(windowNetwork)")
        }
        cadence = FramePacingAccumulator()
        windowNetwork = NetworkQualityMonitor.shared.telemetryNetworkClass
        windowMode = UBEYEResourceMonitor.shared.mode
    }
    @objc private func tick(_ link: CADisplayLink) {
        guard UIApplication.shared.applicationState == .active else { cadence.interrupt(); return }
        if windowNetwork != NetworkQualityMonitor.shared.telemetryNetworkClass || windowMode != UBEYEResourceMonitor.shared.mode { flush() }
        let expected = link.targetTimestamp - link.timestamp
        let hitch = cadence.sample(timestamp: link.timestamp, expected: expected)
        if hitch, Date().timeIntervalSince(lastReportedHitchAt) > 1.5 {
            lastReportedHitchAt = Date()
            MediaPerformance.mark("frame_hitch surface=\(activeSurfaces.sorted().joined(separator: ",")) elapsed_ms=\(Int(cadence.lastGap * 1000)) expected_ms=\(Int(expected * 1000))")
        }
        if cadence.elapsed >= 60 { flush() }
    }
}
