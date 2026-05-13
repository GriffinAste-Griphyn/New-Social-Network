import AVFoundation
import PhotosUI
import SwiftUI
import UIKit

enum PickedStoryMedia {
    case image(UIImage)
    case video(URL)
}

@MainActor
final class StoryComposerStore: ObservableObject {
    @Published var caption = ""
    @Published var brandTags = ""
    @Published var textOverlay = ""
    @Published var selectedMedia: PickedStoryMedia?
    @Published var uploadStatus: String?
    @Published var error: String?
    @Published var isUploading = false

    func upload(api: APIClient) async {
        guard let selectedMedia else {
            error = "Capture or choose story media first."
            return
        }

        isUploading = true
        error = nil
        uploadStatus = "Preparing upload"

        do {
            switch selectedMedia {
            case .image(let image):
                uploadStatus = "Uploading image"
                let _: StoryUploadResponse = try await api.uploadImageStory(
                    image: image,
                    caption: caption,
                    brandTags: brandTags,
                    textOverlay: textOverlay,
                    textOverlayPositionY: 74
                )
            case .video(let url):
                uploadStatus = "Preparing video slot"
                let byteSize = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value
                let upload = try await api.prepareVideoUpload(
                    fileName: url.lastPathComponent.isEmpty ? "story-video.mp4" : url.lastPathComponent,
                    byteSize: byteSize,
                    maxDurationSeconds: 60 * 60
                )
                uploadStatus = "Uploading video"
                try await api.uploadVideoFile(fileURL: url, upload: upload)
                uploadStatus = "Finishing story"
                let response: StoryUploadResponse = try await api.completeVideoStory(
                    uid: upload.uid,
                    fileURL: url,
                    caption: caption,
                    brandTags: brandTags,
                    textOverlay: textOverlay,
                    durationMs: nil
                )
                if response.processingStatus != "ready" {
                    uploadStatus = "Processing video"
                    await api.waitForStoryLive(storyId: response.storyId)
                }
            }

            uploadStatus = "Story posted"
            caption = ""
            brandTags = ""
            textOverlay = ""
            self.selectedMedia = nil
        } catch {
            self.error = error.localizedDescription
        }

        isUploading = false
    }
}

struct StoryComposerView: View {
    @EnvironmentObject private var api: APIClient
    @StateObject private var camera = CameraController()
    @StateObject private var store = StoryComposerStore()
    @State private var photoPickerItem: PhotosPickerItem?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    mediaStage
                    metadataFields

                    if let uploadStatus = store.uploadStatus {
                        Text(uploadStatus)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.7))
                    }

                    if let error = store.error ?? camera.error {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }

                    PrimaryButton(title: "Post story", isLoading: store.isUploading) {
                        Task { await store.upload(api: api) }
                    }
                }
                .padding(18)
            }
            .navigationTitle("Post")
            .ubeyeScreen()
            .task {
                await camera.requestAccessAndConfigure()
            }
            .onDisappear {
                camera.stop()
            }
            .onChange(of: photoPickerItem) { _, item in
                Task {
                    await loadPickedItem(item)
                }
            }
        }
    }

    @ViewBuilder
    private var mediaStage: some View {
        ZStack(alignment: .bottom) {
            mediaPreview
                .frame(height: 480)
                .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))

            HStack(spacing: 18) {
                PhotosPicker(selection: $photoPickerItem, matching: .any(of: [.images, .videos])) {
                    Image(systemName: "photo.on.rectangle")
                        .font(.title2)
                        .frame(width: 54, height: 54)
                        .background(.black.opacity(0.45), in: Circle())
                }

                Button {
                    camera.capturePhoto()
                    if let image = camera.capturedImage {
                        store.selectedMedia = .image(image)
                    }
                } label: {
                    Circle()
                        .strokeBorder(.white, lineWidth: 4)
                        .frame(width: 72, height: 72)
                        .overlay(Circle().fill(.white).padding(9))
                }

                Button {
                    if camera.isRecording {
                        camera.stopRecording()
                    } else {
                        camera.startRecording()
                    }
                } label: {
                    Image(systemName: camera.isRecording ? "stop.fill" : "video.fill")
                        .font(.title2)
                        .frame(width: 54, height: 54)
                        .background(camera.isRecording ? Color.ubeyeRed : .black.opacity(0.45), in: Circle())
                }

                Button {
                    store.selectedMedia = nil
                    camera.capturedImage = nil
                    camera.capturedVideoURL = nil
                } label: {
                    Image(systemName: "arrow.counterclockwise")
                        .font(.title2)
                        .frame(width: 54, height: 54)
                        .background(.black.opacity(0.45), in: Circle())
                }
            }
            .foregroundStyle(.white)
            .padding(.bottom, 18)
        }
    }

    @ViewBuilder
    private var mediaPreview: some View {
        switch store.selectedMedia {
        case .image(let image):
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
        case .video(let url):
            StoryVideoPreview(url: url)
        case nil:
            if let image = camera.capturedImage {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .onAppear {
                        store.selectedMedia = .image(image)
                    }
            } else if let videoURL = camera.capturedVideoURL {
                StoryVideoPreview(url: videoURL)
                    .onAppear {
                        store.selectedMedia = .video(videoURL)
                    }
            } else if camera.authorizationStatus == .authorized {
                CameraPreview(session: camera.session)
            } else {
                EmptyStateView(title: "Camera unavailable", message: "Enable camera access or choose media from your library.", systemImage: "camera")
                    .background(Color.ubeyePanel)
            }
        }
    }

    private var metadataFields: some View {
        VStack(spacing: 12) {
            composerTextField("Caption", text: $store.caption)
            composerTextField("Brand tags", text: $store.brandTags)
            composerTextField("Text overlay", text: $store.textOverlay)
        }
    }

    private func composerTextField(_ title: String, text: Binding<String>) -> some View {
        TextField(title, text: text)
            .padding()
            .frame(height: 52)
            .background(.white.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .textInputAutocapitalization(.sentences)
    }

    private func loadPickedItem(_ item: PhotosPickerItem?) async {
        guard let item else {
            return
        }

        if item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) }) {
            if let data = try? await item.loadTransferable(type: Data.self) {
                let url = FileManager.default.temporaryDirectory.appendingPathComponent("picked-\(UUID().uuidString).mov")
                try? data.write(to: url)
                store.selectedMedia = .video(url)
            }
            return
        }

        if let data = try? await item.loadTransferable(type: Data.self),
           let image = UIImage(data: data) {
            store.selectedMedia = .image(image)
        }
    }
}

struct StoryVideoPreview: View {
    let url: URL

    var body: some View {
        ZStack {
            Color.black
            VStack(spacing: 10) {
                Image(systemName: "play.circle.fill")
                    .font(.system(size: 54))
                Text(url.lastPathComponent)
                    .font(.footnote)
                    .lineLimit(1)
                    .foregroundStyle(.white.opacity(0.68))
            }
        }
    }
}
