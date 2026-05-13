import { z } from "zod"

const envSchema = z.object({
  DATABASE_URL: z.url(),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  AUTH_SECRET: z.string().min(32),
  ADMIN_EMAILS: z.string().optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.string().default("UBEYE <onboarding@resend.dev>"),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  APNS_KEY_ID: z.string().min(1).optional(),
  APNS_TEAM_ID: z.string().min(1).optional(),
  APNS_BUNDLE_ID: z.string().min(1).optional(),
  APNS_PRIVATE_KEY: z.string().min(1).optional(),
  APNS_ENVIRONMENT: z.enum(["sandbox", "production"]).default("production"),
})

type Env = z.infer<typeof envSchema>

let cachedEnv: Env | undefined

export const env = new Proxy({} as Env, {
  get(_target, property: string) {
    if (!cachedEnv) {
      const parsed = envSchema.safeParse(process.env)

      if (!parsed.success) {
        throw new Error(
          `Invalid environment variables: ${parsed.error.issues
            .map((issue) => issue.path.join("."))
            .join(", ")}`,
        )
      }

      cachedEnv = parsed.data
    }

    return cachedEnv[property as keyof Env]
  },
})
