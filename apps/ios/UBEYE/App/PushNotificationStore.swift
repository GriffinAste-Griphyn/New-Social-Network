import Foundation
import UIKit
import UserNotifications

@MainActor
final class PushNotificationStore: ObservableObject {
    @Published private(set) var isRegistered = false
    @Published private(set) var lastError: String?

    private var latestDeviceToken: String?
    private var isRequestingPermission = false

    func requestAuthorizationAndRegister(api: APIClient) async {
        guard !isRequestingPermission else {
            return
        }

        guard api.authToken != nil else {
            return
        }

        isRequestingPermission = true
        defer { isRequestingPermission = false }

        do {
            let center = UNUserNotificationCenter.current()
            let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
            guard granted else {
                lastError = "Notifications are disabled."
                return
            }

            UIApplication.shared.registerForRemoteNotifications()
        } catch {
            lastError = error.localizedDescription
        }
    }

    func didReceiveDeviceToken(_ deviceToken: Data, api: APIClient) {
        latestDeviceToken = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task {
            await registerLatestToken(api: api)
        }
    }

    func didFailToRegister(_ error: Error) {
        lastError = error.localizedDescription
    }

    func registerLatestToken(api: APIClient) async {
        guard let latestDeviceToken, api.authToken != nil else {
            return
        }

        do {
            try await api.registerAPNsDeviceToken(latestDeviceToken, environment: Self.apnsEnvironment)
            isRegistered = true
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    private static var apnsEnvironment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }
}
