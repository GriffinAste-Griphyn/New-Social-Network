export function getPublicSiteUrl() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";

  return appUrl.replace(/\/+$/, "");
}
