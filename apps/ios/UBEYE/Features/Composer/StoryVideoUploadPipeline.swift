import AVFoundation
import CoreGraphics
import Foundation

enum StoryVideoUploadStrategy: String {
    case originalQuality
    case normalized
}

struct PreparedStoryVideo {
    let url: URL
    let durationMs: Int?
    let byteSize: Int64
    let shouldRemoveAfterUpload: Bool
    let shouldUploadOriginalQuality: Bool
    let strategy: StoryVideoUploadStrategy
    let inspection: StoryVideoInspection

    var shouldAttachOriginalRendition: Bool {
        strategy == .normalized && inspection.supportsOriginalQualityUpload
    }
}

struct StoryVideoInspection {
    let source: StoryVideoUpload.Source
    let originalURL: URL
    let byteSize: Int64
    let durationMs: Int?
    let naturalSize: CGSize?
    let preferredTransform: CGAffineTransform?
    let codecTypes: [String]

    var supportsOriginalQualityUpload: Bool {
        switch originalURL.pathExtension.lowercased() {
        case "mov", "mp4", "m4v":
            return !codecTypes.isEmpty
        default:
            return false
        }
    }

    var isPlaybackOptimizedOriginal: Bool {
        switch originalURL.pathExtension.lowercased() {
        case "mp4", "m4v":
            return !codecTypes.isEmpty && codecTypes.allSatisfy { codec in
                let normalizedCodec = codec.lowercased()
                return normalizedCodec == "avc1" || normalizedCodec == "avc3"
            }
        default:
            return false
        }
    }

    var diagnosticSummary: String {
        [
            "source=\(source.diagnosticName)",
            "bytes=\(byteSize)",
            durationMs.map { "durationMs=\($0)" },
            naturalSize.map { "natural=\(Int($0.width))x\(Int($0.height))" },
            preferredTransform.map { "transform=\(Self.transformSummary($0))" },
            codecTypes.isEmpty ? "codecs=none" : "codecs=\(codecTypes.joined(separator: "."))",
            "originalSupported=\(supportsOriginalQualityUpload)",
            "playbackOptimized=\(isPlaybackOptimizedOriginal)",
        ]
            .compactMap { $0 }
            .joined(separator: " ")
    }

    private static func transformSummary(_ transform: CGAffineTransform) -> String {
        [
            transform.a,
            transform.b,
            transform.c,
            transform.d,
            transform.tx,
            transform.ty,
        ]
            .map { String(format: "%.2f", $0) }
            .joined(separator: ",")
    }
}

enum StoryVideoUploadPhase: String, CaseIterable {
    case inspect
    case prepare
    case thumbnailGenerate
    case prepareUpload
    case thumbnailUpload
    case videoUpload
    case completeStory
    case processing

    var statusLabel: String {
        switch self {
        case .inspect:
            "Inspecting video"
        case .prepare:
            "Preparing video"
        case .thumbnailGenerate:
            "Preparing poster"
        case .prepareUpload:
            "Preparing upload"
        case .thumbnailUpload:
            "Uploading poster"
        case .videoUpload:
            "Uploading video"
        case .completeStory:
            "Finishing story"
        case .processing:
            "Upload complete"
        }
    }
}

struct StoryVideoUploadAttempt {
    let id = UUID().uuidString.lowercased()
    let startedAt = Date()
    var phaseStartedAt = Date()
    var phase: StoryVideoUploadPhase = .inspect
    var uploadUid: String?
    var byteSize: Int64?
    var durationMs: Int?
    var strategy: StoryVideoUploadStrategy?
    var source: StoryVideoUpload.Source?
    var retries = 0
    var lastError: String?

    mutating func begin(_ nextPhase: StoryVideoUploadPhase) {
        phase = nextPhase
        phaseStartedAt = Date()
        MediaPerformance.mark("video_upload_phase attempt=\(id) phase=\(nextPhase.rawValue)")
    }

    mutating func attach(upload: VideoUploadResponse) {
        uploadUid = upload.uid
    }

    mutating func attach(video: PreparedStoryVideo) {
        byteSize = video.byteSize
        durationMs = video.durationMs
        strategy = video.strategy
        source = video.inspection.source
    }

    mutating func recordRetry(_ reason: String) {
        retries += 1
        MediaPerformance.mark(
            "video_upload_retry attempt=\(id) phase=\(phase.rawValue) retries=\(retries) reason=\(Self.sanitize(reason))"
        )
    }

    mutating func recordSuccess(processingStatus: String?) {
        MediaPerformance.measure(
            "video_upload_succeeded attempt=\(id) phase=\(phase.rawValue) status=\(processingStatus ?? "unknown") strategy=\(strategy?.rawValue ?? "unknown") retries=\(retries)",
            since: startedAt
        )
    }

    mutating func recordFailure(_ error: Error) {
        let message = error.localizedDescription
        lastError = message
        MediaPerformance.measure(
            "video_upload_failed attempt=\(id) phase=\(phase.rawValue) retries=\(retries) reason=\(Self.sanitize(message))",
            since: startedAt
        )
    }

    var report: String {
        [
            "attempt=\(id)",
            "phase=\(phase.rawValue)",
            source.map { "source=\($0.diagnosticName)" },
            strategy.map { "strategy=\($0.rawValue)" },
            uploadUid.map { "uid=\($0)" },
            byteSize.map { "bytes=\($0)" },
            durationMs.map { "durationMs=\($0)" },
            "retries=\(retries)",
            lastError.map { "error=\(Self.sanitize($0))" },
        ]
            .compactMap { $0 }
            .joined(separator: " ")
    }

    static func sanitizedDiagnostic(_ value: String) -> String {
        sanitize(value)
    }

    private static func sanitize(_ value: String) -> String {
        let allowed = value.map { character -> Character in
            character.isLetter || character.isNumber || "-_./:".contains(character)
                ? character
                : "_"
        }

        return String(allowed).prefix(160).description
    }
}

enum StoryVideoUploadNormalizer {
    private static let maxUploadBytes: Int64 = 300 * 1024 * 1024
    private static let maxOriginalFastPathBytes: Int64 = 75 * 1024 * 1024

    static func prepare(
        url: URL,
        source: StoryVideoUpload.Source,
        maxDurationSeconds: Int
    ) async throws -> PreparedStoryVideo {
        let inspection = try await inspect(url: url, source: source)
        MediaPerformance.mark("video_upload_inspected \(inspection.diagnosticSummary)")

        if let durationMs = inspection.durationMs, durationMs > maxDurationSeconds * 1_000 {
            throw APIClientError.server("Story videos are capped at 2 minutes.", 0)
        }

        if inspection.byteSize <= maxOriginalFastPathBytes, inspection.isPlaybackOptimizedOriginal {
            MediaPerformance.mark("video_upload_strategy original \(inspection.diagnosticSummary)")
            return PreparedStoryVideo(
                url: url,
                durationMs: inspection.durationMs,
                byteSize: inspection.byteSize,
                shouldRemoveAfterUpload: false,
                shouldUploadOriginalQuality: true,
                strategy: .originalQuality,
                inspection: inspection
            )
        }
        if inspection.supportsOriginalQualityUpload {
            let reason = inspection.byteSize > maxOriginalFastPathBytes
                ? "large_original"
                : "container_or_codec"
            MediaPerformance.mark("video_upload_original_proxy_required reason=\(reason) \(inspection.diagnosticSummary)")
        }

        let normalizedURL = try await normalizedVideoURL(
            for: url,
            mirrorsHorizontally: source.mirrorsNormalizedFallback
        )
        guard let normalizedURL else {
            throw APIClientError.server("Could not prepare this video for upload. Try a different video.", 0)
        }

        do {
            let durationMs = await videoDurationMs(for: normalizedURL)
            let byteSize = try videoFileSize(for: normalizedURL)

            if byteSize > maxUploadBytes {
                throw APIClientError.server("Story videos are capped at 300 MB.", 0)
            }

            if let durationMs, durationMs > maxDurationSeconds * 1_000 {
                throw APIClientError.server("Story videos are capped at 2 minutes.", 0)
            }

            MediaPerformance.mark(
                "video_upload_strategy normalized source=\(source.diagnosticName) bytes=\(byteSize) durationMs=\(durationMs ?? 0)"
            )
            return PreparedStoryVideo(
                url: normalizedURL,
                durationMs: durationMs,
                byteSize: byteSize,
                shouldRemoveAfterUpload: true,
                shouldUploadOriginalQuality: false,
                strategy: .normalized,
                inspection: inspection
            )
        } catch {
            try? FileManager.default.removeItem(at: normalizedURL)
            throw error
        }
    }

    private static func inspect(url: URL, source: StoryVideoUpload.Source) async throws -> StoryVideoInspection {
        let asset = AVURLAsset(url: url)
        let byteSize = try videoFileSize(for: url)
        let durationMs = await videoDurationMs(for: url)
        let videoTrack = await firstVideoTrack(in: asset)
        let naturalSize: CGSize?
        let preferredTransform: CGAffineTransform?
        let codecTypeNames: [String]

        if let videoTrack {
            if #available(iOS 16.0, *) {
                naturalSize = try? await videoTrack.load(.naturalSize)
                preferredTransform = try? await videoTrack.load(.preferredTransform)
                let formatDescriptions = (try? await videoTrack.load(.formatDescriptions)) ?? []
                codecTypeNames = codecTypes(from: formatDescriptions)
            } else {
                naturalSize = videoTrack.naturalSize
                preferredTransform = videoTrack.preferredTransform
                codecTypeNames = codecTypes(
                    from: videoTrack.formatDescriptions.map { $0 as! CMFormatDescription }
                )
            }
        } else {
            naturalSize = nil
            preferredTransform = nil
            codecTypeNames = []
        }

        if videoTrack == nil {
            MediaPerformance.mark("video_upload_original_unsupported reason=no_video_track")
        } else if codecTypeNames.isEmpty {
            MediaPerformance.mark("video_upload_original_unsupported reason=no_codec")
        }

        return StoryVideoInspection(
            source: source,
            originalURL: url,
            byteSize: byteSize,
            durationMs: durationMs,
            naturalSize: naturalSize,
            preferredTransform: preferredTransform,
            codecTypes: codecTypeNames.sorted()
        )
    }

    private static func normalizedVideoURL(
        for url: URL,
        mirrorsHorizontally: Bool
    ) async throws -> URL? {
        let asset = AVURLAsset(url: url)
        let presets = await compatibleExportPresets(for: asset)
        let timeRange = await alignedPlayableTimeRange(for: asset)

        for preset in presets {
            let outputURL = FileManager.default.temporaryDirectory
                .appendingPathComponent("story-upload-\(UUID().uuidString).mp4")

            guard let export = try await exportSession(
                asset: asset,
                preset: preset,
                outputURL: outputURL,
                timeRange: timeRange,
                mirrorsHorizontally: mirrorsHorizontally
            ) else {
                continue
            }

            guard export.supportedFileTypes.contains(.mp4) else {
                MediaPerformance.mark("video_upload_normalize_skipped preset=\(preset) unsupported_mp4")
                continue
            }

            await exportVideo(export)

            if export.status == .completed {
                let byteSize = (try? videoFileSize(for: outputURL)) ?? 0

                if byteSize <= maxUploadBytes {
                    let mode = mirrorsHorizontally ? "mirrored" : "standard"
                    MediaPerformance.mark("video_upload_normalized mode=\(mode) preset=\(preset) bytes=\(byteSize)")
                    return outputURL
                }

                try? FileManager.default.removeItem(at: outputURL)
                MediaPerformance.mark("video_upload_normalized_too_large preset=\(preset) bytes=\(byteSize)")
                continue
            }

            try? FileManager.default.removeItem(at: outputURL)
            let nsError = export.error as NSError?
            MediaPerformance.mark(
                "video_upload_normalize_failed preset=\(preset) status=\(export.status.rawValue) code=\(nsError?.code ?? 0)"
            )
        }

        return nil
    }

    private static func exportSession(
        asset: AVURLAsset,
        preset: String,
        outputURL: URL,
        timeRange: CMTimeRange?,
        mirrorsHorizontally: Bool
    ) async throws -> AVAssetExportSession? {
        let exportAsset: AVAsset
        let videoComposition: AVVideoComposition?
        let exportTimeRange: CMTimeRange?

        if mirrorsHorizontally {
            guard let timeRange else {
                return nil
            }

            let mirrored = try await StoryVideoGeometryNormalizer.mirroredComposition(
                for: asset,
                timeRange: timeRange
            )
            exportAsset = mirrored.asset
            videoComposition = mirrored.videoComposition
            exportTimeRange = CMTimeRange(start: .zero, duration: timeRange.duration)
        } else {
            exportAsset = asset
            videoComposition = nil
            exportTimeRange = timeRange
        }

        guard let export = AVAssetExportSession(asset: exportAsset, presetName: preset) else {
            return nil
        }

        export.outputURL = outputURL
        export.outputFileType = .mp4
        export.shouldOptimizeForNetworkUse = true
        export.videoComposition = videoComposition

        if let exportTimeRange {
            export.timeRange = exportTimeRange
        }

        return export
    }

    private static func compatibleExportPresets(for asset: AVAsset) async -> [String] {
        let candidates = [
            AVAssetExportPreset1920x1080,
            AVAssetExportPreset1280x720,
            AVAssetExportPresetHighestQuality,
        ]
        var presets: [String] = []

        for candidate in candidates {
            guard !presets.contains(candidate) else {
                continue
            }

            if await AVAssetExportSession.compatibility(
                ofExportPreset: candidate,
                with: asset,
                outputFileType: .mp4
            ) {
                presets.append(candidate)
            }
        }

        return presets
    }

    private static func alignedPlayableTimeRange(for asset: AVURLAsset) async -> CMTimeRange? {
        let duration: CMTime?
        let tracks: [AVAssetTrack]
        let trackDurations: [CMTime]

        if #available(iOS 16.0, *) {
            duration = try? await asset.load(.duration)
            tracks = (try? await asset.load(.tracks)) ?? []
            var loadedDurations: [CMTime] = []
            for track in tracks {
                if let timeRange = try? await track.load(.timeRange) {
                    loadedDurations.append(timeRange.duration)
                }
            }
            trackDurations = loadedDurations
        } else {
            duration = asset.duration
            tracks = asset.tracks
            trackDurations = tracks.map(\.timeRange.duration)
        }

        let finiteDurations = ([duration].compactMap { $0 } + trackDurations)
            .filter { time in
                let seconds = CMTimeGetSeconds(time)
                return time.isValid && seconds.isFinite && seconds > 0.2
            }

        guard let shortest = finiteDurations.min(by: { CMTimeCompare($0, $1) < 0 }) else {
            return nil
        }

        return CMTimeRange(start: .zero, duration: shortest)
    }

    private static func exportVideo(_ export: AVAssetExportSession) async {
        await withCheckedContinuation { continuation in
            export.exportAsynchronously {
                continuation.resume()
            }
        }
    }

    private static func firstVideoTrack(in asset: AVURLAsset) async -> AVAssetTrack? {
        if #available(iOS 16.0, *) {
            return (try? await asset.loadTracks(withMediaType: .video))?.first
        }

        return asset.tracks(withMediaType: .video).first
    }

    private static func codecTypes(from formatDescriptions: [CMFormatDescription]) -> [String] {
        Array(
            Set(
                formatDescriptions.map {
                    fourCharacterCodeString(CMFormatDescriptionGetMediaSubType($0))
                }
            )
        )
    }

    private static func fourCharacterCodeString(_ value: FourCharCode) -> String {
        let scalars = [
            UnicodeScalar((value >> 24) & 255),
            UnicodeScalar((value >> 16) & 255),
            UnicodeScalar((value >> 8) & 255),
            UnicodeScalar(value & 255),
        ]

        return String(String.UnicodeScalarView(scalars.compactMap { $0 }))
    }

    private static func videoFileSize(for url: URL) throws -> Int64 {
        guard let size = try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber,
              size.int64Value > 0 else {
            throw APIClientError.invalidResponse
        }

        return size.int64Value
    }

    private static func videoDurationMs(for url: URL) async -> Int? {
        let asset = AVURLAsset(url: url)
        let duration: CMTime?

        if #available(iOS 16.0, *) {
            duration = try? await asset.load(.duration)
        } else {
            duration = asset.duration
        }

        guard let duration else {
            return nil
        }

        let seconds = CMTimeGetSeconds(duration)
        guard seconds.isFinite, seconds > 0 else {
            return nil
        }

        return max(1, Int((seconds * 1_000).rounded()))
    }
}

private extension StoryVideoUpload.Source {
    var diagnosticName: String {
        switch self {
        case .cameraFront:
            "camera_front"
        case .cameraBack:
            "camera_back"
        case .library:
            "library"
        }
    }
}
