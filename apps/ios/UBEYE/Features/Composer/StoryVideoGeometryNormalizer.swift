import AVFoundation
import CoreGraphics
import Foundation

enum StoryVideoGeometryNormalizer {
    struct PresentationPlan {
        let renderSize: CGSize
        let transform: CGAffineTransform
        let renderedSourceRect: CGRect
    }

    static func presentationPlan(
        naturalSize: CGSize,
        preferredTransform: CGAffineTransform,
        mirrorsHorizontally: Bool
    ) -> PresentationPlan {
        let sourceRect = CGRect(origin: .zero, size: naturalSize)
        let orientedRect = sourceRect.applying(preferredTransform)
        let orientedSize = CGSize(
            width: abs(orientedRect.width),
            height: abs(orientedRect.height)
        )

        var transform = preferredTransform.concatenating(
            CGAffineTransform(
                translationX: -orientedRect.minX,
                y: -orientedRect.minY
            )
        )

        if mirrorsHorizontally {
            let mirrorTransform = CGAffineTransform(
                translationX: orientedSize.width,
                y: 0
            )
            .scaledBy(x: -1, y: 1)
            transform = transform.concatenating(mirrorTransform)
        }

        let renderedRect = sourceRect.applying(transform)
        transform = transform.concatenating(
            CGAffineTransform(
                translationX: -renderedRect.minX,
                y: -renderedRect.minY
            )
        )

        let finalRect = sourceRect.applying(transform)
        let renderSize = CGSize(
            width: abs(finalRect.width),
            height: abs(finalRect.height)
        )

        return PresentationPlan(
            renderSize: renderSize,
            transform: transform,
            renderedSourceRect: finalRect
        )
    }

    static func mirroredComposition(
        for asset: AVURLAsset,
        timeRange: CMTimeRange
    ) async throws -> (asset: AVMutableComposition, videoComposition: AVMutableVideoComposition) {
        let sourceVideoTrack = try await firstVideoTrack(in: asset)
        let composition = AVMutableComposition()

        guard let compositionVideoTrack = composition.addMutableTrack(
            withMediaType: .video,
            preferredTrackID: kCMPersistentTrackID_Invalid
        ) else {
            throw APIClientError.server("Could not prepare front camera video. Try recording again.", 0)
        }

        try compositionVideoTrack.insertTimeRange(timeRange, of: sourceVideoTrack, at: .zero)

        for audioTrack in await audioTracks(in: asset) {
            guard let compositionAudioTrack = composition.addMutableTrack(
                withMediaType: .audio,
                preferredTrackID: kCMPersistentTrackID_Invalid
            ) else {
                continue
            }
            try? compositionAudioTrack.insertTimeRange(timeRange, of: audioTrack, at: .zero)
        }

        let naturalSize = try await sourceVideoTrack.load(.naturalSize)
        let preferredTransform = try await sourceVideoTrack.load(.preferredTransform)
        let plan = presentationPlan(
            naturalSize: naturalSize,
            preferredTransform: preferredTransform,
            mirrorsHorizontally: true
        )

        let instruction = AVMutableVideoCompositionInstruction()
        instruction.timeRange = CMTimeRange(start: .zero, duration: timeRange.duration)

        let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: compositionVideoTrack)
        layerInstruction.setTransform(plan.transform, at: .zero)
        instruction.layerInstructions = [layerInstruction]

        let videoComposition = AVMutableVideoComposition()
        videoComposition.instructions = [instruction]
        videoComposition.renderSize = plan.renderSize
        videoComposition.frameDuration = await frameDuration(for: sourceVideoTrack)

        return (composition, videoComposition)
    }

    private static func firstVideoTrack(in asset: AVURLAsset) async throws -> AVAssetTrack {
        let tracks = try await asset.loadTracks(withMediaType: .video)

        guard let track = tracks.first else {
            throw APIClientError.server("Could not prepare front camera video. Try recording again.", 0)
        }

        return track
    }

    private static func audioTracks(in asset: AVURLAsset) async -> [AVAssetTrack] {
        (try? await asset.loadTracks(withMediaType: .audio)) ?? []
    }

    private static func frameDuration(for track: AVAssetTrack) async -> CMTime {
        let fps = (try? await track.load(.nominalFrameRate)) ?? 0

        guard fps.isFinite, fps > 0 else {
            return CMTime(value: 1, timescale: 30)
        }

        return CMTime(value: 1, timescale: CMTimeScale(max(1, Int(round(fps)))))
    }
}
