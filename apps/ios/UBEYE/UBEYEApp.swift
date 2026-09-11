import SwiftUI

@main
struct UBEYEApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    @StateObject private var api: APIClient
    @StateObject private var auth: AuthStore
    @StateObject private var mediaEngine: MediaEngine
    @StateObject private var pendingStoryUploads: PendingStoryUploadStore
    @StateObject private var push: PushNotificationStore

    init() {
        AppReliabilityMonitor.shared.start()
        let api = APIClient()
        let auth = AuthStore()
        let pendingStoryUploads = PendingStoryUploadStore()
        let push = PushNotificationStore()
        _api = StateObject(wrappedValue: api)
        _auth = StateObject(wrappedValue: auth)
        _mediaEngine = StateObject(wrappedValue: MediaEngine())
        _pendingStoryUploads = StateObject(wrappedValue: pendingStoryUploads)
        _push = StateObject(wrappedValue: push)

        AppDelegate.onDeviceToken = { deviceToken in
            Task { @MainActor in
                push.didReceiveDeviceToken(deviceToken, api: api)
            }
        }
        AppDelegate.onRegistrationError = { error in
            Task { @MainActor in
                push.didFailToRegister(error)
            }
        }
        AppDelegate.onBackgroundNotification = { userInfo, completion in
            Task { @MainActor in
                let result = await push.handleBackgroundNotification(userInfo, api: api)
                completion(result)
            }
        }
        AppDelegate.onStoryBackgroundTransferEvents = {
            await auth.restoreSession(api: api)
            guard auth.account != nil else {
                return
            }
            await pendingStoryUploads.waitForActiveUploadsToSettle()
            _ = await pendingStoryUploads.resumeInterruptedUploads(api: api)
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(api)
                .environmentObject(auth)
                .environmentObject(mediaEngine)
                .environmentObject(pendingStoryUploads)
                .environmentObject(push)
                .task {
                    await auth.restoreSession(api: api)
                    if auth.account != nil {
                        await push.registerIfAuthorizationAlreadyGranted(api: api)
                    }
                }
                .onChange(of: auth.account?.mobileToken) { _, token in
                    guard token != nil else {
                        return
                    }

                    Task {
                        await push.registerIfAuthorizationAlreadyGranted(api: api)
                    }
                }
        }
    }
}
