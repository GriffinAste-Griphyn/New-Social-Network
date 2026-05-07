import {
  createContext,
  type ReactNode,
  useEffect,
  useContext,
  useMemo,
  useState,
} from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"
import * as SecureStore from "expo-secure-store"

import {
  MobileApiError,
  postMobileApi,
  setMobileApiAuthToken,
} from "@/lib/mobile-api"

type MobileAccount = {
  email: string
  displayName: string
  handle: string
  mobileToken: string
}

type MobileAuthUser = {
  email: string
  displayName: string | null
  handle: string | null
}

type AuthStage = "landing" | "signup" | "login" | "verify" | "profile" | "complete"

type AuthFlowContextValue = {
  account: MobileAccount | null
  error: string | null
  isSubmitting: boolean
  isComplete: boolean
  pendingEmail: string | null
  stage: AuthStage
  backToLanding: () => void
  clearError: () => void
  completeProfile: (input: { displayName: string; handle: string }) => Promise<boolean>
  login: (input: { email: string; password: string }) => Promise<boolean>
  reset: () => void
  resendVerification: () => Promise<boolean>
  startLogin: () => void
  startSignup: () => void
  submitSignup: (input: { email: string; password: string }) => Promise<boolean>
  expireSession: () => void
  verifyAccount: () => Promise<boolean>
}

const AuthFlowContext = createContext<AuthFlowContextValue | null>(null)
const storedAccountKey = "nsn.mobile.account.v1"
const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
}

function parseStoredAccount(value: string | null): MobileAccount | null {
  if (!value) {
    return null
  }

  try {
    const parsed = JSON.parse(value) as Partial<MobileAccount>

    if (
      typeof parsed.email === "string" &&
      typeof parsed.displayName === "string" &&
      typeof parsed.handle === "string" &&
      typeof parsed.mobileToken === "string" &&
      parsed.mobileToken.length > 0
    ) {
      return {
        email: parsed.email,
        displayName: parsed.displayName,
        handle: parsed.handle,
        mobileToken: parsed.mobileToken,
      }
    }
  } catch {
    return null
  }

  return null
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function normalizeHandle(handle: string) {
  return handle.trim().toLowerCase().replace(/^@+/, "")
}

function isValidHandle(handle: string) {
  return /^[a-z0-9._]{3,20}$/.test(handle)
}

async function isSecureStoreAvailable() {
  return SecureStore.isAvailableAsync().catch(() => false)
}

async function getStoredAccount() {
  if (await isSecureStoreAvailable()) {
    const secureValue = await SecureStore.getItemAsync(storedAccountKey)

    if (secureValue) {
      return secureValue
    }
  }

  return AsyncStorage.getItem(storedAccountKey)
}

async function setStoredAccount(account: MobileAccount) {
  const value = JSON.stringify(account)

  if (await isSecureStoreAvailable()) {
    await SecureStore.setItemAsync(storedAccountKey, value, secureStoreOptions)
    await AsyncStorage.removeItem(storedAccountKey)
    return
  }

  await AsyncStorage.setItem(storedAccountKey, value)
}

async function removeStoredAccount() {
  await Promise.all([
    SecureStore.deleteItemAsync(storedAccountKey).catch(() => undefined),
    AsyncStorage.removeItem(storedAccountKey),
  ])
}

export function AuthFlowProvider({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<AuthStage>("landing")
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [pendingPassword, setPendingPassword] = useState("")
  const [account, setAccount] = useState<MobileAccount | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    let isMounted = true

    getStoredAccount()
      .then((value) => {
        const storedAccount = parseStoredAccount(value)

        if (isMounted && storedAccount) {
          setAccount(storedAccount)
          setStage("complete")
        }
      })
      .catch(() => undefined)

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    setMobileApiAuthToken(account?.mobileToken ?? null)
  }, [account?.mobileToken])

  const persistCompleteAccount = (nextAccount: MobileAccount) => {
    setAccount(nextAccount)
    setMobileApiAuthToken(nextAccount.mobileToken)
    setStage("complete")
    void setStoredAccount(nextAccount)
  }

  const value = useMemo<AuthFlowContextValue>(
    () => ({
      account,
      error,
      isSubmitting,
      isComplete: stage === "complete" && Boolean(account),
      pendingEmail,
      stage,
      backToLanding: () => {
        setError(null)
        setStage("landing")
      },
      clearError: () => setError(null),
      completeProfile: async ({ displayName, handle }) => {
        const normalizedDisplayName = displayName.trim()
        const normalizedHandle = normalizeHandle(handle)

        if (normalizedDisplayName.length < 2) {
          setError("Enter a display name with at least 2 characters.")
          return false
        }

        if (!isValidHandle(normalizedHandle)) {
          setError("Handle must be 3-20 characters: letters, numbers, periods, or underscores.")
          return false
        }

        if (!pendingEmail || !pendingPassword) {
          setStage("signup")
          setError("Enter your email and password again.")
          return false
        }

        setIsSubmitting(true)

        try {
          const result = await postMobileApi<{
            ok: true
            user: MobileAuthUser
            profileComplete: boolean
            mobileToken: string
          }>("/api/mobile/auth/complete-profile", {
            email: pendingEmail,
            password: pendingPassword,
            displayName: normalizedDisplayName,
            handle: normalizedHandle,
            onboardingIntent: "both",
          })

          persistCompleteAccount({
            email: result.user.email,
            displayName: result.user.displayName ?? normalizedDisplayName,
            handle: result.user.handle ?? normalizedHandle,
            mobileToken: result.mobileToken,
          })
          setError(null)
          return true
        } catch (error) {
          setError(error instanceof Error ? error.message : "Could not finish setup.")
          return false
        } finally {
          setIsSubmitting(false)
        }
      },
      login: async ({ email, password }) => {
        const normalizedEmail = normalizeEmail(email)

        if (!normalizedEmail || !normalizedEmail.includes("@")) {
          setError("Enter a valid email.")
          return false
        }

        if (password.length < 8) {
          setError("Use at least 8 characters for your password.")
          return false
        }

        setIsSubmitting(true)

        try {
          const result = await postMobileApi<{
            ok: true
            user: MobileAuthUser
            profileComplete: boolean
            mobileToken: string
          }>("/api/mobile/auth/login", {
            email: normalizedEmail,
            password,
          })

          setPendingEmail(normalizedEmail)
          setPendingPassword(password)

          if (result.profileComplete && result.user.displayName && result.user.handle) {
            persistCompleteAccount({
              email: result.user.email,
              displayName: result.user.displayName,
              handle: result.user.handle,
              mobileToken: result.mobileToken,
            })
          } else {
            setStage("profile")
          }

          setError(null)
          return true
        } catch (error) {
          if (error instanceof MobileApiError && error.status === 403) {
            setPendingEmail(normalizedEmail)
            setPendingPassword(password)
            setStage("verify")
          }

          setError(error instanceof Error ? error.message : "Could not log in.")
          return false
        } finally {
          setIsSubmitting(false)
        }
      },
      reset: () => {
        setAccount(null)
        setError(null)
        setPendingEmail(null)
        setPendingPassword("")
        setStage("landing")
        void removeStoredAccount()
        setMobileApiAuthToken(null)
      },
      expireSession: () => {
        setAccount(null)
        setPendingEmail(null)
        setPendingPassword("")
        setStage("login")
        setError("Your session expired. Sign in again.")
        void removeStoredAccount()
        setMobileApiAuthToken(null)
      },
      resendVerification: async () => {
        if (!pendingEmail || !pendingPassword) {
          setStage("signup")
          setError("Enter your email and password again.")
          return false
        }

        setIsSubmitting(true)

        try {
          await postMobileApi("/api/mobile/auth/check-verification", {
            email: pendingEmail,
            password: pendingPassword,
          })
          setError(null)
          return true
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : "Could not resend verification email.",
          )
          return false
        } finally {
          setIsSubmitting(false)
        }
      },
      startLogin: () => {
        setError(null)
        setStage("login")
      },
      startSignup: () => {
        setError(null)
        setStage("signup")
      },
      submitSignup: async ({ email, password }) => {
        const normalizedEmail = normalizeEmail(email)

        if (!normalizedEmail || !normalizedEmail.includes("@")) {
          setError("Enter a valid email.")
          return false
        }

        if (password.length < 8) {
          setError("Use at least 8 characters for your password.")
          return false
        }

        setIsSubmitting(true)

        try {
          const result = await postMobileApi<{
            ok: true
            pendingEmail: string
          }>("/api/mobile/auth/signup", {
            email: normalizedEmail,
            password,
          })

          setPendingEmail(result.pendingEmail)
          setPendingPassword(password)
          setStage("verify")
          setError(null)
          return true
        } catch (error) {
          setError(error instanceof Error ? error.message : "Could not sign up.")
          return false
        } finally {
          setIsSubmitting(false)
        }
      },
      verifyAccount: async () => {
        if (!pendingEmail || !pendingPassword) {
          setStage("signup")
          setError("Enter your email and password again.")
          return false
        }

        setIsSubmitting(true)

        try {
          const result = await postMobileApi<{
            ok: true
            user: MobileAuthUser
            profileComplete: boolean
            mobileToken: string
          }>("/api/mobile/auth/check-verification", {
            email: pendingEmail,
            password: pendingPassword,
          })

          if (result.profileComplete && result.user.displayName && result.user.handle) {
            persistCompleteAccount({
              email: result.user.email,
              displayName: result.user.displayName,
              handle: result.user.handle,
              mobileToken: result.mobileToken,
            })
          } else {
            setStage("profile")
          }

          setError(null)
          return true
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : "Verify your email before continuing.",
          )
          return false
        } finally {
          setIsSubmitting(false)
        }
      },
    }),
    [account, error, isSubmitting, pendingEmail, pendingPassword, stage],
  )

  return (
    <AuthFlowContext.Provider value={value}>
      {children}
    </AuthFlowContext.Provider>
  )
}

export function useAuthFlow() {
  const context = useContext(AuthFlowContext)

  if (!context) {
    throw new Error("useAuthFlow must be used inside AuthFlowProvider.")
  }

  return context
}
