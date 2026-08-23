import Foundation
import UIKit
import UserNotifications

@MainActor
final class PushNotificationStore: ObservableObject {
    @Published private(set) var isRegistered = false
    @Published private(set) var lastError: String?

    private var latestDeviceToken: String?
    private var isRequestingPermission = false

    func registerIfAuthorizationAlreadyGranted(api: APIClient) async {
        guard api.authToken != nil else {
            return
        }

        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard settings.authorizationStatus == .authorized ||
            settings.authorizationStatus == .provisional ||
            settings.authorizationStatus == .ephemeral else {
            return
        }

        UIApplication.shared.registerForRemoteNotifications()
    }

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

    func handleBackgroundNotification(
        _ userInfo: [AnyHashable: Any],
        api: APIClient
    ) async -> UIBackgroundFetchResult {
        guard api.authToken != nil,
              userInfo["type"] as? String == "creator_story_posted",
              let storyId = userInfo["storyId"] as? String,
              !storyId.isEmpty else {
            return .noData
        }

        do {
            async let stack: StoryStackResponse = api.storyStack(storyId: storyId, refresh: true)
            async let feed: MobileFeedResponse = api.mobileFeed(limit: 20)
            _ = try await (stack, feed)
            MediaPerformance.mark("silent_push_prewarm id=\(storyId) result=success")
            return .newData
        } catch {
            MediaPerformance.mark("silent_push_prewarm id=\(storyId) result=failed")
            return .failed
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
