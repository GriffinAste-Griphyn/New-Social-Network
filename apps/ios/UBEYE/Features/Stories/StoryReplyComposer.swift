import SwiftUI

struct StoryReplyComposer: View {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Binding var text: String
    var isFocused: FocusState<Bool>.Binding
    let isSending: Bool
    let onSubmit: () -> Void

    var body: some View {
        let fieldBackgroundOpacity = reduceTransparency ? 0.92 : (isFocused.wrappedValue ? 0.62 : 0.48)
        let fieldBorderOpacity = isFocused.wrappedValue ? 0.24 : 0.16

        return HStack(spacing: 10) {
            TextField(
                "",
                text: $text,
                prompt: Text("Reply").foregroundStyle(.white.opacity(0.86))
            )
                .textFieldStyle(.plain)
                .font(.body.weight(.semibold))
                .padding(.horizontal, 14)
                .frame(height: 46)
                .background(.black.opacity(fieldBackgroundOpacity), in: Capsule())
                .overlay(
                    Capsule()
                        .stroke(.white.opacity(fieldBorderOpacity), lineWidth: 1)
                )
                .foregroundColor(.white)
                .foregroundStyle(.white)
                .tint(.white)
                .focused(isFocused)
                .lineLimit(1)
                .submitLabel(.send)
                .onSubmit {
                    onSubmit()
                }
            Button {
                onSubmit()
            } label: {
                Image(systemName: isSending ? "hourglass" : "paperplane.fill")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 46, height: 46)
                    .background(Color.ubeyeRed, in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(isSending || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityLabel("Send reply")
        }
    }
}
