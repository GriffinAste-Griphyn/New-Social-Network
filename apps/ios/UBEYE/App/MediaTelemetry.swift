import AVFoundation
import CryptoKit
import Foundation
import ImageIO
import MetricKit
import Network
import os
import SwiftUI
import UIKit

enum MediaPerformance {
    private static let logger = Logger(subsystem: "com.griffinaste.ubeye", category: "media")
    private static let signpostLog = OSLog(subsystem: "com.griffinaste.ubeye", category: "media.signpost")
    private static let uploadableEventNames: Set<String> = [
        "media_delivery_accepted",
        "media_delivery_ready",
        "media_delivery_observed",
        "api_request",
        "api_server_timing",
        "feed_disk_cache_clear",
        "feed_disk_cache_hit",
        "feed_disk_cache_miss",
        "feed_disk_cache_restore",
        "feed_disk_cache_write",
        "feed_disk_restore",
        "feed_load",
        "feed_media_commit",
        "feed_media_deferred",
        "feed_media_preparation",
        "feed_media_preheat",
        "feed_refresh_failed",
        "media_cache_summary",
        "media_file_cache_failed",
        "media_file_cache_hit",
        "media_file_cache_skip",
        "media_file_cache_write",
        "hls_asset_download_failed",
        "hls_asset_download_finished",
        "hls_asset_download_start",
        "hls_asset_package_hit",
        "media_qoe_config",
        "image_derivatives_prepared",
        "image_derivative_upload_failed",
        "image_ready",
        "image_upload_failed",
        "image_upload_phase",
        "image_upload_succeeded",
        "interaction_latency",
        "keyboard_latency",
        "metric_kit_diagnostic",
        "metric_kit_payload",
        "gesture_outcome",
        "frame_hitch",
        "frame_pacing",
        "prefetch_intent",
        "resource_mode",
        "undo_action",
        "thumbnail_generation_swap",
        "background_upload_resume",
        "silent_push_prewarm",
        "story_open",
        "story_open_warm",
        "story_stack_cache_clear",
        "story_stack_cache_hit",
        "story_stack_cache_miss",
        "story_stack_disk_cache_hit",
        "story_stack_disk_cache_miss",
        "story_stack_disk_cache_write",
        "story_stack_disk_restore",
        "story_stack_display_cache_hit",
        "story_stack_fetch_join",
        "story_stack_network",
        "story_stack_prefetch_end",
        "story_stack_prefetch_start",
        "story_transition_visible",
        "video_disk_cache_hit",
        "video_dismissed",
        "video_ended",
        "video_player_pool_hit",
        "video_player_pool_wait",
        "video_player_prepared",
        "video_player_staged",
        "video_preroll_reused",
        "video_prerolled",
        "video_retry",
        "video_recovered",
        "video_startup",
        "video_upload_failed",
        "video_upload_phase",
        "video_upload_retry",
        "video_upload_succeeded",
        "video_upload_encoding",
        "video_upload_chunk",
        "video_first_frame",
        "video_item_ready",
        "video_stalled",
        "video_terminal_failure",
        "video_access_log",
        "video_quality_ramp",
    ]

    struct Interval {
        fileprivate let event: String
        fileprivate let startedAt: Date
        fileprivate let signpostID: OSSignpostID
    }

    static func configureUpload(
        _ send: @escaping ([MobilePerformanceEventUpload]) async throws -> Void
    ) {
        Task { @MainActor in
            MobilePerformanceReporter.shared.configure(send: send)
        }
    }

    @discardableResult
    static func beginInterval(_ event: String) -> Interval {
        let signpostID = OSSignpostID(log: signpostLog)
        os_signpost(
            .begin,
            log: signpostLog,
            name: "MediaOperation",
            signpostID: signpostID,
            "%{public}@",
            event as NSString
        )
        logger.debug("begin \(event, privacy: .public)")
        return Interval(event: event, startedAt: Date(), signpostID: signpostID)
    }

    static func endInterval(_ interval: Interval, event: String? = nil, upload: Bool = true) {
        let resolvedEvent = event ?? interval.event
        let elapsedMs = Int(Date().timeIntervalSince(interval.startedAt) * 1000)
        os_signpost(
            .end,
            log: signpostLog,
            name: "MediaOperation",
            signpostID: interval.signpostID,
            "%{public}@ duration_ms=%{public}ld",
            resolvedEvent as NSString,
            elapsedMs
        )
        logMeasuredEvent(resolvedEvent, elapsedMs: elapsedMs, upload: upload)
    }

    static func cancelInterval(_ interval: Interval, reason: String) {
        os_signpost(
            .end,
            log: signpostLog,
            name: "MediaOperation",
            signpostID: interval.signpostID,
            "%{public}@ cancelled reason=%{public}@",
            interval.event as NSString,
            reason as NSString
        )
        logger.debug("cancel \(interval.event, privacy: .public) reason=\(reason, privacy: .public)")
    }

    static func mark(_ event: String) {
        os_signpost(
            .event,
            log: signpostLog,
            name: "MediaEvent",
            "%{public}@",
            event as NSString
        )
        logger.info("\(event, privacy: .public)")
        enqueue(event, durationMs: nil)
    }

    static func measure(_ event: String, since start: Date) {
        let elapsedMs = Int(Date().timeIntervalSince(start) * 1000)
        logMeasuredEvent(event, elapsedMs: elapsedMs, upload: true)
    }

    static func flushUploadEvents() {
        Task { @MainActor in
            await Task.yield()
            await MobilePerformanceReporter.shared.flushNow()
        }
    }

    private static func logMeasuredEvent(_ event: String, elapsedMs: Int, upload: Bool) {
        os_signpost(
            .event,
            log: signpostLog,
            name: "MediaMeasure",
            "%{public}@ duration_ms=%{public}ld",
            event as NSString,
            elapsedMs
        )
        logger.info("\(event, privacy: .public) \(elapsedMs)ms")
        if upload {
            enqueue(event, durationMs: elapsedMs)
        }
    }

    private static func enqueue(_ event: String, durationMs: Int?) {
        guard let parsed = parse(event), uploadableEventNames.contains(parsed.name) else {
            return
        }

        Task { @MainActor in
            MobilePerformanceReporter.shared.record(
                name: parsed.name,
                durationMs: durationMs,
                metadata: enrichedMetadata(
                    for: parsed.name,
                    eventMetadata: parsed.metadata
                )
            )
        }
    }

    private static let hardwareModel: String = {
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { bytes in
            String(bytes: bytes.prefix { $0 != 0 }, encoding: .utf8) ?? "unknown"
        }
    }()

    @MainActor
    static func enrichedMetadata(
        for name: String,
        eventMetadata: [String: String]
    ) -> [String: String] {
        let build = Bundle.main.object(
            forInfoDictionaryKey: kCFBundleVersionKey as String
        ) as? String ?? "unknown"
        let deviceClass: String
        switch UIDevice.current.userInterfaceIdiom {
        case .phone:
            deviceClass = "phone"
        case .pad:
            deviceClass = "tablet"
        case .mac:
            deviceClass = "mac"
        default:
            deviceClass = "other"
        }

        var metadata = [
            "build": build,
            "device_class": deviceClass,
            "device_model": hardwareModel,
            "network_class": eventMetadata["network_class"] ?? NetworkQualityMonitor.shared.telemetryNetworkClass,
            "os": UIDevice.current.systemVersion,
            "resource_mode": UBEYEResourceMonitor.shared.mode.rawValue,
            "low_power": ProcessInfo.processInfo.isLowPowerModeEnabled ? "true" : "false",
            "thermal_state": String(ProcessInfo.processInfo.thermalState.rawValue),
            "startup_profile": MediaControlConfig.shared.startupExperiment,
            "upload_experiment": eventMetadata["upload_experiment"] ?? MediaControlConfig.shared.uploadExperiment,
        ]
        // Preserve identities and the counters used by QoE rollups when an
        // access log has more fields than the backend's metadata budget.
        let priority = ["story", "installation", "phase", "playback", "delivery", "startup_state", "layer_ready_ms", "attachment_ms", "preroll_ms", "preparation_ms", "target", "result", "attempt", "bytes", "watchedMs", "downloadedMs", "indicatedBitrate", "observedBitrate", "width", "height", "reason", "generation", "media", "stalls", "transferDurationMs"]
        for key in priority + eventMetadata.keys.filter({ !priority.contains($0) }).sorted() {
            guard metadata.count < 32 else { break }
            if let value = eventMetadata[key], metadata[key] == nil {
                metadata[key] = value
            }
        }
        return metadata
    }

    private static func parse(_ event: String) -> (name: String, metadata: [String: String])? {
        let parts = event.split(separator: " ", maxSplits: 1, omittingEmptySubsequences: true)
        guard let rawName = parts.first else {
            return nil
        }

        let name = String(rawName)
        let metadataText = parts.count > 1 ? String(parts[1]) : ""
        var metadata: [String: String] = [:]

        for token in metadataText.split(separator: " ") {
            let pair = token.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard pair.count == 2 else {
                continue
            }

            let key = String(pair[0]).prefix(40)
            let value = String(pair[1]).prefix(500)
            metadata[String(key)] = String(value)

            if metadata.count >= 32 {
                break
            }
        }

        return (name, metadata)
    }

    static func parsedEventForTesting(_ event: String) -> (name: String, metadata: [String: String])? {
        parse(event)
    }
}

final class AppReliabilityMonitor: NSObject, MXMetricManagerSubscriber {
    static let shared = AppReliabilityMonitor()

    private var hasStarted = false

    private override init() {
        super.init()
    }

    func start() {
        guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil else {
            return
        }
        guard !hasStarted else {
            return
        }
        hasStarted = true
        MXMetricManager.shared.add(self)
        MediaPerformance.mark("metric_kit_payload event=subscribed")
    }

    func didReceive(_ payloads: [MXMetricPayload]) {
        MediaPerformance.mark("metric_kit_payload event=received count=\(payloads.count)")
        MediaPerformance.flushUploadEvents()
    }

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        for payload in payloads {
            let crashCount = payload.crashDiagnostics?.count ?? 0
            let hangCount = payload.hangDiagnostics?.count ?? 0
            let cpuExceptionCount = payload.cpuExceptionDiagnostics?.count ?? 0
            let diskWriteExceptionCount = payload.diskWriteExceptionDiagnostics?.count ?? 0
            MediaPerformance.mark(
                "metric_kit_diagnostic crashes=\(crashCount) hangs=\(hangCount) cpu=\(cpuExceptionCount) disk=\(diskWriteExceptionCount)"
            )
        }
        MediaPerformance.flushUploadEvents()
    }
}

@MainActor
final class MobilePerformanceReporter {
    static let shared = MobilePerformanceReporter()

    private var send: (([MobilePerformanceEventUpload]) async throws -> Void)?
    private var buffer: [MobilePerformanceEventUpload] = []
    private var flushTask: Task<Void, Never>?
    private var prefersImmediateFlush = false
    private var flushWake: AsyncStream<Void>.Continuation?
    private var lastUploadStartedAt: Date?
    private var retryNotBefore: Date?
    private let batchSize: Int
    private let maxBufferSize: Int
    private let flushDelaySeconds: TimeInterval
    private let minimumRequestSpacingSeconds: TimeInterval
    private let retryDelaySeconds: TimeInterval
    private let dateFormatter = ISO8601DateFormatter()

    init(
        batchSize: Int = 100,
        maxBufferSize: Int = 400,
        flushDelaySeconds: TimeInterval = 60,
        minimumRequestSpacingSeconds: TimeInterval = 30,
        retryDelaySeconds: TimeInterval = 60
    ) {
        self.batchSize = max(1, batchSize)
        self.maxBufferSize = max(1, maxBufferSize)
        self.flushDelaySeconds = max(0, flushDelaySeconds)
        self.minimumRequestSpacingSeconds = max(0, minimumRequestSpacingSeconds)
        self.retryDelaySeconds = max(0, retryDelaySeconds)
        dateFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    }

    func configure(send: @escaping ([MobilePerformanceEventUpload]) async throws -> Void) {
        self.send = send
        scheduleFlush(immediate: false)
    }

    func record(name: String, durationMs: Int?, metadata: [String: String]) {
        buffer.append(
            MobilePerformanceEventUpload(
                name: name,
                durationMs: durationMs,
                metadata: metadata,
                clientCreatedAt: dateFormatter.string(from: Date())
            )
        )

        if buffer.count > maxBufferSize {
            // Preserve the prefix because it may currently be in flight.
            buffer.removeLast(buffer.count - maxBufferSize)
        }

        scheduleFlush(immediate: buffer.count >= batchSize)
    }

    func flushNow() async {
        // Never cancel an upload that may already have reached the server. A
        // cancelled URLSession task can still be committed remotely, and
        // requeueing that batch creates a tight duplicate-upload loop.
        scheduleFlush(immediate: true)
    }

    private func scheduleFlush(immediate: Bool) {
        guard send != nil, !buffer.isEmpty else {
            return
        }

        if immediate {
            prefersImmediateFlush = true
            // Wake only the delay. Never cancel an in-flight network request.
            flushWake?.yield(())
        }

        // One worker owns both the delay and the network request. New events
        // join its buffer instead of cancelling and replacing it.
        guard flushTask == nil else {
            return
        }

        flushTask = Task { @MainActor [weak self] in
            await self?.runScheduledFlush()
        }
    }

    private func runScheduledFlush() async {
        guard let send, !buffer.isEmpty else {
            flushTask = nil
            return
        }

        let regularDeadline = Date().addingTimeInterval(flushDelaySeconds)
        while !Task.isCancelled {
            let now = Date()
            let immediate = prefersImmediateFlush || buffer.count >= batchSize
            let regularDelay = immediate ? 0 : max(0, regularDeadline.timeIntervalSince(now))
            let spacingDelay = lastUploadStartedAt.map {
                max(0, minimumRequestSpacingSeconds - now.timeIntervalSince($0))
            } ?? 0
            let retryDelay = retryNotBefore.map { max(0, $0.timeIntervalSince(now)) } ?? 0
            let delaySeconds = max(regularDelay, spacingDelay, retryDelay)
            if delaySeconds <= 0 { break }
            let (stream, continuation) = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
            flushWake = continuation
            await withTaskGroup(of: Void.self) { group in
                group.addTask { for await _ in stream { return } }
                group.addTask {
                    try? await Task.sleep(for: .milliseconds(Int((delaySeconds * 1_000).rounded(.up))))
                }
                await group.next()
                group.cancelAll()
            }
            continuation.finish()
            flushWake = nil
        }
        prefersImmediateFlush = false

        guard !Task.isCancelled else {
            flushTask = nil
            return
        }

        let batch = Array(buffer.prefix(batchSize))
        lastUploadStartedAt = Date()

        do {
            try await send(batch)
            // The worker is the only code that removes events, so the batch is
            // still the buffer prefix even if more events arrived in flight.
            buffer.removeFirst(min(batch.count, buffer.count))
            retryNotBefore = nil
            if buffer.isEmpty {
                prefersImmediateFlush = false
            }
        } catch {
            // Keep the original prefix in place and retry with backoff. This
            // bounds failures to one request per retry window instead of a
            // request-per-event storm.
            retryNotBefore = Date().addingTimeInterval(retryDelaySeconds)
        }

        flushTask = nil
        scheduleFlush(immediate: buffer.count >= batchSize)
    }
}

