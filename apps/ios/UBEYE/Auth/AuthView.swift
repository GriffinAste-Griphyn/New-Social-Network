import SwiftUI

struct AuthView: View {
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var auth: AuthStore
    @State private var email = ""
    @State private var password = ""
    @State private var displayName = ""
    @State private var handle = ""

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()

                VStack(spacing: 8) {
                    Text("UBEYE")
                        .font(.system(size: 48, weight: .black, design: .rounded))
                    Text("Stories first. Followers second.")
                        .foregroundStyle(.white.opacity(0.7))
                }

                VStack(spacing: 12) {
                    switch auth.stage {
                    case .landing:
                        PrimaryButton(title: "Create account") {
                            auth.stage = .signup
                        }
                        Button("Sign in") {
                            auth.stage = .login
                        }
                        .foregroundStyle(.white)
                    case .login:
                        AuthTextField(title: "Email", text: $email, keyboard: .emailAddress)
                        AuthSecureField(title: "Password", text: $password)
                        PrimaryButton(title: "Sign in", isLoading: auth.isSubmitting) {
                            Task { await auth.login(email: email, password: password, api: api) }
                        }
                        Button("Forgot password?") {
                            auth.stage = .forgot
                        }
                        .foregroundStyle(.white.opacity(0.7))
                    case .signup:
                        AuthTextField(title: "Email", text: $email, keyboard: .emailAddress)
                        AuthSecureField(title: "Password", text: $password)
                        PrimaryButton(title: "Create account", isLoading: auth.isSubmitting) {
                            Task { await auth.signup(email: email, password: password, api: api) }
                        }
                    case .verify:
                        EmptyStateView(
                            title: "Check your email",
                            message: auth.message ?? "Verify your email, then return to continue.",
                            systemImage: "envelope.badge"
                        )
                        PrimaryButton(title: "I verified", isLoading: auth.isSubmitting) {
                            Task { await auth.checkVerification(api: api) }
                        }
                    case .profile:
                        AuthTextField(title: "Display name", text: $displayName)
                        AuthTextField(title: "Handle", text: $handle)
                        PrimaryButton(title: "Finish setup", isLoading: auth.isSubmitting) {
                            Task { await auth.completeProfile(displayName: displayName, handle: handle, api: api) }
                        }
                    case .forgot:
                        AuthTextField(title: "Email", text: $email, keyboard: .emailAddress)
                        PrimaryButton(title: "Send reset link", isLoading: auth.isSubmitting) {
                            Task { await auth.requestPasswordReset(email: email, api: api) }
                        }
                    }
                }

                if let error = auth.error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red.opacity(0.92))
                        .multilineTextAlignment(.center)
                }

                if auth.stage != .landing {
                    Button("Back") {
                        auth.stage = .landing
                        auth.error = nil
                        auth.message = nil
                    }
                    .foregroundStyle(.white.opacity(0.72))
                }

                Spacer()

                NavigationLink {
                    SettingsView()
                } label: {
                    Label("Settings", systemImage: "gear")
                        .font(.footnote.weight(.semibold))
                }
                .foregroundStyle(.white.opacity(0.72))
            }
            .padding(24)
            .ubeyeScreen()
        }
    }
}

private struct AuthTextField: View {
    let title: String
    @Binding var text: String
    var keyboard: UIKeyboardType = .default

    var body: some View {
        TextField(title, text: $text)
            .textInputAutocapitalization(.never)
            .keyboardType(keyboard)
            .autocorrectionDisabled()
            .padding()
            .frame(height: 52)
            .background(.white.opacity(0.12))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

private struct AuthSecureField: View {
    let title: String
    @Binding var text: String

    var body: some View {
        SecureField(title, text: $text)
            .textInputAutocapitalization(.never)
            .padding()
            .frame(height: 52)
            .background(.white.opacity(0.12))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct SettingsView: View {
    @EnvironmentObject private var api: APIClient

    var body: some View {
        Form {
            Section("Backend") {
                TextField("API base URL", text: $api.baseURLString)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
            }
        }
        .navigationTitle("Settings")
    }
}
