import SwiftUI
import UIKit

@MainActor
final class StoryPresentationCoordinator: ObservableObject {
    @Published private(set) var activeContext: StoryOpeningContext?
    @Published var isExpanded = false
    @Published var showsViewer = false
    @Published var showsOpeningBridge = false

    private var transitionTask: Task<Void, Never>?

    var isPresenting: Bool {
        activeContext != nil
    }

    func present(_ context: StoryOpeningContext) {
        transitionTask?.cancel()
        activeContext = context
        isExpanded = false
        showsViewer = false
        showsOpeningBridge = true
        UBEYEHaptics.storyOpen()
        MediaPerformance.mark("story_transition_begin id=\(context.route.id) source=\(String(describing: context.route.source))")

        transitionTask = Task { @MainActor in
            await Task.yield()
            guard !Task.isCancelled else {
                return
            }

            withAnimation(.spring(response: 0.34, dampingFraction: 0.88)) {
                self.isExpanded = true
            }

            try? await Task.sleep(for: .milliseconds(90))
            guard !Task.isCancelled else {
                return
            }

            self.showsViewer = true
            MediaPerformance.mark("story_overlay_visible id=\(context.route.id)")

            try? await Task.sleep(for: .milliseconds(260))
            guard !Task.isCancelled else {
                return
            }

            withAnimation(.easeOut(duration: 0.14)) {
                self.showsOpeningBridge = false
            }
            MediaPerformance.mark("story_transition_complete id=\(context.route.id)")
        }
    }

    func dismiss() {
        guard let context = activeContext else {
            return
        }

        transitionTask?.cancel()
        UBEYEHaptics.storyDismiss()
        MediaPerformance.mark("story_transition_dismiss_begin id=\(context.route.id)")

        withAnimation(.spring(response: 0.28, dampingFraction: 0.9)) {
            isExpanded = false
            showsViewer = false
            showsOpeningBridge = true
        }

        transitionTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(240))
            guard !Task.isCancelled else {
                return
            }

            self.activeContext = nil
            self.showsOpeningBridge = false
            MediaPerformance.mark("story_transition_dismiss_complete id=\(context.route.id)")
        }
    }
}

struct StoryOpeningContext: Identifiable, Equatable {
    let id = UUID()
    let route: StoryRoute
    let thumbnailUrl: URL?
    let transitionId: String

    init(route: StoryRoute, thumbnailUrl: URL?, transitionId: String) {
        self.route = route
        self.thumbnailUrl = thumbnailUrl
        self.transitionId = transitionId
    }
}

enum StoryTransitionIdentity {
    static func story(_ id: String) -> String {
        "story-transition-\(id)"
    }
}

enum UBEYEHaptics {
    private static let storyOpenGenerator = UIImpactFeedbackGenerator(style: .light)
    private static let storyDismissGenerator = UIImpactFeedbackGenerator(style: .soft)
    private static let storyNavigationGenerator = UISelectionFeedbackGenerator()

    static func storyPress() {
        storyOpenGenerator.prepare()
        storyOpenGenerator.impactOccurred(intensity: 0.55)
    }

    static func storyOpen() {
        storyOpenGenerator.prepare()
        storyOpenGenerator.impactOccurred(intensity: 0.72)
    }

    static func storyDismiss() {
        storyDismissGenerator.prepare()
        storyDismissGenerator.impactOccurred(intensity: 0.62)
    }

    static func storyNavigation() {
        storyNavigationGenerator.prepare()
        storyNavigationGenerator.selectionChanged()
    }
}

private struct StoryTransitionNamespaceKey: EnvironmentKey {
    static let defaultValue: Namespace.ID? = nil
}

extension EnvironmentValues {
    var storyTransitionNamespace: Namespace.ID? {
        get { self[StoryTransitionNamespaceKey.self] }
        set { self[StoryTransitionNamespaceKey.self] = newValue }
    }
}

extension View {
    @ViewBuilder
    func storyMatchedGeometry(id: String, namespace: Namespace.ID?) -> some View {
        if let namespace {
            matchedGeometryEffect(id: id, in: namespace)
        } else {
            self
        }
    }
}

struct InstantStoryButton<Label: View>: View {
    let action: () -> Void
    var onPressStart: () -> Void = {}
    @ViewBuilder let label: () -> Label
    @State private var isPressed = false
    @State private var didStartPress = false

    var body: some View {
        Button(action: action) {
            label()
                .scaleEffect(isPressed ? 0.985 : 1)
                .animation(.easeOut(duration: 0.12), value: isPressed)
        }
        .buttonStyle(.plain)
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0, maximumDistance: 18)
                .onChanged { _ in
                    guard !didStartPress else {
                        return
                    }
                    didStartPress = true
                    isPressed = true
                    UBEYEHaptics.storyPress()
                    onPressStart()
                }
                .onEnded { _ in
                    isPressed = false
                    didStartPress = false
                }
        )
    }
}

struct StoryPresentationOverlay: View {
    @EnvironmentObject private var presenter: StoryPresentationCoordinator
    let namespace: Namespace.ID
    @State private var dragOffset: CGFloat = 0
    @State private var didCrossDismissThreshold = false

    private let dismissThreshold: CGFloat = 130

    var body: some View {
        GeometryReader { proxy in
            if let context = presenter.activeContext {
                ZStack {
                    Color.black
                        .opacity(backgroundOpacity)
                        .ignoresSafeArea()

                    if presenter.showsViewer {
                        StoryStackViewer(
                            route: context.route,
                            openingThumbnailUrl: context.thumbnailUrl,
                            onDismiss: {
                                presenter.dismiss()
                            }
                        )
                        .opacity(viewerOpacity)
                        .transition(.opacity)
                    }

                    if presenter.showsOpeningBridge {
                        StoryOpeningBridge(thumbnailUrl: context.thumbnailUrl)
                            .frame(width: proxy.size.width, height: proxy.size.height)
                            .clipShape(RoundedRectangle(cornerRadius: presenter.isExpanded ? 0 : 8, style: .continuous))
                            .storyMatchedGeometry(id: context.transitionId, namespace: namespace)
                            .ignoresSafeArea()
                            .allowsHitTesting(false)
                    }
                }
                .offset(y: dragOffset)
                .scaleEffect(activeScale)
                .animation(.spring(response: 0.28, dampingFraction: 0.88), value: dragOffset == 0)
                .highPriorityGesture(dismissGesture)
                .onChange(of: presenter.activeContext?.id) { _, _ in
                    dragOffset = 0
                    didCrossDismissThreshold = false
                }
            }
        }
        .ignoresSafeArea()
    }

    private var backgroundOpacity: Double {
        if dragOffset <= 0 {
            return presenter.isExpanded ? 1 : 0
        }

        let progress = min(Double(dragOffset / 280), 0.5)
        return max((presenter.isExpanded ? 1 : 0) - progress, 0)
    }

    private var viewerOpacity: Double {
        presenter.showsViewer ? 1 : 0
    }

    private var activeScale: CGFloat {
        guard dragOffset > 0 else {
            return 1
        }

        return max(0.9, 1 - dragOffset / 1800)
    }

    private var dismissGesture: some Gesture {
        DragGesture(minimumDistance: 18, coordinateSpace: .local)
            .onChanged { value in
                guard value.translation.height > 0,
                      abs(value.translation.height) > abs(value.translation.width) * 1.15 else {
                    return
                }

                dragOffset = value.translation.height
                if dragOffset > dismissThreshold, !didCrossDismissThreshold {
                    didCrossDismissThreshold = true
                    UBEYEHaptics.storyDismiss()
                } else if dragOffset <= dismissThreshold {
                    didCrossDismissThreshold = false
                }
            }
            .onEnded { value in
                let shouldDismiss = value.translation.height > dismissThreshold ||
                    value.predictedEndTranslation.height > 220

                if shouldDismiss {
                    presenter.dismiss()
                } else {
                    withAnimation(.spring(response: 0.26, dampingFraction: 0.86)) {
                        dragOffset = 0
                    }
                }
            }
    }
}

private struct StoryOpeningBridge: View {
    let thumbnailUrl: URL?

    var body: some View {
        ZStack {
            Color.black

            if let thumbnailUrl {
                CachedAsyncImage(url: thumbnailUrl) { image in
                    image
                        .resizable()
                        .scaledToFill()
                } placeholder: {
                    Color.black
                }
            }

            LinearGradient(
                colors: [.clear, .black.opacity(0.18), .black.opacity(0.42)],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .clipped()
    }
}
