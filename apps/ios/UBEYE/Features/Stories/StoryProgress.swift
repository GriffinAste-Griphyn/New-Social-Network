import AVKit
import CryptoKit
import SwiftUI
import UIKit

@MainActor
final class StoryTimerProgressState: ObservableObject {
    @Published fileprivate(set) var visibleProgress = 0.0
}

@MainActor
final class StoryTimerDisplayLinkTarget: NSObject {
    weak var timer: StoryTimerState?
    init(timer: StoryTimerState) { self.timer = timer }
    @objc func tick(_ link: CADisplayLink) { timer?.displayLinkDidFire(link) }
}

@MainActor
final class StoryTimerState {
    let progressState = StoryTimerProgressState()
    var startedAt = Date()
    private(set) var playerProgress = 0.0
    private var usesPlayerProgress = false
    private var displayLink: CADisplayLink?
    private var displayDuration: TimeInterval = 1
    private var isPaused = false
    private var onFinished: (() -> Void)?

    deinit { displayLink?.invalidate() }

    private var visibleProgress: Double {
        get { progressState.visibleProgress }
        set { progressState.visibleProgress = newValue }
    }

    func reset(at date: Date = Date()) {
        stop()
        startedAt = date
        playerProgress = 0
        usesPlayerProgress = false
        visibleProgress = 0
    }

    func resetForPlayerProgress(at date: Date = Date()) {
        stop()
        startedAt = date
        playerProgress = 0
        usesPlayerProgress = true
        visibleProgress = 0
    }

    func start(
        duration: TimeInterval,
        paused: Bool,
        onFinished: @escaping () -> Void
    ) {
        stop()
        usesPlayerProgress = false
        displayDuration = max(duration, 0.001)
        startedAt = Date().addingTimeInterval(-visibleProgress * displayDuration)
        isPaused = paused
        self.onFinished = onFinished

        let displayLink = CADisplayLink(target: StoryTimerDisplayLinkTarget(timer: self), selector: #selector(StoryTimerDisplayLinkTarget.tick(_:)))
        displayLink.preferredFrameRateRange = CAFrameRateRange(
            minimum: 30,
            maximum: Float(UIScreen.main.maximumFramesPerSecond),
            preferred: Float(UBEYEResourceMonitor.shared.mode == .standard ? UIScreen.main.maximumFramesPerSecond : 60)
        )
        displayLink.isPaused = paused
        displayLink.add(to: .main, forMode: .common)
        self.displayLink = displayLink
    }

    func setPaused(_ paused: Bool, at date: Date = Date()) {
        guard paused != isPaused else {
            return
        }

        if paused, !usesPlayerProgress {
            visibleProgress = progress(at: date, duration: displayDuration)
        } else if !paused, !usesPlayerProgress {
            startedAt = date.addingTimeInterval(-visibleProgress * displayDuration)
        }

        isPaused = paused
        displayLink?.isPaused = paused
    }

    func stop() {
        displayLink?.invalidate()
        displayLink = nil
        onFinished = nil
        isPaused = false
    }

    func setPlayerProgress(_ progress: Double) {
        usesPlayerProgress = true
        playerProgress = max(playerProgress, Self.clamped(progress))
        visibleProgress = playerProgress
    }

    func progress(at date: Date, duration: TimeInterval) -> Double {
        if usesPlayerProgress {
            return playerProgress
        }

        guard duration > 0 else {
            return 1
        }

        return Self.clamped(date.timeIntervalSince(startedAt) / duration)
    }

    func align(progress: Double, duration: TimeInterval, at date: Date) {
        usesPlayerProgress = false
        startedAt = date.addingTimeInterval(-Self.clamped(progress) * max(duration, 0.001))
    }

    fileprivate func displayLinkDidFire(_ displayLink: CADisplayLink) {
        guard !usesPlayerProgress, !isPaused else {
            return
        }

        let nextProgress = progress(at: Date(), duration: displayDuration)
        visibleProgress = nextProgress
        guard nextProgress >= 1 else {
            return
        }

        let completion = onFinished
        stop()
        completion?()
    }

    private static func clamped(_ value: Double) -> Double {
        min(max(value, 0), 1)
    }
}

struct StoryTimelineProgressView: View {
    let segmentCount: Int
    let activeIndex: Int
    @ObservedObject var progressState: StoryTimerProgressState

    private let segmentSpacing: CGFloat = 3

    var body: some View {
        Canvas { context, size in
            drawProgress(
                in: context,
                size: size,
                activeProgress: progressState.visibleProgress
            )
        }
    }

    private func drawProgress(
        in context: GraphicsContext,
        size: CGSize,
        activeProgress: Double
    ) {
        let count = max(segmentCount, 0)
        guard count > 0, size.width > 0, size.height > 0 else {
            return
        }

        let safeActiveIndex = min(max(activeIndex, 0), count - 1)
        let totalSpacing = segmentSpacing * CGFloat(max(count - 1, 0))
        let segmentWidth = max(0, (size.width - totalSpacing) / CGFloat(count))
        let cornerRadius = size.height / 2
        for index in 0..<count {
            let originX = CGFloat(index) * (segmentWidth + segmentSpacing)
            let frame = CGRect(x: originX, y: 0, width: segmentWidth, height: size.height)
            let backgroundPath = Path(roundedRect: frame, cornerRadius: cornerRadius)
            context.fill(backgroundPath, with: .color(.white.opacity(0.28)))

            let fillProgress: Double
            if index < safeActiveIndex {
                fillProgress = 1
            } else if index == safeActiveIndex {
                fillProgress = activeProgress
            } else {
                fillProgress = 0
            }

            guard fillProgress > 0 else {
                continue
            }

            let fillFrame = CGRect(
                x: frame.minX,
                y: frame.minY,
                width: frame.width * CGFloat(min(max(fillProgress, 0), 1)),
                height: frame.height
            )
            let fillPath = Path(roundedRect: fillFrame, cornerRadius: cornerRadius)
            context.fill(fillPath, with: .color(.white.opacity(0.96)))
        }
    }
}

