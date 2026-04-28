import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { isSocialNetworkEnabled } from "@/lib/feature-flags"
import { prisma } from "@/lib/prisma"
import SimpleSocialApp from "./simple-social-app"

const SOCIAL_NETWORK_APP_PATH = "/social-network/app"
const CLAIM_USERNAME_PATH = "/social-network/claim-username"
const SOCIAL_NETWORK_PROFILE_PATH = "/social-network/profile"

function deriveTemporaryHandle(email: string | null | undefined) {
  const localPart = (email || "").trim().split("@")[0] || ""
  const normalized = localPart.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 15)
  return normalized.length >= 3 ? normalized : "guest"
}

export default async function SocialNetworkAppPage() {
  if (!isSocialNetworkEnabled()) {
    notFound()
  }

  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  const email = typeof session?.user?.email === "string" ? session.user.email : null
  const role = session?.user?.role

  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(SOCIAL_NETWORK_APP_PATH)}`)
  }
  if (role !== "VIEWER" && role !== "ADMIN") {
    redirect("/social-network?error=viewer-profile-required")
  }

  const profile = await prisma.viewerProfile.findUnique({
    where: { userId },
    select: { username: true, profileCompleted: true },
  })

  const claimedUsername = profile?.username?.trim() || null
  const displayHandle = claimedUsername || deriveTemporaryHandle(email)
  const profileCompleted = profile?.profileCompleted === true
  const canClaimUsername = profileCompleted && !claimedUsername
  const socialProfileHref = SOCIAL_NETWORK_PROFILE_PATH
  const setupCtaHref = !profileCompleted
    ? `/viewer/onboarding?callbackUrl=${encodeURIComponent(SOCIAL_NETWORK_PROFILE_PATH)}`
    : canClaimUsername
      ? CLAIM_USERNAME_PATH
      : socialProfileHref
  const setupCtaLabel = !profileCompleted
    ? "Complete profile"
    : canClaimUsername
      ? "Claim username"
      : "Profile"
  const adNetworkHref = "/viewer"

  return (
    <SimpleSocialApp
      displayHandle={displayHandle}
      setupCtaHref={setupCtaHref}
      setupCtaLabel={setupCtaLabel}
      profileHref={socialProfileHref}
      viewerUserId={userId}
      adNetworkHref={adNetworkHref}
    />
  )
}
