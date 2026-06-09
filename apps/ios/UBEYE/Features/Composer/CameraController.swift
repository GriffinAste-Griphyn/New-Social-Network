import AVFoundation
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

@MainActor
final class CameraController: NSObject, ObservableObject {
    @Published var session = AVCaptureSession()
    @Published var authorizationStatus = AVCaptureDevice.authorizationStatus(for: .video)
    @Published var microphoneAuthorizationStatus = AVCaptureDevice.authorizationStatus(for: .audio)
    @Published var capturedPhoto: StoryImageUpload?
    @Published var capturedVideoURL: URL?
    @Published var capturedVideoCameraPosition: AVCaptureDevice.Position = .back
    @Published var isRecording = false
    @Published var cameraPosition: AVCaptureDevice.Position = .back
    @Published var activeVideoDevice: AVCaptureDevice?
    @Published var error: String?

    private let output = AVCapturePhotoOutput()
    private let movieOutput = AVCaptureMovieFileOutput()
    private var photoDelegate: PhotoCaptureDelegate?
    private var movieDelegate: MovieCaptureDelegate?
    private var videoInput: AVCaptureDeviceInput?
    private var audioInput: AVCaptureDeviceInput?
    private var recordingCameraPosition: AVCaptureDevice.Position = .back
    private var isConfigured = false
    private var captureRotationCoordinator: AVCaptureDevice.RotationCoordinator?
    private var configuredMaxPhotoDimensions: CMVideoDimensions?
    private let preferredVideoBitrate = 18_000_000
    private let preferredVideoFrameRate = 30

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
        Task.detached { [session] in
            session.stopRunning()
        }
    }

    func capturePhoto() {
        let settings = makePhotoSettings()
        settings.flashMode = preferredPhotoFlashMode()
        settings.photoQualityPrioritization = .quality
        if let configuredMaxPhotoDimensions {
            settings.maxPhotoDimensions = configuredMaxPhotoDimensions
        }
        let delegate = PhotoCaptureDelegate { [weak self] result in
            Task { @MainActor in
                switch result {
                case .success(let photo):
                    self?.capturedPhoto = photo
                case .failure(let error):
                    self?.error = error.localizedDescription
                }
                self?.photoDelegate = nil
            }
        }
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

        let codec: AVVideoCodecType = movieOutput.availableVideoCodecTypes.contains(.h264) ? .h264 : .hevc
        movieOutput.setOutputSettings(
            [
                AVVideoCodecKey: codec,
                AVVideoCompressionPropertiesKey: [
                    AVVideoAverageBitRateKey: preferredVideoBitrate,
                    AVVideoExpectedSourceFrameRateKey: preferredVideoFrameRate,
                    AVVideoMaxKeyFrameIntervalKey: preferredVideoFrameRate,
                ],
            ],
            for: videoConnection
        )
        MediaPerformance.mark("capture_video_settings codec=\(codec.rawValue) bitrate=\(preferredVideoBitrate) fps=\(preferredVideoFrameRate)")
    }

    private func makePhotoSettings() -> AVCapturePhotoSettings {
        if output.availablePhotoCodecTypes.contains(.jpeg) {
            return AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
        }

        return AVCapturePhotoSettings()
    }

    private func preferredPhotoFlashMode() -> AVCaptureDevice.FlashMode {
        cameraPosition == .front ? .off : .auto
    }

    private func configurePhotoOutput(for device: AVCaptureDevice) {
        if let maxDimensions = largestPhotoDimensions(
            in: device.activeFormat.supportedMaxPhotoDimensions
        ) {
            output.maxPhotoDimensions = maxDimensions
            configuredMaxPhotoDimensions = maxDimensions
        } else {
            configuredMaxPhotoDimensions = nil
        }
    }

    private func largestPhotoDimensions(
        in dimensions: [CMVideoDimensions]
    ) -> CMVideoDimensions? {
        dimensions.max { left, right in
            Int(left.width) * Int(left.height) < Int(right.width) * Int(right.height)
        }
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
            configureVideoConnection(movieConnection, mirrorsFrontCamera: false)
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
}

private final class PhotoCaptureDelegate: NSObject, AVCapturePhotoCaptureDelegate {
    private let completion: (Result<StoryImageUpload, Error>) -> Void

    init(completion: @escaping (Result<StoryImageUpload, Error>) -> Void) {
        self.completion = completion
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        if let error {
            completion(.failure(error))
            return
        }

        guard let data = photo.fileDataRepresentation(),
              let upload = StoryImageUpload(data: data, fallbackFileName: "story-photo") else {
            completion(.failure(APIClientError.invalidResponse))
            return
        }

        completion(.success(upload))
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
