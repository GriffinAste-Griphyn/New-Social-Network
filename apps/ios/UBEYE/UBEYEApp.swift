import SwiftUI

@main
struct UBEYEApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    @StateObject private var api: APIClient
    @StateObject private var auth: AuthStore
    @StateObject private var push: PushNotificationStore

    init() {
        let api = APIClient()
        let push = PushNotificationStore()
        _api = StateObject(wrappedValue: api)
        _auth = StateObject(wrappedValue: AuthStore())
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
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(api)
                .environmentObject(auth)
                .environmentObject(push)
                .task {
                    await auth.restoreSession(api: api)
                    if auth.account != nil {
                        await push.requestAuthorizationAndRegister(api: api)
                    }
                }
                .onChange(of: auth.account?.mobileToken) { _, token in
                    guard token != nil else {
                        return
                    }

                    Task {
                        await push.requestAuthorizationAndRegister(api: api)
                    }
                }
        }
    }
}
