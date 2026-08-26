import AVFoundation
import Foundation

/// A deliberately small, opportunistic cache for the most likely next HLS story.
///
/// AVFoundation owns the downloaded package location. We persist only the exact
/// package URLs returned by its delegate and apply both an expiration policy and
/// an application-level count/byte bound. Downloads are Wi-Fi-only and
/// discretionary; active playback never waits for this cache.
actor HLSOfflineCache {
    static let shared = HLSOfflineCache()
    nonisolated static let sessionIdentifier = "com.griffinaste.ubeye.hls-offline-cache.v1"

    struct Policy: Equatable {
        static let defaultMaximumAssets = 2
        static let defaultMaximumBytes: Int64 = 128 * 1024 * 1024
        static let defaultExpiration: TimeInterval = 24 * 60 * 60

        let maximumAssets: Int
        let maximumBytes: Int64
        let expiration: TimeInterval

        init(
            maximumAssets: Int = defaultMaximumAssets,
            maximumBytes: Int64 = defaultMaximumBytes,
            expiration: TimeInterval = defaultExpiration
        ) {
            self.maximumAssets = max(0, maximumAssets)
            self.maximumBytes = max(0, maximumBytes)
            self.expiration = max(0, expiration)
        }
    }

    private struct Entry: Codable, Equatable {
        let identity: String
        let remoteURL: URL
        let localURL: URL
        let completedAt: Date
        var lastAccessedAt: Date
    }

    private struct DownloadDescriptor: Codable {
        let identity: String
        let remoteURL: URL
        let maximumAssets: Int
        let maximumBytes: Int64
        let expiration: TimeInterval

        var taskDescription: String? {
            guard let data = try? JSONEncoder().encode(self) else {
                return nil
            }
            return data.base64EncodedString()
        }

        init(identity: String, remoteURL: URL, policy: Policy) {
            self.identity = identity
            self.remoteURL = remoteURL
            maximumAssets = policy.maximumAssets
            maximumBytes = policy.maximumBytes
            expiration = policy.expiration
        }

        init?(taskDescription: String?) {
            guard let taskDescription,
                  let data = Data(base64Encoded: taskDescription),
                  let decoded = try? JSONDecoder().decode(Self.self, from: data) else {
                return nil
            }
            self = decoded
        }
    }

    private let defaultsKey = "ubeye.hls-offline-cache.entries.v1"
    private let maximumEligibleDuration: TimeInterval = 30
    private let minimumAvailableCapacity: Int64 = 512 * 1024 * 1024
    private let fileManager = FileManager.default
    private let delegate = HLSOfflineCacheDelegate()
    private var entries: [String: Entry] = [:]
    private var activeIdentities = Set<String>()
    private var pendingEntries: [String: Entry] = [:]
    private var successfulIdentities = Set<String>()
    private var failedIdentities = Set<String>()
    private var backgroundCompletionHandler: (() -> Void)?
    private var didRestoreSessionTasks = false

    private lazy var session: AVAssetDownloadURLSession = {
        let configuration = URLSessionConfiguration.background(
            withIdentifier: Self.sessionIdentifier
        )
        configuration.isDiscretionary = true
        configuration.allowsCellularAccess = false
        configuration.allowsConstrainedNetworkAccess = false
        configuration.allowsExpensiveNetworkAccess = false
        configuration.httpMaximumConnectionsPerHost = 1
        delegate.owner = self
        return AVAssetDownloadURLSession(
            configuration: configuration,
            assetDownloadDelegate: delegate,
            delegateQueue: nil
        )
    }()

    private init() {
        entries = Self.restoreEntries(defaultsKey: defaultsKey)
    }

    func cachedPlaybackURL(
        for source: StoryVideoPlaybackSource,
        policy: Policy = Policy()
    ) -> URL? {
        prune(policy: policy)
        guard var entry = entries[source.identity],
              Self.representsSameRemoteMedia(entry.remoteURL, source.url),
              isSafePackageURL(entry.localURL),
              fileManager.fileExists(atPath: entry.localURL.path) else {
            if let removed = entries.removeValue(forKey: source.identity) {
                removePackageIfPresent(removed.localURL)
                persistEntries()
            }
            return nil
        }

        entry.lastAccessedAt = Date()
        entries[source.identity] = entry
        persistEntries()
        MediaPerformance.mark(
            "hls_asset_package_hit url=\(source.url.lastPathComponent)"
        )
        return entry.localURL
    }

    func preheat(
        _ sources: [StoryVideoPlaybackSource],
        limit: Int,
        policy: Policy = Policy()
    ) async {
        guard limit > 0, policy.maximumAssets > 0, hasStorageHeadroom else {
            return
        }

        await restoreActiveSessionTasksIfNeeded()
        prune(policy: policy)

        var seen = Set<String>()
        let candidates = sources
            .filter {
                Self.isEligibleForOfflineCache(
                    $0,
                    maximumDuration: maximumEligibleDuration
                )
            }
            .filter { seen.insert($0.identity).inserted }
            .filter { entries[$0.identity] == nil && !activeIdentities.contains($0.identity) }
            .prefix(min(limit, 1))

        for source in candidates {
            let offlinePeakBitRate = await MediaPlaybackQuality.offlineStreamingPeakBitRate
            let asset = AVURLAsset(url: source.url)
            let configuration = AVAssetDownloadConfiguration(
                asset: asset,
                title: "UBEYE Story"
            )
            let bitratePredicate = NSPredicate(
                format: "peakBitRate <= %lf",
                offlinePeakBitRate
            )
            configuration.primaryContentConfiguration.variantQualifiers = [
                AVAssetVariantQualifier(predicate: bitratePredicate),
            ]
            configuration.auxiliaryContentConfigurations = []

            let task = session.makeAssetDownloadTask(
                downloadConfiguration: configuration
            )
            let descriptor = DownloadDescriptor(
                identity: source.identity,
                remoteURL: source.url,
                policy: policy
            )
            task.taskDescription = descriptor.taskDescription
            successfulIdentities.remove(source.identity)
            failedIdentities.remove(source.identity)
            activeIdentities.insert(source.identity)
            MediaPerformance.mark(
                "hls_asset_download_start url=\(source.url.lastPathComponent)"
            )
            task.resume()
        }
    }

    func removeAll() async {
        let tasks = await session.allTasks
        tasks.forEach { $0.cancel() }
        activeIdentities.removeAll()
        successfulIdentities.removeAll()
        failedIdentities.removeAll()

        let cachedEntries = Array(entries.values)
        let pendingPackages = pendingEntries.values.map(\.localURL)
        entries.removeAll()
        pendingEntries.removeAll()
        persistEntries()
        cachedEntries.forEach { removePackageIfPresent($0.localURL) }
        pendingPackages.forEach(removePackageIfPresent)
    }

    func suspendSpeculativeDownloads() async {
        let tasks = await session.allTasks
        tasks.forEach { $0.cancel() }
        activeIdentities.removeAll()
    }

    func attachSystemCompletionHandler(_ completionHandler: @escaping () -> Void) {
        backgroundCompletionHandler = completionHandler
        _ = session
    }

    fileprivate func didFinishDownloading(
        taskDescription: String?,
        location: URL
    ) async {
        guard let descriptor = DownloadDescriptor(taskDescription: taskDescription) else {
            removePackageIfPresent(location)
            return
        }

        let packageAsset = AVURLAsset(url: location)
        let isPlayable = (try? await packageAsset.load(.isPlayable)) == true
        guard isPlayable,
              failedIdentities.remove(descriptor.identity) == nil else {
            activeIdentities.remove(descriptor.identity)
            successfulIdentities.remove(descriptor.identity)
            removePackageIfPresent(location)
            MediaPerformance.mark(
                "hls_asset_download_failed reason=invalid_package url=\(descriptor.remoteURL.lastPathComponent)"
            )
            return
        }

        let now = Date()
        pendingEntries[descriptor.identity] = Entry(
            identity: descriptor.identity,
            remoteURL: descriptor.remoteURL,
            localURL: location,
            completedAt: now,
            lastAccessedAt: now
        )
        if successfulIdentities.remove(descriptor.identity) != nil {
            commitSuccessfulDownload(descriptor: descriptor)
        }
    }

    fileprivate func didComplete(taskDescription: String?, error: Error?) {
        guard let descriptor = DownloadDescriptor(taskDescription: taskDescription) else {
            return
        }
        activeIdentities.remove(descriptor.identity)
        let errorCode = (error as NSError?)?.code
        if error == nil {
            failedIdentities.remove(descriptor.identity)
            if pendingEntries[descriptor.identity] != nil {
                commitSuccessfulDownload(descriptor: descriptor)
            } else {
                successfulIdentities.insert(descriptor.identity)
            }
            return
        }

        successfulIdentities.remove(descriptor.identity)
        failedIdentities.insert(descriptor.identity)
        if let pending = pendingEntries.removeValue(forKey: descriptor.identity) {
            removePackageIfPresent(pending.localURL)
        }
        if let invalid = entries[descriptor.identity],
           Self.representsSameRemoteMedia(invalid.remoteURL, descriptor.remoteURL) {
            entries.removeValue(forKey: descriptor.identity)
            removePackageIfPresent(invalid.localURL)
            persistEntries()
        }
        if errorCode != NSURLErrorCancelled {
            MediaPerformance.mark(
                "hls_asset_download_failed url=\(descriptor.remoteURL.lastPathComponent)"
            )
        }
    }

    private func commitSuccessfulDownload(descriptor: DownloadDescriptor) {
        guard let entry = pendingEntries.removeValue(forKey: descriptor.identity) else {
            return
        }

        let policy = Policy(
            maximumAssets: descriptor.maximumAssets,
            maximumBytes: descriptor.maximumBytes,
            expiration: descriptor.expiration
        )
        entries[descriptor.identity] = entry
        activeIdentities.remove(descriptor.identity)
        applyStoragePolicy(to: entry.localURL, expiration: policy.expiration)
        prune(policy: policy)
        persistEntries()
        MediaPerformance.mark(
            "hls_asset_download_finished url=\(descriptor.remoteURL.lastPathComponent)"
        )
    }

    fileprivate func didFinishBackgroundEvents() {
        let completion = backgroundCompletionHandler
        backgroundCompletionHandler = nil
        DispatchQueue.main.async {
            completion?()
        }
    }

    private var hasStorageHeadroom: Bool {
        let cachesURL = fileManager.urls(
            for: .cachesDirectory,
            in: .userDomainMask
        )[0]
        let values = try? cachesURL.resourceValues(
            forKeys: [.volumeAvailableCapacityForImportantUsageKey]
        )
        return (values?.volumeAvailableCapacityForImportantUsage ?? 0) >= minimumAvailableCapacity
    }

    nonisolated static func isEligibleForOfflineCache(
        _ source: StoryVideoPlaybackSource,
        maximumDuration: TimeInterval = 30
    ) -> Bool {
        guard isHTTPStreamingPlaylist(source.url),
              let duration = source.durationSeconds else {
            return false
        }
        return duration.isFinite && duration > 0 && duration <= maximumDuration
    }

    nonisolated static func representsSameRemoteMedia(_ lhs: URL, _ rhs: URL) -> Bool {
        StoryVideoPlaybackPool.canonicalURL(for: lhs) ==
            StoryVideoPlaybackPool.canonicalURL(for: rhs)
    }

    private func restoreActiveSessionTasksIfNeeded() async {
        guard !didRestoreSessionTasks else {
            return
        }
        didRestoreSessionTasks = true
        let tasks = await session.allTasks
        for task in tasks {
            if let descriptor = DownloadDescriptor(
                taskDescription: task.taskDescription
            ) {
                activeIdentities.insert(descriptor.identity)
            }
        }
    }

    private func prune(policy: Policy) {
        let now = Date()
        var retained = entries.values.filter { entry in
            let exists = fileManager.fileExists(atPath: entry.localURL.path)
            let isFresh = now.timeIntervalSince(entry.completedAt) <= policy.expiration
            if !exists || !isFresh {
                if exists {
                    removePackageIfPresent(entry.localURL)
                }
                return false
            }
            return true
        }
        retained.sort { $0.lastAccessedAt > $1.lastAccessedAt }

        var retainedBytes: Int64 = 0
        var bounded: [Entry] = []
        for entry in retained {
            let bytes = packageByteSize(entry.localURL)
            let fitsCount = bounded.count < policy.maximumAssets
            let fitsBytes = retainedBytes + bytes <= policy.maximumBytes
            if fitsCount && fitsBytes {
                bounded.append(entry)
                retainedBytes += bytes
            } else {
                removePackageIfPresent(entry.localURL)
            }
        }

        let nextEntries = Dictionary(
            uniqueKeysWithValues: bounded.map { ($0.identity, $0) }
        )
        if nextEntries != entries {
            entries = nextEntries
            persistEntries()
        }
    }

    private func applyStoragePolicy(to url: URL, expiration: TimeInterval) {
        let policy = AVMutableAssetDownloadStorageManagementPolicy()
        policy.priority = .default
        policy.expirationDate = Date().addingTimeInterval(expiration)
        AVAssetDownloadStorageManager.shared().setStorageManagementPolicy(
            policy,
            for: url
        )
    }

    private func packageByteSize(_ url: URL) -> Int64 {
        guard let enumerator = fileManager.enumerator(
            at: url,
            includingPropertiesForKeys: [.fileAllocatedSizeKey],
            options: [.skipsHiddenFiles]
        ) else {
            return Int64(
                (try? url.resourceValues(forKeys: [.fileAllocatedSizeKey]))?.fileAllocatedSize ?? 0
            )
        }

        var bytes: Int64 = 0
        for case let fileURL as URL in enumerator {
            bytes += Int64(
                (try? fileURL.resourceValues(forKeys: [.fileAllocatedSizeKey]))?.fileAllocatedSize ?? 0
            )
        }
        return bytes
    }

    private func removePackageIfPresent(_ url: URL) {
        guard isSafePackageURL(url),
              fileManager.fileExists(atPath: url.path) else {
            return
        }
        try? fileManager.removeItem(at: url)
    }

    private func isSafePackageURL(_ url: URL) -> Bool {
        let standardized = url.standardizedFileURL
        return standardized.isFileURL &&
            standardized.pathExtension.lowercased() == "movpkg" &&
            standardized.pathComponents.count > 5
    }

    private func persistEntries() {
        let values = Array(entries.values)
        guard let data = try? JSONEncoder().encode(values) else {
            return
        }
        UserDefaults.standard.set(data, forKey: defaultsKey)
    }

    private static func restoreEntries(defaultsKey: String) -> [String: Entry] {
        guard let data = UserDefaults.standard.data(forKey: defaultsKey),
              let values = try? JSONDecoder().decode([Entry].self, from: data) else {
            return [:]
        }
        return Dictionary(uniqueKeysWithValues: values.map { ($0.identity, $0) })
    }
}

private final class HLSOfflineCacheDelegate: NSObject, AVAssetDownloadDelegate, @unchecked Sendable {
    weak var owner: HLSOfflineCache?

    func urlSession(
        _ session: URLSession,
        assetDownloadTask: AVAssetDownloadTask,
        didFinishDownloadingTo location: URL
    ) {
        let description = assetDownloadTask.taskDescription
        Task {
            await owner?.didFinishDownloading(
                taskDescription: description,
                location: location
            )
        }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        let description = task.taskDescription
        Task {
            await owner?.didComplete(
                taskDescription: description,
                error: error
            )
        }
    }

    func urlSessionDidFinishEvents(
        forBackgroundURLSession session: URLSession
    ) {
        Task {
            await owner?.didFinishBackgroundEvents()
        }
    }
}
