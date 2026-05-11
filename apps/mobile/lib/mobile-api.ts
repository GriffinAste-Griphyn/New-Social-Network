import Constants from "expo-constants"
import AsyncStorage from "@react-native-async-storage/async-storage"

const fallbackApiBaseUrl = "http://127.0.0.1:3000"

export class MobileApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "MobileApiError"
    this.status = status
  }
}

let mobileAuthToken: string | null = null
const mobileDeviceIdKey = "ubeye.mobile.device.id"
const legacyMobileDeviceIdKey = "nsn.mobile.device.id"
let mobileDeviceIdPromise: Promise<string> | null = null

export function setMobileApiAuthToken(token: string | null) {
  mobileAuthToken = token
}

type MobileApiOptions = {
  authToken?: string | null
}

function createMobileDeviceId() {
  const randomParts = Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, "0"),
  )

  return `mobile-${Date.now().toString(36)}-${randomParts.join("")}`
}

async function getMobileDeviceId() {
  if (!mobileDeviceIdPromise) {
    mobileDeviceIdPromise = AsyncStorage.getItem(mobileDeviceIdKey).then(
      async (storedValue) => {
        if (storedValue) {
          return storedValue
        }

        const legacyValue = await AsyncStorage.getItem(legacyMobileDeviceIdKey)

        if (legacyValue) {
          await AsyncStorage.setItem(mobileDeviceIdKey, legacyValue)
          await AsyncStorage.removeItem(legacyMobileDeviceIdKey)
          return legacyValue
        }

        const nextValue = createMobileDeviceId()
        await AsyncStorage.setItem(mobileDeviceIdKey, nextValue)

        return nextValue
      },
    )
  }

  return mobileDeviceIdPromise
}

async function getMobileApiHeaders(
  headers?: Record<string, string>,
  options?: MobileApiOptions,
) {
  const authToken = options?.authToken ?? mobileAuthToken
  const deviceId = await getMobileDeviceId()

  return {
    Accept: "application/json",
    "X-Device-Id": deviceId,
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...headers,
  }
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "")
}

function getHostFromExpoUri(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const hostWithPort = value.replace(/^[a-z]+:\/\//i, "").split("/")[0]
  const host = hostWithPort?.split(":")[0]

  return host || null
}

export function getApiBaseUrl() {
  const configuredUrl = process.env.EXPO_PUBLIC_API_URL

  if (configuredUrl) {
    return trimTrailingSlash(configuredUrl)
  }

  const host =
    getHostFromExpoUri(Constants.expoConfig?.hostUri) ??
    getHostFromExpoUri((Constants as { debuggerHost?: string }).debuggerHost)

  if (!host) {
    return fallbackApiBaseUrl
  }

  return `http://${host === "localhost" ? "127.0.0.1" : host}:3000`
}

export function normalizeMobileMediaUrl(value: string | null | undefined) {
  if (!value) {
    return null
  }

  if (!/^https?:\/\//i.test(value)) {
    return value
  }

  try {
    const mediaUrl = new URL(value)

    if (mediaUrl.hostname !== "localhost" && mediaUrl.hostname !== "127.0.0.1") {
      return value
    }

    const apiUrl = new URL(getApiBaseUrl())
    mediaUrl.protocol = apiUrl.protocol
    mediaUrl.hostname = apiUrl.hostname
    mediaUrl.port = apiUrl.port

    return mediaUrl.toString()
  } catch {
    return value
  }
}

export async function postMobileApi<TResponse>(
  path: string,
  body: Record<string, unknown>,
  options?: MobileApiOptions,
) {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: "POST",
    headers: await getMobileApiHeaders({
      "Content-Type": "application/json",
    }, options),
    body: JSON.stringify(body),
  })

  const payload = (await response.json().catch(() => null)) as
    | (TResponse & { error?: string })
    | null

  if (!response.ok) {
    throw new MobileApiError(
      payload?.error ?? "The auth server did not respond.",
      response.status,
    )
  }

  return payload as TResponse
}

export async function getMobileApi<TResponse>(
  path: string,
  options?: MobileApiOptions,
) {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: "GET",
    headers: await getMobileApiHeaders(undefined, options),
  })

  const payload = (await response.json().catch(() => null)) as
    | (TResponse & { error?: string })
    | null

  if (!response.ok) {
    throw new MobileApiError(
      payload?.error ?? "The server did not respond.",
      response.status,
    )
  }

  return payload as TResponse
}

export async function postMobileFormApi<TResponse>(
  path: string,
  body: FormData,
  options?: MobileApiOptions,
) {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: "POST",
    headers: await getMobileApiHeaders(undefined, options),
    body,
  })

  const payload = (await response.json().catch(() => null)) as
    | (TResponse & { error?: string })
    | null

  if (!response.ok) {
    throw new MobileApiError(
      payload?.error ?? "The upload server did not respond.",
      response.status,
    )
  }

  return payload as TResponse
}

export async function deleteMobileApi<TResponse>(
  path: string,
  body: Record<string, unknown>,
  options?: MobileApiOptions,
) {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: "DELETE",
    headers: await getMobileApiHeaders({
      "Content-Type": "application/json",
    }, options),
    body: JSON.stringify(body),
  })

  const payload = (await response.json().catch(() => null)) as
    | (TResponse & { error?: string })
    | null

  if (!response.ok) {
    throw new MobileApiError(
      payload?.error ?? "The server did not respond.",
      response.status,
    )
  }

  return payload as TResponse
}
