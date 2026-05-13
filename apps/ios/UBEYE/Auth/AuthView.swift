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
            ScrollView {
                VStack(spacing: 22) {
                    HStack {
                        UBEYEWordmark()
                        Spacer()
                        NavigationLink {
                            SettingsView()
                        } label: {
                            Image(systemName: "gearshape.fill")
                                .font(.system(size: 16, weight: .semibold))
                                .frame(width: 38, height: 38)
                                .foregroundStyle(Color.ubeyeInk)
                                .background(Color.ubeyeSubtle, in: Circle())
                        }
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Stories first. Followers second.")
                            .font(.system(size: 32, weight: .black, design: .rounded))
                            .foregroundStyle(Color.ubeyeInk)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("Post fast vertical updates, follow creators, and keep the same UBEYE social experience on iPhone.")
                            .font(.subheadline)
                            .foregroundStyle(Color.ubeyeMuted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 18)

                    authPanel

                    if let error = auth.error {
                        InlineNotice(message: error, isError: true)
                    } else if let message = auth.message, auth.stage != .verify {
                        InlineNotice(message: message)
                    }

                    if auth.stage != .landing {
                        Button {
                            auth.stage = .landing
                            auth.error = nil
                            auth.message = nil
                        } label: {
                            Label("Back", systemImage: "chevron.left")
                                .font(.subheadline.weight(.semibold))
                        }
                        .foregroundStyle(Color.ubeyeMuted)
                    }
                }
                .padding(20)
            }
            .ubeyeScreen()
        }
    }

    @ViewBuilder
    private var authPanel: some View {
        VStack(spacing: 14) {
            switch auth.stage {
            case .landing:
                VStack(alignment: .leading, spacing: 10) {
                    Text("Start watching")
                        .font(.title3.bold())
                    Text("Use your existing account or create a new creator profile.")
                        .font(.subheadline)
                        .foregroundStyle(Color.ubeyeMuted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                PrimaryButton(title: "Create account") {
                    auth.stage = .signup
                }
                Button {
                    auth.stage = .login
                } label: {
                    Text("Sign in")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .foregroundStyle(Color.ubeyeInk)
                        .background(Color.ubeyeSubtle)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            case .login:
                AuthTextField(title: "Email", text: $email, keyboard: .emailAddress)
                AuthSecureField(title: "Password", text: $password)
                PrimaryButton(title: "Sign in", isLoading: auth.isSubmitting) {
                    Task { await auth.login(email: email, password: password, api: api) }
                }
                Button("Forgot password?") {
                    auth.stage = .forgot
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.ubeyeMuted)
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
        .padding(16)
        .ubeyeCard()
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
            .background(Color.ubeyeSubtle)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .foregroundStyle(Color.ubeyeInk)
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
            .background(Color.ubeyeSubtle)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .foregroundStyle(Color.ubeyeInk)
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
