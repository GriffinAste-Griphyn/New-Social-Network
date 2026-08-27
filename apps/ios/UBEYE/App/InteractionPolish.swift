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
    var allowsSpeculativeMedia: Bool { mode != .critical }

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
    private var generation = 0
    private var requestStage: ProgressiveImageStage = .none

    func load(placeholderURL: URL?, thumbnailURL: URL?, fullURL: URL?) async {
        generation &+= 1
        let currentGeneration = generation
        let startedAt = Date()
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
            if let cached = MediaImageCache.shared.cachedImage(for: candidate.key) {
                promote(cached, to: candidate.value, generation: currentGeneration, startedAt: startedAt)
            }
        }
        if requestStage == .full { return }

        await withTaskGroup(of: (ProgressiveImageStage, UIImage?).self) { group in
            for (url, candidateStage) in bestStagesByURL {
                if MediaImageCache.shared.cachedImage(for: url) != nil { continue }
                group.addTask {
                    let loaded = await MediaImageCache.shared.loadImage(for: url)
                    return (candidateStage, loaded)
                }
            }

            for await (candidateStage, loaded) in group {
                guard !Task.isCancelled, currentGeneration == generation else {
                    group.cancelAll()
                    return
                }
                if let loaded {
                    promote(loaded, to: candidateStage, generation: currentGeneration, startedAt: startedAt)
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
        startedAt: Date
    ) {
        guard candidateGeneration == generation, candidateStage >= requestStage else { return }
        image = candidate
        stage = candidateStage
        requestStage = candidateStage
        MediaPerformance.measure("image_ready stage=\(candidateStage)", since: startedAt)
    }
}

struct ProgressiveCachedImage<Content: View, Placeholder: View>: View {
    let placeholderURL: URL?
    let thumbnailURL: URL?
    let fullURL: URL?
    private let content: (Image, ProgressiveImageStage) -> Content
    private let placeholder: () -> Placeholder
    private let onReady: (ProgressiveImageStage) -> Void
    @StateObject private var loader = ProgressiveImageLoader()

    init(
        placeholderURL: URL?,
        thumbnailURL: URL?,
        fullURL: URL?,
        @ViewBuilder content: @escaping (Image, ProgressiveImageStage) -> Content,
        @ViewBuilder placeholder: @escaping () -> Placeholder,
        onReady: @escaping (ProgressiveImageStage) -> Void = { _ in }
    ) {
        self.placeholderURL = placeholderURL
        self.thumbnailURL = thumbnailURL
        self.fullURL = fullURL
        self.content = content
        self.placeholder = placeholder
        self.onReady = onReady
    }

    private var loadKey: String {
        [placeholderURL, thumbnailURL, fullURL]
            .map { $0?.absoluteString ?? "-" }
            .joined(separator: "|")
    }

    var body: some View {
        ZStack {
            placeholder()
            if let image = loader.image {
                content(Image(uiImage: image), loader.stage)
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
                fullURL: fullURL
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

@MainActor
final class InteractionFrameMonitor: NSObject {
    static let shared = InteractionFrameMonitor()

    private var displayLink: CADisplayLink?
    private var activeSurfaces = Set<String>()
    private var lastTimestamp: CFTimeInterval = 0
    private var lastReportedHitchAt = Date.distantPast

    func start(surface: String) {
        activeSurfaces.insert(surface)
        guard displayLink == nil else { return }
        lastTimestamp = 0
        let link = CADisplayLink(target: self, selector: #selector(tick(_:)))
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    func stop(surface: String) {
        activeSurfaces.remove(surface)
        guard activeSurfaces.isEmpty else { return }
        displayLink?.invalidate()
        displayLink = nil
        lastTimestamp = 0
    }

    @objc private func tick(_ link: CADisplayLink) {
        defer { lastTimestamp = link.timestamp }
        guard lastTimestamp > 0 else { return }
        let elapsed = link.timestamp - lastTimestamp
        let expected = max(link.targetTimestamp - link.timestamp, 1.0 / 120.0)
        let hitchThreshold = max(expected * 1.75, 0.025)
        guard elapsed > hitchThreshold,
              Date().timeIntervalSince(lastReportedHitchAt) > 1.5 else {
            return
        }
        lastReportedHitchAt = Date()
        let surfaces = activeSurfaces.sorted().joined(separator: ",")
        MediaPerformance.mark(
            "frame_hitch surface=\(surfaces) elapsed_ms=\(Int(elapsed * 1000)) expected_ms=\(Int(expected * 1000))"
        )
    }
}
