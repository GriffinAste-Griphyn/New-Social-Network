import AVFoundation
import CoreTransferable
import Foundation
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

enum StoryMediaKind: Equatable {
    case image
    case video
}

enum StoryMediaIngestionError: LocalizedError {
    case unsupported

    var errorDescription: String? {
        "Could not load that media. Try another photo or video."
    }
}

enum StoryMediaIngestor {
    static func readyMedia(fromCameraPhoto photo: StoryImageUpload) -> StoryReadyMedia {
        .image(photo)
    }

    static func readyMedia(fromCameraVideoURL url: URL, cameraPosition: AVCaptureDevice.Position) -> StoryReadyMedia {
        let source: StoryVideoUpload.Source = cameraPosition == .front ? .cameraFront : .cameraBack
        return .video(StoryVideoUpload(url: url, source: source))
    }

    static func readyMedia(fromLibraryItem item: PhotosPickerItem) async throws -> StoryReadyMedia {
        switch preferredLibraryMediaKind(for: item.supportedContentTypes) {
        case .video:
            return .video(try await libraryVideoUpload(from: item))
        case .image:
            return .image(try await libraryImageUpload(from: item))
        case nil:
            if let image = try? await libraryImageUpload(from: item) {
                return .image(image)
            }
            if let video = try? await libraryVideoUpload(from: item) {
                return .video(video)
            }
            throw StoryMediaIngestionError.unsupported
        }
    }

    static func preferredLibraryMediaKind(for contentTypes: [UTType]) -> StoryMediaKind? {
        if contentTypes.contains(where: isVideoContentType) {
            return .video
        }
        if contentTypes.contains(where: isImageContentType) {
            return .image
        }
        return nil
    }

    private static func libraryVideoUpload(from item: PhotosPickerItem) async throws -> StoryVideoUpload {
        guard let pickedVideo = try await item.loadTransferable(type: LibraryPickedVideo.self) else {
            throw StoryMediaIngestionError.unsupported
        }

        return StoryVideoUpload(url: pickedVideo.url, source: .library)
    }

    private static func libraryImageUpload(from item: PhotosPickerItem) async throws -> StoryImageUpload {
        var lastError: Error?

        do {
            if let pickedImage = try await item.loadTransferable(type: LibraryPickedImage.self) {
                return pickedImage.upload
            }
        } catch {
            lastError = error
        }

        do {
            if let data = try await item.loadTransferable(type: Data.self),
               let upload = StoryImageUpload(data: data, fallbackFileName: "story-photo") {
                return upload
            }
        } catch {
            lastError = error
        }

        throw lastError ?? StoryMediaIngestionError.unsupported
    }

    private static func isImageContentType(_ contentType: UTType) -> Bool {
        contentType.conforms(to: .image)
    }

    private static func isVideoContentType(_ contentType: UTType) -> Bool {
        contentType.conforms(to: .movie) ||
            contentType.conforms(to: .video) ||
            contentType == .quickTimeMovie ||
            contentType == .mpeg4Movie
    }
}

private struct LibraryPickedVideo: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { video in
            SentTransferredFile(video.url)
        } importing: { received in
            let sourceExtension = received.file.pathExtension
            let fileExtension = sourceExtension.isEmpty ? "mov" : sourceExtension
            let copy = FileManager.default.temporaryDirectory.appendingPathComponent("picked-\(UUID().uuidString).\(fileExtension)")
            if FileManager.default.fileExists(atPath: copy.path) {
                try FileManager.default.removeItem(at: copy)
            }
            try FileManager.default.copyItem(at: received.file, to: copy)
            return LibraryPickedVideo(url: copy)
        }
    }
}

private struct LibraryPickedImage: Transferable {
    let upload: StoryImageUpload

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .image) { image in
            let copy = FileManager.default.temporaryDirectory
                .appendingPathComponent("picked-\(UUID().uuidString).\(image.upload.fileName)")
            try image.upload.data.write(to: copy, options: .atomic)
            return SentTransferredFile(copy)
        } importing: { received in
            let data = try Data(contentsOf: received.file)
            guard let upload = StoryImageUpload(
                data: data,
                fallbackFileName: received.file.lastPathComponent
            ) else {
                throw APIClientError.invalidResponse
            }

            return LibraryPickedImage(upload: upload)
        }
    }
}
