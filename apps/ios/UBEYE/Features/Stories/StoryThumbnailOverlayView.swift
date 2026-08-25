import SwiftUI

enum StoryTextOverlayAppearance {
    static let fontSize: CGFloat = 16
    static let letterSpacing: CGFloat = 0.2
    static let horizontalPadding: CGFloat = 10
    static let verticalPadding: CGFloat = 5
    static let minimumWidth: CGFloat = 56
    static let cornerRadius: CGFloat = 6
    static let horizontalScreenInset: CGFloat = 24
    static let thumbnailCornerRadius: CGFloat = 4
    static let quoteAuthorForeground = Color.white
    static let quoteCardBackground = Color.black.opacity(0.86)
    static let quoteMessageForeground = Color.white.opacity(0.94)
    static let quoteCardBorder = Color.white.opacity(0.14)
}

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
        .background(
            .black.opacity(0.46),
            in: RoundedRectangle(
                cornerRadius: StoryTextOverlayAppearance.thumbnailCornerRadius,
                style: .continuous
            )
        )
    }

    private func quoteReplyCard(_ overlay: StoryTextOverlay, maxWidth: CGFloat) -> some View {
        // Keep the reply legible without letting it dominate a 132×192 tile.
        // The compact proportions, dark treatment, and restrained tilt
        // preserve the lightweight comment-sticker character of the source UI.
        let cardWidth = min(maxWidth, max(fontSize * 10, 60))
        let cardCornerRadius = max(fontSize * 0.72, 4.5)
        let avatarSize = max(fontSize + 5, 11)
        let authorFontSize = max(fontSize * 0.92, 5.5)
        let messageFontSize = max(fontSize * 0.8, 4.8)
        let resolvedHorizontalPadding = max(horizontalPadding - 0.5, 3.5)
        let resolvedVerticalPadding = max(verticalPadding - 0.5, 2.5)

        return HStack(alignment: .center, spacing: max(fontSize * 0.42, 2.5)) {
            quoteAvatar(overlay, size: avatarSize)

            VStack(alignment: .leading, spacing: max(fontSize * 0.06, 0.35)) {
                Text(overlay.sourceActorName ?? "Reply")
                    .font(.system(size: authorFontSize, weight: .bold))
                    .foregroundStyle(StoryTextOverlayAppearance.quoteAuthorForeground)
                    .lineLimit(1)

                Text(overlay.label)
                    .font(.system(size: messageFontSize, weight: .medium))
                    .foregroundStyle(StoryTextOverlayAppearance.quoteMessageForeground)
                    .tracking(-0.05)
                    .lineSpacing(-0.35)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, resolvedHorizontalPadding)
        .padding(.vertical, resolvedVerticalPadding)
        .frame(width: cardWidth, alignment: .leading)
        .background(
            StoryTextOverlayAppearance.quoteCardBackground,
            in: RoundedRectangle(cornerRadius: cardCornerRadius, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: cardCornerRadius, style: .continuous)
                .stroke(StoryTextOverlayAppearance.quoteCardBorder, lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.28), radius: 1.5, y: 0.75)
        .rotationEffect(.degrees(-2.5))
    }

    private func quoteAvatar(_ overlay: StoryTextOverlay, size: CGFloat) -> some View {
        CachedAsyncImage(url: overlay.sourceActorAvatarUrl) { image in
            image
                .resizable()
                .scaledToFill()
        } placeholder: {
            ZStack {
                Circle()
                    .fill(Color.ubeyeRed)

                Text(quoteInitial(for: overlay))
                    .font(.system(size: max(size * 0.44, 5.5), weight: .black))
                    .foregroundStyle(.white)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().stroke(Color.ubeyeInk.opacity(0.08), lineWidth: 0.5))
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
