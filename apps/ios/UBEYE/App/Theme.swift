import AVFoundation
import CryptoKit
import Foundation
import ImageIO
import Network
import os
import SwiftUI
import UIKit

extension Color {
    static let ubeyeRed = Color(red: 224 / 255, green: 22 / 255, blue: 22 / 255)
    static let ubeyeNavy = Color(red: 13 / 255, green: 18 / 255, blue: 28 / 255)
    static let ubeyeInk = Color(red: 15 / 255, green: 16 / 255, blue: 20 / 255)
    static let ubeyeMuted = Color(red: 107 / 255, green: 114 / 255, blue: 128 / 255)
    static let ubeyeSubtle = Color(red: 246 / 255, green: 247 / 255, blue: 249 / 255)
    static let ubeyeBackground = Color(red: 250 / 255, green: 250 / 255, blue: 251 / 255)
    static let ubeyePanel = Color.white
    static let ubeyeBorder = Color(red: 229 / 255, green: 231 / 255, blue: 235 / 255)
    static let ubeyeYellow = Color(red: 253 / 255, green: 224 / 255, blue: 71 / 255)
    static let ubeyePurple = Color(red: 124 / 255, green: 58 / 255, blue: 237 / 255)
}

enum UBEYEMetrics {
    static let screenInset: CGFloat = 16
    static let topAvatar: CGFloat = 42
    static let topAvatarTopInset: CGFloat = 14
    static let compactTopAvatar: CGFloat = 38
}

extension View {
    func ubeyeScreen() -> some View {
        self
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.ubeyeBackground.ignoresSafeArea())
            .foregroundStyle(Color.ubeyeInk)
    }

    func ubeyeCard(cornerRadius: CGFloat = 8) -> some View {
        self
            .background(Color.ubeyePanel)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(Color.ubeyeBorder.opacity(0.85), lineWidth: 1)
            )
    }

    func ubeyeMediaCardChrome(cornerRadius: CGFloat = 8) -> some View {
        self
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(.white.opacity(0.16), lineWidth: 1)
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(Color.black.opacity(0.08), lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.10), radius: 12, x: 0, y: 6)
    }
}

struct EmptyStateView: View {
    let title: String
    let message: String
    var systemImage: String = "sparkles"

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: systemImage)
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(Color.ubeyeRed)
            Text(title)
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .multilineTextAlignment(.center)
                .foregroundStyle(Color.ubeyeMuted)
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .ubeyeCard()
    }
}

struct UBEYESkeletonBlock: View {
    var cornerRadius: CGFloat = 8

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [
                        Color.ubeyeSubtle,
                        Color.ubeyeBorder.opacity(0.74),
                        Color.ubeyeRed.opacity(0.045),
                        Color.ubeyeSubtle.opacity(0.96)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(Color.white.opacity(0.64), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}

struct UBEYESkeletonLine: View {
    let width: CGFloat
    var height: CGFloat = 10

    var body: some View {
        UBEYESkeletonBlock(cornerRadius: height / 2)
            .frame(width: width, height: height)
    }
}

struct UBEYESkeletonCircle: View {
    let size: CGFloat

    var body: some View {
        Circle()
            .fill(
                LinearGradient(
                    colors: [
                        Color.ubeyeSubtle,
                        Color.ubeyeBorder.opacity(0.78),
                        Color.ubeyeSubtle.opacity(0.94)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(Circle().stroke(Color.white.opacity(0.7), lineWidth: 1))
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

struct PrimaryButton: View {
    let title: String
    var isLoading = false
    var isDisabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                if isLoading {
                    ProgressView()
                        .tint(.white)
                }
                Text(title)
                    .fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(isDisabled ? Color.ubeyeMuted.opacity(0.45) : Color.ubeyeNavy)
            .clipShape(Capsule())
            .foregroundStyle(.white)
        }
        .disabled(isLoading || isDisabled)
    }
}

struct UBEYEWordmark: View {
    var compact = false

    var body: some View {
        Image("UBEYELogo")
            .resizable()
            .scaledToFit()
        .frame(width: compact ? 32 : 38, height: compact ? 32 : 38)
        .accessibilityLabel("UBEYE")
    }
}

struct CircleIconButton: View {
    let systemImage: String
    var action: () -> Void = {}

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .semibold))
                .frame(width: 36, height: 36)
                .foregroundStyle(Color.ubeyeInk)
                .background(Color.ubeyeSubtle, in: Circle())
        }
        .buttonStyle(.plain)
    }
}

struct RemoteAvatar: View {
    let url: URL?
    var size: CGFloat = 44
    var name: String = ""
    @State private var loadedImage: UIImage?
    @State private var loadedImageURL: URL?

    var body: some View {
        ZStack {
            if let image = MediaImageCache.shared.cachedImage(for: url) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else if loadedImageURL == url, let image = loadedImage {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                placeholder
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .task(id: url) {
            await loadImageIfNeeded()
        }
    }

    private var placeholder: some View {
        ZStack {
            Circle().fill(Color.ubeyeRed)
            Text(initials)
                .font(.system(size: max(11, size * 0.32), weight: .black))
                .foregroundStyle(.white)
        }
    }

    private var initials: String {
        let parts = name.split(separator: " ")
        let letters = parts.prefix(2).compactMap { $0.first }
        let value = String(letters).uppercased()
        return value.isEmpty ? "U" : value
    }

    private func loadImageIfNeeded() async {
        guard let url else {
            loadedImage = nil
            loadedImageURL = nil
            return
        }

        if let cached = MediaImageCache.shared.cachedImage(for: url) {
            loadedImage = cached
            loadedImageURL = url
            return
        }

        loadedImage = nil
        loadedImageURL = nil

        if let image = await MediaImageCache.shared.loadImage(for: url) {
            loadedImage = image
            loadedImageURL = url
        } else {
            loadedImage = nil
            loadedImageURL = nil
        }
    }
}

struct TopAvatarSpacer: View {
    var body: some View {
        Color.clear
            .frame(width: UBEYEMetrics.topAvatar, height: UBEYEMetrics.topAvatar)
    }
}

enum MediaPerformance {
    private static let logger = Logger(subsystem: "com.griffinaste.ubeye", category: "media")
    private static let signpostLog = OSLog(subsystem: "com.griffinaste.ubeye", category: "media.signpost")
    private static let uploadableEventNames: Set<String> = [
        "api_request",
        "api_server_timing",
        "feed_disk_cache_clear",
        "feed_disk_cache_hit",
        "feed_disk_cache_miss",
        "feed_disk_cache_restore",
        "feed_disk_cache_write",
        "feed_disk_restore",
        "feed_load",
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
        "video_disk_cache_hit",
        "video_dismissed",
        "video_ended",
        "video_player_pool_hit",
        "video_retry",
        "video_recovered",
        "video_startup",
        "video_upload_failed",
        "video_upload_phase",
        "video_upload_retry",
        "video_upload_succeeded",
        "video_first_frame",
        "video_item_ready",
        "video_stalled",
        "video_access_log",
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
                metadata: parsed.metadata
            )
        }
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

            if metadata.count >= 20 {
                break
            }
        }

        return (name, metadata)
    }

    static func parsedEventForTesting(_ event: String) -> (name: String, metadata: [String: String])? {
        parse(event)
    }
}

@MainActor
final class MobilePerformanceReporter {
    static let shared = MobilePerformanceReporter()

    private var send: (([MobilePerformanceEventUpload]) async throws -> Void)?
    private var buffer: [MobilePerformanceEventUpload] = []
    private var flushTask: Task<Void, Never>?
    private var isFlushing = false
    private let batchSize = 25
    private let maxBufferSize = 200
    private let flushDelay: Duration = .seconds(20)
    private let dateFormatter = ISO8601DateFormatter()

    private init() {
        dateFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    }

    func configure(send: @escaping ([MobilePerformanceEventUpload]) async throws -> Void) {
        self.send = send
        scheduleFlush(immediate: true)
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
            buffer.removeFirst(buffer.count - maxBufferSize)
        }

        scheduleFlush(immediate: buffer.count >= batchSize)
    }

    private func scheduleFlush(immediate: Bool) {
        guard send != nil else {
            return
        }
        guard !isFlushing else {
            return
        }

        flushTask?.cancel()
        flushTask = Task { @MainActor [weak self] in
            if !immediate {
                try? await Task.sleep(for: self?.flushDelay ?? .seconds(20))
            }
            await self?.flush()
        }
    }

    private func flush() async {
        guard !isFlushing, let send, !buffer.isEmpty else {
            return
        }

        isFlushing = true
        defer {
            isFlushing = false
        }

        let batch = Array(buffer.prefix(batchSize))
        buffer.removeFirst(batch.count)

        do {
            try await send(batch)
            if !buffer.isEmpty {
                scheduleFlush(immediate: buffer.count >= batchSize)
            }
        } catch {
            if !Task.isCancelled {
                buffer.insert(contentsOf: batch, at: 0)
            }
            if buffer.count > maxBufferSize {
                buffer.removeLast(buffer.count - maxBufferSize)
            }
            scheduleFlush(immediate: false)
        }
    }
}

enum AppAudioSession {
    @discardableResult
    static func configureForVideoRecording() -> Bool {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(
                .playAndRecord,
                mode: .videoRecording,
                options: [.defaultToSpeaker, .allowBluetoothHFP]
            )
            try session.setPreferredSampleRate(48_000)
            if let builtInMic = session.availableInputs?.first(where: { $0.portType == .builtInMic }) {
                try? session.setPreferredInput(builtInMic)
            }
            try session.setActive(true)
            MediaPerformance.mark("audio_session_video_recording")
            return true
        } catch {
            MediaPerformance.mark("audio_session_video_recording_failed")
            return false
        }
    }

    @discardableResult
    static func configureForVideoPlayback() -> Bool {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .moviePlayback)
            try session.setPreferredSampleRate(48_000)
            try session.setActive(true)
            MediaPerformance.mark("audio_session_video_playback")
            return true
        } catch {
            MediaPerformance.mark("audio_session_video_playback_failed")
            return false
        }
    }
}

enum MediaDiagnostics {
    static func capturedVideoHasAudio(url: URL) -> Bool {
        let asset = AVURLAsset(url: url)
        let audioTrack = asset.tracks(withMediaType: .audio).first

        guard let audioTrack else {
            MediaPerformance.mark("capture_audio_missing")
            return false
        }

        let dataRate = Int(audioTrack.estimatedDataRate)
        let formatDescription = audioTrack.formatDescriptions.first.map {
            $0 as! CMAudioFormatDescription
        }
        let streamDescription = formatDescription.flatMap {
            CMAudioFormatDescriptionGetStreamBasicDescription($0)
        }
        let sampleRate = Int(streamDescription?.pointee.mSampleRate ?? 0)
        let channels = Int(streamDescription?.pointee.mChannelsPerFrame ?? 0)
        let codec = formatDescription
            .map { fourCharacterCode(CMFormatDescriptionGetMediaSubType($0)) } ??
            "unknown"

        MediaPerformance.mark(
            "capture_audio codec=\(codec) sample_rate=\(sampleRate) channels=\(channels) bitrate=\(dataRate)"
        )
        return true
    }

    private static func fourCharacterCode(_ value: FourCharCode) -> String {
        let bytes: [UInt8] = [
            UInt8((value >> 24) & 0xff),
            UInt8((value >> 16) & 0xff),
            UInt8((value >> 8) & 0xff),
            UInt8(value & 0xff),
        ]

        return String(bytes: bytes, encoding: .macOSRoman) ?? "\(value)"
    }
}

final class MediaControlConfig {
    static let shared = MediaControlConfig()

    private let lock = NSLock()
    private var mediaConfig: MobileMediaConfigResponse.Media?

    private init() {}

    var imageDerivativeUploadEnabled: Bool {
        read { $0?.imageDerivativeUploadEnabled ?? true }
    }

    var qoeAccessLogSampleRate: Double {
        read { min(max($0?.qoeAccessLogSampleRate ?? 1, 0), 1) }
    }

    var uploadChunkBytes: Int {
        read { $0?.uploadChunkBytes ?? 3 * 1024 * 1024 }
    }

    var mediaFileCacheMaxBytes: Int {
        read { $0?.mediaFileCacheMaxBytes ?? 1024 * 1024 * 1024 }
    }

    func apply(_ config: MobileMediaConfigResponse.Media) {
        lock.lock()
        mediaConfig = config
        lock.unlock()

        MediaPerformance.mark("media_qoe_config version=\(config.version) profile=\(config.rolloutProfile ?? "baseline") cacheBytes=\(config.mediaFileCacheMaxBytes)")
    }

    func imagePreheatLimit(isLimited: Bool) -> Int {
        readLimit(\.imagePreheatLimit, isLimited: isLimited, fallback: isLimited ? 2 : 4)
    }

    func stackPreheatLimit(isLimited: Bool) -> Int {
        readLimit(\.stackPreheatLimit, isLimited: isLimited, fallback: isLimited ? 2 : 4)
    }

    func preparedPlayerLimit(isLimited: Bool) -> Int {
        readLimit(\.preparedPlayerLimit, isLimited: isLimited, fallback: isLimited ? 0 : 4)
    }

    func persistentVideoPreheatLimit(isLimited: Bool) -> Int {
        readLimit(\.persistentVideoPreheatLimit, isLimited: isLimited, fallback: isLimited ? 2 : 4)
    }

    func startupStreamingPeakBitRate(isLimited: Bool) -> Double {
        read {
            guard let pair = $0?.startupStreamingPeakBitRate else {
                return isLimited ? 4_000_000 : 8_000_000
            }

            return isLimited ? pair.constrained : pair.standard
        }
    }

    func startupStreamingMaximumResolution(isLimited: Bool) -> CGSize {
        read {
            guard let pair = $0?.startupStreamingMaximumResolution else {
                return isLimited ? CGSize(width: 720, height: 1280) : CGSize(width: 1080, height: 1920)
            }

            let resolution = isLimited ? pair.constrained : pair.standard
            return CGSize(width: resolution.width, height: resolution.height)
        }
    }

    func shouldUploadAccessLog() -> Bool {
        let sampleRate = qoeAccessLogSampleRate
        guard sampleRate > 0 else {
            return false
        }

        return sampleRate >= 1 || Double.random(in: 0..<1) <= sampleRate
    }

    private func read<T>(_ block: (MobileMediaConfigResponse.Media?) -> T) -> T {
        lock.lock()
        let config = mediaConfig
        lock.unlock()
        return block(config)
    }

    private func readLimit(
        _ keyPath: KeyPath<MobileMediaConfigResponse.Media, MobileMediaConfigResponse.Media.LimitPair>,
        isLimited: Bool,
        fallback: Int
    ) -> Int {
        read {
            guard let pair = $0?[keyPath: keyPath] else {
                return fallback
            }

            return isLimited ? pair.constrained : pair.standard
        }
    }
}

@MainActor
final class NetworkQualityMonitor {
    static let shared = NetworkQualityMonitor()

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "ubeye.network-quality")
    private(set) var isConstrained = false
    private(set) var isCellular = false

    private var shouldLimitPreheating: Bool {
        isConstrained || isCellular
    }

    private var shouldLimitStreamingQuality: Bool {
        isConstrained
    }

    var imagePreheatLimit: Int {
        MediaControlConfig.shared.imagePreheatLimit(isLimited: shouldLimitPreheating)
    }

    var stackPreheatLimit: Int {
        MediaControlConfig.shared.stackPreheatLimit(isLimited: shouldLimitPreheating)
    }

    var preparedPlayerLimit: Int {
        MediaControlConfig.shared.preparedPlayerLimit(isLimited: shouldLimitPreheating)
    }

    var persistentVideoPreheatLimit: Int {
        MediaControlConfig.shared.persistentVideoPreheatLimit(isLimited: shouldLimitPreheating)
    }

    var startupStreamingPeakBitRate: Double {
        MediaControlConfig.shared.startupStreamingPeakBitRate(isLimited: shouldLimitStreamingQuality)
    }

    var startupStreamingMaximumResolution: CGSize {
        MediaControlConfig.shared.startupStreamingMaximumResolution(isLimited: shouldLimitStreamingQuality)
    }

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                self?.isConstrained = path.isConstrained
                self?.isCellular = path.usesInterfaceType(.cellular)
            }
        }
        monitor.start(queue: queue)
    }
}

enum MediaFileKind: String {
    case image
    case video
}

func isHTTPStreamingPlaylist(_ url: URL) -> Bool {
    url.pathExtension.lowercased() == "m3u8"
}

actor MediaFileDiskCache {
    static let shared = MediaFileDiskCache()

    private let rootURL: URL
    private let fileManager = FileManager.default
    private let minimumAvailableCapacity: Int64 = 512 * 1024 * 1024
    private var maxCacheBytes: Int {
        MediaControlConfig.shared.mediaFileCacheMaxBytes
    }

    private init() {
        rootURL = fileManager
            .urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("UBEYE", isDirectory: true)
            .appendingPathComponent("media-cache", isDirectory: true)
    }

    func cachedFileURL(for url: URL) -> URL? {
        let fileURLs = candidateFileURLs(for: url)

        for fileURL in fileURLs where fileManager.fileExists(atPath: fileURL.path) {
            try? fileManager.setAttributes([.modificationDate: Date()], ofItemAtPath: fileURL.path)
            MediaPerformance.mark("media_file_cache_hit url=\(url.lastPathComponent)")
            return fileURL
        }

        return nil
    }

    func hasCachedFile(for url: URL) -> Bool {
        candidateFileURLs(for: url).contains { fileManager.fileExists(atPath: $0.path) }
    }

    func playbackURL(for url: URL) -> URL {
        cachedFileURL(for: url) ?? url
    }

    func supportsPersistence(url: URL, kind: MediaFileKind) -> Bool {
        shouldPersist(url: url, kind: kind)
    }

    func removeAll() {
        try? fileManager.removeItem(at: rootURL)
    }

    @discardableResult
    func storeLocalFile(sourceURL: URL, for url: URL, kind: MediaFileKind) async -> URL? {
        guard canStoreLocalFile(for: url, kind: kind) else {
            MediaPerformance.mark("media_file_cache_skip kind=\(kind.rawValue) url=\(url.lastPathComponent)")
            return nil
        }

        let startedAt = Date()
        let sourceBytes = ((try? sourceURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        guard prepareCapacity(forAdditionalBytes: sourceBytes) else {
            MediaPerformance.mark("media_file_cache_skip kind=\(kind.rawValue) reason=storage_pressure")
            return nil
        }
        let finalURL = fileURL(
            for: url,
            contentType: contentType(forLocalFile: sourceURL, kind: kind)
        )

        do {
            try fileManager.createDirectory(
                at: finalURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try? fileManager.removeItem(at: finalURL)
            try fileManager.copyItem(at: sourceURL, to: finalURL)
            try? fileManager.setAttributes([.modificationDate: Date()], ofItemAtPath: finalURL.path)
            pruneIfNeeded()
            MediaPerformance.measure("media_file_cache_write kind=\(kind.rawValue) url=\(url.lastPathComponent)", since: startedAt)
            return finalURL
        } catch {
            MediaPerformance.mark("media_file_cache_failed kind=\(kind.rawValue) url=\(url.lastPathComponent)")
            return nil
        }
    }

    @discardableResult
    func cache(url: URL, kind: MediaFileKind) async -> URL? {
        if let cached = cachedFileURL(for: url) {
            return cached
        }

        guard shouldPersist(url: url, kind: kind) else {
            MediaPerformance.mark("media_file_cache_skip kind=\(kind.rawValue) url=\(url.lastPathComponent)")
            return nil
        }

        let startedAt = Date()
        var request = URLRequest(url: url)
        request.cachePolicy = .returnCacheDataElseLoad
        request.timeoutInterval = kind == .video ? 60 : 25

        do {
            let (temporaryURL, response) = try await URLSession.shared.download(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200..<300).contains(httpResponse.statusCode) else {
                return nil
            }

            let downloadedBytes = ((try? temporaryURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
            guard prepareCapacity(forAdditionalBytes: downloadedBytes) else {
                MediaPerformance.mark("media_file_cache_skip kind=\(kind.rawValue) reason=storage_pressure")
                return nil
            }

            let finalURL = fileURL(
                for: url,
                contentType: httpResponse.mimeType ?? response.mimeType
            )
            try fileManager.createDirectory(
                at: finalURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try? fileManager.removeItem(at: finalURL)
            try fileManager.moveItem(at: temporaryURL, to: finalURL)
            try? fileManager.setAttributes([.modificationDate: Date()], ofItemAtPath: finalURL.path)
            pruneIfNeeded()
            MediaPerformance.measure("media_file_cache_write kind=\(kind.rawValue) url=\(url.lastPathComponent)", since: startedAt)
            return finalURL
        } catch {
            MediaPerformance.mark("media_file_cache_failed kind=\(kind.rawValue) url=\(url.lastPathComponent)")
            return nil
        }
    }

    private func shouldPersist(url: URL, kind: MediaFileKind) -> Bool {
        if isHTTPStreamingPlaylist(url) {
            return false
        }

        let pathExtension = url.pathExtension.lowercased()

        switch kind {
        case .image:
            return ["jpg", "jpeg", "png", "webp", "heic", "avif"].contains(pathExtension) || pathExtension.isEmpty
        case .video:
            return ["mp4", "mov", "m4v"].contains(pathExtension)
        }
    }

    private func canStoreLocalFile(for url: URL, kind: MediaFileKind) -> Bool {
        if isHTTPStreamingPlaylist(url) {
            return false
        }

        let pathExtension = url.pathExtension.lowercased()
        return pathExtension.isEmpty || shouldPersist(url: url, kind: kind)
    }

    private func contentType(forLocalFile sourceURL: URL, kind: MediaFileKind) -> String? {
        switch sourceURL.pathExtension.lowercased() {
        case "jpg", "jpeg":
            return "image/jpeg"
        case "png":
            return "image/png"
        case "webp":
            return "image/webp"
        case "avif":
            return "image/avif"
        case "mp4", "m4v":
            return "video/mp4"
        case "mov":
            return "video/quicktime"
        default:
            switch kind {
            case .image:
                return nil
            case .video:
                return "video/mp4"
            }
        }
    }

    private func fileURL(for url: URL, contentType: String? = nil) -> URL {
        let key = cacheKey(for: url)
        let fileExtension = fileExtension(for: url, contentType: contentType)

        return rootURL.appendingPathComponent("\(key).\(fileExtension)", isDirectory: false)
    }

    private func candidateFileURLs(for url: URL) -> [URL] {
        let defaultURL = fileURL(for: url)
        guard url.pathExtension.isEmpty else {
            return [defaultURL]
        }

        let key = cacheKey(for: url)
        let fallbackExtensions = ["mp4", "mov", "m4v", "jpg", "jpeg", "png", "webp", "heic", "avif", "media"]
        var seen = Set<URL>()
        return ([defaultURL] + fallbackExtensions.map {
            rootURL.appendingPathComponent("\(key).\($0)", isDirectory: false)
        }).filter { seen.insert($0).inserted }
    }

    private func cacheKey(for url: URL) -> String {
        let stableURL = stableCacheURL(for: url)
        let digest = SHA256.hash(data: Data(stableURL.absoluteString.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    private func stableCacheURL(for url: URL) -> URL {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url
        }

        components.queryItems = components.queryItems?
            .filter {
                let name = $0.name.lowercased()
                return name != "token" && name != "v"
            }
            .sorted { $0.name < $1.name }

        return components.url ?? url
    }

    private func fileExtension(for url: URL, contentType: String?) -> String {
        let pathExtension = url.pathExtension.lowercased()

        if !pathExtension.isEmpty, pathExtension != "m3u8" {
            return pathExtension
        }

        switch contentType?.lowercased() {
        case "image/jpeg":
            return "jpg"
        case "image/png":
            return "png"
        case "image/webp":
            return "webp"
        case "image/avif":
            return "avif"
        case "video/mp4":
            return "mp4"
        case "video/quicktime":
            return "mov"
        default:
            return "media"
        }
    }

    private func prepareCapacity(forAdditionalBytes bytes: Int) -> Bool {
        pruneIfNeeded(additionalBytes: bytes)

        guard let values = try? rootURL.deletingLastPathComponent().resourceValues(
            forKeys: [.volumeAvailableCapacityKey]
        ), let availableCapacity = values.volumeAvailableCapacity else {
            return true
        }

        return Int64(availableCapacity) - Int64(max(bytes, 0)) >= minimumAvailableCapacity
    }

    private func pruneIfNeeded(additionalBytes: Int = 0) {
        guard let files = try? fileManager.contentsOfDirectory(
            at: rootURL,
            includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey]
        ) else {
            return
        }

        let records = files.compactMap { url -> (url: URL, size: Int, modifiedAt: Date) in
            let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
            return (
                url,
                values?.fileSize ?? 0,
                values?.contentModificationDate ?? .distantPast
            )
        }
        var totalBytes = records.reduce(0) { $0 + $1.size }
        let availableCapacity = try? rootURL.deletingLastPathComponent().resourceValues(
            forKeys: [.volumeAvailableCapacityKey]
        ).volumeAvailableCapacity
        let isUnderStoragePressure = availableCapacity.map {
            Int64($0) - Int64(max(additionalBytes, 0)) < minimumAvailableCapacity
        } ?? false
        let targetBytes = isUnderStoragePressure
            ? min(maxCacheBytes / 2, max(0, maxCacheBytes - additionalBytes))
            : max(0, maxCacheBytes - additionalBytes)

        guard totalBytes > targetBytes else {
            return
        }

        for record in records.sorted(by: { $0.modifiedAt < $1.modifiedAt }) {
            try? fileManager.removeItem(at: record.url)
            totalBytes -= record.size

            if totalBytes <= targetBytes {
                break
            }
        }
    }
}

@MainActor
final class MediaImageCache {
    static let shared = MediaImageCache()

    private struct InFlightLoad {
        let id: UUID
        let task: Task<UIImage?, Never>
    }

    private struct ActivePreheat {
        let id: UUID
        let task: Task<Void, Never>
    }

    private let cache = NSCache<NSURL, UIImage>()
    private var inFlightLoads: [URL: InFlightLoad] = [:]
    private var queuedPreheatURLs = Set<URL>()
    private var preheatQueue: [URL] = []
    private var activePreheats: [URL: ActivePreheat] = [:]
    private let maxDecodedPixelDimension: CGFloat
    private let maxCachedImageCost: Int
    private let maxConcurrentPreheats = 4
    private let maxPreheatWorkItems = 16

    private init() {
        let hasProClassMemory = ProcessInfo.processInfo.physicalMemory >= 6 * 1_024 * 1_024 * 1_024
        maxDecodedPixelDimension = hasProClassMemory ? 3_840 : 2_560
        maxCachedImageCost = hasProClassMemory ? 48 * 1_024 * 1_024 : 24 * 1_024 * 1_024
        cache.countLimit = hasProClassMemory ? 200 : 120
        cache.totalCostLimit = hasProClassMemory ? 256 * 1_024 * 1_024 : 96 * 1_024 * 1_024
    }

    func cachedImage(for url: URL?) -> UIImage? {
        guard let url else {
            return nil
        }
        return cache.object(forKey: url as NSURL)
    }

    func loadImage(for url: URL) async -> UIImage? {
        if let cached = cachedImage(for: url) {
            return cached
        }

        if let inFlightLoad = inFlightLoads[url] {
            return await inFlightLoad.task.value
        }

        let loadID = UUID()
        let loadTask = Task<UIImage?, Never> { @MainActor [weak self] in
            guard let self,
                  let image = await loadUncachedImage(for: url),
                  !Task.isCancelled else {
                return nil
            }

            let cost = image.cacheCost
            if cost > maxCachedImageCost {
                MediaPerformance.mark("image_cache_skip reason=decoded_cost url=\(url.lastPathComponent) bytes=\(cost)")
                return image
            }

            cache.setObject(image, forKey: url as NSURL, cost: cost)
            return image
        }
        inFlightLoads[url] = InFlightLoad(id: loadID, task: loadTask)

        let image = await loadTask.value
        if inFlightLoads[url]?.id == loadID {
            inFlightLoads[url] = nil
        }
        return image
    }

    func preheat(_ urls: [URL], limit: Int = 16) {
        guard limit > 0 else {
            return
        }

        var seen = Set<URL>()
        for url in urls where seen.insert(url).inserted {
            guard seen.count <= limit else {
                break
            }
            guard activePreheats.count + preheatQueue.count < maxPreheatWorkItems else {
                break
            }
            guard cachedImage(for: url) == nil,
                  inFlightLoads[url] == nil,
                  activePreheats[url] == nil,
                  queuedPreheatURLs.insert(url).inserted else {
                continue
            }
            preheatQueue.append(url)
        }

        drainPreheatQueue()
    }

    func removeAll() {
        for preheat in activePreheats.values {
            preheat.task.cancel()
        }
        activePreheats.removeAll()
        queuedPreheatURLs.removeAll()
        preheatQueue.removeAll()

        for load in inFlightLoads.values {
            load.task.cancel()
        }
        inFlightLoads.removeAll()
        cache.removeAllObjects()
    }

    private func loadUncachedImage(for url: URL) async -> UIImage? {
        if url.scheme?.lowercased() == "thumbhash",
           let image = Self.image(fromThumbHashURL: url) {
            return image
        }

        if url.scheme?.lowercased() == "data",
           let separator = url.absoluteString.firstIndex(of: ","),
           url.absoluteString[..<separator].lowercased() == "data:image/jpeg;base64",
           let data = Data(base64Encoded: String(url.absoluteString[url.absoluteString.index(after: separator)...])),
           let image = await ImageDecodePipeline.decode(data: data, maxPixelDimension: maxDecodedPixelDimension) {
            return image
        }

        if url.isFileURL,
           let image = await ImageDecodePipeline.decode(contentsOf: url, maxPixelDimension: maxDecodedPixelDimension) {
            return image
        }

        guard !Task.isCancelled else {
            return nil
        }

        if let fileURL = await MediaFileDiskCache.shared.cachedFileURL(for: url),
           let image = await ImageDecodePipeline.decode(contentsOf: fileURL, maxPixelDimension: maxDecodedPixelDimension) {
            return image
        }

        guard !Task.isCancelled else {
            return nil
        }

        if let fileURL = await MediaFileDiskCache.shared.cache(url: url, kind: .image),
           let image = await ImageDecodePipeline.decode(contentsOf: fileURL, maxPixelDimension: maxDecodedPixelDimension) {
            return image
        }

        guard !Task.isCancelled else {
            return nil
        }

        var request = URLRequest(url: url)
        request.cachePolicy = .returnCacheDataElseLoad
        request.timeoutInterval = 20

        do {
            let (data, response) = try await URLSession.shared.data(for: request)

            if let httpResponse = response as? HTTPURLResponse,
               !(200..<300).contains(httpResponse.statusCode) {
                return nil
            }

            guard let image = await ImageDecodePipeline.decode(data: data, maxPixelDimension: maxDecodedPixelDimension) else {
                return nil
            }

            return image
        } catch {
            return nil
        }
    }

    private static func image(fromThumbHashURL url: URL) -> UIImage? {
        var encoded = String(url.absoluteString.dropFirst("thumbhash:".count))
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while encoded.count.isMultiple(of: 4) == false {
            encoded.append("=")
        }
        guard let hash = Data(base64Encoded: encoded), hash.count >= 5 else {
            return nil
        }
        let (width, height, rgba) = thumbHashToRGBA(hash: hash)
        guard width > 0, height > 0,
              let provider = CGDataProvider(data: rgba as CFData),
              let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
              let image = CGImage(
                width: width,
                height: height,
                bitsPerComponent: 8,
                bitsPerPixel: 32,
                bytesPerRow: width * 4,
                space: colorSpace,
                bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                provider: provider,
                decode: nil,
                shouldInterpolate: true,
                intent: .defaultIntent
              ) else {
            return nil
        }
        return UIImage(cgImage: image)
    }

    private func drainPreheatQueue() {
        while activePreheats.count < maxConcurrentPreheats,
              !preheatQueue.isEmpty {
            let url = preheatQueue.removeFirst()
            queuedPreheatURLs.remove(url)

            guard cachedImage(for: url) == nil else {
                continue
            }

            let preheatID = UUID()
            let preheatTask = Task { @MainActor [weak self] in
                guard let self else {
                    return
                }
                _ = await loadImage(for: url)
                finishPreheat(for: url, id: preheatID)
            }
            activePreheats[url] = ActivePreheat(id: preheatID, task: preheatTask)
        }
    }

    private func finishPreheat(for url: URL, id: UUID) {
        guard activePreheats[url]?.id == id else {
            return
        }
        activePreheats[url] = nil
        drainPreheatQueue()
    }
}

private enum ImageDecodePipeline {
    static func decode(contentsOf fileURL: URL, maxPixelDimension: CGFloat) async -> UIImage? {
        await Task.detached(priority: .utility) {
            autoreleasepool {
                let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
                guard let source = CGImageSourceCreateWithURL(fileURL as CFURL, sourceOptions) else {
                    return nil
                }

                return downsample(source: source, maxPixelDimension: maxPixelDimension)
            }
        }.value
    }

    static func decode(data: Data, maxPixelDimension: CGFloat) async -> UIImage? {
        await Task.detached(priority: .utility) {
            autoreleasepool {
                let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
                guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else {
                    return nil
                }

                return downsample(source: source, maxPixelDimension: maxPixelDimension)
            }
        }.value
    }

    private static func downsample(source: CGImageSource, maxPixelDimension: CGFloat) -> UIImage? {
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: Int(maxPixelDimension)
        ]

        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            return nil
        }

        return UIImage(cgImage: cgImage)
    }
}

private extension UIImage {
    var cacheCost: Int {
        guard let cgImage else {
            return 1
        }

        return max(cgImage.bytesPerRow * cgImage.height, 1)
    }
}

struct CachedAsyncImage<Content: View, Placeholder: View>: View {
    let url: URL?
    private let content: (Image) -> Content
    private let placeholder: () -> Placeholder
    private let retryDelays: [Duration] = [
        .milliseconds(450),
        .seconds(1),
        .seconds(2)
    ]
    @State private var loadedImage: UIImage?
    @State private var loadedImageURL: URL?

    init(
        url: URL?,
        @ViewBuilder content: @escaping (Image) -> Content,
        @ViewBuilder placeholder: @escaping () -> Placeholder
    ) {
        self.url = url
        self.content = content
        self.placeholder = placeholder
    }

    var body: some View {
        Group {
            if let image = MediaImageCache.shared.cachedImage(for: url) {
                content(Image(uiImage: image))
            } else if loadedImageURL == url, let image = loadedImage {
                content(Image(uiImage: image))
            } else {
                placeholder()
            }
        }
        .task(id: url) {
            await loadImageIfNeeded()
        }
    }

    private func loadImageIfNeeded() async {
        guard let url else {
            loadedImage = nil
            loadedImageURL = nil
            return
        }

        if loadedImageURL == url, loadedImage != nil {
            return
        }

        loadedImage = nil
        loadedImageURL = nil

        for attempt in 0...retryDelays.count {
            guard !Task.isCancelled else {
                return
            }

            if let image = await MediaImageCache.shared.loadImage(for: url) {
                guard self.url == url else {
                    return
                }

                loadedImage = image
                loadedImageURL = url
                return
            }

            guard attempt < retryDelays.count else {
                return
            }

            try? await Task.sleep(for: retryDelays[attempt])
        }
    }
}

enum MediaPreheater {
    @MainActor
    static func configureURLCache() {
        _ = NetworkQualityMonitor.shared
        URLCache.shared = URLCache(
            memoryCapacity: 64 * 1024 * 1024,
            diskCapacity: 512 * 1024 * 1024,
            directory: nil
        )
    }

    @MainActor
    static func preheat(feed: MobileFeedResponse) {
        let imageUrls = [
            feed.myStory.latestThumbnailUrl,
            feed.myStory.owner.imageUrl
        ] +
        feed.followingProfiles.map(\.imageUrl) +
        feed.suggestedAccounts.map(\.imageUrl) +
        feed.verticalFollowingStories.map { $0.playbackThumbnailUrl ?? ($0.assetKind == .image ? $0.playbackMediaUrl : nil) } +
        feed.followingStories.map { $0.playbackThumbnailUrl ?? ($0.assetKind == .image ? $0.playbackMediaUrl : nil) } +
        feed.discoverTiles.map { $0.thumbnailUrl ?? $0.imageUrl }

        MediaImageCache.shared.preheat(
            imageUrls.compactMap { $0 },
            limit: NetworkQualityMonitor.shared.imagePreheatLimit
        )

        MediaPerformance.mark("feed_media_preheat thumbnails_only")
    }

    @MainActor
    static func preheat(
        stack: StoryStack,
        around index: Int = 0,
        preheatVideoAssets: Bool = true
    ) {
        let nearbyItems = orderedNearbyStoryItems(in: stack, around: index)
        let imageUrls = nearbyItems.flatMap { item -> [URL] in
            var urls: [URL] = []
            if let thumbnailUrl = item.playbackThumbnailUrl {
                urls.append(thumbnailUrl)
            }
            if item.assetKind == .image {
                urls.append(item.playbackMediaUrl)
            }
            return urls
        }
        MediaImageCache.shared.preheat(
            imageUrls,
            limit: min(12, NetworkQualityMonitor.shared.imagePreheatLimit)
        )

        guard preheatVideoAssets else {
            return
        }

        let videoUrls = nearbyItems
            .filter(\.isPlayableVideo)
            .map(\.playbackMediaUrl)
        let videoLimit = min(NetworkQualityMonitor.shared.persistentVideoPreheatLimit, 4)

        Task {
            await MediaVideoPreheater.shared.preheat(
                videoUrls,
                limit: videoLimit
            )
        }
    }

    private static func orderedNearbyStoryItems(in stack: StoryStack, around index: Int) -> [StoryStackItem] {
        guard stack.items.indices.contains(index) else {
            return []
        }

        var seen = Set<Int>()
        return [index, index + 1, index - 1, index + 2]
            .filter { candidate in
                stack.items.indices.contains(candidate) && seen.insert(candidate).inserted
            }
            .map { stack.items[$0] }
    }
}

actor MediaVideoPreheater {
    static let shared = MediaVideoPreheater()

    private struct ActivePreheat {
        let id: UUID
        let task: Task<Void, Never>
    }

    private var activePreheats: [URL: ActivePreheat] = [:]
    private var recentlyPreheatedAt: [URL: Date] = [:]
    private var isSuspended = false
    private let recentPreheatWindow: TimeInterval = 90

    func suspend() {
        isSuspended = true
        for preheat in activePreheats.values {
            preheat.task.cancel()
        }
        activePreheats.removeAll()
    }

    func resume() {
        isSuspended = false
    }

    func preheat(_ urls: [URL], limit: Int) {
        guard !isSuspended, limit > 0 else {
            return
        }

        let now = Date()
        var seen = Set<URL>()
        let candidates = urls
            .filter { seen.insert($0).inserted }
            .filter { url in
                guard activePreheats[url] == nil else {
                    return false
                }

                if let lastPreheatedAt = recentlyPreheatedAt[url],
                   now.timeIntervalSince(lastPreheatedAt) < recentPreheatWindow {
                    return false
                }

                return true
            }
            .prefix(limit)

        guard !candidates.isEmpty else {
            return
        }

        pruneRecentEntries(now: now)

        for url in candidates {
            let preheatID = UUID()
            let task = Task.detached(priority: .utility) { [weak self] in
                let completed = await Self.preheatOne(url)
                await self?.finish(url, id: preheatID, completed: completed)
            }
            activePreheats[url] = ActivePreheat(id: preheatID, task: task)
        }
    }

    private static func preheatOne(_ url: URL) async -> Bool {
        let preheatInterval = MediaPerformance.beginInterval(
            "video_asset_preheated mode=manifest url=\(url.lastPathComponent)"
        )
        guard !Task.isCancelled else {
            MediaPerformance.cancelInterval(preheatInterval, reason: "cancelled")
            return false
        }
        let playbackURL: URL

        if !isHTTPStreamingPlaylist(url) {
            playbackURL = await MediaFileDiskCache.shared.cachedFileURL(for: url) ?? url
        } else {
            playbackURL = url
        }

        let asset = AVURLAsset(url: playbackURL)

        do {
            _ = try await asset.load(.isPlayable)
            _ = try? await asset.load(.duration)
            guard !Task.isCancelled else {
                MediaPerformance.cancelInterval(preheatInterval, reason: "cancelled")
                return false
            }
            MediaPerformance.endInterval(
                preheatInterval,
                event: "video_asset_preheated url=\(url.lastPathComponent)",
                upload: false
            )
            return true
        } catch {
            MediaPerformance.cancelInterval(
                preheatInterval,
                reason: Task.isCancelled ? "cancelled" : "failed"
            )
            MediaPerformance.mark("video_asset_preheat_failed url=\(url.lastPathComponent)")
            return false
        }
    }

    private func finish(_ url: URL, id: UUID, completed: Bool) {
        guard activePreheats[url]?.id == id else {
            return
        }
        activePreheats[url] = nil
        if completed {
            recentlyPreheatedAt[url] = Date()
        }
    }

    private func pruneRecentEntries(now: Date) {
        recentlyPreheatedAt = recentlyPreheatedAt.filter { _, date in
            now.timeIntervalSince(date) < recentPreheatWindow
        }
    }
}

struct UBEYEPill: View {
    let title: String
    var systemImage: String?
    var tint: Color = .ubeyeRed

    var body: some View {
        HStack(spacing: 6) {
            if let systemImage {
                Image(systemName: systemImage)
            }
            Text(title)
        }
        .font(.caption.weight(.bold))
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .foregroundStyle(tint)
        .background(tint.opacity(0.1), in: Capsule())
    }
}

struct InlineNotice: View {
    let message: String
    var isError = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: isError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .foregroundStyle(isError ? Color.ubeyeRed : Color.green)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Color.ubeyeInk)
            Spacer(minLength: 0)
        }
        .padding(12)
        .background((isError ? Color.ubeyeRed : Color.green).opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke((isError ? Color.ubeyeRed : Color.green).opacity(0.18), lineWidth: 1)
        )
    }
}
