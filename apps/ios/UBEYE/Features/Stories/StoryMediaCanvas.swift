import SwiftUI

enum StoryMediaContract {
    static let aspectRatio: CGFloat = 9 / 16
    static let playbackPixelSize = CGSize(width: 1_080, height: 1_920)
    static let thumbnailPixelSize = CGSize(width: 360, height: 640)
    static let maximumImageUploadBytes = 25 * 1024 * 1024
    static let maximumImageDisplayDerivativeBytes = 1_500_000
    static let maximumImageThumbnailDerivativeBytes = 150_000
    static let displayAVIFQualityCandidates: [CGFloat] = [
        0.65, 0.60, 0.55, 0.50,
    ]
    static let displayWebPQualityCandidates: [Double] = [
        0.85, 0.80, 0.75, 0.70, 0.65,
    ]
    static let thumbnailWebPQualityCandidates: [Double] = [
        0.80, 0.75, 0.70, 0.65, 0.60,
    ]
    static let maximumVideoUploadBytes: Int64 = 512 * 1024 * 1024
    static let maximumVideoDurationSeconds = 120
}

struct StoryCanvasLayout: Equatable {
    static let aspectRatio = StoryMediaContract.aspectRatio
    static let playbackPixelSize = StoryMediaContract.playbackPixelSize
    static let thumbnailPixelSize = StoryMediaContract.thumbnailPixelSize

    let frame: CGRect

    init(
        containerSize: CGSize,
        reservedTopHeight: CGFloat = 0,
        reservedBottomHeight: CGFloat = 0,
        fillsAvailableHeight: Bool = false
    ) {
        let containerWidth = max(containerSize.width, 0)
        let containerHeight = max(containerSize.height, 0)
        let topHeight = max(reservedTopHeight, 0)
        let availableHeight = max(
            containerHeight - topHeight - max(reservedBottomHeight, 0),
            0
        )
        let canvasWidth: CGFloat
        let canvasHeight: CGFloat

        if fillsAvailableHeight {
            canvasHeight = availableHeight
            canvasWidth = canvasHeight * Self.aspectRatio
        } else {
            canvasWidth = min(
                containerWidth,
                availableHeight * Self.aspectRatio
            )
            canvasHeight = canvasWidth > 0
                ? canvasWidth / Self.aspectRatio
                : 0
        }

        frame = CGRect(
            x: (containerWidth - canvasWidth) / 2,
            y: topHeight,
            width: canvasWidth,
            height: canvasHeight
        )
    }
}

struct StoryCanvasForegroundImage: View {
    let image: Image

    var body: some View {
        image
            .resizable()
            .scaledToFit()
    }
}

struct StoryCanvasImage: View {
    let image: Image

    var body: some View {
        Color.black
            .overlay {
                StoryCanvasForegroundImage(image: image)
            }
            .clipped()
    }
}
