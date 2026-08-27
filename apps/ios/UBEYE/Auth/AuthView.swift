import SwiftUI

struct AuthView: View {
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var auth: AuthStore
    @State private var email = ""
    @State private var password = ""
    @State private var verificationCode = ""
    @State private var displayName = ""
    @State private var handle = ""
    @State private var hasAcceptedTerms = false

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
            #if DEBUG
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
            #endif
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
                VStack(spacing: 10) {
                    PrimaryButton(title: "Sign up") {
                        hasAcceptedTerms = false
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
                }
            case .login:
                AuthTextField(title: "Email", text: $email, keyboard: .emailAddress)
                AuthSecureField(title: "Password", text: $password)
                legalDocumentLinks
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
                signupLegalAgreementView
                PrimaryButton(title: "Create account", isLoading: auth.isSubmitting, isDisabled: !hasAcceptedTerms) {
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

    private var signupLegalAgreementView: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 9) {
                Button {
                    hasAcceptedTerms.toggle()
                } label: {
                    Image(systemName: hasAcceptedTerms ? "checkmark.square.fill" : "square")
                        .font(.system(size: 19, weight: .semibold))
                        .foregroundStyle(hasAcceptedTerms ? Color.ubeyeRed : Color.ubeyeMuted)
                        .frame(width: 24, height: 24)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(hasAcceptedTerms ? "Terms accepted" : "Accept terms")

                Button {
                    hasAcceptedTerms.toggle()
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Terms and policies")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(Color.ubeyeInk)

                        Text("I agree to UBEYE's Terms and Community Guidelines and acknowledge the Privacy Policy.")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Color.ubeyeMuted)
                            .lineSpacing(1)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(hasAcceptedTerms ? "Terms accepted" : "Accept terms")
            }
            legalDocumentLinks
                .padding(.leading, 33)
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 10)
        .background(
            hasAcceptedTerms ? Color.ubeyeRed.opacity(0.045) : Color.white,
            in: RoundedRectangle(cornerRadius: 8, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(hasAcceptedTerms ? Color.ubeyeRed.opacity(0.28) : Color.ubeyeBorder.opacity(0.9), lineWidth: 1)
        )
    }

    private var legalDocumentLinks: some View {
        HStack(spacing: 12) {
            Link("Terms", destination: LegalDocuments.termsURL)
            Link("Privacy", destination: LegalDocuments.privacyPolicyURL)
            Link("Community Guidelines", destination: LegalDocuments.communityGuidelinesURL)
        }
        .font(.system(size: 12, weight: .bold))
        .foregroundStyle(Color.ubeyeRed)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct AuthTextField: View {
    let title: String
    @Binding var text: String
    var keyboard: UIKeyboardType = .default

    var body: some View {
        ZStack(alignment: .leading) {
            if text.isEmpty {
                AuthInlinePlaceholder(title)
            }

            TextField("", text: $text)
                .textInputAutocapitalization(.never)
                .keyboardType(keyboard)
                .autocorrectionDisabled()
                .accessibilityLabel(title)
        }
            .padding()
            .frame(minHeight: 50)
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
            ZStack(alignment: .leading) {
                if text.isEmpty {
                    AuthInlinePlaceholder(title)
                }

                if isPasswordVisible {
                    TextField("", text: $text)
                } else {
                    SecureField("", text: $text)
                }
            }
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .accessibilityLabel(title)

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
        .frame(minHeight: 50)
        .background(Color.ubeyeSubtle)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .foregroundStyle(Color.ubeyeInk)
    }
}

private struct AuthInlinePlaceholder: View {
    let title: String

    init(_ title: String) {
        self.title = title
    }

    var body: some View {
        Text(title)
            .font(.system(size: 16, weight: .medium))
            .foregroundStyle(Color.ubeyeMuted.opacity(0.72))
            .lineLimit(1)
            .minimumScaleFactor(0.82)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
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
