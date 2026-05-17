import Link from "next/link"
import type { Metadata } from "next"
import { ArrowRight } from "lucide-react"

import { Button } from "@/components/ui/button"

const signupHref = "/signup?next=%2Fadvertiser"
const portalHref = "/login?next=%2Fadvertiser"
const heroPoster = "/ubeye/hero-manhattan-poster-v2.jpg"
const heroVideo = "/ubeye/hero-manhattan-loop-v2.mp4"

export const metadata: Metadata = {
  title: "Advertise on UBEYE",
  description:
    "Serve ads to targeted users on UBEYE with simple audience, budget, and safety controls.",
}

const attentionPath = [
  { label: "Choose audience", value: "Pick who should see your ads" },
  { label: "Set budget", value: "Control daily and monthly spend" },
  { label: "Serve ads", value: "Reach targeted users in the app" },
  { label: "Measure", value: "Track delivery and performance" },
]

const heroMetrics = [
  { label: "Format", value: "Ads" },
  { label: "Targeting", value: "Users" },
  { label: "Spend", value: "Capped" },
]

function SiteHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-[#060606]/78 text-white backdrop-blur-xl">
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
            <Link href={portalHref}>Sign in</Link>
          </Button>
          <Button
            asChild
            className="h-9 rounded-[8px] bg-white px-4 text-sm text-black hover:bg-white/88"
          >
            <Link href={signupHref}>Advertise</Link>
          </Button>
        </div>
      </div>
    </header>
  )
}

function FundingPath() {
  return (
    <div className="border border-white/12 bg-black/54 p-4 text-white shadow-[0_24px_80px_-56px_rgba(0,0,0,0.9)] backdrop-blur-md md:p-5">
      <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <p className="text-xs uppercase text-white/42">Campaign path</p>
          <p className="mt-1 text-sm font-medium text-white">Simple campaign setup</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-[8px] bg-[#e01616] px-2.5 py-1 text-xs font-medium text-white">
          <span className="size-1.5 rounded-full bg-white" />
          Ads
        </span>
      </div>

      <div className="grid grid-cols-3 divide-x divide-white/10 border-b border-white/10">
        {heroMetrics.map((metric) => (
          <div key={metric.label} className="px-3 py-4 first:pl-0 last:pr-0">
            <p className="text-[0.7rem] uppercase text-white/38">{metric.label}</p>
            <p className="mt-1 text-xl font-medium text-white md:text-2xl">{metric.value}</p>
          </div>
        ))}
      </div>

      <div className="divide-y divide-white/10">
        {attentionPath.map((item, index) => (
          <div key={item.label} className="grid grid-cols-[1.35rem_1fr] gap-3 py-4">
            <div className="pt-1">
              <span className="flex size-5 items-center justify-center rounded-full border border-[#e01616]/50 bg-[#e01616]/16 text-[0.65rem] font-medium text-[#ffb4a6]">
                {index + 1}
              </span>
            </div>
            <div>
              <p className="text-xs uppercase text-white/38">{item.label}</p>
              <p className="mt-1 text-sm text-white/82">{item.value}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function AdvertisePage() {
  return (
    <div className="min-h-screen bg-[#060606] text-white">
      <SiteHeader />

      <main className="overflow-hidden">
        <section className="relative min-h-[100svh] pt-16">
          <div
            className="absolute inset-0 bg-cover bg-center opacity-58 motion-reduce:block"
            style={{ backgroundImage: `url(${heroPoster})` }}
          />
          <video
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            poster={heroPoster}
            className="absolute inset-0 hidden h-full w-full object-cover opacity-56 motion-safe:block [filter:contrast(1.05)_saturate(0.82)]"
          >
            <source src={heroVideo} type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(6,6,6,0.96),rgba(6,6,6,0.72)_52%,rgba(6,6,6,0.38))]" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,6,6,0.2),rgba(6,6,6,0.44)_54%,rgba(6,6,6,1)_100%)]" />

          <div className="relative mx-auto grid max-w-[1180px] gap-10 px-4 md:min-h-[calc(100svh-4rem)] md:grid-cols-[minmax(0,1.08fr)_24rem] md:items-center md:py-12 lg:grid-cols-[minmax(0,1fr)_28rem] lg:gap-14">
            <div className="flex min-h-[calc(100svh-4rem)] max-w-4xl flex-col pb-8 pt-17 md:block md:min-h-0 md:py-0">
              <div>
                <p className="inline-flex max-w-full items-center rounded-[8px] border border-white/14 bg-white/8 px-3 py-1.5 text-[0.68rem] font-medium uppercase leading-[1.2] text-white/78 backdrop-blur-sm">
                  Advertise on UBEYE
                </p>
                <h1 className="mt-10 max-w-[15ch] text-[3.65rem] font-[350] leading-[0.92] text-white sm:text-[4.8rem] md:mt-7 md:text-[4.5rem] md:leading-[0.94] lg:text-[5.2rem]">
                  Organic content monetized.
                </h1>
                <p className="mt-9 max-w-2xl text-base leading-8 text-white/68 md:mt-6 md:text-lg md:leading-8">
                  <span className="md:hidden">
                    Choose your audience, set your budget, and launch ads.
                  </span>
                  <span className="hidden md:inline">
                    UBEYE lets advertisers choose the users they want to reach,
                    set a budget, and serve ads in the app.
                  </span>
                </p>
              </div>

              <div className="mt-auto flex flex-col gap-3 pt-10 sm:flex-row md:mt-6 md:pt-0">
                <Button
                  asChild
                  className="h-12 justify-between rounded-[8px] bg-[#e01616] px-5 text-sm font-medium text-white hover:bg-[#c91414] sm:justify-center"
                >
                  <Link href={signupHref}>
                    Create advertiser account
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="h-12 justify-between rounded-[8px] border-white/16 bg-white/5 px-5 text-sm font-medium text-white hover:bg-white/10 sm:justify-center"
                >
                  <Link href={portalHref}>Open advertiser portal</Link>
                </Button>
              </div>
            </div>

            <div className="pb-10 md:pb-0">
              <FundingPath />
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
