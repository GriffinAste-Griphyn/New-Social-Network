import Foundation

@MainActor
final class AuthStore: ObservableObject {
    enum Stage {
        case landing
        case login
        case signup
        case verify
        case profile
        case forgot
    }

    @Published var account: MobileAccount?
    @Published var stage: Stage = .landing
    @Published var pendingEmail = ""
    @Published var pendingPassword = ""
    @Published var message: String?
    @Published var error: String?
    @Published var isSubmitting = false

    private let keychainService = "com.griffinaste.ubeye.ios"
    private let accountKey = "mobile-account-v1"

    func restoreSession(api: APIClient) async {
        guard let data = KeychainStore.load(service: keychainService, account: accountKey),
              let stored = try? JSONDecoder().decode(MobileAccount.self, from: data) else {
            return
        }
        account = stored
        api.authToken = stored.mobileToken
    }

    func login(email: String, password: String, api: APIClient) async {
        let normalizedEmail = normalizeEmail(email)
        guard isValidEmail(normalizedEmail), password.count >= 8 else {
            error = "Enter a valid email and password."
            return
        }

        await submit {
            struct Body: Encodable {
                let email: String
                let password: String
            }

            let response: AuthResponse = try await api.post("/api/mobile/auth/login", body: Body(email: normalizedEmail, password: password))
            pendingEmail = normalizedEmail
            pendingPassword = password
            if response.profileComplete, let displayName = response.user.displayName, let handle = response.user.handle {
                persist(
                    MobileAccount(
                        email: response.user.email,
                        displayName: displayName,
                        handle: handle,
                        avatarUrl: response.user.avatarUrl,
                        mobileToken: response.mobileToken
                    ),
                    api: api
                )
            } else {
                stage = .profile
            }
        }
    }

    func signup(email: String, password: String, api: APIClient) async {
        let normalizedEmail = normalizeEmail(email)
        guard isValidEmail(normalizedEmail), password.count >= 8 else {
            error = "Use a valid email and at least 8 password characters."
            return
        }

        await submit {
            struct Body: Encodable {
                let email: String
                let password: String
            }

            let response: SignupResponse = try await api.post("/api/mobile/auth/signup", body: Body(email: normalizedEmail, password: password))
            pendingEmail = response.pendingEmail
            pendingPassword = password
            message = response.message ?? "Check your email, then return to continue."
            stage = .verify
        }
    }

    func checkVerification(api: APIClient) async {
        guard !pendingEmail.isEmpty, !pendingPassword.isEmpty else {
            stage = .signup
            error = "Enter your email and password again."
            return
        }

        await submit {
            struct Body: Encodable {
                let email: String
                let password: String
            }

            let response: AuthResponse = try await api.post(
                "/api/mobile/auth/check-verification",
                body: Body(email: pendingEmail, password: pendingPassword)
            )
            if response.profileComplete, let displayName = response.user.displayName, let handle = response.user.handle {
                persist(
                    MobileAccount(
                        email: response.user.email,
                        displayName: displayName,
                        handle: handle,
                        avatarUrl: response.user.avatarUrl,
                        mobileToken: response.mobileToken
                    ),
                    api: api
                )
            } else {
                stage = .profile
            }
        }
    }

    func completeProfile(displayName: String, handle: String, api: APIClient) async {
        let normalizedName = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedHandle = handle.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "@"))

        guard normalizedName.count >= 2, normalizedHandle.range(of: #"^[a-z0-9._]{3,20}$"#, options: .regularExpression) != nil else {
            error = "Use a display name and a 3-20 character handle."
            return
        }

        await submit {
            struct Body: Encodable {
                let email: String
                let password: String
                let displayName: String
                let handle: String
                let onboardingIntent: String
            }

            let response: AuthResponse = try await api.post(
                "/api/mobile/auth/complete-profile",
                body: Body(
                    email: pendingEmail,
                    password: pendingPassword,
                    displayName: normalizedName,
                    handle: normalizedHandle,
                    onboardingIntent: "both"
                )
            )
            persist(
                MobileAccount(
                    email: response.user.email,
                    displayName: response.user.displayName ?? normalizedName,
                    handle: response.user.handle ?? normalizedHandle,
                    avatarUrl: response.user.avatarUrl,
                    mobileToken: response.mobileToken
                ),
                api: api
            )
        }
    }

    func requestPasswordReset(email: String, api: APIClient) async {
        let normalizedEmail = normalizeEmail(email)
        guard isValidEmail(normalizedEmail) else {
            error = "Enter a valid email."
            return
        }

        await submit {
            struct Body: Encodable {
                let email: String
            }

            struct Response: Decodable {
                let ok: Bool
                let message: String
            }

            let response: Response = try await api.post("/api/mobile/auth/forgot-password", body: Body(email: normalizedEmail))
            pendingEmail = normalizedEmail
            message = response.message
        }
    }

    func updateAccount(_ update: (inout MobileAccount) -> Void, api: APIClient) {
        guard var next = account else {
            return
        }
        update(&next)
        persist(next, api: api)
    }

    func signOut(api: APIClient) {
        account = nil
        api.authToken = nil
        stage = .landing
        pendingEmail = ""
        pendingPassword = ""
        message = nil
        error = nil
        KeychainStore.delete(service: keychainService, account: accountKey)
    }

    private func persist(_ next: MobileAccount, api: APIClient) {
        account = next
        api.authToken = next.mobileToken
        stage = .landing
        if let data = try? JSONEncoder().encode(next) {
            KeychainStore.save(data, service: keychainService, account: accountKey)
        }
    }

    private func submit(_ operation: () async throws -> Void) async {
        isSubmitting = true
        error = nil
        message = nil
        do {
            try await operation()
        } catch {
            self.error = error.localizedDescription
        }
        isSubmitting = false
    }

    private func normalizeEmail(_ email: String) -> String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private func isValidEmail(_ email: String) -> Bool {
        email.contains("@") && email.contains(".")
    }
}
