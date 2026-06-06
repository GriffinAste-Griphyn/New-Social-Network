import { randomUUID, scryptSync } from "node:crypto"

import { Pool } from "@neondatabase/serverless"
import { config } from "dotenv"

config({ path: ".env.local" })
config({ path: ".env.production.local", override: true })
config()

const reviewer = {
  email: "griffin.aste+appreview@gmail.com",
  password: "UbeYeReview!2026",
  displayName: "UBEYE App Review",
  handle: "ubeye_app_review",
}

const now = new Date()
const storyId = "app-review-story-2026"
const mediaAssetId = "app-review-media-asset-2026"
const storyMediaUrl = "https://www.ubeye.ai/ubeye/hero-manhattan-loop-v2.mp4"

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required.`)
  }
  return value
}

function hashPassword(password) {
  const salt = randomUUID()
  const digest = scryptSync(password, salt, 64).toString("hex")

  return `${salt}:${digest}`
}

async function main() {
  const pool = new Pool({ connectionString: requiredEnv("DATABASE_URL") })

  try {
    const userId = `app-review-${randomUUID()}`
    const passwordHash = hashPassword(reviewer.password)

    await pool.query("begin")

    const existing = await pool.query(
      `select id from users where lower(email) = lower($1) limit 1`,
      [reviewer.email],
    )
    const resolvedUserId = existing.rows[0]?.id ?? userId

    await pool.query(
      `
        insert into users (
          id,
          auth_provider,
          auth_user_id,
          email,
          email_verified_at,
          password_hash,
          failed_login_count,
          locked_until,
          handle,
          display_name,
          onboarding_intent,
          creator_status,
          is_creator_mode,
          created_at,
          updated_at
        )
        values (
          $1,
          'credentials',
          $2,
          $3,
          $4,
          $5,
          0,
          null,
          $6,
          $7,
          'both',
          'active',
          true,
          $4,
          $4
        )
        on conflict (email) do update set
          auth_provider = 'credentials',
          auth_user_id = excluded.auth_user_id,
          email_verified_at = excluded.email_verified_at,
          password_hash = excluded.password_hash,
          failed_login_count = 0,
          locked_until = null,
          handle = excluded.handle,
          display_name = excluded.display_name,
          onboarding_intent = 'both',
          creator_status = 'active',
          is_creator_mode = true,
          updated_at = excluded.updated_at
      `,
      [
        resolvedUserId,
        `credentials:${reviewer.email}`,
        reviewer.email,
        now,
        passwordHash,
        reviewer.handle,
        reviewer.displayName,
      ],
    )

    await pool.query(
      `
        insert into creator_profiles (
          user_id,
          category,
          creator_bio,
          is_public,
          analytics_enabled,
          monetization_enabled,
          created_at,
          updated_at
        )
        values (
          $1,
          'App Review',
          'Demo account for Apple App Review.',
          true,
          true,
          false,
          $2,
          $2
        )
        on conflict (user_id) do update set
          category = excluded.category,
          creator_bio = excluded.creator_bio,
          is_public = true,
          analytics_enabled = true,
          updated_at = excluded.updated_at
      `,
      [resolvedUserId, now],
    )

    const revokedSessions = await pool.query(
      `
        update auth_sessions
        set revoked_at = $2
        where user_id = $1 and revoked_at is null
      `,
      [resolvedUserId, now],
    )

    const clearedResetTokens = await pool.query(
      `
        update password_reset_tokens
        set used_at = $2
        where user_id = $1 and used_at is null
      `,
      [resolvedUserId, now],
    )

    const clearedVerificationTokens = await pool.query(
      `
        update email_verification_tokens
        set used_at = $2
        where user_id = $1 and used_at is null
      `,
      [resolvedUserId, now],
    )

    const clearedRateLimits = await pool.query(
      `
        delete from auth_rate_limits
        where key like '%griffin.aste+appreview@gmail.com%'
           or key like '%appreview%'
           or key like '%codex-app-review-check%'
      `,
    )

    await pool.query(
      `
        insert into media_assets (
          id,
          owner_user_id,
          purpose,
          asset_kind,
          storage_provider,
          storage_key,
          media_url,
          thumbnail_url,
          content_type,
          byte_size,
          checksum,
          width,
          height,
          duration_ms,
          processing_status,
          scan_status,
          ready_at,
          created_at,
          updated_at
        )
        values (
          $1,
          $2,
          'story',
          'video',
          'local',
          'ubeye/hero-manhattan-loop-v2.mp4',
          $3,
          null,
          'video/mp4',
          1,
          'app-review-demo',
          1080,
          1920,
          10000,
          'ready',
          'passed',
          $4,
          $4,
          $4
        )
        on conflict (id) do update set
          owner_user_id = excluded.owner_user_id,
          media_url = excluded.media_url,
          processing_status = 'ready',
          scan_status = 'passed',
          ready_at = excluded.ready_at,
          updated_at = excluded.updated_at
      `,
      [mediaAssetId, resolvedUserId, storyMediaUrl, now],
    )

    await pool.query(
      `
        insert into stories (
          id,
          creator_id,
          asset_kind,
          media_url,
          thumbnail_url,
          storage_provider,
          storage_key,
          content_type,
          byte_size,
          checksum,
          media_asset_id,
          width,
          height,
          processing_status,
          moderation_status,
          moderation_reason,
          reviewed_at,
          caption,
          duration_ms,
          expires_at,
          status,
          brand_signal_score,
          created_at
        )
        values (
          $1,
          $2,
          'video',
          $3,
          null,
          'local',
          'ubeye/hero-manhattan-loop-v2.mp4',
          'video/mp4',
          1,
          'app-review-demo',
          $4,
          1080,
          1920,
          'ready',
          'approved',
          null,
          $5,
          'App Review demo story',
          10000,
          $6,
          'live',
          '0.00',
          $5
        )
        on conflict (id) do update set
          creator_id = excluded.creator_id,
          media_url = excluded.media_url,
          media_asset_id = excluded.media_asset_id,
          processing_status = 'ready',
          moderation_status = 'approved',
          moderation_reason = null,
          reviewed_at = excluded.reviewed_at,
          expires_at = excluded.expires_at,
          status = 'live'
      `,
      [
        storyId,
        resolvedUserId,
        storyMediaUrl,
        mediaAssetId,
        now,
        new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      ],
    )

    await pool.query("commit")

    console.log(
      JSON.stringify(
        {
          ok: true,
          email: reviewer.email,
          userId: resolvedUserId,
          handle: reviewer.handle,
          storyId,
          revokedSessions: revokedSessions.rowCount,
          clearedResetTokens: clearedResetTokens.rowCount,
          clearedVerificationTokens: clearedVerificationTokens.rowCount,
          clearedRateLimits: clearedRateLimits.rowCount,
        },
        null,
        2,
      ),
    )
  } catch (error) {
    await pool.query("rollback").catch(() => undefined)
    throw error
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
