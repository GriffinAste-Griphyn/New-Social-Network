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
  BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
  STORY_STORAGE_PROVIDER: z.enum(["local", "vercel-blob"]).optional(),
  STORY_VIDEO_PROCESSOR: z.enum(["cloudflare-stream"]).optional(),
  CLOUDFLARE_STREAM_ACCOUNT_ID: z.string().min(1).optional(),
  CLOUDFLARE_STREAM_API_TOKEN: z.string().min(1).optional(),
  CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN: z.string().min(1).optional(),
  CLOUDFLARE_STREAM_WEBHOOK_SECRET: z.string().min(1).optional(),
  CLOUDFLARE_STREAM_SIGNING_KEY_ID: z.string().min(1).optional(),
  CLOUDFLARE_STREAM_SIGNING_KEY_PEM: z.string().min(1).optional(),
  CLOUDFLARE_STREAM_SIGNING_KEY_JWK: z.string().min(1).optional(),
  CLOUDFLARE_STREAM_HEALTHCHECK_UID: z.string().regex(/^[a-f0-9]{32}$/i).optional(),
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  CRON_SECRET: z.string().min(16).optional(),
  DAILY_DRAW_SECRET: z.string().min(16).optional(),
  APNS_KEY_ID: z.string().min(1).optional(),
  APNS_TEAM_ID: z.string().min(1).optional(),
  APNS_BUNDLE_ID: z.string().min(1).optional(),
  APNS_PRIVATE_KEY: z.string().min(1).optional(),
  APNS_ENVIRONMENT: z.enum(["sandbox", "production"]).default("production"),
})

type Env = z.infer<typeof envSchema>

let cachedEnv: Env | undefined

function parsedEnvironment() {
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

  return cachedEnv
}

export function assertProductionEnvironment() {
  if (process.env.VERCEL_ENV !== "production") {
    return
  }

  const parsed = parsedEnvironment()
  const required: Array<keyof Env> = [
    "BLOB_READ_WRITE_TOKEN",
    "STORY_VIDEO_PROCESSOR",
    "CLOUDFLARE_STREAM_ACCOUNT_ID",
    "CLOUDFLARE_STREAM_API_TOKEN",
    "CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN",
    "CLOUDFLARE_STREAM_WEBHOOK_SECRET",
    "CLOUDFLARE_STREAM_SIGNING_KEY_ID",
    "CLOUDFLARE_STREAM_HEALTHCHECK_UID",
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "CRON_SECRET",
  ]
  const missing: string[] = required.filter((name) => !parsed[name])

  if (parsed.STORY_STORAGE_PROVIDER !== "vercel-blob") {
    missing.push("STORY_STORAGE_PROVIDER")
  }
  if (
    !parsed.CLOUDFLARE_STREAM_SIGNING_KEY_PEM &&
    !parsed.CLOUDFLARE_STREAM_SIGNING_KEY_JWK
  ) {
    missing.push("CLOUDFLARE_STREAM_SIGNING_KEY_JWK")
  }
  if (!parsed.UPSTASH_REDIS_REST_URL || !parsed.UPSTASH_REDIS_REST_TOKEN) {
    missing.push("UPSTASH_REDIS_REST_URL/TOKEN")
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing production environment variables: ${[...new Set(missing)].join(", ")}`,
    )
  }
}

export const env = new Proxy({} as Env, {
  get(_target, property: string) {
    return parsedEnvironment()[property as keyof Env]
  },
})
