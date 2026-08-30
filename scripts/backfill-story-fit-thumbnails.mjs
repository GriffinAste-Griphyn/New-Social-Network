import { del, get, put } from "@vercel/blob"
import postgres from "postgres"
import sharp from "sharp"

const applyChanges = process.argv.includes("--apply")
const connectionString = process.env.DATABASE_URL?.trim()
const blobToken = (
  process.env.BLOB_READ_WRITE_TOKEN ??
  process.env.MEDIA_DELIVERY_BLOB_READ_WRITE_TOKEN
)?.trim()

if (!connectionString || !blobToken) {
  console.error("DATABASE_URL and a Vercel Blob read/write token are required.")
  process.exit(1)
}

const sql = postgres(connectionString, {
  max: 1,
  prepare: false,
  connect_timeout: 15,
  idle_timeout: 5,
})

function fitThumbnailPathname(storageKey) {
  const match = storageKey.match(/^(.*)-display\.(?:avif|webp)$/i)
  return match ? `${match[1]}-fit-thumb.webp` : null
}

function storyMediaUrl(pathname) {
  const encodedPathname = pathname
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  return `/api/story-media/${encodedPathname}`
}

async function encodeFitThumbnail(sourceBody) {
  const body = await sharp(sourceBody, {
    autoOrient: true,
    failOn: "warning",
    limitInputPixels: 80_000_000,
  })
    .resize(360, 640, {
      fit: "contain",
      position: "centre",
      kernel: sharp.kernel.lanczos3,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality: 85, effort: 6, smartSubsample: true })
    .toBuffer()

  if (body.byteLength > 150_000) {
    throw new Error(`Encoded thumbnail exceeds 150000 bytes (${body.byteLength}).`)
  }

  const metadata = await sharp(body).metadata()
  if (metadata.width !== 360 || metadata.height !== 640) {
    throw new Error(
      `Encoded thumbnail has unexpected dimensions ${metadata.width}x${metadata.height}.`,
    )
  }

  return body
}

try {
  const candidates = await sql`
    select id, storage_key, thumbnail_url
    from stories
    where asset_kind = 'image'
      and status = 'live'
      and expires_at > now()
      and storage_provider = 'vercel-blob'
      and thumbnail_url like '%-thumb.webp%'
      and thumbnail_url not like '%-fit-thumb.webp%'
    order by created_at asc
  `

  console.log(
    `${applyChanges ? "Applying" : "Dry run:"} ${candidates.length} active legacy image thumbnail(s).`,
  )

  if (!applyChanges) {
    for (const candidate of candidates) {
      const target = fitThumbnailPathname(candidate.storage_key)
      console.log(`${candidate.id} -> ${target ?? "unsupported storage key"}`)
    }
    process.exitCode = candidates.some(
      (candidate) => !fitThumbnailPathname(candidate.storage_key),
    )
      ? 1
      : 0
  } else {
    let updated = 0
    const failures = []

    for (const candidate of candidates) {
      const targetPathname = fitThumbnailPathname(candidate.storage_key)
      if (!targetPathname) {
        failures.push({ id: candidate.id, reason: "unsupported storage key" })
        continue
      }

      try {
        const source = await get(candidate.storage_key, {
          access: "private",
          token: blobToken,
          useCache: false,
        })
        if (!source || source.statusCode !== 200 || !source.stream) {
          throw new Error(`Could not read playback image (${source?.statusCode ?? "missing"}).`)
        }

        const sourceBody = Buffer.from(await new Response(source.stream).arrayBuffer())
        const thumbnailBody = await encodeFitThumbnail(sourceBody)
        const uploaded = await put(targetPathname, thumbnailBody, {
          access: "private",
          token: blobToken,
          addRandomSuffix: false,
          allowOverwrite: true,
          cacheControlMaxAge: 31_536_000,
          contentType: "image/webp",
        })
        if (uploaded.pathname !== targetPathname) {
          throw new Error(`Blob pathname mismatch: ${uploaded.pathname}`)
        }

        const nextThumbnailUrl = storyMediaUrl(targetPathname)
        const changed = await sql`
          update stories
          set thumbnail_url = ${nextThumbnailUrl}
          where id = ${candidate.id}
            and thumbnail_url = ${candidate.thumbnail_url}
          returning id
        `

        if (changed.length !== 1) {
          await del(targetPathname, { token: blobToken }).catch(() => undefined)
          throw new Error("Story changed while the derivative was being generated.")
        }

        updated += 1
        console.log(
          `${candidate.id} -> ${targetPathname} (${thumbnailBody.byteLength} bytes)`,
        )
      } catch (error) {
        failures.push({
          id: candidate.id,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }

    console.log(`Updated ${updated}/${candidates.length} active thumbnail(s).`)
    if (failures.length > 0) {
      for (const failure of failures) {
        console.error(`${failure.id}: ${failure.reason}`)
      }
      process.exitCode = 1
    }
  }
} finally {
  await sql.end({ timeout: 5 })
}
