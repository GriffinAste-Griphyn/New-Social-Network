import { z } from "zod"

const blankToUndefined = (value: unknown) => (value === "" ? undefined : value)
const optionalString = (minimumLength = 1) =>
  z.preprocess(blankToUndefined, z.string().min(minimumLength).optional())
const optionalUrl = z.preprocess(blankToUndefined, z.url().optional())

const envSchema = z.object({
  DATABASE_URL: z.url(),
  NEXT_PUBLIC_APP_URL: z.preprocess(
    blankToUndefined,
    z.url().default("http://localhost:3000"),
  ),
  AUTH_SECRET: z.string().min(32),
  ADMIN_EMAILS: optionalString(),
  RESEND_API_KEY: optionalString(),
  RESEND_FROM_EMAIL: z.preprocess(
    blankToUndefined,
    z.string().default("UBEYE <onboarding@resend.dev>"),
  ),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: optionalString(),
  STRIPE_SECRET_KEY: optionalString(),
  STRIPE_WEBHOOK_SECRET: optionalString(),
  BLOB_READ_WRITE_TOKEN: optionalString(),
  STORY_STORAGE_PROVIDER: z.preprocess(
    blankToUndefined,
    z.enum(["local", "vercel-blob"]).optional(),
  ),
  STORY_VIDEO_PROCESSOR: z.preprocess(
    blankToUndefined,
    z.enum(["cloudflare-stream", "vercel-hls"]).optional(),
  ),
  MEDIA_PIPELINE_ENABLED: z.preprocess(
    blankToUndefined,
    z.enum(["true", "false"]).default("false"),
  ),
  MEDIA_DELIVERY_BLOB_READ_WRITE_TOKEN: optionalString(),
  CLOUDFLARE_STREAM_ACCOUNT_ID: optionalString(),
  CLOUDFLARE_STREAM_API_TOKEN: optionalString(),
  CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN: optionalString(),
  CLOUDFLARE_STREAM_WEBHOOK_SECRET: optionalString(),
  CLOUDFLARE_STREAM_SIGNING_KEY_ID: optionalString(),
  CLOUDFLARE_STREAM_SIGNING_KEY_PEM: optionalString(),
  CLOUDFLARE_STREAM_SIGNING_KEY_JWK: optionalString(),
  CLOUDFLARE_STREAM_HEALTHCHECK_UID: z.preprocess(
    blankToUndefined,
    z.string().regex(/^[a-f0-9]{32}$/i).optional(),
  ),
  UPSTASH_REDIS_REST_URL: optionalUrl,
  UPSTASH_REDIS_REST_TOKEN: optionalString(),
  CRON_SECRET: optionalString(16),
  DAILY_DRAW_SECRET: optionalString(16),
  APNS_KEY_ID: optionalString(),
  APNS_TEAM_ID: optionalString(),
  APNS_BUNDLE_ID: optionalString(),
  APNS_PRIVATE_KEY: optionalString(),
  APNS_ENVIRONMENT: z.preprocess(
    blankToUndefined,
    z.enum(["sandbox", "production"]).default("production"),
  ),
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
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "CRON_SECRET",
  ]
  const missing: string[] = required.filter((name) => !parsed[name])

  if (parsed.STORY_STORAGE_PROVIDER !== "vercel-blob") {
    missing.push("STORY_STORAGE_PROVIDER")
  }
  if (parsed.STORY_VIDEO_PROCESSOR === "vercel-hls") {
    if (parsed.MEDIA_PIPELINE_ENABLED !== "true") {
      missing.push("MEDIA_PIPELINE_ENABLED")
    }
    if (!parsed.MEDIA_DELIVERY_BLOB_READ_WRITE_TOKEN) {
      missing.push("MEDIA_DELIVERY_BLOB_READ_WRITE_TOKEN")
    }
  } else {
    const cloudflareRequired: Array<keyof Env> = [
      "CLOUDFLARE_STREAM_ACCOUNT_ID",
      "CLOUDFLARE_STREAM_API_TOKEN",
      "CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN",
      "CLOUDFLARE_STREAM_WEBHOOK_SECRET",
      "CLOUDFLARE_STREAM_SIGNING_KEY_ID",
      "CLOUDFLARE_STREAM_HEALTHCHECK_UID",
    ]
    missing.push(...cloudflareRequired.filter((name) => !parsed[name]))
    if (
      !parsed.CLOUDFLARE_STREAM_SIGNING_KEY_PEM &&
      !parsed.CLOUDFLARE_STREAM_SIGNING_KEY_JWK
    ) {
      missing.push("CLOUDFLARE_STREAM_SIGNING_KEY_JWK")
    }
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
