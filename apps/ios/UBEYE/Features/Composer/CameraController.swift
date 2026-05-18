import AVFoundation
import SwiftUI
import UIKit

@MainActor
final class CameraController: NSObject, ObservableObject {
    @Published var session = AVCaptureSession()
    @Published var authorizationStatus = AVCaptureDevice.authorizationStatus(for: .video)
    @Published var microphoneAuthorizationStatus = AVCaptureDevice.authorizationStatus(for: .audio)
    @Published var capturedImage: UIImage?
    @Published var capturedVideoURL: URL?
    @Published var isRecording = false
    @Published var cameraPosition: AVCaptureDevice.Position = .back
    @Published var error: String?

    private let output = AVCapturePhotoOutput()
    private let movieOutput = AVCaptureMovieFileOutput()
    private var photoDelegate: PhotoCaptureDelegate?
    private var movieDelegate: MovieCaptureDelegate?
    private var videoInput: AVCaptureDeviceInput?
    private var audioInput: AVCaptureDeviceInput?
    private var isConfigured = false

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
        let settings = AVCapturePhotoSettings()
        settings.flashMode = .auto
        let delegate = PhotoCaptureDelegate { [weak self] result in
            Task { @MainActor in
                switch result {
                case .success(let image):
                    self?.capturedImage = image
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

        capturedImage = nil
        capturedVideoURL = nil
        AppAudioSession.configureForVideoRecording()
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("story-\(UUID().uuidString).mov")
        let delegate = MovieCaptureDelegate { [weak self] result in
            Task { @MainActor in
                self?.isRecording = false
                switch result {
                case .success(let url):
                    MediaDiagnostics.logCapturedVideo(url: url)
                    self?.capturedVideoURL = url
                case .failure(let error):
                    self?.error = error.localizedDescription
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
        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: nextPosition),
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
        session.sessionPreset = .high
        session.usesApplicationAudioSession = true
        session.automaticallyConfiguresApplicationAudioSession = true

        defer {
            session.commitConfiguration()
        }

        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: cameraPosition),
              let input = try? AVCaptureDeviceInput(device: camera),
              session.canAddInput(input),
              session.canAddOutput(output),
              session.canAddOutput(movieOutput) else {
            error = "Could not start the camera."
            return
        }

        session.addInput(input)
        videoInput = input
        if microphoneAuthorizationStatus == .authorized,
           let microphone = AVCaptureDevice.default(for: .audio),
           let microphoneInput = try? AVCaptureDeviceInput(device: microphone),
           session.canAddInput(microphoneInput) {
            session.addInput(microphoneInput)
            audioInput = microphoneInput
        }
        session.addOutput(output)
        session.addOutput(movieOutput)
        updateOutputOrientation()
        isConfigured = true
    }

    private func updateOutputOrientation() {
        for connection in [output.connection(with: .video), movieOutput.connection(with: .video)].compactMap({ $0 }) {
            if connection.isVideoRotationAngleSupported(90) {
                connection.videoRotationAngle = 90
            }
            if connection.isVideoMirroringSupported {
                connection.isVideoMirrored = cameraPosition == .front
            }
        }
    }
}

private final class PhotoCaptureDelegate: NSObject, AVCapturePhotoCaptureDelegate {
    private let completion: (Result<UIImage, Error>) -> Void

    init(completion: @escaping (Result<UIImage, Error>) -> Void) {
        self.completion = completion
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        if let error {
            completion(.failure(error))
            return
        }

        guard let data = photo.fileDataRepresentation(), let image = UIImage(data: data) else {
            completion(.failure(APIClientError.invalidResponse))
            return
        }

        completion(.success(image))
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

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.videoPreviewLayer.session = session
        view.videoPreviewLayer.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {
        uiView.videoPreviewLayer.session = session
    }
}

final class PreviewView: UIView {
    override class var layerClass: AnyClass {
        AVCaptureVideoPreviewLayer.self
    }

    var videoPreviewLayer: AVCaptureVideoPreviewLayer {
        layer as! AVCaptureVideoPreviewLayer
    }
}
