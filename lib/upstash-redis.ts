type RedisResult<T> = {
  result?: T
  error?: string
}

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL
    ?.trim()
    .replace(/\/$/, "")
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()

  if (url && token) {
    return { url, token }
  }

  if (process.env.VERCEL_ENV === "production") {
    throw new Error(
      "Production requires Upstash Redis REST credentials.",
    )
  }

  return null
}

export function hasRedisCache() {
  return redisConfig() !== null
}

export async function redisCommand<T>(command: Array<string | number>) {
  const config = redisConfig()
  if (!config) {
    return null
  }

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error(`Redis command failed with HTTP ${response.status}.`)
  }

  const payload = (await response.json()) as RedisResult<T>
  if (payload.error) {
    throw new Error(payload.error)
  }

  return payload.result ?? null
}

export async function redisPipeline<T = unknown>(
  commands: Array<Array<string | number>>,
) {
  const config = redisConfig()
  if (!config || commands.length === 0) {
    return null
  }

  const response = await fetch(`${config.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error(`Redis pipeline failed with HTTP ${response.status}.`)
  }

  const payload = (await response.json()) as Array<RedisResult<T>>
  const failed = payload.find((item) => item.error)
  if (failed?.error) {
    throw new Error(failed.error)
  }

  return payload.map((item) => item.result ?? null)
}
