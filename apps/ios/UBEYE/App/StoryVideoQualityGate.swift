import AVFoundation
import CoreGraphics
import Foundation

/// Compare matched, color-managed presentation frames before accepting a lossy
/// upload optimization. This is a conservative guard, not a perceptual guarantee.
enum StoryVideoQualityGate {
    struct Score { let ssim: Double; let meanAbsoluteError: Double }

    static func compare(source: URL, candidate: URL, durationMs: Int, deadline: TimeInterval = .infinity) async throws -> Bool {
        let original = AVAssetImageGenerator(asset: AVURLAsset(url: source))
        let encoded = AVAssetImageGenerator(asset: AVURLAsset(url: candidate))
        for generator in [original, encoded] {
            generator.appliesPreferredTrackTransform = true
            generator.maximumSize = CGSize(width: 960, height: 960)
            generator.requestedTimeToleranceBefore = .zero
            generator.requestedTimeToleranceAfter = .zero
        }
        return try await withTaskCancellationHandler {
            for fraction in [0.1, 0.35, 0.6, 0.85] {
                try Task.checkCancellation()
                guard ProcessInfo.processInfo.systemUptime < deadline else { throw URLError(.timedOut) }
                let time = CMTime(seconds: Double(durationMs) / 1000 * fraction, preferredTimescale: 600)
                async let sourceFrame = original.image(at: time)
                async let candidateFrame = encoded.image(at: time)
                let (a, b) = try await (sourceFrame, candidateFrame)
                let score = await Task.detached(priority: .utility) { compare(a.image, b.image, deadline: deadline) }.value
                try Task.checkCancellation()
                guard ProcessInfo.processInfo.systemUptime < deadline else { throw URLError(.timedOut) }
                guard let score, score.ssim >= 0.97, score.meanAbsoluteError <= 0.012 else { return false }
            }
            return true
        } onCancel: {
            original.cancelAllCGImageGeneration()
            encoded.cancelAllCGImageGeneration()
        }
    }

    static func compare(_ source: CGImage, _ candidate: CGImage, deadline: TimeInterval = .infinity) -> Score? {
        guard source.width == candidate.width, source.height == candidate.height,
              source.width > 0, source.height > 0, source.width <= 1920, source.height <= 1920,
              let a = pixels(source), let b = pixels(candidate) else { return nil }
        var sumSSIM = 0.0, absoluteError = 0.0, blocks = 0
        let width = source.width, height = source.height
        // RGB blocks retain chroma sensitivity, including skin tones and dark scenes.
        for y in stride(from: 0, to: height, by: 8) {
            guard !Task.isCancelled, ProcessInfo.processInfo.systemUptime < deadline else { return nil }
            for x in stride(from: 0, to: width, by: 8) {
                for channel in 0..<3 {
                    var sumA = 0.0, sumB = 0.0, squareA = 0.0, squareB = 0.0, product = 0.0, count = 0.0
                    for row in y..<min(y + 8, height) {
                        for column in x..<min(x + 8, width) {
                            let index = (row * width + column) * 4 + channel
                            let av = Double(a[index]) / 255, bv = Double(b[index]) / 255
                            sumA += av; sumB += bv; squareA += av * av; squareB += bv * bv; product += av * bv
                            absoluteError += abs(av - bv); count += 1
                        }
                    }
                    let ma = sumA / count, mb = sumB / count
                    let va = max(0, squareA / count - ma * ma), vb = max(0, squareB / count - mb * mb)
                    let covariance = product / count - ma * mb
                    sumSSIM += ((2 * ma * mb + 0.0001) * (2 * covariance + 0.0009)) /
                        ((ma * ma + mb * mb + 0.0001) * (va + vb + 0.0009))
                    blocks += 1
                }
            }
        }
        return Score(ssim: sumSSIM / Double(blocks), meanAbsoluteError: absoluteError / Double(width * height * 3))
    }

    private static func pixels(_ image: CGImage) -> [UInt8]? {
        var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
        let rendered = bytes.withUnsafeMutableBytes { buffer -> Bool in
            guard let color = CGColorSpace(name: CGColorSpace.sRGB),
                  let context = CGContext(data: buffer.baseAddress, width: image.width, height: image.height,
                    bitsPerComponent: 8, bytesPerRow: image.width * 4, space: color,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
            return true
        }
        return rendered ? bytes : nil
    }
}
