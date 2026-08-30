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
    let verticalPlacement: StoryCanvasVerticalPlacement

    init(
        containerSize: CGSize,
        reservedTopHeight: CGFloat = 0,
        reservedBottomHeight: CGFloat = 0,
        fillsAvailableHeight: Bool = false,
        verticalPlacement: StoryCanvasVerticalPlacement = .center
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

        let canvasOriginY = switch verticalPlacement {
        case .top:
            topHeight
        case .center:
            (containerHeight - canvasHeight) / 2
        }

        self.verticalPlacement = verticalPlacement
        frame = CGRect(
            x: (containerWidth - canvasWidth) / 2,
            y: canvasOriginY,
            width: canvasWidth,
            height: canvasHeight
        )
    }
}

enum StoryCanvasVerticalPlacement: Equatable {
    case top
    case center

    static func forRenditions(
        _ renditions: StoryMediaRenditions?,
        prefersPlaybackDimensions: Bool = false,
        missingDimensionsFallback: Self = .center
    ) -> Self {
        let sourceRendition = prefersPlaybackDimensions
            ? renditions?.playback
            : renditions?.original ?? renditions?.playback
        guard let width = sourceRendition?.width,
              let height = sourceRendition?.height,
              width > 0,
              height > 0 else {
            return missingDimensionsFallback
        }

        return forMediaDimensions(width: width, height: height)
    }

    static func forMediaDimensions(width: Int?, height: Int?) -> Self {
        guard let width,
              let height,
              width > 0,
              height > 0 else {
            return .center
        }

        return width < height ? .top : .center
    }
}

private struct StoryCanvasFrameModifier: ViewModifier {
    let layout: StoryCanvasLayout
    let cornerRadius: CGFloat

    func body(content: Content) -> some View {
        content
            .frame(
                width: layout.frame.width,
                height: layout.frame.height
            )
            .position(
                x: layout.frame.midX,
                y: layout.frame.midY
            )
            .clipShape(
                RoundedRectangle(
                    cornerRadius: max(cornerRadius, 0),
                    style: .continuous
                )
            )
    }
}

extension View {
    func storyCanvasFrame(
        _ layout: StoryCanvasLayout,
        cornerRadius: CGFloat = 0
    ) -> some View {
        modifier(
            StoryCanvasFrameModifier(
                layout: layout,
                cornerRadius: cornerRadius
            )
        )
    }
}

struct StoryCanvasForegroundImage: View {
    let image: Image
    var verticalContentOffsetFraction: CGFloat = 0

    var body: some View {
        GeometryReader { proxy in
            image
                .resizable()
                .scaledToFit()
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                .offset(y: proxy.size.height * verticalContentOffsetFraction)
        }
    }
}

struct StoryCanvasBackground: View {
    var body: some View {
        Color.black
    }
}

struct StoryCanvasImage: View {
    let image: Image
    var verticalContentOffsetFraction: CGFloat = 0

    var body: some View {
        StoryCanvasBackground()
            .overlay {
                StoryCanvasForegroundImage(
                    image: image,
                    verticalContentOffsetFraction: verticalContentOffsetFraction
                )
            }
            .clipped()
    }
}

enum StoryImageVerticalAlignmentPolicy {
    static func correctionFraction(for image: UIImage) -> CGFloat {
        guard let cgImage = image.cgImage,
              cgImage.width > 0,
              cgImage.height > 0,
              cgImage.bitsPerPixel % 8 == 0,
              let data = cgImage.dataProvider?.data,
              let bytes = CFDataGetBytePtr(data) else {
            return 0
        }

        let bytesPerPixel = cgImage.bitsPerPixel / 8
        let usesLittleEndian32BitOrder = cgImage.bitsPerPixel == 32 &&
            cgImage.bitmapInfo.contains(.byteOrder32Little)
        let alphaOffset: Int
        switch cgImage.alphaInfo {
        case .premultipliedFirst, .first:
            alphaOffset = usesLittleEndian32BitOrder ? bytesPerPixel - 1 : 0
        case .premultipliedLast, .last:
            alphaOffset = usesLittleEndian32BitOrder ? 0 : bytesPerPixel - 1
        default:
            return 0
        }
        guard alphaOffset >= 0, alphaOffset < bytesPerPixel else {
            return 0
        }

        let sampledXPositions = [0.25, 0.5, 0.75].map {
            min(max(Int(CGFloat(cgImage.width - 1) * $0), 0), cgImage.width - 1)
        }
        let visibilityThreshold: UInt8 = 8
        func rowHasVisibleContent(_ y: Int) -> Bool {
            sampledXPositions.contains { x in
                let offset = y * cgImage.bytesPerRow + x * bytesPerPixel + alphaOffset
                return bytes[offset] > visibilityThreshold
            }
        }

        guard let firstVisibleRow = (0..<cgImage.height).first(where: rowHasVisibleContent),
              let lastVisibleRow = (0..<cgImage.height).reversed().first(where: rowHasVisibleContent) else {
            return 0
        }

        let topPadding = firstVisibleRow
        let bottomPadding = cgImage.height - lastVisibleRow - 1
        let paddingAsymmetry = bottomPadding - topPadding
        guard abs(paddingAsymmetry) >= max(cgImage.height / 100, 2) else {
            return 0
        }

        return CGFloat(paddingAsymmetry) / CGFloat(cgImage.height) / 2
    }
}
