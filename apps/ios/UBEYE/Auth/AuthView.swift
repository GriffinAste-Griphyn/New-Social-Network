import SwiftUI

struct AuthView: View {
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var auth: AuthStore
    @State private var email = ""
    @State private var password = ""
    @State private var verificationCode = ""
    @State private var displayName = ""
    @State private var handle = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Spacer(minLength: auth.stage == .landing ? 180 : 36)

                    UBEYEWordmark()

                    VStack(alignment: .leading, spacing: 12) {
                        if auth.stage != .landing {
                            Text(stageEyebrow)
                                .font(.system(size: 17, weight: .black))
                                .foregroundStyle(Color.ubeyeMuted.opacity(0.7))
                        }
                        Text(stageTitle)
                            .font(.system(size: auth.stage == .landing ? 34 : 30, weight: .bold))
                            .foregroundStyle(Color.ubeyeInk)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(stageSubtitle)
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(Color.ubeyeMuted)
                    }

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
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
            .scrollIndicators(.hidden)
            .ubeyeScreen()
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink {
                        SettingsView()
                    } label: {
                        Image(systemName: "gearshape")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(Color.ubeyeMuted)
                    }
                }
            }
        }
    }

    private var stageEyebrow: String {
        switch auth.stage {
        case .landing: ""
        case .signup: "CREATE ACCOUNT"
        case .login: "WELCOME BACK"
        case .verify: "EMAIL CODE"
        case .profile: "CREATOR PROFILE"
        case .forgot: "PASSWORD RESET"
        }
    }

    private var stageTitle: String {
        switch auth.stage {
        case .landing: "Welcome to UBEYE"
        case .signup: "Create your account"
        case .login: "Log in"
        case .verify: "Enter your code"
        case .profile: "Finish your profile"
        case .forgot: "Reset password"
        }
    }

    private var stageSubtitle: String {
        switch auth.stage {
        case .landing: "Sign up or log in to continue."
        case .signup: "Start with email and password."
        case .login: "Use your existing creator account."
        case .verify: "Use the code we sent to your email."
        case .profile: "Choose how creators and viewers see you."
        case .forgot: "Send yourself a secure reset link."
        }
    }

    @ViewBuilder
    private var authPanel: some View {
        VStack(spacing: 14) {
            switch auth.stage {
            case .landing:
                PrimaryButton(title: "Sign up") {
                    auth.stage = .signup
                }
                Button {
                    auth.stage = .login
                } label: {
                        Text("Log in")
                        .font(.system(size: 16, weight: .bold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .foregroundStyle(Color.ubeyeInk)
                        .background(Color.white)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(Color.ubeyeBorder, lineWidth: 1))
                }
            case .login:
                AuthTextField(title: "Email", text: $email, keyboard: .emailAddress)
                AuthSecureField(title: "Password", text: $password)
                PrimaryButton(title: "Sign in", isLoading: auth.isSubmitting) {
                    verificationCode = ""
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
                    verificationCode = ""
                    Task { await auth.signup(email: email, password: password, api: api) }
                }
            case .verify:
                EmptyStateView(
                    title: auth.pendingEmail,
                    message: auth.message ?? "Enter the verification code we sent to your email.",
                    systemImage: "envelope.badge"
                )
                AuthTextField(title: "6-digit code", text: $verificationCode, keyboard: .numberPad)
                PrimaryButton(title: "Verify email", isLoading: auth.isSubmitting) {
                    Task { await auth.verifyCode(verificationCode, api: api) }
                }
                Button("Resend code") {
                    Task { await auth.resendVerificationCode(api: api) }
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.ubeyeMuted)
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
        .padding(auth.stage == .landing ? 18 : 16)
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
            .frame(height: 50)
            .background(Color.ubeyeSubtle)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .foregroundStyle(Color.ubeyeInk)
    }
}

private struct AuthSecureField: View {
    let title: String
    @Binding var text: String
    @State private var isPasswordVisible = false

    var body: some View {
        HStack(spacing: 10) {
            Group {
                if isPasswordVisible {
                    TextField(title, text: $text)
                } else {
                    SecureField(title, text: $text)
                }
            }
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()

            Button {
                isPasswordVisible.toggle()
            } label: {
                Image(systemName: isPasswordVisible ? "eye.slash" : "eye")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Color.ubeyeMuted)
                    .frame(width: 34, height: 34)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isPasswordVisible ? "Hide password" : "Show password")
        }
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .frame(height: 50)
        .background(Color.ubeyeSubtle)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
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
