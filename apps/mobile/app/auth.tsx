import Ionicons from "@expo/vector-icons/Ionicons"
import { useRouter } from "expo-router"
import type { ComponentProps } from "react"
import { useEffect, useState } from "react"
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { useAuthFlow } from "@/lib/auth-flow"
import { mobileBrandFontFamily } from "@/lib/typography"

const colors = {
  surface: "#ffffff",
  mutedSurface: "#f5f6f8",
  text: "#17191f",
  subtext: "#6b7280",
  border: "#e5e7eb",
  accent: "#e01616",
  dark: "#111827",
}

export default function AuthScreen() {
  const router = useRouter()
  const {
    backToLanding,
    clearError,
    completeProfile,
    error,
    isComplete,
    isSubmitting,
    login,
    pendingEmail,
    reset,
    resendVerification,
    stage,
    startLogin,
    startSignup,
    submitSignup,
    verifyAccount,
  } = useAuthFlow()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [handle, setHandle] = useState("")

  useEffect(() => {
    if (isComplete) {
      router.replace("/(tabs)")
    }
  }, [isComplete, router])

  const submitEmailPassword = async () => {
    await submitSignup({ email, password })
  }

  const submitLogin = async () => {
    await login({ email, password })
  }

  const submitVerification = async () => {
    await verifyAccount()
  }

  const submitProfile = async () => {
    if (await completeProfile({ displayName, handle })) {
      router.replace("/(tabs)")
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: "padding", default: undefined })}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <Ionicons name="sparkles" size={22} color={colors.surface} />
            </View>
            <Text style={styles.brandText}>UBEYE</Text>
          </View>

          <View style={styles.heroCopy}>
            {stage === "landing" ? null : (
              <Text style={styles.kicker}>{stageKicker[stage]}</Text>
            )}
            <Text
              style={[
                styles.title,
                stage === "landing" ? styles.landingTitle : null,
              ]}
            >
              {stageTitle[stage]}
            </Text>
            <Text style={styles.subtitle}>{stageSubtitle[stage]}</Text>
          </View>

          <View style={styles.card}>
            {stage === "signup" || stage === "verify" || stage === "profile" ? (
              <StepRail stage={stage} />
            ) : null}

            {error ? (
              <Pressable
                accessibilityRole="button"
                onPress={clearError}
                style={styles.errorBox}
              >
                <Text style={styles.errorText}>{error}</Text>
              </Pressable>
            ) : null}

            {stage === "landing" ? (
              <View style={styles.form}>
                <PrimaryButton label="Sign up" onPress={startSignup} />
                <SecondaryButton label="Log in" onPress={startLogin} />
              </View>
            ) : null}

            {stage === "signup" ? (
              <View style={styles.form}>
                <Field
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  label="Email"
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  value={email}
                />
                <Field
                  autoComplete="password-new"
                  label="Password"
                  onChangeText={setPassword}
                  placeholder="At least 8 characters"
                  secureTextEntry
                  value={password}
                />
                <PrimaryButton
                  disabled={isSubmitting}
                  label={isSubmitting ? "Sending verification" : "Continue"}
                  onPress={submitEmailPassword}
                />
                <SecondaryButton
                  disabled={isSubmitting}
                  label="Back"
                  onPress={backToLanding}
                />
              </View>
            ) : null}

            {stage === "login" ? (
              <View style={styles.form}>
                <Field
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  label="Email"
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  value={email}
                />
                <Field
                  autoComplete="current-password"
                  label="Password"
                  onChangeText={setPassword}
                  placeholder="Your password"
                  secureTextEntry
                  value={password}
                />
                <PrimaryButton
                  disabled={isSubmitting}
                  icon="log-in-outline"
                  label={isSubmitting ? "Logging in" : "Log in"}
                  onPress={submitLogin}
                />
                <SecondaryButton
                  disabled={isSubmitting}
                  label="Back"
                  onPress={backToLanding}
                />
              </View>
            ) : null}

            {stage === "verify" ? (
              <View style={styles.form}>
                <View style={styles.noticeBox}>
                  <Text style={styles.noticeTitle}>Check your email</Text>
                  <Text style={styles.noticeText}>
                    Open the verification link sent to{" "}
                    {pendingEmail ?? "your email"}, then return here.
                  </Text>
                </View>
                <PrimaryButton
                  disabled={isSubmitting}
                  label={isSubmitting ? "Checking" : "I verified my email"}
                  onPress={submitVerification}
                />
                <SecondaryButton
                  disabled={isSubmitting}
                  label="Resend verification email"
                  onPress={resendVerification}
                />
                <SecondaryButton
                  disabled={isSubmitting}
                  label="Use a different email"
                  onPress={() => {
                    reset()
                  }}
                />
              </View>
            ) : null}

            {stage === "profile" ? (
              <View style={styles.form}>
                <Field
                  autoComplete="name"
                  label="Display name"
                  onChangeText={setDisplayName}
                  placeholder="Griffin Aste"
                  value={displayName}
                />
                <Field
                  autoCapitalize="none"
                  autoComplete="username"
                  label="Handle"
                  onChangeText={(text) => setHandle(text.replace(/@/g, ""))}
                  placeholder="griffinaste"
                  prefix="@"
                  value={handle}
                />
                <PrimaryButton
                  disabled={isSubmitting}
                  label={isSubmitting ? "Finishing setup" : "Finish setup"}
                  onPress={submitProfile}
                />
              </View>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function StepRail({ stage }: { stage: (typeof stageOrder)[number] }) {
  const activeIndex = stageOrder.indexOf(stage)

  return (
    <View style={styles.stepRail}>
      {stageOrder.slice(0, 3).map((step, index) => (
        <View
          key={step}
          style={[
            styles.stepDot,
            index <= activeIndex ? styles.stepDotActive : null,
          ]}
        />
      ))}
    </View>
  )
}

function Field({
  label,
  prefix,
  secureTextEntry,
  ...props
}: {
  label: string
  prefix?: string
} & ComponentProps<typeof TextInput>) {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const canTogglePassword = Boolean(secureTextEntry)
  const resolvedSecureTextEntry = canTogglePassword && !isPasswordVisible

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {prefix || canTogglePassword ? (
        <View style={styles.inputShell}>
          {prefix ? <Text style={styles.inputPrefix}>{prefix}</Text> : null}
          <TextInput
            placeholderTextColor="#9ca3af"
            secureTextEntry={resolvedSecureTextEntry}
            style={styles.shellInput}
            {...props}
          />
          {canTogglePassword ? (
            <Pressable
              accessibilityLabel={
                isPasswordVisible ? "Hide password" : "Show password"
              }
              accessibilityRole="button"
              onPress={() => setIsPasswordVisible((current) => !current)}
              hitSlop={8}
              style={({ pressed }) => [
                styles.passwordToggle,
                pressed ? styles.pressed : null,
              ]}
            >
              <Ionicons
                name={isPasswordVisible ? "eye-off-outline" : "eye-outline"}
                size={22}
                color={colors.subtext}
              />
            </Pressable>
          ) : null}
        </View>
      ) : (
        <TextInput
          placeholderTextColor="#9ca3af"
          secureTextEntry={secureTextEntry}
          style={styles.input}
          {...props}
        />
      )}
    </View>
  )
}

function PrimaryButton({
  disabled = false,
  icon,
  label,
  onPress,
}: {
  disabled?: boolean
  icon?: ComponentProps<typeof Ionicons>["name"]
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        disabled ? styles.disabled : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <View style={styles.buttonContent}>
        {icon ? <Ionicons name={icon} size={18} color={colors.surface} /> : null}
        <Text style={styles.primaryButtonText}>{label}</Text>
      </View>
    </Pressable>
  )
}

function SecondaryButton({
  disabled = false,
  icon,
  label,
  onPress,
}: {
  disabled?: boolean
  icon?: ComponentProps<typeof Ionicons>["name"]
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        disabled ? styles.disabled : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <View style={styles.buttonContent}>
        {icon ? <Ionicons name={icon} size={18} color={colors.text} /> : null}
        <Text style={styles.secondaryButtonText}>{label}</Text>
      </View>
    </Pressable>
  )
}

const stageOrder = ["signup", "verify", "profile"] as const

const stageKicker = {
  landing: "",
  signup: "Create account",
  login: "Welcome back",
  verify: "Verify email",
  profile: "Profile setup",
  complete: "Ready",
}

const stageTitle = {
  landing: "Welcome to UBEYE",
  signup: "Start with email and password.",
  login: "Log in to your account.",
  verify: "Verify your account.",
  profile: "Choose your name and handle.",
  complete: "Account ready.",
}

const stageSubtitle = {
  landing: "Sign up or log in to continue.",
  signup: "Handles are claimed after email verification.",
  login: "Use the email and password you signed up with.",
  verify: "Tap the email link, then return here to continue.",
  profile: "This is how people will find and reply to you.",
  complete: "Your account is ready to use.",
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f3f4f6",
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  brandMark: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.dark,
  },
  brandText: {
    fontSize: 18,
    fontFamily: mobileBrandFontFamily,
    fontWeight: "700",
    color: colors.text,
  },
  heroCopy: {
    marginTop: 40,
  },
  kicker: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    textTransform: "uppercase",
    color: colors.subtext,
  },
  title: {
    marginTop: 12,
    fontSize: 34,
    lineHeight: 39,
    fontWeight: "700",
    letterSpacing: 0,
    color: colors.text,
  },
  landingTitle: {
    marginTop: 0,
  },
  subtitle: {
    marginTop: 10,
    maxWidth: 310,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "500",
    color: colors.subtext,
  },
  card: {
    marginTop: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 16,
  },
  stepRail: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  stepDot: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  stepDotActive: {
    backgroundColor: colors.dark,
  },
  form: {
    gap: 12,
  },
  field: {
    gap: 7,
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.text,
  },
  input: {
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 13,
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    backgroundColor: colors.surface,
  },
  inputShell: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 13,
    backgroundColor: colors.surface,
  },
  inputPrefix: {
    marginRight: 1,
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
  },
  shellInput: {
    flex: 1,
    minHeight: 48,
    padding: 0,
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
  },
  passwordToggle: {
    width: 34,
    height: 34,
    marginLeft: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  errorBox: {
    marginBottom: 14,
    borderRadius: 8,
    backgroundColor: colors.mutedSurface,
    padding: 12,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    color: colors.text,
  },
  noticeBox: {
    borderRadius: 8,
    backgroundColor: colors.mutedSurface,
    padding: 13,
  },
  noticeTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  noticeText: {
    marginTop: 5,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: colors.subtext,
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.dark,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.surface,
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  pressed: {
    opacity: 0.72,
  },
  disabled: {
    opacity: 0.5,
  },
})
