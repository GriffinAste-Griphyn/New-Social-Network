import Constants from "expo-constants"

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

export function setMobileApiAuthToken(token: string | null) {
  mobileAuthToken = token
}

type MobileApiOptions = {
  authToken?: string | null
}

function getMobileApiHeaders(
  headers?: Record<string, string>,
  options?: MobileApiOptions,
) {
  const authToken = options?.authToken ?? mobileAuthToken

  return {
    Accept: "application/json",
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

export async function postMobileApi<TResponse>(
  path: string,
  body: Record<string, unknown>,
  options?: MobileApiOptions,
) {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: "POST",
    headers: getMobileApiHeaders({
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
    headers: getMobileApiHeaders(undefined, options),
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

export async function postMobileFormApi<TResponse>(path: string, body: FormData) {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: "POST",
    headers: getMobileApiHeaders(),
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
    headers: getMobileApiHeaders({
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
