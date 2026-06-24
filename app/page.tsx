import Link from "next/link"
import type { Metadata } from "next"
import { ArrowRight } from "lucide-react"

import { Button } from "@/components/ui/button"

const mobileAppHref = "https://apps.apple.com/us/app/ubeye/id6768760562"
const advertiserSignInHref = "/login?next=%2Fadvertiser"
const heroPoster = "/ubeye/hero-manhattan-poster-v2.jpg"
const heroVideo = "/ubeye/hero-manhattan-loop-v2.mp4"

export const metadata: Metadata = {
  title: "UBEYE | The post-work income platform",
  description: "UBEYE | The post-work income platform",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "UBEYE | The post-work income platform",
    description: "UBEYE | The post-work income platform",
    url: "/",
    siteName: "UBEYE",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "UBEYE | The post-work income platform",
    description: "UBEYE | The post-work income platform",
  },
}

function SiteHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-[#050505]/80 text-white backdrop-blur-xl">
      <div className="relative mx-auto flex h-16 w-full max-w-[1180px] items-center justify-between gap-4 px-4">
        <Link href="/" className="text-xl font-medium" aria-label="UBEYE home">
          UBEYE
        </Link>

        <div className="flex items-center gap-2">
          <Button
            asChild
            variant="ghost"
            className="hidden h-9 rounded-[8px] px-3 text-sm text-white/70 hover:bg-white/8 hover:text-white sm:inline-flex"
          >
            <Link href={advertiserSignInHref}>Advertiser sign in</Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            className="h-9 rounded-[8px] bg-white px-4 text-sm text-black hover:bg-[#e01616] hover:text-white dark:hover:bg-[#e01616]"
          >
            <a href={mobileAppHref}>Get the app</a>
          </Button>
        </div>
      </div>
    </header>
  )
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <SiteHeader />

      <main className="overflow-hidden">
        <section className="relative min-h-svh border-b border-white/10 pt-16">
          <div
            className="absolute inset-0 bg-cover bg-center opacity-54 motion-reduce:block"
            style={{ backgroundImage: `url(${heroPoster})` }}
          />
          <video
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            poster={heroPoster}
            className="absolute inset-0 hidden h-full w-full object-cover opacity-50 motion-safe:block [filter:contrast(1.05)_saturate(0.78)]"
          >
            <source src={heroVideo} type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,5,5,0.98),rgba(5,5,5,0.78)_55%,rgba(5,5,5,0.42))]" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,5,5,0.18),rgba(5,5,5,0.48)_62%,rgba(5,5,5,1)_100%)]" />

          <div className="relative mx-auto flex min-h-[calc(100svh-4rem)] max-w-[1180px] items-center px-4 py-10 md:py-12">
            <div className="max-w-4xl">
              <p className="inline-flex max-w-full items-center rounded-[8px] border border-white/14 bg-white/8 px-3 py-1.5 text-[0.68rem] font-medium uppercase leading-[1.2] text-white/78 backdrop-blur-sm">
                The post-work income platform
              </p>
              <h1 className="mt-8 text-6xl font-[340] leading-[0.95] text-white sm:text-7xl md:text-8xl lg:text-9xl">
                UBEYE
              </h1>
              <p className="mt-7 max-w-3xl text-2xl font-[340] leading-tight text-white md:text-4xl md:leading-tight">
                In the pursuit of AGI, human attention and consciousness will become the new gold.
              </p>
              <p className="mt-6 max-w-2xl text-base leading-8 text-white/66 md:text-lg">
                UBEYE turns that idea into a social product: people post stories,
                people spend attention, advertisers fund the signal, and users can
                share in the value they helped create.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Button
                  asChild
                  className="h-12 justify-between rounded-[8px] bg-[#e01616] px-5 text-sm font-medium text-white hover:bg-[#c91414] sm:justify-center"
                >
                  <a href={mobileAppHref}>
                    Get the app
                    <ArrowRight className="size-4" />
                  </a>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="h-12 justify-between rounded-[8px] border-white/16 bg-white/5 px-5 text-sm font-medium text-white hover:bg-white/10 sm:justify-center"
                >
                  <Link href="/advertise">Advertise on UBEYE</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
