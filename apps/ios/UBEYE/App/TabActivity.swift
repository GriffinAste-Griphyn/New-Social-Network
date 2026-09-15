import SwiftUI

private struct TabActivityKey: EnvironmentKey { static let defaultValue = true }
extension EnvironmentValues {
    var isTabActive: Bool {
        get { self[TabActivityKey.self] }
        set { self[TabActivityKey.self] = newValue }
    }
}

/// Retains invalidation while hidden and combines bursts into one refresh.
@MainActor
final class TabRefreshController: ObservableObject {
    private var isActive = false
    private var pending = false
    private var force = false
    private var generation = 0
    private var task: Task<Void, Never>?
    private var operation: ((Bool) async -> Void)?
    private let debounce: Duration

    init(debounce: Duration = .milliseconds(150)) { self.debounce = debounce }

    func setActive(_ active: Bool, operation: @escaping (Bool) async -> Void) {
        // A hidden/disposed view must not be retained through its callback.
        self.operation = active ? operation : nil
        guard isActive != active else { return }
        isActive = active
        if active { request(force: false) }
        else {
            if task != nil { pending = true; force = true }
            generation += 1
            task?.cancel()
            task = nil
        }
    }

    func request(force: Bool = true) {
        pending = true
        self.force = self.force || force
        guard isActive, task == nil else { return }
        let token = generation
        task = Task { @MainActor [weak self] in
            guard let self else { return }
            defer { if generation == token { task = nil } }
            while isActive, pending, generation == token, !Task.isCancelled {
                if self.force {
                    do { try await Task.sleep(for: debounce) } catch { return }
                }
                guard isActive, generation == token, !Task.isCancelled else { return }
                let shouldForce = self.force
                self.force = false
                pending = false
                await operation?(shouldForce)
            }
        }
    }
}

private struct ActiveTabRefresh: ViewModifier {
    @Environment(\.isTabActive) private var isTabActive
    @Environment(\.scenePhase) private var scenePhase
    let controller: TabRefreshController
    let operation: (Bool) async -> Void

    func body(content: Content) -> some View {
        content
            .onAppear { controller.setActive(isTabActive && scenePhase == .active, operation: operation) }
            .onChange(of: isTabActive && scenePhase == .active, initial: true) { _, active in
                controller.setActive(active, operation: operation)
            }
            .onDisappear { controller.setActive(false, operation: operation) }
    }
}

extension View {
    func activeTabRefresh(_ controller: TabRefreshController,
                          operation: @escaping (Bool) async -> Void) -> some View {
        modifier(ActiveTabRefresh(controller: controller, operation: operation))
    }
}
