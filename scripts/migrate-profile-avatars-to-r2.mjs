import { randomUUID } from "node:crypto"

import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { get } from "@vercel/blob"
import postgres from "postgres"

function requiredEnvironment(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}

const connectionString = requiredEnvironment("DATABASE_URL")
const accountId =
  process.env.CLOUDFLARE_R2_ACCOUNT_ID?.trim() ||
  requiredEnvironment("CLOUDFLARE_STREAM_ACCOUNT_ID")
const accessKeyId = requiredEnvironment("CLOUDFLARE_R2_ACCESS_KEY_ID")
const secretAccessKey = requiredEnvironment("CLOUDFLARE_R2_SECRET_ACCESS_KEY")
const originalsBucket = requiredEnvironment("CLOUDFLARE_R2_ORIGINALS_BUCKET")
const deliveryBucket = requiredEnvironment("CLOUDFLARE_R2_DELIVERY_BUCKET")
const publicBaseUrl = requiredEnvironment("CLOUDFLARE_R2_PUBLIC_BASE_URL").replace(
  /\/+$/,
  "",
)

const sql = postgres(connectionString, {
  max: 1,
  prepare: false,
  connect_timeout: 15,
  idle_timeout: 5,
})
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
})

function encodeKey(key) {
  return key.split("/").map(encodeURIComponent).join("/")
}

function publicUrl(key) {
  return `${publicBaseUrl}/${encodeKey(key)}`
}

function sourceRoute(key) {
  return `/api/profile-avatar-media/cloudflare-r2/${encodeKey(key)}`
}

function privateBlobPathname(value) {
  if (!value) return null

  try {
    const url = new URL(value, "https://www.ubeye.ai")
    if (url.pathname.startsWith("/api/profile-avatar-media/cloudflare-r2/")) {
      return null
    }

    if (url.hostname.endsWith(".private.blob.vercel-storage.com")) {
      const pathname = decodeURIComponent(url.pathname.replace(/^\/+/, ""))
      return pathname.startsWith("avatars/") ? pathname : null
    }

    const routePrefix = "/api/profile-avatar-media/"
    if (!url.pathname.startsWith(routePrefix)) return null
    const pathname = url.pathname
      .slice(routePrefix.length)
      .split("/")
      .map(decodeURIComponent)
      .join("/")
    return pathname.startsWith("avatars/") ? pathname : null
  } catch {
    return null
  }
}

async function readPrivateBlob(pathname) {
  const result = await get(pathname, { access: "private" })
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new Error(`Could not read legacy avatar object ${pathname}.`)
  }

  return {
    body: Buffer.from(await new Response(result.stream).arrayBuffer()),
    contentType: result.blob.contentType || "image/jpeg",
  }
}

async function putObject(bucket, key, body, contentType, cacheControl) {
  await r2.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentLength: body.byteLength,
      ContentType: contentType,
      CacheControl: cacheControl,
    }),
  )
}

async function deleteObject(bucket, key) {
  await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}

let migrated = 0
let skipped = 0
let failed = 0

try {
  const users = await sql`
    select
      id,
      avatar_url,
      avatar_source_url,
      avatar_asset_id
    from users
    where avatar_url is not null
    order by created_at asc
  `

  for (const user of users) {
    const avatarPathname = privateBlobPathname(user.avatar_url)
    if (!avatarPathname) {
      skipped += 1
      continue
    }

    let deliveryKey
    let sourceKey
    try {
      const avatar = await readPrivateBlob(avatarPathname)
      const sourcePathname = privateBlobPathname(user.avatar_source_url)
      const source = sourcePathname
        ? await readPrivateBlob(sourcePathname).catch(() => avatar)
        : avatar
      const migrationId = `${Date.now()}-${randomUUID()}`
      deliveryKey = `avatars/${user.id}/${migrationId}.jpg`
      sourceKey = `avatars/source/${user.id}/${migrationId}.jpg`

      await putObject(
        originalsBucket,
        sourceKey,
        source.body,
        source.contentType,
        "private, no-store",
      )
      await putObject(
        deliveryBucket,
        deliveryKey,
        avatar.body,
        avatar.contentType,
        "public, max-age=31536000, immutable",
      )

      const nextAvatarUrl = publicUrl(deliveryKey)
      const nextSourceUrl = sourceRoute(sourceKey)
      const updated = await sql.begin(async (tx) => {
        const rows = await tx`
          update users
          set
            avatar_url = ${nextAvatarUrl},
            avatar_source_url = ${nextSourceUrl},
            avatar_source_storage_key = ${sourceKey},
            avatar_source_content_type = ${source.contentType},
            avatar_source_byte_size = ${source.body.byteLength},
            updated_at = now()
          where id = ${user.id}
            and avatar_url = ${user.avatar_url}
          returning id
        `

        if (rows.length === 0) return false

        if (user.avatar_asset_id) {
          await tx`
            update media_assets
            set
              storage_provider = 'cloudflare-r2',
              storage_key = ${deliveryKey},
              media_url = ${nextAvatarUrl},
              thumbnail_url = ${nextAvatarUrl},
              content_type = ${avatar.contentType},
              byte_size = ${avatar.body.byteLength},
              updated_at = now()
            where id = ${user.avatar_asset_id}
          `
        }

        return true
      })

      if (!updated) {
        await Promise.allSettled([
          deleteObject(originalsBucket, sourceKey),
          deleteObject(deliveryBucket, deliveryKey),
        ])
        skipped += 1
        continue
      }

      migrated += 1
    } catch (error) {
      if (deliveryKey || sourceKey) {
        await Promise.allSettled([
          sourceKey
            ? deleteObject(originalsBucket, sourceKey)
            : Promise.resolve(),
          deliveryKey
            ? deleteObject(deliveryBucket, deliveryKey)
            : Promise.resolve(),
        ])
      }
      failed += 1
      console.warn(
        "Legacy avatar migration skipped one record:",
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  console.log(
    JSON.stringify({
      status: "ok",
      total: users.length,
      migrated,
      skipped,
      failed,
    }),
  )
} finally {
  await sql.end({ timeout: 5 })
}
