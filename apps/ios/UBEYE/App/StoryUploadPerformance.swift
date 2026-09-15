import Foundation
import Darwin

/// Upload measurements are deliberately separate from playback/download estimates.
struct StoryUploadRateHistory: Codable {
    struct Sample: Codable { var bitsPerSecond: Double; var measuredAt: Date; var count: Int }
    private(set) var samples: [String: Sample] = [:]

    mutating func record(bytes: Int64, seconds: TimeInterval, network: String, now: Date = Date()) {
        guard bytes >= 256 * 1024, seconds >= 0.1, seconds.isFinite else { return }
        let rate = Double(bytes) * 8 / seconds
        guard rate.isFinite, rate >= 32_000, rate <= 2_000_000_000 else { return }
        let prior = samples[network].flatMap { now.timeIntervalSince($0.measuredAt) < 120 ? $0 : nil }
        samples[network] = Sample(bitsPerSecond: prior.map { $0.bitsPerSecond * 0.65 + rate * 0.35 } ?? rate,
                                  measuredAt: now, count: min((prior?.count ?? 0) + 1, 100))
    }

    func estimate(network: String, now: Date = Date()) -> Double? {
        guard let sample = samples[network], sample.count >= 2,
              (0..<120).contains(now.timeIntervalSince(sample.measuredAt)) else { return nil }
        return sample.bitsPerSecond * 0.8
    }
}

@MainActor
final class StoryUploadMeasurements {
    static let shared = StoryUploadMeasurements()
    private let defaults: UserDefaults
    private var history: StoryUploadRateHistory
    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        history = defaults.data(forKey: "story-upload-rates-v1")
            .flatMap { try? JSONDecoder().decode(StoryUploadRateHistory.self, from: $0) } ?? .init()
    }
    func estimate(network: String) -> Double? { history.estimate(network: network) }
    func record(bytes: Int64, seconds: TimeInterval, network: String) {
        history.record(bytes: bytes, seconds: seconds, network: network)
        if let data = try? JSONEncoder().encode(history) { defaults.set(data, forKey: "story-upload-rates-v1") }
    }
}

/// Shared by the foreground retry loop and every background PATCH in its chain.
final class AdaptiveTusChunkController: @unchecked Sendable {
    private let lock = NSLock()
    private let maximum: Int64
    private let enabled: Bool
    private var current: Int64
    private var permitsTailMerge = true
    private var smoothedBytesPerSecond: Double?
    let onAccepted: (@Sendable (Int64, TimeInterval) -> Void)?

    init(maximum: Int64, initial: Int64, enabled: Bool,
         onAccepted: (@Sendable (Int64, TimeInterval) -> Void)? = nil) {
        self.maximum = TusUploadChunkPolicy.limit(maximum)
        self.current = min(self.maximum, TusUploadChunkPolicy.limit(initial))
        self.enabled = enabled
        self.onAccepted = onAccepted
    }
    var limit: Int64 { lock.lock(); defer { lock.unlock() }; return current }
    func nextLength(remaining: Int64) -> Int64 {
        lock.lock(); defer { lock.unlock() }
        let length = min(current, remaining)
        // Avoid a separate PATCH and OS scheduling cycle for a tiny final tail.
        // Keep constrained-path/provider caps and reduced retry chunks intact.
        if enabled, permitsTailMerge, current >= 5 * 1024 * 1024,
           remaining <= maximum, remaining <= 8 * 1024 * 1024,
           remaining > length, remaining - length <= 512 * 1024 {
            return remaining
        }
        return length
    }
    func accepted(bytes: Int64, seconds: TimeInterval) {
        guard bytes > 0, seconds.isFinite, seconds >= 0.1 else { return }
        lock.lock()
        permitsTailMerge = true
        let rate = Double(bytes) / seconds
        smoothedBytesPerSecond = smoothedBytesPerSecond.map { $0 * 0.5 + rate * 0.5 } ?? rate
        if enabled {
            let target = min(Double(maximum), max(Double(TusUploadChunkPolicy.minimum), smoothedBytesPerSecond! * 8))
            current = min(maximum, TusUploadChunkPolicy.limit(Int64(min(target, Double(current) * 2))))
        }
        lock.unlock()
        onAccepted?(bytes, seconds)
    }
    func failed() {
        lock.lock(); defer { lock.unlock() }
        permitsTailMerge = false
        if enabled { current = TusUploadChunkPolicy.limit(current / 2); smoothedBytesPerSecond = nil }
    }
}

enum StoryUploadInitialChunkPolicy {
    static func bytes(maximum: Int64, measuredBitsPerSecond: Double?) -> Int64 {
        let minimum = Int64(5 * 1024 * 1024)
        guard let rate = measuredBitsPerSecond, rate.isFinite, rate > 0 else {
            return min(TusUploadChunkPolicy.limit(maximum), minimum)
        }
        // Match the ongoing controller's eight-second target from the first
        // PATCH when fresh measurements exist; unknown paths still start small.
        let target = min(Double(maximum), max(Double(minimum), rate / 8 * 8))
        return min(TusUploadChunkPolicy.limit(maximum), TusUploadChunkPolicy.limit(Int64(target)))
    }
}

struct StoryAdaptiveEncodingContext {
    let enabled: Bool
    let uploadBitsPerSecond: Double?
    let network: String
    static let disabled = Self(enabled: false, uploadBitsPerSecond: nil, network: "unknown")

    @MainActor static func current() -> Self {
        let network = NetworkQualityMonitor.shared.telemetryNetworkClass
        return .init(enabled: MediaControlConfig.shared.adaptiveUploadEncodingEnabled &&
                     UBEYEResourceMonitor.shared.mode == .standard && NetworkQualityMonitor.shared.isConnected,
                     uploadBitsPerSecond: StoryUploadMeasurements.shared.estimate(network: network), network: network)
    }
    // A network label is not an uplink measurement. Unknown or stale paths
    // preserve the original instead of speculating on a costly export.
    private var encodingDecisionRate: Double? { uploadBitsPerSecond }
    static let preparationBudgetSeconds: TimeInterval = 6
    func shouldTry(bytes: Int64, durationMs: Int?) -> Bool {
        guard enabled, bytes >= 16 * 1024 * 1024, let rate = encodingDecisionRate,
              rate.isFinite, rate > 0, let durationMs, durationMs > 0 else { return false }
        let targetBytes = Double(durationMs) / 1000 * Double(StoryVideoUploadNormalizer.adaptiveTargetBitsPerSecond) / 8
        return Double(bytes) * 8 / rate >= 15 && targetBytes <= Double(bytes) * 0.7 &&
            (Double(bytes) - targetBytes) * 8 / rate >= Self.preparationBudgetSeconds * 2
    }
    func isWorthKeeping(sourceBytes: Int64, candidateBytes: Int64, exportSeconds: TimeInterval) -> Bool {
        guard let rate = encodingDecisionRate, rate.isFinite, rate > 0,
              candidateBytes > 0, exportSeconds.isFinite, exportSeconds >= 0 else { return false }
        let saving = Double(sourceBytes - candidateBytes) * 8 / rate
        return Double(candidateBytes) <= Double(sourceBytes) * 0.75 && saving >= max(3, exportSeconds * 1.5)
    }
}

enum StoryUploadRecoveryPolicy {
    static func isTransient(_ error: Error) -> Bool {
        guard let error = error as? URLError else { return error is CancellationError }
        return [.timedOut, .cannotFindHost, .cannotConnectToHost, .networkConnectionLost,
                .dnsLookupFailed, .notConnectedToInternet, .internationalRoamingOff,
                .dataNotAllowed, .cancelled].contains(error.code)
    }
    static func delay(attempt: Int) -> TimeInterval { min(120, pow(2, Double(min(max(attempt, 1), 7)))) }
}

/// Resident memory samples are useful for cohort comparisons; they are not peaks.
enum StoryUploadMemoryProbe {
    static var residentBytes: UInt64? {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size)
        let result = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }
        return result == KERN_SUCCESS ? info.resident_size : nil
    }
}

/// Bound network progress delivery before it creates main-actor tasks. First and
/// final values are immediate; phase changes are handled separately by the store.
struct StoryUploadProgressThrottle {
    private var lastEmittedAt: TimeInterval?
    private var lastProgress: Double?
    mutating func shouldEmit(_ progress: Double, now: TimeInterval) -> Bool {
        guard progress.isFinite, now.isFinite else { return false }
        let value = min(max(progress, 0), 1)
        guard value != lastProgress else { return false }
        guard lastEmittedAt == nil || value == 1 || now - lastEmittedAt! >= 0.2 else { return false }
        lastEmittedAt = now
        lastProgress = value
        return true
    }
}
