import Foundation
import UIKit

enum StoryReadyMedia: Equatable {
    case image(StoryImageUpload)
    case video(StoryVideoUpload)
}

struct StoryVideoUpload: Equatable {
    enum Source: Equatable {
        case cameraFront
        case cameraBack
        case library

        var mirrorsNormalizedFallback: Bool {
            self == .cameraFront
        }
    }

    let url: URL
    let source: Source
}

struct StoryImageUpload: Equatable {
    let image: UIImage
    let data: Data
    let fileName: String
    let mimeType: String

    init?(data: Data, fallbackFileName: String = "story-photo") {
        guard let image = UIImage(data: data) else {
            return nil
        }

        let format = StoryImageFormat(data: data)
        self.image = image
        self.data = data
        fileName = Self.normalizedFileName(fallbackFileName, fileExtension: format.fileExtension)
        mimeType = format.mimeType
    }

    private static func normalizedFileName(_ value: String, fileExtension: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = trimmed.isEmpty ? "story-photo" : trimmed

        if base.lowercased().hasSuffix(".\(fileExtension)") {
            return base
        }

        let stem = (base as NSString).deletingPathExtension
        return "\(stem.isEmpty ? "story-photo" : stem).\(fileExtension)"
    }

    static func == (lhs: StoryImageUpload, rhs: StoryImageUpload) -> Bool {
        lhs.data == rhs.data &&
            lhs.fileName == rhs.fileName &&
            lhs.mimeType == rhs.mimeType
    }
}

struct StoryImageFormat {
    let fileExtension: String
    let mimeType: String

    init(data: Data) {
        let bytes = [UInt8](data.prefix(16))

        if bytes.starts(with: [0xff, 0xd8, 0xff]) {
            fileExtension = "jpg"
            mimeType = "image/jpeg"
        } else if bytes.starts(with: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) {
            fileExtension = "png"
            mimeType = "image/png"
        } else if data.count >= 12,
                  String(data: data.prefix(4), encoding: .ascii) == "RIFF",
                  String(data: data.dropFirst(8).prefix(4), encoding: .ascii) == "WEBP" {
            fileExtension = "webp"
            mimeType = "image/webp"
        } else if data.count >= 12,
                  String(data: data.dropFirst(4).prefix(4), encoding: .ascii) == "ftyp" {
            let brand = String(data: data.dropFirst(8).prefix(4), encoding: .ascii) ?? ""
            if ["avif", "avis"].contains(brand) {
                fileExtension = "avif"
                mimeType = "image/avif"
            } else {
                fileExtension = "heic"
                mimeType = "image/heic"
            }
        } else {
            fileExtension = "jpg"
            mimeType = "image/jpeg"
        }
    }
}

enum StoryComposerMode {
    case capture
    case ready(StoryReadyMedia)

    var media: StoryReadyMedia? {
        switch self {
        case .capture:
            return nil
        case .ready(let media):
            return media
        }
    }
}
