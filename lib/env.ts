import { z } from "zod"

const envSchema = z.object({
  DATABASE_URL: z.url(),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  AUTH_SECRET: z.string().min(32),
  ADMIN_EMAILS: z.string().optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.string().default("New Social Network <onboarding@resend.dev>"),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STORY_STORAGE_PROVIDER: z.enum(["vercel-blob"]).optional(),
  STORY_VIDEO_PROCESSOR: z.enum(["cloudflare-stream"]).optional(),
  BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
  CLOUDFLARE_STREAM_ACCOUNT_ID: z.string().min(1).optional(),
  CLOUDFLARE_STREAM_API_TOKEN: z.string().min(1).optional(),
  CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN: z.string().min(1).optional(),
  CLOUDFLARE_STREAM_WEBHOOK_SECRET: z.string().min(1).optional(),
  CRON_SECRET: z.string().min(16).optional(),
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

export function assertProductionMediaEnvironment() {
  if (process.env.NODE_ENV !== "production") {
    return
  }

  const required: Array<keyof Env> = [
    "STORY_STORAGE_PROVIDER",
    "STORY_VIDEO_PROCESSOR",
    "BLOB_READ_WRITE_TOKEN",
    "CLOUDFLARE_STREAM_ACCOUNT_ID",
    "CLOUDFLARE_STREAM_API_TOKEN",
    "CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN",
    "CRON_SECRET",
  ]
  const missing = required.filter((key) => !env[key])

  if (missing.length > 0) {
    throw new Error(
      `Missing production media environment variables: ${missing.join(", ")}`,
    )
  }

  if (env.STORY_STORAGE_PROVIDER !== "vercel-blob") {
    throw new Error("Production media requires STORY_STORAGE_PROVIDER=vercel-blob.")
  }

  if (env.STORY_VIDEO_PROCESSOR !== "cloudflare-stream") {
    throw new Error(
      "Production video uploads require STORY_VIDEO_PROCESSOR=cloudflare-stream.",
    )
  }
}
