import Link from "next/link"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import {
  ArrowLeft,
  ArrowRight,
  BadgeDollarSign,
  MonitorSmartphone,
  Smartphone,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { getSession, isProfileComplete } from "@/lib/auth"

const mobileSignupHref = "/signup?next=%2Ffeed"
const mobileSignInHref = "/login?next=%2Ffeed"
const advertiserSignInHref = "/login?next=%2Fadvertiser"
const heroPoster = "/ubeye/hero-manhattan-poster-v2.jpg"
const heroVideo = "/ubeye/hero-manhattan-loop-v2.mp4"

export const metadata: Metadata = {
  title: "Open UBEYE mobile web",
  description:
    "Open UBEYE on your phone in the browser. Sign up, post stories, watch, follow, and participate on mobile web.",
}

const accessRows = [
  {
    icon: Smartphone,
    label: "Mobile users",
    value: "Sign up, log in, post, watch, and participate from mobile Safari or Chrome.",
  },
  {
    icon: MonitorSmartphone,
    label: "Desktop visitors",
    value: "Consumer access is phone-only while the product is in mobile web beta.",
  },
  {
    icon: BadgeDollarSign,
    label: "Advertisers",
    value: "Use the desktop portal to create accounts and manage funding.",
  },
]

export default async function MobileAppPage() {
  const session = await getSession()

  if (isProfileComplete(session)) {
    redirect("/feed")
  }

  if (session) {
    redirect("/onboarding/profile?next=%2Ffeed")
  }

  return (
    <main className="min-h-screen bg-[#f4f2ec] text-black">
      <section className="relative isolate min-h-[calc(100svh-4rem)] overflow-hidden border-b border-black/10">
        <div
          className="absolute inset-0 bg-cover bg-center motion-reduce:block"
          style={{ backgroundImage: `url(${heroPoster})` }}
        />
        <video
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          poster={heroPoster}
          className="absolute inset-0 hidden h-full w-full object-cover motion-safe:block [filter:brightness(0.78)_contrast(0.98)_saturate(0.86)]"
        >
          <source src={heroVideo} type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,10,12,0.68),rgba(7,10,12,0.36)_52%,rgba(7,10,12,0.18))]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,10,12,0.16),rgba(7,10,12,0.06)_45%,rgba(7,10,12,0.66))]" />

        <div className="relative z-10 mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-[1180px] flex-col px-4 py-5 text-white sm:px-6 lg:px-4">
          <header className="flex items-center justify-between gap-4">
            <Link href="/" className="text-xl font-semibold tracking-[-0.04em]" aria-label="UBEYE home">
              UBEYE
            </Link>
            <Button asChild variant="ghost" className="h-10 rounded-full px-4 text-sm text-white hover:bg-white/10 hover:text-white">
              <Link href={advertiserSignInHref}>Advertiser sign in</Link>
            </Button>
          </header>

          <div className="grid flex-1 items-end gap-10 pb-8 pt-20 lg:grid-cols-[minmax(0,1fr)_24rem] lg:pb-12">
            <div className="max-w-4xl">
              <Link
                href="/"
                className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-white/72 transition hover:text-white"
              >
                <ArrowLeft className="size-4" />
                Back to UBEYE
              </Link>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-white/54">
                Mobile web beta
              </p>
              <h1 className="mt-5 max-w-[10ch] text-6xl font-semibold leading-[0.94] tracking-[-0.07em] sm:text-7xl lg:text-[6.6rem]">
                UBEYE runs in your browser.
              </h1>
              <p className="mt-7 max-w-xl text-base leading-8 text-white/68 md:text-lg">
                Use UBEYE from your phone first. The mobile web beta supports
                signup, login, posting, stories, follows, stats, and payouts
                without TestFlight.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild className="h-12 justify-between rounded-full bg-white px-6 text-sm font-semibold text-black hover:bg-white/88 sm:justify-center">
                  <Link href={mobileSignupHref}>
                    Create mobile account
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="h-12 justify-between rounded-full border-white/22 bg-white/8 px-6 text-sm font-semibold text-white hover:bg-white/14 hover:text-white sm:justify-center"
                >
                  <Link href={mobileSignInHref}>Sign in</Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="h-12 justify-between rounded-full border-white/22 bg-white/8 px-6 text-sm font-semibold text-white hover:bg-white/14 hover:text-white sm:justify-center"
                >
                  <Link href="/advertise">Advertise on UBEYE</Link>
                </Button>
              </div>
            </div>

            <div className="grid gap-3">
              {accessRows.map((row) => (
                <article
                  key={row.label}
                  className="rounded-[8px] border border-white/14 bg-white/10 p-4 backdrop-blur-md"
                >
                  <div className="flex gap-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-black">
                      <row.icon className="size-5" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-white">{row.label}</h2>
                      <p className="mt-2 text-sm leading-6 text-white/62">{row.value}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
