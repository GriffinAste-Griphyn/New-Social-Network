import SwiftUI

struct StoryThumbnailOverlayView: View {
    let overlays: [StoryTextOverlay]
    var fontSize: CGFloat = 10
    var horizontalPadding: CGFloat = 7
    var verticalPadding: CGFloat = 4
    var maxLines: Int = 2

    var body: some View {
        GeometryReader { proxy in
            ForEach(visibleOverlays) { overlay in
                thumbnailOverlay(overlay, maxWidth: max(proxy.size.width - 16, 44))
                    .fixedSize(horizontal: false, vertical: true)
                    .position(clampedPosition(for: overlay, in: proxy.size))
            }
        }
        .allowsHitTesting(false)
    }

    private var visibleOverlays: [StoryTextOverlay] {
        overlays.filter {
            !$0.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        .prefix(2)
        .map { $0 }
    }

    @ViewBuilder
    private func thumbnailOverlay(_ overlay: StoryTextOverlay, maxWidth: CGFloat) -> some View {
        if overlay.kind == "quote_reply" {
            quoteReplyCard(overlay, maxWidth: maxWidth)
        } else {
            chip(overlay, maxWidth: maxWidth)
        }
    }

    private func chip(_ overlay: StoryTextOverlay, maxWidth: CGFloat) -> some View {
        HStack(spacing: 4) {
            if overlay.kind == "link" {
                Image(systemName: "link")
                    .font(.system(size: max(fontSize - 2, 7), weight: .bold))
            }

            Text(overlay.label)
                .font(.system(size: fontSize, weight: .bold))
                .lineLimit(maxLines)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, horizontalPadding)
        .padding(.vertical, verticalPadding)
        .frame(maxWidth: maxWidth)
        .background(.black.opacity(0.46), in: Capsule())
    }

    private func quoteReplyCard(_ overlay: StoryTextOverlay, maxWidth: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 5) {
                quoteAvatar(overlay)

                VStack(alignment: .leading, spacing: 0) {
                    Text(overlay.sourceActorName ?? "Reply")
                        .font(.system(size: max(fontSize - 1, 8), weight: .bold))
                        .lineLimit(1)

                    if let handle = overlay.sourceActorHandle, !handle.isEmpty {
                        Text("@\(handle)")
                            .font(.system(size: max(fontSize - 3, 7), weight: .semibold))
                            .foregroundStyle(.white.opacity(0.72))
                            .lineLimit(1)
                    }
                }
            }

            Text(overlay.label)
                .font(.system(size: max(fontSize, 9), weight: .bold))
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, horizontalPadding + 1)
        .padding(.vertical, verticalPadding + 2)
        .frame(width: min(maxWidth, 118), alignment: .leading)
        .background(.black.opacity(0.68), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .stroke(.white.opacity(0.18), lineWidth: 0.7)
        )
    }

    private func quoteAvatar(_ overlay: StoryTextOverlay) -> some View {
        ZStack {
            Circle()
                .fill(Color.ubeyeRed)

            Text(quoteInitial(for: overlay))
                .font(.system(size: max(fontSize - 2, 7), weight: .black))
                .foregroundStyle(.white)
        }
        .frame(width: max(fontSize + 9, 16), height: max(fontSize + 9, 16))
    }

    private func quoteInitial(for overlay: StoryTextOverlay) -> String {
        let source = overlay.sourceActorName ?? overlay.sourceActorHandle ?? "R"
        return source.trimmingCharacters(in: .whitespacesAndNewlines).first.map { String($0).uppercased() } ?? "R"
    }

    private func clampedPosition(for overlay: StoryTextOverlay, in size: CGSize) -> CGPoint {
        let x = size.width * CGFloat(min(max(overlay.positionX, 0), 100) / 100)
        let y = size.height * CGFloat(min(max(overlay.positionY, 0), 100) / 100)
        let horizontalInset = min(max(size.width * 0.08, 10), size.width / 2)
        let verticalInset = min(max(size.height * 0.06, 10), size.height / 2)

        return CGPoint(
            x: min(max(x, horizontalInset), size.width - horizontalInset),
            y: min(max(y, verticalInset), size.height - verticalInset)
        )
    }
}
