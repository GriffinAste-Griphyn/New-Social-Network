const defaultHiddenProfileEmails = ["griffin.aste+appreview@gmail.com"]
const defaultHiddenProfileHandles = ["appreview", "ubeyeappreview", "ubeye_app_review"]
const defaultHiddenProfileNames = ["ubeye app review"]

function normalizedList(values: string[], envValue?: string) {
  return [
    ...values,
    ...(envValue ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ].map((value) => value.trim().toLowerCase())
}

function normalizeHandle(value: string | null | undefined) {
  return value?.trim().replace(/^@+/, "").toLowerCase() ?? ""
}

export function isPubliclyHiddenProfile(profile: {
  email?: string | null
  handle?: string | null
  displayName?: string | null
  name?: string | null
}) {
  const hiddenEmails = normalizedList(
    defaultHiddenProfileEmails,
    process.env.HIDDEN_PUBLIC_PROFILE_EMAILS,
  )
  const hiddenHandles = normalizedList(
    defaultHiddenProfileHandles,
    process.env.HIDDEN_PUBLIC_PROFILE_HANDLES,
  )
  const hiddenNames = normalizedList(
    defaultHiddenProfileNames,
    process.env.HIDDEN_PUBLIC_PROFILE_NAMES,
  )

  const email = profile.email?.trim().toLowerCase()
  const handle = normalizeHandle(profile.handle)
  const displayName = (profile.displayName ?? profile.name)?.trim().toLowerCase()

  return (
    Boolean(email && hiddenEmails.includes(email)) ||
    Boolean(handle && hiddenHandles.includes(handle)) ||
    Boolean(displayName && hiddenNames.includes(displayName))
  )
}
