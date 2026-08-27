import { buildStoryMediaRoute, createStoryMediaAccessToken } from "./access"

function resolveHlsChildPathname(parentPathname: string, child: string) {
  if (
    !parentPathname.startsWith("media/") ||
    /^[a-z][a-z0-9+.-]*:/i.test(child) ||
    child.startsWith("/")
  ) {
    return null
  }
  const parentSegments = parentPathname.split("/")
  parentSegments.pop()
  for (const segment of child.split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") parentSegments.pop()
    else parentSegments.push(segment)
  }
  const pathname = parentSegments.join("/")
  return pathname.startsWith("media/") &&
    pathname.split("/").every((segment) => segment && segment !== "..")
    ? pathname
    : null
}

function signedHlsChildUrl(parentPathname: string, child: string) {
  const pathname = resolveHlsChildPathname(parentPathname, child)
  if (!pathname) return child
  const token = createStoryMediaAccessToken(pathname)
  return `${buildStoryMediaRoute(pathname)}?token=${encodeURIComponent(token)}`
}

export function rewriteHlsPlaylistForStoryMedia(
  playlist: string,
  parentPathname: string,
) {
  return playlist
    .split("\n")
    .map((line) => {
      if (!line || !line.startsWith("#")) {
        return line ? signedHlsChildUrl(parentPathname, line) : line
      }
      return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
        return `URI="${signedHlsChildUrl(parentPathname, uri)}"`
      })
    })
    .join("\n")
}
