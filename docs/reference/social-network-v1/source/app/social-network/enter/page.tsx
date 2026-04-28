import Link from "next/link"
import { cookies } from "next/headers"
import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { ArrowRight } from "lucide-react"
import MarketingHeader from "@/components/marketing-header"
import { MarketingFooter } from "@/components/marketing-footer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { authOptions } from "@/lib/auth"
import { isSocialNetworkEnabled } from "@/lib/feature-flags"
import {
  createSocialNetworkAccessCookieValue,
  hasConfiguredSocialNetworkAccessCodes,
  isSocialNetworkAccessCookieValueValid,
  isSocialNetworkAccessGateEnabled,
  resolveSocialNetworkNextPath,
  SOCIAL_NETWORK_ACCESS_COOKIE_MAX_AGE_SECONDS,
  SOCIAL_NETWORK_ACCESS_COOKIE_NAME,
} from "@/lib/social-network-access"

const errorMessages: Record<string, string> = {
  "invalid-code": "That access code was not recognized.",
}

type SocialNetworkEnterPageProps = {
  searchParams?: {
    error?: string
    next?: string
  }
}

export default async function SocialNetworkEnterPage({ searchParams }: SocialNetworkEnterPageProps) {
  if (!isSocialNetworkEnabled()) {
    notFound()
  }

  const gateEnabled = isSocialNetworkAccessGateEnabled()
  const nextPath = resolveSocialNetworkNextPath(searchParams?.next)
  const enterCallback = `/social-network/enter?next=${encodeURIComponent(nextPath)}`
  const signInHref = `/login?callbackUrl=${encodeURIComponent(enterCallback)}`

  if (!gateEnabled) {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      redirect(`/login?callbackUrl=${encodeURIComponent(nextPath)}`)
    }
    redirect(nextPath)
  }

  const cookieStore = await cookies()
  const accessCookie = cookieStore.get(SOCIAL_NETWORK_ACCESS_COOKIE_NAME)?.value
  const hasAccessCookie = isSocialNetworkAccessCookieValueValid(accessCookie)

  if (hasAccessCookie) {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      redirect(`/login?callbackUrl=${encodeURIComponent(enterCallback)}`)
    }
    redirect(nextPath)
  }

  const hasCodesConfigured = hasConfiguredSocialNetworkAccessCodes()
  const errorMessage = searchParams?.error ? errorMessages[searchParams.error] || null : null

  async function submitAccessCode(formData: FormData) {
    "use server"

    const nextRaw = formData.get("next")
    const nextValue = resolveSocialNetworkNextPath(typeof nextRaw === "string" ? nextRaw : null)
    const accessCodeRaw = formData.get("accessCode")
    const accessCode = typeof accessCodeRaw === "string" ? accessCodeRaw : ""
    const nextQuery = `next=${encodeURIComponent(nextValue)}`

    if (!isSocialNetworkAccessGateEnabled()) {
      redirect(`/social-network/enter?${nextQuery}`)
    }

    if (!hasConfiguredSocialNetworkAccessCodes()) {
      redirect(`/social-network/enter?${nextQuery}`)
    }

    const cookieValue = createSocialNetworkAccessCookieValue(accessCode)
    if (!cookieValue) {
      redirect(`/social-network/enter?error=invalid-code&${nextQuery}`)
    }

    const writableCookies = await cookies()
    writableCookies.set({
      name: SOCIAL_NETWORK_ACCESS_COOKIE_NAME,
      value: cookieValue,
      maxAge: SOCIAL_NETWORK_ACCESS_COOKIE_MAX_AGE_SECONDS,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/social-network",
    })

    redirect(`/social-network/enter?${nextQuery}`)
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader
        signInHref={signInHref}
        getStartedHref="/social-network"
        getStartedLabel="Learn more"
        activeHref="/social-network"
      />

      <main>
        <section className="container mx-auto flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-20 md:min-h-[calc(100vh-9rem)] md:py-24">
          <div className="mx-auto w-full max-w-xl text-center">
            <p className="mb-4 text-sm font-medium tracking-wide uppercase text-muted-foreground">Access code entry</p>
            <h1 className="mb-6 text-4xl font-bold leading-tight tracking-tight md:text-5xl">
              Enter the social network with an access code
            </h1>
            <p className="mb-10 text-lg leading-relaxed text-muted-foreground">
              The network is live behind a private gate. Enter your access code to unlock onboarding and continue to
              the app.
            </p>

            {errorMessage ? (
              <p className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {errorMessage}
              </p>
            ) : null}

            <form action={submitAccessCode} className="space-y-4 rounded-xl border border-border p-6 text-left">
              <label htmlFor="social-access-code" className="block text-sm font-medium">
                Access code
              </label>
              <Input
                id="social-access-code"
                name="accessCode"
                placeholder="Enter access code"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                disabled={!hasCodesConfigured}
                required
              />
              <input type="hidden" name="next" value={nextPath} />
              <Button type="submit" className="group w-full sm:w-auto" disabled={!hasCodesConfigured}>
                Continue
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </form>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" variant="outline" className="bg-transparent px-[15px]" asChild>
                <Link href={signInHref}>Sign in</Link>
              </Button>
              <Button size="lg" variant="ghost" className="px-[15px]" asChild>
                <Link href="/social-network">Back to social network overview</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}
