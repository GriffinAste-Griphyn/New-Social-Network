import CryptoKit
import Foundation
import ImageIO
import UIKit

enum TusUploadChunkPolicy {
    static let minimum: Int64 = 5_242_880
    static let maximum: Int64 = 209_715_200
    static let alignment: Int64 = 262_144

    static func limit(_ requested: Int64) -> Int64 {
        let bounded = min(maximum, max(minimum, requested))
        return bounded - bounded % alignment
    }
}

final class TusUploadCancellation: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false
    private var task: URLSessionTask?
    var isCancelled: Bool { lock.lock(); defer { lock.unlock() }; return cancelled }
    func register(_ task: URLSessionTask) {
        lock.lock()
        self.task = task
        let shouldCancel = cancelled
        lock.unlock()
        if shouldCancel { task.cancel() }
    }
    func cancel() {
        lock.lock()
        cancelled = true
        let active = task
        lock.unlock()
        active?.cancel()
    }
}

/// Stored by URLSession with the task, independent of Swift continuations. The
/// signed upload URL is compared exactly and is never included in telemetry.
struct StoryTransferIdentity: Codable, Equatable {
    let version: Int
    let attemptID: String
    let uploadURL: URL
    let bodyURL: URL

    init(attemptID: String, uploadURL: URL, bodyURL: URL) {
        version = 1; self.attemptID = attemptID; self.uploadURL = uploadURL; self.bodyURL = bodyURL
    }
    var encoded: String? { (try? JSONEncoder().encode(self)).flatMap { String(data: $0, encoding: .utf8) } }
    static func decode(_ value: String?) -> Self? {
        guard let data = value?.data(using: .utf8), let result = try? JSONDecoder().decode(Self.self, from: data),
              result.version == 1, !result.attemptID.isEmpty, result.bodyURL.isFileURL,
              result.uploadURL.scheme == "https" else { return nil }
        return result
    }
    func matches(attemptID: String?, uploadURL: URL) -> Bool {
        self.attemptID == attemptID && self.uploadURL == uploadURL
    }
}

final class BackgroundTusUploadTransport: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
    static let sessionIdentifier = "com.griffinaste.ubeye.story-upload.tus"
    static let shared = BackgroundTusUploadTransport()
    static let uploadTimeout: TimeInterval = 6 * 60 * 60

    struct ChunkChain {
        let sourceURL: URL
        let uploadURL: URL
        let totalBytes: Int64
        var offset: Int64
        var length: Int64
        let limit: Int64
        let bufferBytes: Int
        var controller: AdaptiveTusChunkController? = nil
        var attemptId: String? = nil
        var unmeteredOnly = false
    }

    private struct PendingUpload {
        var data = Data()
        var transferStarted = ProcessInfo.processInfo.systemUptime
        var firstBytesObserved = false
        var progressThrottle = StoryUploadProgressThrottle()
        let bodyFileURL: URL
        let onProgress: ((Double) -> Void)?
        let onFirstBytesSent: (@Sendable () -> Void)?
        let continuation: CheckedContinuation<(Data, URLResponse), Error>
        let cancellation: TusUploadCancellation
        let chain: ChunkChain?
    }

    private let lock = NSLock()
    private var pendingUploads: [Int: PendingUpload] = [:]
    private var systemCompletionHandler: (() -> Void)?
    private var continuationWorkCount = 0
    private var finishedSystemEvents = false
    private let configurationOverride: URLSessionConfiguration?
    private lazy var session: URLSession = {
        let configuration = configurationOverride ?? URLSessionConfiguration.background(
            withIdentifier: Self.sessionIdentifier
        )
        configuration.isDiscretionary = false
        configuration.sessionSendsLaunchEvents = true
        configuration.waitsForConnectivity = true
        configuration.timeoutIntervalForRequest = Self.uploadTimeout
        configuration.timeoutIntervalForResource = Self.uploadTimeout
        return URLSession(
            configuration: configuration,
            delegate: self,
            delegateQueue: nil
        )
    }()

    init(configuration: URLSessionConfiguration? = nil) {
        configurationOverride = configuration
        super.init()
        if configuration == nil { removeAbandonedChunkFiles() }
    }

    func upload(
        request: URLRequest,
        bodyFileURL: URL,
        onProgress: ((Double) -> Void)? = nil,
        onFirstBytesSent: (@Sendable () -> Void)? = nil,
        chain: ChunkChain? = nil
    ) async throws -> (Data, URLResponse) {
        let cancellation = TusUploadCancellation()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                enqueue(request: request, pending: PendingUpload(
                    bodyFileURL: bodyFileURL, onProgress: onProgress,
                    onFirstBytesSent: onFirstBytesSent,
                    continuation: continuation, cancellation: cancellation, chain: chain
                ))
            }
        } onCancel: { cancellation.cancel() }
    }

    private func enqueue(request: URLRequest, pending: PendingUpload) {
        let task = session.uploadTask(with: request, fromFile: pending.bodyFileURL)
        if let chain = pending.chain, let attempt = chain.attemptId {
            task.taskDescription = StoryTransferIdentity(attemptID: attempt, uploadURL: chain.uploadURL,
                bodyURL: pending.bodyFileURL).encoded
        } else { task.taskDescription = pending.bodyFileURL.path }
        lock.lock()
        pendingUploads[task.taskIdentifier] = pending
        lock.unlock()
        pending.cancellation.register(task)
        task.resume()
    }

    func prepareForRecovery() async {
        let trackedTaskIds: Set<Int> = {
            lock.lock()
            defer { lock.unlock() }
            return Set(pendingUploads.keys)
        }()
        let orphanedTasks = await allTasks().filter {
            !trackedTaskIds.contains($0.taskIdentifier) && StoryTransferIdentity.decode($0.taskDescription) == nil
        }
        guard !orphanedTasks.isEmpty else {
            return
        }

        orphanedTasks.forEach { $0.cancel() }
        for _ in 0..<50 {
            let remainingIds = Set(await allTasks().map(\.taskIdentifier))
            if orphanedTasks.allSatisfy({ !remainingIds.contains($0.taskIdentifier) }) {
                return
            }
            try? await Task.sleep(for: .milliseconds(100))
        }
    }

    func attachSystemCompletionHandler(_ completionHandler: @escaping () -> Void) {
        lock.lock()
        systemCompletionHandler = completionHandler
        finishedSystemEvents = false
        lock.unlock()
        // Recreate the session and let identifiable system-owned transfers finish.
        // The authenticated durable queue will reconcile their server offsets before
        // issuing another PATCH. Legacy tasks retain the old recovery path.
        _ = session
    }

    func waitForRestoredTransfer(attemptID: String?, uploadURL: URL) async throws {
        let started = Date()
        var observed = false
        while true {
            try Task.checkCancellation()
            let tracked: Set<Int> = { lock.lock(); defer { lock.unlock() }; return Set(pendingUploads.keys) }()
            let tasks = await allTasks().filter {
                !tracked.contains($0.taskIdentifier) &&
                StoryTransferIdentity.decode($0.taskDescription)?.matches(attemptID: attemptID, uploadURL: uploadURL) == true
            }
            guard !tasks.isEmpty else { break }
            observed = true
            // Do not restart this upload while its previous PATCH is still owned by
            // the system. Loss of connectivity is handled by URLSession's timeout.
            try await Task.sleep(for: .milliseconds(250))
        }
        if observed { MediaPerformance.measure("background_upload_resume result=reattached", since: started) }
    }

    func cancelTransfer(attemptID: String) async {
        for task in await allTasks() where StoryTransferIdentity.decode(task.taskDescription)?.attemptID == attemptID {
            task.cancel()
        }
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive data: Data
    ) {
        lock.lock()
        pendingUploads[dataTask.taskIdentifier]?.data.append(data)
        lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
        lock.lock()
        let chain = pendingUploads[task.taskIdentifier]?.chain
        lock.unlock()
        guard let chain, let attemptId = chain.attemptId else { return }
        // URLSession transaction dates distinguish connection setup, request
        // transmission and response wait. Progress callbacks are not wire timing.
        for transaction in metrics.transactionMetrics {
            let phases: [(String, Date?, Date?)] = [
                ("chunk_dns", transaction.domainLookupStartDate, transaction.domainLookupEndDate),
                ("chunk_connection", transaction.connectStartDate, transaction.connectEndDate),
                ("chunk_tls", transaction.secureConnectionStartDate, transaction.secureConnectionEndDate),
                ("chunk_request", transaction.requestStartDate, transaction.requestEndDate),
                ("chunk_response_wait", transaction.requestEndDate, transaction.responseStartDate)
            ]
            for (phase, start, end) in phases {
                guard let start, let end, end >= start else { continue }
                MediaPerformance.measure("video_upload_phase attempt=\(attemptId) phase=\(phase) bytes=\(chain.length) transport=background reused=\(transaction.isReusedConnection)",
                    since: Date().addingTimeInterval(-end.timeIntervalSince(start)))
            }
        }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didSendBodyData bytesSent: Int64,
        totalBytesSent: Int64,
        totalBytesExpectedToSend: Int64
    ) {
        guard totalBytesExpectedToSend > 0 else {
            return
        }
        lock.lock()
        let pending = pendingUploads[task.taskIdentifier]
        let firstBytes = totalBytesSent > 0 && pending?.firstBytesObserved == false
        if firstBytes { pendingUploads[task.taskIdentifier]?.firstBytesObserved = true }
        let fraction = min(max(Double(totalBytesSent) / Double(totalBytesExpectedToSend), 0), 1)
        let progress = pending?.chain.map { (Double($0.offset) + Double($0.length) * fraction) / Double($0.totalBytes) } ?? fraction
        let emitProgress = pendingUploads[task.taskIdentifier]?.progressThrottle.shouldEmit(progress, now: ProcessInfo.processInfo.systemUptime) ?? false
        lock.unlock()
        if firstBytes, let pending, let attemptId = pending.chain?.attemptId {
            MediaPerformance.measure("video_upload_phase attempt=\(attemptId) phase=chunk_first_bytes bytes=\(pending.chain?.length ?? 0)",
                since: Date().addingTimeInterval(-(ProcessInfo.processInfo.systemUptime - pending.transferStarted)))
        }
        if firstBytes { pending?.onFirstBytesSent?() }
        if emitProgress { pending?.onProgress?(progress) }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        lock.lock()
        let pending = pendingUploads.removeValue(forKey: task.taskIdentifier)
        lock.unlock()

        let restored = StoryTransferIdentity.decode(task.taskDescription)
        let legacyBody = task.taskDescription.flatMap { $0.hasPrefix("/") ? URL(fileURLWithPath: $0) : nil }
        let bodyFileURL = pending?.bodyFileURL ?? restored?.bodyURL ?? legacyBody
        if let bodyFileURL {
            try? FileManager.default.removeItem(at: bodyFileURL)
        }

        guard let pending else {
            return
        }

        if let chain = pending.chain, !pending.cancellation.isCancelled {
            if error == nil, let response = task.response as? HTTPURLResponse,
               200..<300 ~= response.statusCode,
               Int64(response.value(forHTTPHeaderField: "Upload-Offset") ?? "") == chain.offset + chain.length {
                chain.controller?.accepted(bytes: chain.length, seconds: ProcessInfo.processInfo.systemUptime - pending.transferStarted)
            } else { chain.controller?.failed() }
        }
        if pending.cancellation.isCancelled {
            pending.continuation.resume(throwing: CancellationError())
        } else if let error {
            pending.continuation.resume(throwing: error)
        } else if var chain = pending.chain,
                  let response = task.response as? HTTPURLResponse,
                  200..<300 ~= response.statusCode,
                  let nextOffset = Int64(response.value(forHTTPHeaderField: "Upload-Offset") ?? ""),
                  nextOffset == chain.offset + chain.length,
                  nextOffset < chain.totalBytes {
            chain.offset = nextOffset
            chain.length = chain.controller?.nextLength(remaining: chain.totalBytes - nextOffset)
                ?? min(chain.limit, chain.totalBytes - nextOffset)
            lock.lock()
            continuationWorkCount += 1
            lock.unlock()
            Task {
                do {
                    guard !pending.cancellation.isCancelled else { throw CancellationError() }
                    let stagingStarted = Date()
                    let body = try await APIClient.stageTusUploadBody(
                        fileURL: chain.sourceURL, uploadURL: chain.uploadURL,
                        offset: chain.offset, length: chain.length, bufferBytes: chain.bufferBytes
                    )
                    if let attemptId = chain.attemptId { MediaPerformance.measure("video_upload_phase attempt=\(attemptId) phase=chunk_stage bytes=\(chain.length)", since: stagingStarted) }
                    guard !pending.cancellation.isCancelled else {
                        try? FileManager.default.removeItem(at: body)
                        throw CancellationError()
                    }
                    var request = URLRequest(url: chain.uploadURL)
                    request.httpMethod = "PATCH"
                    request.allowsCellularAccess = !chain.unmeteredOnly
                    request.allowsExpensiveNetworkAccess = !chain.unmeteredOnly
                    request.allowsConstrainedNetworkAccess = !chain.unmeteredOnly
                    request.timeoutInterval = Self.uploadTimeout
                    request.setValue("1.0.0", forHTTPHeaderField: "Tus-Resumable")
                    request.setValue(String(chain.offset), forHTTPHeaderField: "Upload-Offset")
                    request.setValue("application/offset+octet-stream", forHTTPHeaderField: "Content-Type")
                    self.enqueue(request: request, pending: PendingUpload(
                        bodyFileURL: body, onProgress: pending.onProgress,
                        onFirstBytesSent: pending.onFirstBytesSent,
                        continuation: pending.continuation, cancellation: pending.cancellation, chain: chain
                    ))
                } catch { pending.continuation.resume(throwing: error) }
                self.finishContinuationWork()
            }
        } else if let response = task.response {
            pending.continuation.resume(returning: (pending.data, response))
        } else {
            pending.continuation.resume(throwing: APIClientError.invalidResponse)
        }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        lock.lock()
        finishedSystemEvents = true
        lock.unlock()
        finishSystemEventsIfReady()
    }

    private func finishContinuationWork() {
        lock.lock()
        continuationWorkCount -= 1
        lock.unlock()
        finishSystemEventsIfReady()
    }

    private func finishSystemEventsIfReady() {
        lock.lock()
        let completionHandler: (() -> Void)?
        if finishedSystemEvents && continuationWorkCount == 0 {
            completionHandler = systemCompletionHandler
            systemCompletionHandler = nil
        } else { completionHandler = nil }
        lock.unlock()
        if let completionHandler { DispatchQueue.main.async { completionHandler() } }
    }

    private func allTasks() async -> [URLSessionTask] {
        await withCheckedContinuation { continuation in
            session.getAllTasks { tasks in
                continuation.resume(returning: tasks)
            }
        }
    }

    private func removeAbandonedChunkFiles() {
        let rootURL = FileManager.default
            .urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("UBEYE", isDirectory: true)
            .appendingPathComponent("background-tus", isDirectory: true)
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: rootURL,
            includingPropertiesForKeys: [.contentModificationDateKey]
        ) else {
            return
        }

        let cutoff = Date().addingTimeInterval(-24 * 60 * 60)
        for fileURL in files {
            let modifiedAt = try? fileURL.resourceValues(
                forKeys: [.contentModificationDateKey]
            ).contentModificationDate
            if modifiedAt.map({ $0 < cutoff }) ?? true {
                try? FileManager.default.removeItem(at: fileURL)
            }
        }
    }
}

/// The first OS body-send notification, never a resumed HEAD offset or a
/// synthetic progress value. It is an observation, not a packet timestamp.
final class UploadFirstBytesDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var reported = false
    private let callback: (@Sendable () -> Void)?
    init(_ callback: (@Sendable () -> Void)?) { self.callback = callback }
    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                    totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard totalBytesSent > 0 else { return }
        lock.lock()
        let shouldReport = !reported
        reported = true
        lock.unlock()
        if shouldReport { callback?() }
    }
}
