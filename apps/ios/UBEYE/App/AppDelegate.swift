import UIKit

final class AppDelegate: NSObject, UIApplicationDelegate {
    static var onDeviceToken: ((Data) -> Void)?
    static var onRegistrationError: ((Error) -> Void)?
    static var onBackgroundNotification: (([AnyHashable: Any], @escaping (UIBackgroundFetchResult) -> Void) -> Void)?

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Self.onDeviceToken?(deviceToken)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Self.onRegistrationError?(error)
    }

    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        guard let handler = Self.onBackgroundNotification else {
            completionHandler(.noData)
            return
        }

        handler(userInfo, completionHandler)
    }

    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        if identifier == HLSOfflineCache.sessionIdentifier {
            Task {
                await HLSOfflineCache.shared.attachSystemCompletionHandler(
                    completionHandler
                )
            }
            return
        }

        guard identifier == BackgroundTusUploadTransport.sessionIdentifier else {
            completionHandler()
            return
        }

        BackgroundTusUploadTransport.shared.attachSystemCompletionHandler(completionHandler)
    }
}
