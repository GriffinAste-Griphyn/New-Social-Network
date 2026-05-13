import SwiftUI

extension Color {
    static let ubeyeRed = Color(red: 224 / 255, green: 22 / 255, blue: 22 / 255)
    static let ubeyeInk = Color(red: 5 / 255, green: 6 / 255, blue: 8 / 255)
    static let ubeyePanel = Color(red: 20 / 255, green: 22 / 255, blue: 27 / 255)
}

extension View {
    func ubeyeScreen() -> some View {
        self
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.ubeyeInk.ignoresSafeArea())
            .foregroundStyle(.white)
    }
}

struct EmptyStateView: View {
    let title: String
    let message: String
    var systemImage: String = "sparkles"

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: systemImage)
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(Color.ubeyeRed)
            Text(title)
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .multilineTextAlignment(.center)
                .foregroundStyle(.white.opacity(0.68))
        }
        .padding(24)
        .frame(maxWidth: .infinity)
    }
}

struct PrimaryButton: View {
    let title: String
    var isLoading = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                if isLoading {
                    ProgressView()
                        .tint(.white)
                }
                Text(title)
                    .fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(Color.ubeyeRed)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .disabled(isLoading)
    }
}
