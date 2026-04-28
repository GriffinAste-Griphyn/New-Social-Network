import { z } from "zod"

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export function normalizeHandle(handle: string) {
  return handle.trim().toLowerCase().replace(/^@+/, "")
}

export const handlePattern = /^[a-z0-9._]{3,20}$/

export const loginSchema = z.object({
  email: z.email().transform(normalizeEmail),
  password: z.string().min(8).max(72),
})

export const onboardingIntentSchema = z.enum(["explore", "create", "both"])
export const signupAccountTypeSchema = z.enum(["user", "advertiser"])

export const signupSchema = z.object({
  email: z.email().transform(normalizeEmail),
  password: z.string().min(8).max(72),
})

export const signupFlowSchema = signupSchema.extend({
  accountType: signupAccountTypeSchema.default("user"),
})

export const passwordResetRequestSchema = z.object({
  email: z.email().transform(normalizeEmail),
})

export const passwordResetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(72),
})

export const profileSetupSchema = z.object({
  displayName: z.string().trim().min(2).max(40),
  handle: z
    .string()
    .transform(normalizeHandle)
    .refine((value) => handlePattern.test(value), {
      message:
        "Handle must be 3-20 characters and use only lowercase letters, numbers, periods, or underscores.",
    }),
  onboardingIntent: onboardingIntentSchema.default("both"),
})

export type LoginInput = z.infer<typeof loginSchema>
export type SignupInput = z.infer<typeof signupSchema>
export type SignupFlowInput = z.infer<typeof signupFlowSchema>
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>
export type PasswordResetInput = z.infer<typeof passwordResetSchema>
export type ProfileSetupInput = z.infer<typeof profileSetupSchema>
export type OnboardingIntent = z.infer<typeof onboardingIntentSchema>
export type SignupAccountType = z.infer<typeof signupAccountTypeSchema>
