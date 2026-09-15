import AVFoundation
import CryptoKit
import Foundation
import ImageIO
import MetricKit
import Network
import os
import SwiftUI
import UIKit

extension Color {
    static let ubeyeRed = Color(red: 224 / 255, green: 22 / 255, blue: 22 / 255)
    static let ubeyeNavy = Color(red: 13 / 255, green: 18 / 255, blue: 28 / 255)
    static let ubeyeInk = Color(red: 15 / 255, green: 16 / 255, blue: 20 / 255)
    static let ubeyeMuted = Color(red: 107 / 255, green: 114 / 255, blue: 128 / 255)
    static let ubeyeSubtle = Color(red: 246 / 255, green: 247 / 255, blue: 249 / 255)
    static let ubeyeBackground = Color(red: 250 / 255, green: 250 / 255, blue: 251 / 255)
    static let ubeyePanel = Color.white
    static let ubeyeBorder = Color(red: 229 / 255, green: 231 / 255, blue: 235 / 255)
    static let ubeyeYellow = Color(red: 253 / 255, green: 224 / 255, blue: 71 / 255)
    static let ubeyePurple = Color(red: 124 / 255, green: 58 / 255, blue: 237 / 255)
}

enum UBEYEMetrics {
    static let screenInset: CGFloat = 16
    static let topAvatar: CGFloat = 42
    static let topAvatarTopInset: CGFloat = 14
    static let compactTopAvatar: CGFloat = 38
    static let bottomBarItemHeight: CGFloat = 52
    static let bottomBarTopPadding: CGFloat = 8
    static let bottomBarBottomPadding: CGFloat = 7
    static var bottomBarHeight: CGFloat {
        bottomBarItemHeight + bottomBarTopPadding + bottomBarBottomPadding
    }
}

@MainActor
enum UBEYEFeedback {
    enum Vocabulary {
        case selection
        case snap
        case boundary
        case success
        case warning
        case failure
    }

    private static let selectionGenerator = UISelectionFeedbackGenerator()
    private static let lightImpactGenerator = UIImpactFeedbackGenerator(style: .light)
    private static let mediumImpactGenerator = UIImpactFeedbackGenerator(style: .medium)
    private static let heavyImpactGenerator = UIImpactFeedbackGenerator(style: .heavy)
    private static let rigidImpactGenerator = UIImpactFeedbackGenerator(style: .rigid)
    private static let softImpactGenerator = UIImpactFeedbackGenerator(style: .soft)
    private static let notificationGenerator = UINotificationFeedbackGenerator()

    static func prepare(_ vocabulary: Vocabulary = .selection) {
        switch vocabulary {
        case .selection:
            selectionGenerator.prepare()
        case .snap:
            lightImpactGenerator.prepare()
        case .boundary:
            rigidImpactGenerator.prepare()
        case .success, .warning, .failure:
            notificationGenerator.prepare()
        }
    }

    static func selection() {
        selectionGenerator.selectionChanged()
        selectionGenerator.prepare()
    }

    static func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .light, intensity: CGFloat = 0.85) {
        let generator = impactGenerator(for: style)
        generator.impactOccurred(intensity: intensity)
        generator.prepare()
    }

    static func snap() {
        lightImpactGenerator.impactOccurred(intensity: 0.72)
        lightImpactGenerator.prepare()
    }

    static func boundary() {
        rigidImpactGenerator.impactOccurred(intensity: 0.88)
        rigidImpactGenerator.prepare()
    }

    static func success() {
        notificationGenerator.notificationOccurred(.success)
        notificationGenerator.prepare()
    }

    static func warning() {
        notificationGenerator.notificationOccurred(.warning)
        notificationGenerator.prepare()
    }

    static func error() {
        notificationGenerator.notificationOccurred(.error)
        notificationGenerator.prepare()
    }

    private static func impactGenerator(
        for style: UIImpactFeedbackGenerator.FeedbackStyle
    ) -> UIImpactFeedbackGenerator {
        switch style {
        case .light:
            lightImpactGenerator
        case .medium:
            mediumImpactGenerator
        case .heavy:
            heavyImpactGenerator
        case .rigid:
            rigidImpactGenerator
        case .soft:
            softImpactGenerator
        @unknown default:
            lightImpactGenerator
        }
    }
}

struct UBEYEPressButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var pressedScale: CGFloat = 0.96
    var pressedOpacity: Double = 0.82

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
            .scaleEffect(configuration.isPressed && !reduceMotion ? pressedScale : 1)
            .opacity(configuration.isPressed ? pressedOpacity : 1)
            .animation(
                reduceMotion ? .easeOut(duration: 0.08) : .snappy(duration: 0.16),
                value: configuration.isPressed
            )
    }
}

extension View {
    func ubeyeScreen() -> some View {
        self
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.ubeyeBackground.ignoresSafeArea())
            .foregroundStyle(Color.ubeyeInk)
    }

    func ubeyeCard(cornerRadius: CGFloat = 8) -> some View {
        self
            .background(Color.ubeyePanel)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(Color.ubeyeBorder.opacity(0.85), lineWidth: 1)
            )
    }

    func ubeyeMediaCardChrome(cornerRadius: CGFloat = 8) -> some View {
        self
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(.white.opacity(0.16), lineWidth: 1)
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(Color.black.opacity(0.08), lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.10), radius: 12, x: 0, y: 6)
    }
}

struct EmptyStateView: View {
    let title: String
    let message: String
    var systemImage: String = "sparkles"

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: systemImage)
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(Color.ubeyeRed)
            Text(title)
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .multilineTextAlignment(.center)
                .foregroundStyle(Color.ubeyeMuted)
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .ubeyeCard()
    }
}

struct UBEYESkeletonBlock: View {
    var cornerRadius: CGFloat = 8

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [
                        Color.ubeyeSubtle,
                        Color.ubeyeBorder.opacity(0.74),
                        Color.ubeyeRed.opacity(0.045),
                        Color.ubeyeSubtle.opacity(0.96)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(Color.white.opacity(0.64), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}

struct UBEYESkeletonLine: View {
    let width: CGFloat
    var height: CGFloat = 10

    var body: some View {
        UBEYESkeletonBlock(cornerRadius: height / 2)
            .frame(width: width, height: height)
    }
}

struct UBEYESkeletonCircle: View {
    let size: CGFloat

    var body: some View {
        Circle()
            .fill(
                LinearGradient(
                    colors: [
                        Color.ubeyeSubtle,
                        Color.ubeyeBorder.opacity(0.78),
                        Color.ubeyeSubtle.opacity(0.94)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(Circle().stroke(Color.white.opacity(0.7), lineWidth: 1))
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

struct PrimaryButton: View {
    let title: String
    var isLoading = false
    var isDisabled = false
    let action: () -> Void

    var body: some View {
        Button {
            UBEYEFeedback.impact(.light)
            action()
        } label: {
            HStack {
                if isLoading {
                    ProgressView()
                        .tint(.white)
                }
                Text(title)
                    .fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(isDisabled ? Color.ubeyeMuted.opacity(0.45) : Color.ubeyeNavy)
            .clipShape(Capsule())
            .foregroundStyle(.white)
        }
        .buttonStyle(UBEYEPressButtonStyle())
        .disabled(isLoading || isDisabled)
    }
}

struct UBEYEWordmark: View {
    var compact = false

    var body: some View {
        Image("UBEYELogo")
            .resizable()
            .scaledToFit()
        .frame(width: compact ? 32 : 38, height: compact ? 32 : 38)
        .accessibilityLabel("UBEYE")
    }
}

struct CircleIconButton: View {
    let systemImage: String
    var action: () -> Void = {}

    var body: some View {
        Button {
            UBEYEFeedback.selection()
            action()
        } label: {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .semibold))
                .frame(width: 36, height: 36)
                .foregroundStyle(Color.ubeyeInk)
                .background(Color.ubeyeSubtle, in: Circle())
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(UBEYEPressButtonStyle(pressedScale: 0.9))
    }
}

struct RemoteAvatar: View {
    @Environment(\.displayScale) private var displayScale
    let url: URL?
    var size: CGFloat = 44
    var name: String = ""
    @State private var loadedImage: UIImage?
    @State private var loadedImageURL: URL?

    private var pixels: CGFloat { MediaImagePixelBudget.avatar(points: size, scale: displayScale) }

    var body: some View {
        ZStack {
            if let image = MediaImageCache.shared.cachedImage(for: url, maxPixelDimension: pixels) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else if loadedImageURL == url, let image = loadedImage {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                placeholder
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .task(id: "\(url?.absoluteString ?? "-")|\(pixels)") {
            await loadImageIfNeeded()
        }
    }

    private var placeholder: some View {
        ZStack {
            Circle().fill(Color.ubeyeRed)
            Text(initials)
                .font(.system(size: max(11, size * 0.32), weight: .black))
                .foregroundStyle(.white)
        }
    }

    private var initials: String {
        let parts = name.split(separator: " ")
        let letters = parts.prefix(2).compactMap { $0.first }
        let value = String(letters).uppercased()
        return value.isEmpty ? "U" : value
    }

    private func loadImageIfNeeded() async {
        guard let url else {
            loadedImage = nil
            loadedImageURL = nil
            return
        }

        if let cached = MediaImageCache.shared.cachedImage(for: url, maxPixelDimension: pixels) {
            loadedImage = cached
            loadedImageURL = url
            return
        }

        loadedImage = nil
        loadedImageURL = nil

        if let image = await MediaImageCache.shared.loadImage(for: url, maxPixelDimension: pixels) {
            loadedImage = image
            loadedImageURL = url
        } else {
            loadedImage = nil
            loadedImageURL = nil
        }
    }

}

struct TopAvatarSpacer: View {
    var body: some View {
        Color.clear
            .frame(width: UBEYEMetrics.topAvatar, height: UBEYEMetrics.topAvatar)
    }
}

struct UBEYEPill: View {
    let title: String
    var systemImage: String?
    var tint: Color = .ubeyeRed

    var body: some View {
        HStack(spacing: 6) {
            if let systemImage {
                Image(systemName: systemImage)
            }
            Text(title)
        }
        .font(.caption.weight(.bold))
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .foregroundStyle(tint)
        .background(tint.opacity(0.1), in: Capsule())
    }
}

struct InlineNotice: View {
    let message: String
    var isError = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: isError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .foregroundStyle(isError ? Color.ubeyeRed : Color.green)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Color.ubeyeInk)
            Spacer(minLength: 0)
        }
        .padding(12)
        .background((isError ? Color.ubeyeRed : Color.green).opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke((isError ? Color.ubeyeRed : Color.green).opacity(0.18), lineWidth: 1)
        )
    }
}

struct StoryPressPrewarmModifier: ViewModifier {
    let action: () -> Void
    @State private var didPrewarmCurrentPress = false

    func body(content: Content) -> some View {
        content.simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    guard !didPrewarmCurrentPress else {
                        return
                    }
                    didPrewarmCurrentPress = true
                    UBEYEFeedback.prepare(.selection)
                    action()
                }
                .onEnded { _ in
                    didPrewarmCurrentPress = false
                }
        )
    }
}

extension View {
    func storyPressPrewarm(_ action: @escaping () -> Void) -> some View {
        modifier(StoryPressPrewarmModifier(action: action))
    }
}
