import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { notFound } from "next/navigation"
import MarketingHeader from "@/components/marketing-header"
import { MarketingFooter } from "@/components/marketing-footer"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { isSocialNetworkEnabled } from "@/lib/feature-flags"

const SOCIAL_NETWORK_ENTER_CALLBACK = encodeURIComponent("/social-network/enter")

type SocialNetworkPageProps = {
  searchParams?: {
    error?: string
  }
}

const errorMessages: Record<string, string> = {
  "viewer-profile-required": "Sign in with a viewer account to enter the social network.",
}

export default function SocialNetworkPage({ searchParams }: SocialNetworkPageProps) {
  if (!isSocialNetworkEnabled()) {
    notFound()
  }

  const signInHref = `/login?callbackUrl=${SOCIAL_NETWORK_ENTER_CALLBACK}`
  const getStartedHref = "/social-network/enter"
  const errorMessage = searchParams?.error ? errorMessages[searchParams.error] || null : null

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader
        signInHref={signInHref}
        getStartedHref={getStartedHref}
        getStartedLabel="Enter with code"
        activeHref="/social-network"
      />
      <main>
        <section className="container mx-auto px-4 pt-24 pb-20 md:pt-32 md:pb-28">
          <div className="max-w-3xl">
            <p className="text-sm font-medium text-muted-foreground mb-4 tracking-wide uppercase">
              Be your own media network
            </p>
            <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight tracking-tight">
              Content is now Queen
            </h1>
            <p className="text-lg text-muted-foreground mb-10 leading-relaxed max-w-2xl">
              UBEYE turns everyday story content into structured inventory brands can buy at scale, while creators own
              their unique audiences through email addresses and phone numbers
            </p>
            {errorMessage ? (
              <p className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {errorMessage}
              </p>
            ) : null}
            <div className="flex flex-col sm:flex-row items-start gap-3">
              <Button size="lg" className="group" asChild>
                <Link href={getStartedHref}>
                  Enter with access code
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="bg-transparent px-[15px]" asChild>
                <Link href={signInHref}>Sign in</Link>
              </Button>
            </div>
            <p className="mt-8 text-sm font-medium text-muted-foreground">
              Creator ownership. Clear demand. Measurable outcomes.
            </p>
          </div>
        </section>

        <section className="border-y border-border">
          <div className="container mx-auto px-4 py-16">
            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y divide-border sm:divide-y-0 sm:divide-x">
              <div className="py-6 px-6 sm:px-0 sm:pr-8">
                <div className="text-3xl font-bold tracking-tight">Creator-first</div>
                <div className="text-sm text-muted-foreground mt-1">turn everyday content into inventory</div>
              </div>
              <div className="py-6 px-6 sm:px-8">
                <div className="text-3xl font-bold tracking-tight">Media-ready</div>
                <div className="text-sm text-muted-foreground mt-1">brand demand matched to campaign goals</div>
              </div>
              <div className="py-6 px-6 sm:px-0 sm:pl-8">
                <div className="text-3xl font-bold tracking-tight">Measured</div>
                <div className="text-sm text-muted-foreground mt-1">influence tracked from post to outcome</div>
              </div>
            </div>
          </div>
        </section>

        <section className="container mx-auto px-4 py-24 border-t border-border">
          <div className="max-w-3xl mb-10">
            <h2 className="text-3xl font-bold mb-4 tracking-tight">Branded content, bought like media.</h2>
            <p className="text-muted-foreground leading-relaxed">
              A simple way for brands to buy creator inventory and for creators to monetize with clear structure,
              transparent performance, and direct collaboration.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="border-0 bg-muted/30 p-6">
              <h3 className="text-lg font-semibold mb-3">For creators</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Own your handle, publish story-first creative, and own your audience directly through email and mobile
                phone numbers.
              </p>
            </Card>
            <Card className="border-0 bg-muted/30 p-6">
              <h3 className="text-lg font-semibold mb-3">For brands</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Buy branded content like media. A simple way for brands to buy creator inventory based on goals.
              </p>
            </Card>
          </div>
        </section>

        <section className="border-t border-border">
          <div className="container mx-auto px-4 py-24">
            <div className="max-w-xl">
              <h2 className="text-3xl font-bold mb-4 tracking-tight">Request social network access</h2>
              <p className="text-muted-foreground mb-8 leading-relaxed">
                We are opening access in controlled waves. Use your access code to enter the private launch.
              </p>
              <div className="flex flex-col sm:flex-row items-start gap-3">
                <Button size="lg" asChild>
                  <Link href={getStartedHref}>Enter with access code</Link>
                </Button>
                <Button size="lg" variant="outline" className="bg-transparent" asChild>
                  <Link href={signInHref}>Sign in</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  )
}
