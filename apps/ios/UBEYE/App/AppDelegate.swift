import UIKit

final class AppDelegate: NSObject, UIApplicationDelegate {
    static var onDeviceToken: ((Data) -> Void)?
    static var onRegistrationError: ((Error) -> Void)?

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
}
