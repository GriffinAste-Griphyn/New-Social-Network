import AVKit
import CryptoKit
import SwiftUI
import UIKit

struct AspectFitVideoPlayer: UIViewRepresentable {
    let player: AVPlayer?
    let surface: AspectFitPlayerView?
    var videoGravity: AVLayerVideoGravity = .resizeAspect
    let onPlayerAttached: (AVPlayer) -> Void
    let onReadyForDisplay: (AVPlayer) -> Void

    func makeUIView(context: Context) -> StoryVideoSurfaceHost {
        StoryVideoSurfaceHost()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func updateUIView(_ view: StoryVideoSurfaceHost, context: Context) {
        view.install(surface)
        guard let surface else { context.coordinator.stopObserving(); return }
        surface.playerLayer.videoGravity = videoGravity
        surface.attach(player)
        context.coordinator.observeReadyForDisplay(
            playerLayer: surface.playerLayer,
            player: player,
            onPlayerAttached: onPlayerAttached,
            onReadyForDisplay: onReadyForDisplay
        )
    }

    static func dismantleUIView(_ view: StoryVideoSurfaceHost, coordinator: Coordinator) {
        coordinator.stopObserving()
        view.install(nil)
    }

    final class Coordinator {
        private var observation: NSKeyValueObservation?
        private weak var observedLayer: AVPlayerLayer?
        private weak var observedPlayer: AVPlayer?

        func observeReadyForDisplay(
            playerLayer: AVPlayerLayer,
            player: AVPlayer?,
            onPlayerAttached: @escaping (AVPlayer) -> Void,
            onReadyForDisplay: @escaping (AVPlayer) -> Void
        ) {
            guard let player else {
                stopObserving()
                return
            }

            if observedLayer === playerLayer, observedPlayer === player {
                Task { @MainActor [weak self] in
                    guard self?.observedLayer === playerLayer, self?.observedPlayer === player, playerLayer.player === player else {
                        return
                    }

                    onPlayerAttached(player)
                    if playerLayer.isReadyForDisplay {
                        onReadyForDisplay(player)
                    }
                }
                return
            }

            stopObserving()
            observedLayer = playerLayer
            observedPlayer = player
            observation = playerLayer.observe(
                \.isReadyForDisplay,
                options: [.initial, .new]
            ) { [weak self] layer, _ in
                guard layer.player === player, layer.isReadyForDisplay else {
                    return
                }

                Task { @MainActor [weak self] in
                    guard self?.observedLayer === layer, self?.observedPlayer === player, layer.player === player else { return }
                    onReadyForDisplay(player)
                }
            }

            Task { @MainActor [weak self] in
                guard self?.observedLayer === playerLayer, self?.observedPlayer === player, playerLayer.player === player else {
                    return
                }

                onPlayerAttached(player)
                if playerLayer.isReadyForDisplay {
                    onReadyForDisplay(player)
                }
            }
        }

        func stopObserving() {
            observation?.invalidate()
            observation = nil
            observedLayer = nil
            observedPlayer = nil
        }
    }
}

@MainActor
final class StoryVideoSurfaceHost: UIView {
    private(set) var surface: AspectFitPlayerView?

    func install(_ next: AspectFitPlayerView?) {
        guard surface !== next else { return }
        if surface?.superview === self { surface?.removeFromSuperview() }
        surface = next
        if let next {
            addSubview(next)
            next.frame = bounds
            next.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        if surface?.superview === self { surface?.frame = bounds }
    }
}

final class AspectFitPlayerView: UIView {
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

    func attach(_ nextPlayer: AVPlayer?) {
        guard playerLayer.player !== nextPlayer else {
            return
        }
        playerLayer.player = nextPlayer
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        isOpaque = true
        playerLayer.backgroundColor = UIColor.black.cgColor
        playerLayer.videoGravity = .resizeAspect
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        backgroundColor = .black
        isOpaque = true
        playerLayer.backgroundColor = UIColor.black.cgColor
        playerLayer.videoGravity = .resizeAspect
    }
}
