import SwiftUI

struct StoryComposerFooter<Left: View, Center: View, Right: View>: View {
    let leftSlotSize: CGFloat
    let centerSlotSize: CGFloat
    let rightSlotSize: CGFloat
    private let left: () -> Left
    private let center: () -> Center
    private let right: () -> Right

    init(
        leftSlotSize: CGFloat,
        centerSlotSize: CGFloat,
        rightSlotSize: CGFloat,
        @ViewBuilder left: @escaping () -> Left,
        @ViewBuilder center: @escaping () -> Center,
        @ViewBuilder right: @escaping () -> Right
    ) {
        self.leftSlotSize = leftSlotSize
        self.centerSlotSize = centerSlotSize
        self.rightSlotSize = rightSlotSize
        self.left = left
        self.center = center
        self.right = right
    }

    var body: some View {
        HStack {
            left()
                .frame(width: leftSlotSize, height: leftSlotSize)

            Spacer()

            center()
                .frame(width: centerSlotSize, height: centerSlotSize)

            Spacer()

            right()
                .frame(width: rightSlotSize, height: rightSlotSize)
        }
        .frame(maxWidth: .infinity, minHeight: centerSlotSize)
    }
}

struct StoryComposerFooterPlaceholder: View {
    let size: CGFloat

    var body: some View {
        Color.clear
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}
