import AVFoundation
import CoreGraphics
import Foundation

enum StoryVideoUploadStrategy: String {
    case streamPassthrough
    case streamRemux
    case normalized
    case adaptiveNormalized
}

struct PreparedStoryVideo {
    let url: URL
    let durationMs: Int?
    let byteSize: Int64
    let strategy: StoryVideoUploadStrategy
    let inspection: StoryVideoInspection
}

struct StoryVideoInspection {
    let source: StoryVideoUpload.Source
    let originalURL: URL
    let byteSize: Int64
    let durationMs: Int?
    let naturalSize: CGSize?
    let preferredTransform: CGAffineTransform?
    let codecTypes: [String]
    let hasFastStart: Bool
    var frameRate: Float? = nil
    var isExplicitRec709: Bool = false
    var hasAudio: Bool = false

    var isEligibleForAdaptiveEncoding: Bool {
        guard isExplicitRec709, let size = naturalSize, let fps = frameRate else { return false }
        return max(abs(size.width), abs(size.height)) <= 1920 && min(abs(size.width), abs(size.height)) <= 1080 && fps >= 24 && fps <= 30.1
    }

    var hasStreamSupportedContainer: Bool {
        switch originalURL.pathExtension.lowercased() {
        case "mov", "mp4", "m4v":
            return true
        default:
            return false
        }
    }

    var isStreamCompatibleInput: Bool {
        hasStreamSupportedContainer && hasFastStart && hasStreamSupportedCodecs
    }

    var canRemuxForStream: Bool {
        hasStreamSupportedContainer && hasStreamSupportedCodecs
    }

    var estimatedBitsPerSecond: Int? {
        guard let durationMs, durationMs > 0, byteSize > 0 else {
            return nil
        }

        return Int(
            (Double(byteSize) * 8 * 1_000 / Double(durationMs)).rounded()
        )
    }

    private var hasStreamSupportedCodecs: Bool {
        guard !codecTypes.isEmpty else {
            return false
        }

        let supportedCodecs = Set(["avc1", "hvc1"])
        return codecTypes.allSatisfy { supportedCodecs.contains($0.lowercased()) }
    }

    var diagnosticSummary: String {
        [
            "source=\(source.diagnosticName)",
            "bytes=\(byteSize)",
            durationMs.map { "durationMs=\($0)" },
            naturalSize.map { "natural=\(Int($0.width))x\(Int($0.height))" },
            preferredTransform.map { "transform=\(Self.transformSummary($0))" },
            codecTypes.isEmpty ? "codecs=none" : "codecs=\(codecTypes.joined(separator: "."))",
            estimatedBitsPerSecond.map { "estimatedBitrate=\($0)" },
            "fastStart=\(hasFastStart)",
            "streamContainer=\(hasStreamSupportedContainer)",
            "streamCompatible=\(isStreamCompatibleInput)",
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

enum StoryVideoUploadPhase: String, CaseIterable, Hashable {
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
    let uploadExperiment = MediaControlConfig.shared.uploadExperiment
    let initialResidentBytes = StoryUploadMemoryProbe.residentBytes
    var phaseStartedAt = Date()
    var phase: StoryVideoUploadPhase = .inspect
    var uploadUid: String?
    var byteSize: Int64?
    var durationMs: Int?
    var strategy: StoryVideoUploadStrategy?
    var source: StoryVideoUpload.Source?
    var uploadProtocol: String?
    var uploadProvider: String?
    var retries = 0
    var lastError: String?
    private var hasActivePhase = false
    private var phaseDurationsMs: [StoryVideoUploadPhase: Int] = [:]

    mutating func begin(_ nextPhase: StoryVideoUploadPhase) {
        finishActivePhase()
        phase = nextPhase
        phaseStartedAt = Date()
        hasActivePhase = true
        MediaPerformance.mark("video_upload_phase attempt=\(id) phase=\(nextPhase.rawValue)")
    }

    mutating func attach(upload: VideoUploadResponse) {
        uploadUid = upload.uid
        uploadProtocol = upload.uploadProtocol
        uploadProvider = upload.source?.provider ?? upload.uploadProtocol
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
        finishActivePhase()
        let videoUploadDurationMs = phaseDurationsMs[.videoUpload]
        let effectiveMbps = videoUploadDurationMs.flatMap { durationMs in
            byteSize.map { bytes in
                Double(bytes) * 8 / Double(max(durationMs, 1)) / 1_000
            }
        }
        MediaPerformance.measure(
            "video_upload_succeeded resident_bytes=\(StoryUploadMemoryProbe.residentBytes ?? 0) initial_resident_bytes=\(initialResidentBytes ?? 0) upload_experiment=\(uploadExperiment) attempt=\(id) phase=\(phase.rawValue) status=\(processingStatus ?? "unknown") strategy=\(strategy?.rawValue ?? "unknown") retries=\(retries) bytes=\(byteSize ?? 0) protocol=\(uploadProtocol ?? "unknown") provider=\(uploadProvider ?? "unknown") effective_mbps=\(effectiveMbps.map { String(format: "%.2f", $0) } ?? "unknown")",
            since: startedAt
        )
        MediaPerformance.flushUploadEvents()
    }

    mutating func recordFailure(_ error: Error) {
        finishActivePhase()
        let message = error.localizedDescription
        lastError = message
        MediaPerformance.measure(
            "video_upload_failed upload_experiment=\(uploadExperiment) attempt=\(id) phase=\(phase.rawValue) retries=\(retries) bytes=\(byteSize ?? 0) protocol=\(uploadProtocol ?? "unknown") provider=\(uploadProvider ?? "unknown") reason=\(Self.sanitize(message))",
            since: startedAt
        )
        MediaPerformance.flushUploadEvents()
    }

    var report: String {
        [
            "attempt=\(id)",
            "phase=\(phase.rawValue)",
            source.map { "source=\($0.diagnosticName)" },
            strategy.map { "strategy=\($0.rawValue)" },
            uploadProtocol.map { "protocol=\($0)" },
            uploadProvider.map { "provider=\($0)" },
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

    private mutating func finishActivePhase() {
        guard hasActivePhase else {
            return
        }
        let elapsedMs = max(Int(Date().timeIntervalSince(phaseStartedAt) * 1_000), 0)
        phaseDurationsMs[phase, default: 0] += elapsedMs
        MediaPerformance.measure(
            "video_upload_phase attempt=\(id) phase=\(phase.rawValue) bytes=\(byteSize ?? 0) protocol=\(uploadProtocol ?? "unknown") provider=\(uploadProvider ?? "unknown")",
            since: phaseStartedAt
        )
        hasActivePhase = false
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
    // Preserve detail in files that actually require a lossy export. Compatible
    // sources still pass through unchanged. Includes ~8 Mbps video plus AAC and
    // container overhead; AVAssetExportSession treats this as a size hint.
    static let normalizedTargetBitsPerSecond = 8_200_000
    static let adaptiveTargetBitsPerSecond = 6_000_000

    static func normalizedFileLengthLimit(durationSeconds: TimeInterval, targetBitsPerSecond: Int = normalizedTargetBitsPerSecond) -> Int64? {
        guard durationSeconds.isFinite, durationSeconds > 0, targetBitsPerSecond > 0 else {
            return nil
        }

        return Int64(min(Double(maxUploadBytes), ceil(durationSeconds * Double(targetBitsPerSecond) / 8)))
    }

    private static let maxUploadBytes = StoryMediaContract.maximumVideoUploadBytes

    static func prepare(
        url: URL,
        source: StoryVideoUpload.Source,
        maxDurationSeconds: Int,
        adaptiveEncoding: StoryAdaptiveEncodingContext = .disabled
    ) async throws -> PreparedStoryVideo {
        try Task.checkCancellation()
        let inspection = try await inspect(url: url, source: source)
        try Task.checkCancellation()
        MediaPerformance.mark("video_upload_inspected \(inspection.diagnosticSummary)")

        if let durationMs = inspection.durationMs, durationMs > maxDurationSeconds * 1_000 {
            throw APIClientError.server("Story videos are capped at 2 minutes.", 0)
        }

        if inspection.byteSize <= maxUploadBytes,
           inspection.isStreamCompatibleInput {
            MediaPerformance.mark("video_upload_strategy stream_passthrough \(inspection.diagnosticSummary)")
            return PreparedStoryVideo(
                url: url,
                durationMs: inspection.durationMs,
                byteSize: inspection.byteSize,
                strategy: .streamPassthrough,
                inspection: inspection
            )
        }

        if inspection.byteSize <= maxUploadBytes,
           inspection.canRemuxForStream,
           let remuxedURL = await fastStartRemuxedVideoURL(for: url) {
            do {
                let byteSize = try await StoryUploadFileIO.fileSize(at: remuxedURL)
                let hasFastStart = try await StoryUploadFileIO.hasFastStartMoov(at: remuxedURL)
                guard byteSize <= maxUploadBytes, hasFastStart else {
                    try? FileManager.default.removeItem(at: remuxedURL)
                    throw APIClientError.invalidResponse
                }

                let durationMs = await videoDurationMs(for: remuxedURL)
                MediaPerformance.mark(
                    "video_upload_strategy stream_remux sourceBytes=\(inspection.byteSize) preparedBytes=\(byteSize) durationMs=\(durationMs ?? 0)"
                )
                return PreparedStoryVideo(
                    url: remuxedURL,
                    durationMs: durationMs,
                    byteSize: byteSize,
                    strategy: .streamRemux,
                    inspection: inspection
                )
            } catch {
                try? FileManager.default.removeItem(at: remuxedURL)
                MediaPerformance.mark("video_upload_remux_validation_failed")
            }
        }

        // A compatible source is always passed through or remuxed above, even
        // when an older cached configuration enables lossy upload optimization.
        // Only consider another encode when a compatible upload could not be made.
        if inspection.byteSize <= maxUploadBytes, inspection.canRemuxForStream,
           adaptiveEncoding.shouldTry(bytes: inspection.byteSize, durationMs: inspection.durationMs),
           let candidate = try await adaptiveCandidate(inspection: inspection, context: adaptiveEncoding) {
            return candidate
        }

        let reason: String
        if inspection.byteSize > maxUploadBytes {
            reason = "large_input"
        } else if !inspection.hasFastStart {
            reason = "moov_after_media"
        } else {
            reason = "container_or_codec"
        }
        MediaPerformance.mark("video_upload_stream_normalization_required reason=\(reason) \(inspection.diagnosticSummary)")

        let normalizedURL = try await normalizedVideoURL(
            for: url,
            mirrorsHorizontally: false
        )
        guard let normalizedURL else {
            throw APIClientError.server("Could not prepare this video for upload. Try a different video.", 0)
        }

        do {
            let durationMs = await videoDurationMs(for: normalizedURL)
            let byteSize = try await StoryUploadFileIO.fileSize(at: normalizedURL)

            if byteSize > maxUploadBytes {
                throw APIClientError.server("Story videos are capped at 512 MB.", 0)
            }

            if let durationMs, durationMs > maxDurationSeconds * 1_000 {
                throw APIClientError.server("Story videos are capped at 2 minutes.", 0)
            }

            MediaPerformance.mark(
                "video_upload_strategy normalized source=\(source.diagnosticName) sourceBytes=\(inspection.byteSize) preparedBytes=\(byteSize) durationMs=\(durationMs ?? 0)"
            )
            return PreparedStoryVideo(
                url: normalizedURL,
                durationMs: durationMs,
                byteSize: byteSize,
                strategy: .normalized,
                inspection: inspection
            )
        } catch {
            try? FileManager.default.removeItem(at: normalizedURL)
            throw error
        }
    }

    static func inspect(url: URL, source: StoryVideoUpload.Source) async throws -> StoryVideoInspection {
        let asset = AVURLAsset(url: url)
        let byteSize = try await StoryUploadFileIO.fileSize(at: url)
        let hasFastStart = try await StoryUploadFileIO.hasFastStartMoov(at: url)
        let durationMs = await videoDurationMs(for: url)
        let videoTrack = await firstVideoTrack(in: asset)
        let naturalSize: CGSize?
        let preferredTransform: CGAffineTransform?
        let codecTypeNames: [String]
        var frameRate: Float?
        var isExplicitRec709 = false
        let audioTracks = (try? await asset.loadTracks(withMediaType: .audio)) ?? []

        if let videoTrack {
            if #available(iOS 16.0, *) {
                naturalSize = try? await videoTrack.load(.naturalSize)
                preferredTransform = try? await videoTrack.load(.preferredTransform)
                let formatDescriptions = (try? await videoTrack.load(.formatDescriptions)) ?? []
                codecTypeNames = codecTypes(from: formatDescriptions)
                frameRate = try? await videoTrack.load(.nominalFrameRate)
                isExplicitRec709 = !formatDescriptions.isEmpty && formatDescriptions.allSatisfy {
                    let primaries = CMFormatDescriptionGetExtension($0, extensionKey: kCMFormatDescriptionExtension_ColorPrimaries) as? String
                    let transfer = CMFormatDescriptionGetExtension($0, extensionKey: kCMFormatDescriptionExtension_TransferFunction) as? String
                    return primaries == (kCMFormatDescriptionColorPrimaries_ITU_R_709_2 as String) &&
                        transfer == (kCMFormatDescriptionTransferFunction_ITU_R_709_2 as String)
                }
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
            codecTypes: codecTypeNames.sorted(),
            hasFastStart: hasFastStart, frameRate: frameRate, isExplicitRec709: isExplicitRec709, hasAudio: !audioTracks.isEmpty
        )
    }

    /// Opt-in SDR-only export. Unknown color metadata, HDR, 4K and high frame rates
    /// stay on the existing upload path until a separate quality audit approves them.
    private static func adaptiveCandidate(
        inspection: StoryVideoInspection, context: StoryAdaptiveEncodingContext
    ) async throws -> PreparedStoryVideo? {
        guard inspection.isEligibleForAdaptiveEncoding, let size = inspection.naturalSize,
              let fps = inspection.frameRate, let durationMs = inspection.durationMs else { return nil }
        let started = ProcessInfo.processInfo.systemUptime
        guard let export = await adaptiveExportSession(for: inspection.originalURL, durationMs: durationMs) else { return nil }
        guard ProcessInfo.processInfo.systemUptime - started < StoryAdaptiveEncodingContext.preparationBudgetSeconds else { return nil }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("story-adaptive-\(UUID().uuidString).mp4")
        var keep = false
        defer { if !keep { try? FileManager.default.removeItem(at: url) } }
        do {
            let cancellation = ExportCancellationHandle(export)
            let deadline = started + StoryAdaptiveEncodingContext.preparationBudgetSeconds
            // One deadline covers export, inspection AND visual validation.
            // Cancellation reaches the native exporter and frame generators.
            let candidate: StoryVideoInspection = try await withTaskCancellationHandler {
                try await withThrowingTaskGroup(of: StoryVideoInspection.self) { group in
                    group.addTask {
                        try await export.export(to: url, as: .mp4)
                        try Task.checkCancellation()
                        let candidate = try await inspect(url: url, source: inspection.source)
                        let sourceBounds = CGRect(origin: .zero, size: size).applying(inspection.preferredTransform ?? .identity)
                        let candidateBounds = CGRect(origin: .zero, size: candidate.naturalSize ?? .zero).applying(candidate.preferredTransform ?? .identity)
                        let quality = try await StoryVideoQualityGate.compare(source: inspection.originalURL,
                            candidate: url, durationMs: durationMs, deadline: deadline)
                        guard quality, candidate.isStreamCompatibleInput, candidate.isExplicitRec709,
                              candidate.hasAudio == inspection.hasAudio,
                              abs((candidate.durationMs ?? 0) - durationMs) <= 100,
                              abs((candidate.frameRate ?? 0) - fps) <= 0.2,
                              abs(abs(sourceBounds.width) - abs(candidateBounds.width)) <= 2,
                              abs(abs(sourceBounds.height) - abs(candidateBounds.height)) <= 2,
                              context.isWorthKeeping(sourceBytes: inspection.byteSize, candidateBytes: candidate.byteSize,
                                exportSeconds: ProcessInfo.processInfo.systemUptime - started) else {
                            throw APIClientError.invalidResponse
                        }
                        return candidate
                    }
                    group.addTask {
                        try await Task.sleep(for: .seconds(max(0, deadline - ProcessInfo.processInfo.systemUptime)))
                        export.cancelExport()
                        throw URLError(.timedOut)
                    }
                    defer { group.cancelAll() }
                    return try await group.next()!
                }
            } onCancel: { cancellation.cancel() }
            let seconds = ProcessInfo.processInfo.systemUptime - started
            keep = true
            MediaPerformance.mark("video_upload_encoding result=accepted network_class=\(context.network) source_bytes=\(inspection.byteSize) candidate_bytes=\(candidate.byteSize) export_ms=\(Int(seconds * 1000))")
            return PreparedStoryVideo(url: url, durationMs: candidate.durationMs, byteSize: candidate.byteSize,
                                      strategy: .adaptiveNormalized, inspection: inspection)
        } catch {
            if error is CancellationError || Task.isCancelled { throw CancellationError() }
            MediaPerformance.mark("video_upload_encoding result=fallback")
            return nil
        }
    }

    static func adaptiveExportSession(for url: URL, durationMs: Int) async -> AVAssetExportSession? {
        let asset = AVURLAsset(url: url)
        let preset = AVAssetExportPresetHEVC1920x1080
        // Eligibility is already checked from source metadata. Creating the one
        // requested preset avoids probing three unrelated presets before the timer.
        // Unsupported exports fail closed to the original in adaptiveCandidate.
        guard let export = AVAssetExportSession(asset: asset, presetName: preset),
              export.supportedFileTypes.contains(.mp4) else { return nil }
        export.shouldOptimizeForNetworkUse = true
        export.fileLengthLimit = Int64(Double(durationMs) / 1000 * Double(adaptiveTargetBitsPerSecond) / 8)
        return export
    }

    static func normalizedVideoURL(
        for url: URL,
        mirrorsHorizontally: Bool,
        targetBitsPerSecond: Int = normalizedTargetBitsPerSecond
    ) async throws -> URL? {
        let asset = AVURLAsset(url: url)
        let presets = await compatibleExportPresets(for: asset)
        let timeRange = await alignedPlayableTimeRange(for: asset)

        for preset in presets {
            try Task.checkCancellation()
            let outputURL = FileManager.default.temporaryDirectory
                .appendingPathComponent("story-upload-\(UUID().uuidString).mp4")

            guard let export = try await exportSession(
                asset: asset,
                preset: preset,
                outputURL: outputURL,
                timeRange: timeRange,
                mirrorsHorizontally: mirrorsHorizontally,
                targetBitsPerSecond: targetBitsPerSecond
            ) else {
                continue
            }

            guard export.supportedFileTypes.contains(.mp4) else {
                MediaPerformance.mark(
                    "video_upload_normalize_skipped preset=\(preset) unsupported_mp4"
                )
                continue
            }

            await exportVideo(export)
            if Task.isCancelled {
                try? FileManager.default.removeItem(at: outputURL)
                throw CancellationError()
            }

            if export.status == .completed {
                let byteSize = try await StoryUploadFileIO.fileSize(at: outputURL)

                if byteSize <= maxUploadBytes {
                    let mode = mirrorsHorizontally ? "mirrored" : "standard"
                    MediaPerformance.mark(
                        "video_upload_normalized mode=\(mode) preset=\(preset) bytes=\(byteSize)"
                    )
                    return outputURL
                }

                try? FileManager.default.removeItem(at: outputURL)
                MediaPerformance.mark(
                    "video_upload_normalized_too_large preset=\(preset) bytes=\(byteSize)"
                )
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

    private static func fastStartRemuxedVideoURL(for url: URL) async -> URL? {
        let asset = AVURLAsset(url: url)
        let outputURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("story-remux-\(UUID().uuidString).mp4")

        guard await AVAssetExportSession.compatibility(
            ofExportPreset: AVAssetExportPresetPassthrough,
            with: asset,
            outputFileType: .mp4
        ), let export = AVAssetExportSession(
            asset: asset,
            presetName: AVAssetExportPresetPassthrough
        ), export.supportedFileTypes.contains(.mp4) else {
            return nil
        }

        export.outputURL = outputURL
        export.outputFileType = .mp4
        export.shouldOptimizeForNetworkUse = true
        if let timeRange = await alignedPlayableTimeRange(for: asset) {
            export.timeRange = timeRange
        }

        await exportVideo(export)
        guard export.status == .completed else {
            try? FileManager.default.removeItem(at: outputURL)
            let nsError = export.error as NSError?
            MediaPerformance.mark(
                "video_upload_remux_failed status=\(export.status.rawValue) code=\(nsError?.code ?? 0)"
            )
            return nil
        }

        return outputURL
    }

    private static func exportSession(
        asset: AVURLAsset,
        preset: String,
        outputURL: URL,
        timeRange: CMTimeRange?,
        mirrorsHorizontally: Bool,
        targetBitsPerSecond: Int
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
            let cappedFrameRateComposition = AVMutableVideoComposition(propertiesOf: asset)
            cappedFrameRateComposition.frameDuration = CMTime(value: 1, timescale: 30)
            videoComposition = cappedFrameRateComposition
            exportTimeRange = timeRange
        }

        guard let export = AVAssetExportSession(
            asset: exportAsset,
            presetName: preset
        ) else {
            return nil
        }

        export.outputURL = outputURL
        export.outputFileType = .mp4
        export.shouldOptimizeForNetworkUse = true
        export.videoComposition = videoComposition

        if let exportTimeRange {
            export.timeRange = exportTimeRange
            let durationSeconds = CMTimeGetSeconds(exportTimeRange.duration)
            if let fileLengthLimit = normalizedFileLengthLimit(
                durationSeconds: durationSeconds, targetBitsPerSecond: targetBitsPerSecond
            ) {
                export.fileLengthLimit = fileLengthLimit
            }
        }

        return export
    }

    private static func compatibleExportPresets(for asset: AVAsset) async -> [String] {
        let candidates = [
            AVAssetExportPresetHEVC1920x1080,
            AVAssetExportPreset1920x1080,
            AVAssetExportPreset1280x720,
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

    // AVFoundation supports cancelling an asynchronous export from another thread.
    // This handle exposes only that operation; configuration stays with the caller.
    private final class ExportCancellationHandle: @unchecked Sendable {
        private let session: AVAssetExportSession
        init(_ session: AVAssetExportSession) { self.session = session }
        func cancel() { session.cancelExport() }
    }

    private static func exportVideo(_ export: AVAssetExportSession) async {
        let cancellation = ExportCancellationHandle(export)
        await withTaskCancellationHandler {
            let deadline = Task {
                do { try await Task.sleep(for: .seconds(180)) } catch { return }
                cancellation.cancel()
            }
            defer { deadline.cancel() }
            await withCheckedContinuation { continuation in
                export.exportAsynchronously { continuation.resume() }
            }
        } onCancel: {
            cancellation.cancel()
        }
    }

    private static func firstVideoTrack(in asset: AVURLAsset) async -> AVAssetTrack? {
        (try? await asset.loadTracks(withMediaType: .video))?.first
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

extension StoryVideoUpload.Source {
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
