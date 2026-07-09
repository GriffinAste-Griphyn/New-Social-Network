import AVFoundation
import CoreImage
import ImageIO
import SwiftUI
import UIKit

private func applyVideoRotationAngle(_ angle: CGFloat, to connection: AVCaptureConnection) {
    let normalizedAngle = angle.truncatingRemainder(dividingBy: 360)
    let positiveAngle = normalizedAngle < 0 ? normalizedAngle + 360 : normalizedAngle
    let rightAngle = (round(positiveAngle / 90) * 90).truncatingRemainder(dividingBy: 360)
    let candidates = [positiveAngle, rightAngle, 0, 90, 180, 270]

    guard let supportedAngle = candidates.first(where: { connection.isVideoRotationAngleSupported($0) }) else {
        return
    }

    connection.videoRotationAngle = supportedAngle
}

enum StoryCaptureQuality {
    static let videoBitrate = 12_000_000
    static let videoFrameRate = 30
    static let videoKeyFrameInterval = 60
}

@MainActor
final class CameraController: NSObject, ObservableObject {
    @Published var session = AVCaptureSession()
    @Published var authorizationStatus = AVCaptureDevice.authorizationStatus(for: .video)
    @Published var microphoneAuthorizationStatus = AVCaptureDevice.authorizationStatus(for: .audio)
    @Published var capturedPhoto: StoryImageUpload?
    @Published var capturedPhotoPreview: UIImage?
    @Published var capturedVideoURL: URL?
    @Published var capturedVideoCameraPosition: AVCaptureDevice.Position = .back
    @Published var isCapturingPhoto = false
    @Published var isRecording = false
    @Published var cameraPosition: AVCaptureDevice.Position = .back
    @Published var activeVideoDevice: AVCaptureDevice?
    @Published var error: String?

    private let output = AVCapturePhotoOutput()
    private let movieOutput = AVCaptureMovieFileOutput()
    private let previewFrameOutput = AVCaptureVideoDataOutput()
    private let previewFrameQueue = DispatchQueue(label: "com.ubeye.camera.preview-frame")
    private let previewFrameSampler = PreviewFrameSampler()
    private var photoDelegate: PhotoCaptureDelegate?
    private var movieDelegate: MovieCaptureDelegate?
    private var videoInput: AVCaptureDeviceInput?
    private var audioInput: AVCaptureDeviceInput?
    private var recordingCameraPosition: AVCaptureDevice.Position = .back
    private var isConfigured = false
    private var captureRotationCoordinator: AVCaptureDevice.RotationCoordinator?
    private var configuredMaxPhotoDimensions: CMVideoDimensions?
    private let frontCameraPhotoMaxPixels = 3_000_000

    func requestAccessAndConfigure() async {
        if authorizationStatus == .notDetermined {
            let granted = await AVCaptureDevice.requestAccess(for: .video)
            authorizationStatus = granted ? .authorized : .denied
        }

        if microphoneAuthorizationStatus == .notDetermined {
            let granted = await AVCaptureDevice.requestAccess(for: .audio)
            microphoneAuthorizationStatus = granted ? .authorized : .denied
        }

        guard authorizationStatus == .authorized else {
            error = "Camera access is required to create a story."
            return
        }

        configureIfNeeded()
        start()
    }

    func start() {
        guard isConfigured, !session.isRunning else {
            return
        }
        AppAudioSession.configureForVideoRecording()
        Task.detached { [session] in
            session.startRunning()
        }
    }

    func stop() {
        guard session.isRunning else {
            return
        }
        previewFrameSampler.clear()
        Task.detached { [session] in
            session.stopRunning()
        }
    }

    func capturePhoto() {
        let captureStartedAt = Date()
        let capturePosition = cameraPosition
        capturedPhotoPreview = nil
        isCapturingPhoto = true
        if let liveFramePreview = previewFrameSampler.currentImage() {
            capturedPhotoPreview = liveFramePreview
            MediaPerformance.measure(
                "photo_capture_live_preview position=\(cameraLabel(for: capturePosition))",
                since: captureStartedAt
            )
        }

        let settings = makePhotoSettings()
        settings.flashMode = preferredPhotoFlashMode()
        settings.photoQualityPrioritization = capturePosition == .front ? .speed : .quality
        if let configuredMaxPhotoDimensions {
            settings.maxPhotoDimensions = configuredMaxPhotoDimensions
        }
        configurePhotoPreviewFormats(settings)

        let delegate = PhotoCaptureDelegate(
            completion: { [weak self] result in
                Task { @MainActor in
                    self?.isCapturingPhoto = false
                    switch result {
                    case .success(let photo):
                        self?.capturedPhotoPreview = nil
                        self?.capturedPhoto = photo
                    case .failure(let error):
                        self?.capturedPhotoPreview = nil
                        self?.error = error.localizedDescription
                    }
                    self?.photoDelegate = nil
                }
            },
            previewHandler: { [weak self] preview in
                Task { @MainActor in
                    self?.capturedPhotoPreview = preview
                }
            },
            metadata: .init(
                cameraPosition: capturePosition,
                startedAt: captureStartedAt
            )
        )
        photoDelegate = delegate
        output.capturePhoto(with: settings, delegate: delegate)
    }

    func startRecording() {
        guard isConfigured, !movieOutput.isRecording else {
            return
        }

        guard microphoneAuthorizationStatus == .authorized, audioInput != nil else {
            error = "Microphone access is required to record video stories with audio."
            return
        }

        guard AppAudioSession.configureForVideoRecording() else {
            error = "Could not prepare the microphone for recording."
            return
        }
        configureMovieAudioConnection()

        capturedPhoto = nil
        capturedPhotoPreview = nil
        capturedVideoURL = nil
        recordingCameraPosition = cameraPosition
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("story-\(UUID().uuidString).mov")
        let delegate = MovieCaptureDelegate { [weak self] result in
            Task { @MainActor in
                self?.isRecording = false
                switch result {
                case .success(let url):
                    if MediaDiagnostics.capturedVideoHasAudio(url: url) {
                        self?.capturedVideoCameraPosition = self?.recordingCameraPosition ?? .back
                        self?.capturedVideoURL = url
                    } else {
                        self?.error = "Could not capture audio. Check microphone access and try recording again."
                    }
                case .failure(let error):
                    self?.error = Self.recordingErrorMessage(for: error)
                }
                self?.movieDelegate = nil
            }
        }
        movieDelegate = delegate
        isRecording = true
        movieOutput.startRecording(to: url, recordingDelegate: delegate)
    }

    func stopRecording() {
        guard movieOutput.isRecording else {
            return
        }

        movieOutput.stopRecording()
    }

    func switchCamera() {
        guard isConfigured, !movieOutput.isRecording else {
            return
        }

        let nextPosition: AVCaptureDevice.Position = cameraPosition == .back ? .front : .back
        guard let camera = preferredCamera(for: nextPosition),
              let nextInput = try? AVCaptureDeviceInput(device: camera) else {
            error = "Could not switch cameras."
            return
        }

        session.beginConfiguration()
        if let videoInput {
            session.removeInput(videoInput)
        }

        if session.canAddInput(nextInput) {
            session.addInput(nextInput)
            videoInput = nextInput
            cameraPosition = nextPosition
            activeVideoDevice = camera
            captureRotationCoordinator = AVCaptureDevice.RotationCoordinator(
                device: camera,
                previewLayer: nil
            )
            previewFrameSampler.clear()
            configurePhotoOutput(for: camera)
            updateOutputOrientation()
        } else if let videoInput, session.canAddInput(videoInput) {
            session.addInput(videoInput)
        }
        session.commitConfiguration()
    }

    private func configureIfNeeded() {
        guard !isConfigured else {
            return
        }

        session.beginConfiguration()
        session.sessionPreset = session.canSetSessionPreset(.hd1920x1080) ? .hd1920x1080 : .high
        session.usesApplicationAudioSession = true
        session.automaticallyConfiguresApplicationAudioSession = false

        defer {
            session.commitConfiguration()
        }

        guard let camera = preferredCamera(for: cameraPosition),
              let input = try? AVCaptureDeviceInput(device: camera),
              session.canAddInput(input),
              session.canAddOutput(output),
              session.canAddOutput(movieOutput) else {
            error = "Could not start the camera."
            return
        }

        session.addInput(input)
        videoInput = input
        activeVideoDevice = input.device
        captureRotationCoordinator = AVCaptureDevice.RotationCoordinator(
            device: input.device,
            previewLayer: nil
        )
        if microphoneAuthorizationStatus == .authorized,
           let microphone = AVCaptureDevice.default(for: .audio),
           let microphoneInput = try? AVCaptureDeviceInput(device: microphone),
           session.canAddInput(microphoneInput) {
            session.addInput(microphoneInput)
            audioInput = microphoneInput
        }
        session.addOutput(output)
        session.addOutput(movieOutput)
        configurePreviewFrameOutput()
        configurePhotoOutput(for: input.device)
        output.maxPhotoQualityPrioritization = .quality
        configureMovieVideoOutputSettings()
        configureMovieAudioConnection()
        updateOutputOrientation()
        isConfigured = true
    }

    private func configureMovieVideoOutputSettings() {
        guard let videoConnection = movieOutput.connection(with: .video) else {
            MediaPerformance.mark("capture_video_connection_missing")
            return
        }

        let availableCodecs = movieOutput.availableVideoCodecTypes
        guard let codec = availableCodecs.first(where: { $0 == .h264 }) ??
            availableCodecs.first(where: { $0 == .hevc }) else {
            MediaPerformance.mark("capture_video_custom_codec_unavailable")
            return
        }
        movieOutput.setOutputSettings(
            [
                AVVideoCodecKey: codec,
                AVVideoCompressionPropertiesKey: [
                    AVVideoAverageBitRateKey: StoryCaptureQuality.videoBitrate,
                    AVVideoExpectedSourceFrameRateKey: StoryCaptureQuality.videoFrameRate,
                    AVVideoMaxKeyFrameIntervalKey: StoryCaptureQuality.videoKeyFrameInterval,
                ],
            ],
            for: videoConnection
        )
        MediaPerformance.mark(
            "capture_video_settings codec=\(codec.rawValue) bitrate=\(StoryCaptureQuality.videoBitrate) fps=\(StoryCaptureQuality.videoFrameRate) gop=\(StoryCaptureQuality.videoKeyFrameInterval)"
        )
    }

    private func configurePreviewFrameOutput() {
        previewFrameOutput.alwaysDiscardsLateVideoFrames = true
        previewFrameOutput.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        ]
        previewFrameOutput.setSampleBufferDelegate(previewFrameSampler, queue: previewFrameQueue)

        guard session.canAddOutput(previewFrameOutput) else {
            MediaPerformance.mark("capture_preview_frame_output_unavailable")
            return
        }

        session.addOutput(previewFrameOutput)
    }

    private func makePhotoSettings() -> AVCapturePhotoSettings {
        if output.availablePhotoCodecTypes.contains(.jpeg) {
            return AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
        }

        return AVCapturePhotoSettings()
    }

    private func configurePhotoPreviewFormats(_ settings: AVCapturePhotoSettings) {
        guard let previewPixelFormat = settings.availablePreviewPhotoPixelFormatTypes.first else {
            return
        }

        let previewDimensions = CGSize(width: 720, height: 1280)
        settings.previewPhotoFormat = [
            kCVPixelBufferPixelFormatTypeKey as String: previewPixelFormat,
            kCVPixelBufferWidthKey as String: Int(previewDimensions.width),
            kCVPixelBufferHeightKey as String: Int(previewDimensions.height),
        ]
    }

    private func preferredPhotoFlashMode() -> AVCaptureDevice.FlashMode {
        cameraPosition == .front ? .off : .auto
    }

    private func configurePhotoOutput(for device: AVCaptureDevice) {
        if let maxDimensions = preferredPhotoDimensions(
            in: device.activeFormat.supportedMaxPhotoDimensions,
            position: device.position
        ) {
            output.maxPhotoDimensions = maxDimensions
            configuredMaxPhotoDimensions = maxDimensions
        } else {
            configuredMaxPhotoDimensions = nil
        }
    }

    private func preferredPhotoDimensions(
        in dimensions: [CMVideoDimensions],
        position: AVCaptureDevice.Position
    ) -> CMVideoDimensions? {
        let sortedDimensions = dimensions.sorted { left, right in
            pixelCount(left) < pixelCount(right)
        }

        guard position == .front else {
            return sortedDimensions.last
        }

        return sortedDimensions.last { dimensions in
            pixelCount(dimensions) <= frontCameraPhotoMaxPixels
        } ?? sortedDimensions.first
    }

    private func pixelCount(_ dimensions: CMVideoDimensions) -> Int {
        Int(dimensions.width) * Int(dimensions.height)
    }

    private func preferredCamera(for position: AVCaptureDevice.Position) -> AVCaptureDevice? {
        let deviceTypes: [AVCaptureDevice.DeviceType] = position == .back
            ? [
                .builtInTripleCamera,
                .builtInDualWideCamera,
                .builtInDualCamera,
                .builtInWideAngleCamera,
            ]
            : [
                .builtInTrueDepthCamera,
                .builtInWideAngleCamera,
            ]

        let discoverySession = AVCaptureDevice.DiscoverySession(
            deviceTypes: deviceTypes,
            mediaType: .video,
            position: position
        )

        return discoverySession.devices.first ??
            AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position)
    }

    private func configureMovieAudioConnection() {
        guard let audioConnection = movieOutput.connection(with: .audio) else {
            MediaPerformance.mark("capture_audio_connection_missing")
            return
        }

        audioConnection.isEnabled = true
        MediaPerformance.mark("capture_audio_connection_enabled")
    }

    private func updateOutputOrientation() {
        if let photoConnection = output.connection(with: .video) {
            configureVideoConnection(photoConnection, mirrorsFrontCamera: true)
        }

        if let movieConnection = movieOutput.connection(with: .video) {
            configureVideoConnection(movieConnection, mirrorsFrontCamera: true)
        }

        if let previewFrameConnection = previewFrameOutput.connection(with: .video) {
            configureVideoConnection(previewFrameConnection, mirrorsFrontCamera: true)
        }
    }

    private func configureVideoConnection(
        _ connection: AVCaptureConnection,
        mirrorsFrontCamera: Bool
    ) {
        if let captureRotationCoordinator {
            applyVideoRotationAngle(
                captureRotationCoordinator.videoRotationAngleForHorizonLevelCapture,
                to: connection
            )
        }
        if connection.isVideoMirroringSupported {
            connection.automaticallyAdjustsVideoMirroring = false
            connection.isVideoMirrored = mirrorsFrontCamera && cameraPosition == .front
        }
        if connection.isVideoStabilizationSupported {
            connection.preferredVideoStabilizationMode = .cinematic
        }
    }

    private static func recordingErrorMessage(for error: Error) -> String {
        let nsError = error as NSError
        MediaPerformance.mark(
            "capture_recording_failed domain=\(nsError.domain) code=\(nsError.code)"
        )

        if nsError.domain == AVFoundationErrorDomain {
            return "Could not record video. Check camera and microphone access, then try again."
        }

        return error.localizedDescription
    }

    private func cameraLabel(for position: AVCaptureDevice.Position) -> String {
        switch position {
        case .front:
            return "front"
        case .back:
            return "back"
        default:
            return "unspecified"
        }
    }
}

private final class PreviewFrameSampler: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    private let lock = NSLock()
    private let imageContext = CIContext()
    private var latestPixelBuffer: CVPixelBuffer?
    private let maxPreviewDimension: CGFloat = 1280

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            return
        }

        lock.lock()
        latestPixelBuffer = pixelBuffer
        lock.unlock()
    }

    func currentImage() -> UIImage? {
        lock.lock()
        let pixelBuffer = latestPixelBuffer
        lock.unlock()

        guard let pixelBuffer else {
            return nil
        }

        let image = CIImage(cvPixelBuffer: pixelBuffer)
        let longestDimension = max(image.extent.width, image.extent.height)
        let scale = longestDimension > 0 ? min(1, maxPreviewDimension / longestDimension) : 1
        let previewImage = scale < 1
            ? image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
            : image

        guard let cgImage = imageContext.createCGImage(previewImage, from: previewImage.extent) else {
            return nil
        }

        return UIImage(cgImage: cgImage)
    }

    func clear() {
        lock.lock()
        latestPixelBuffer = nil
        lock.unlock()
    }
}

private final class PhotoCaptureDelegate: NSObject, AVCapturePhotoCaptureDelegate {
    struct Metadata {
        let cameraPosition: AVCaptureDevice.Position
        let startedAt: Date
    }

    private let completion: (Result<StoryImageUpload, Error>) -> Void
    private let previewHandler: (UIImage) -> Void
    private let metadata: Metadata

    init(
        completion: @escaping (Result<StoryImageUpload, Error>) -> Void,
        previewHandler: @escaping (UIImage) -> Void,
        metadata: Metadata
    ) {
        self.completion = completion
        self.previewHandler = previewHandler
        self.metadata = metadata
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        if let error {
            MediaPerformance.measure(
                "photo_capture_failed position=\(Self.cameraLabel(for: metadata.cameraPosition))",
                since: metadata.startedAt
            )
            completion(.failure(error))
            return
        }

        let flattenStartedAt = Date()
        let previewImage = Self.previewImage(from: photo)
        if let previewImage {
            previewHandler(previewImage)
        }

        guard let data = photo.fileDataRepresentation(),
              let upload = StoryImageUpload(
                data: data,
                fallbackFileName: "story-photo",
                displayImage: previewImage
              ) else {
            MediaPerformance.measure(
                "photo_capture_failed position=\(Self.cameraLabel(for: metadata.cameraPosition)) reason=file_data",
                since: metadata.startedAt
            )
            completion(.failure(APIClientError.invalidResponse))
            return
        }

        let cameraLabel = Self.cameraLabel(for: metadata.cameraPosition)
        MediaPerformance.measure(
            "photo_capture_file_data position=\(cameraLabel) bytes=\(data.count)",
            since: flattenStartedAt
        )
        MediaPerformance.measure(
            "photo_capture_ready position=\(cameraLabel) bytes=\(data.count)",
            since: metadata.startedAt
        )
        completion(.success(upload))
    }

    private static func previewImage(from photo: AVCapturePhoto) -> UIImage? {
        guard let cgImage = photo.previewCGImageRepresentation() else {
            return nil
        }

        return UIImage(
            cgImage: cgImage,
            scale: 1,
            orientation: imageOrientation(from: photo.metadata)
        )
    }

    private static func imageOrientation(from metadata: [String: Any]) -> UIImage.Orientation {
        let rawValue = metadata[kCGImagePropertyOrientation as String] as? UInt32
        let cgOrientation = rawValue.flatMap(CGImagePropertyOrientation.init(rawValue:)) ?? .up

        switch cgOrientation {
        case .up:
            return .up
        case .upMirrored:
            return .upMirrored
        case .down:
            return .down
        case .downMirrored:
            return .downMirrored
        case .left:
            return .left
        case .leftMirrored:
            return .leftMirrored
        case .right:
            return .right
        case .rightMirrored:
            return .rightMirrored
        }
    }

    private static func cameraLabel(for position: AVCaptureDevice.Position) -> String {
        switch position {
        case .front:
            return "front"
        case .back:
            return "back"
        default:
            return "unspecified"
        }
    }
}

private final class MovieCaptureDelegate: NSObject, AVCaptureFileOutputRecordingDelegate {
    private let completion: (Result<URL, Error>) -> Void

    init(completion: @escaping (Result<URL, Error>) -> Void) {
        self.completion = completion
    }

    func fileOutput(
        _ output: AVCaptureFileOutput,
        didFinishRecordingTo outputFileURL: URL,
        from connections: [AVCaptureConnection],
        error: Error?
    ) {
        if let error {
            completion(.failure(error))
            return
        }

        completion(.success(outputFileURL))
    }
}

struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    let cameraPosition: AVCaptureDevice.Position
    let device: AVCaptureDevice?

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.videoPreviewLayer.session = session
        view.videoPreviewLayer.videoGravity = .resizeAspectFill
        view.updatePreviewConnection(for: cameraPosition, device: device)
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {
        uiView.videoPreviewLayer.session = session
        uiView.updatePreviewConnection(for: cameraPosition, device: device)
    }
}

final class PreviewView: UIView {
    override class var layerClass: AnyClass {
        AVCaptureVideoPreviewLayer.self
    }

    var videoPreviewLayer: AVCaptureVideoPreviewLayer {
        layer as! AVCaptureVideoPreviewLayer
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        updatePreviewConnection(for: currentCameraPosition, device: currentDevice)
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        updatePreviewConnection(for: currentCameraPosition, device: currentDevice)
    }

    private var currentCameraPosition: AVCaptureDevice.Position = .back
    private weak var currentDevice: AVCaptureDevice?
    private var previewRotationCoordinator: AVCaptureDevice.RotationCoordinator?

    func updatePreviewConnection(
        for cameraPosition: AVCaptureDevice.Position,
        device: AVCaptureDevice?
    ) {
        currentCameraPosition = cameraPosition
        if currentDevice !== device {
            currentDevice = device
            previewRotationCoordinator = nil
        }

        guard let connection = videoPreviewLayer.connection else {
            return
        }

        if let device {
            if previewRotationCoordinator == nil {
                previewRotationCoordinator = AVCaptureDevice.RotationCoordinator(
                    device: device,
                    previewLayer: videoPreviewLayer
                )
            }

            if let previewRotationCoordinator {
                applyVideoRotationAngle(
                    previewRotationCoordinator.videoRotationAngleForHorizonLevelPreview,
                    to: connection
                )
            }
        }

        if connection.isVideoMirroringSupported {
            connection.automaticallyAdjustsVideoMirroring = false
            connection.isVideoMirrored = cameraPosition == .front
        }
    }
}
