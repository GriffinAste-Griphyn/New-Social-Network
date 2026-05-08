import Link from "next/link"
import type { Metadata } from "next"
import {
  ArrowRight,
  BadgeDollarSign,
  Check,
  CreditCard,
  Gauge,
  Landmark,
  Megaphone,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { MarketingFooter } from "@/components/marketing-footer"

const signupHref = "/signup?next=%2Fadvertiser"
const portalHref = "/login?next=%2Fadvertiser"
const heroPoster = "/ubeye/hero-manhattan-poster-v2.jpg"
const heroVideo = "/ubeye/hero-manhattan-loop-v2.mp4"

export const metadata: Metadata = {
  title: "Advertise on UBEYE",
  description:
    "Fund real attention on UBEYE, define the moments that matter, and route advertiser dollars into the social network's wealth redistribution experiment.",
}

const navLinks = [
  { label: "Premise", href: "#premise" },
  { label: "Setup", href: "#setup" },
  { label: "Controls", href: "#controls" },
]

const setupSteps = [
  {
    icon: Megaphone,
    label: "01",
    title: "Create an advertiser account",
    copy: "Set up the brand account that will define your funding strategy inside UBEYE.",
  },
  {
    icon: SlidersHorizontal,
    label: "02",
    title: "Define real-world signals",
    copy: "Add brand names, handles, product terms, domains, categories, exclusions, and moments that matter.",
  },
  {
    icon: Wallet,
    label: "03",
    title: "Allocate funding",
    copy: "Fund the account once. Qualified social moments can draw from that budget as the network creates demand.",
  },
]

const controls = [
  "Brand names, handles, domains, product terms, and exclusions",
  "Daily and monthly caps for account-funded payouts",
  "Automatic or manual approval modes for organic matches",
  "Funding controls that keep payouts tied to qualified social signal",
]

const fundingRows = [
  { icon: CreditCard, label: "Account funding", value: "Allocated" },
  { icon: Gauge, label: "Spend limits", value: "Daily + monthly" },
  { icon: ShieldCheck, label: "Brand safety", value: "Exclusions" },
  { icon: BadgeDollarSign, label: "User upside", value: "75% target share" },
]

function SiteHeader() {
  return (
    <header className="hidden border-b border-black/10 bg-[#f4f2ec]/82 backdrop-blur-xl md:block">
      <div className="mx-auto flex h-16 w-full max-w-[1180px] items-center justify-between px-4">
        <Link href="/" className="text-xl font-semibold tracking-[-0.04em]" aria-label="UBEYE home">
          UBEYE
        </Link>

        <nav className="flex items-center gap-2 text-sm text-black/58" aria-label="Primary">
          {navLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="rounded-full px-4 py-2 transition hover:bg-black/5 hover:text-black"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" className="h-9 rounded-full px-4 text-sm text-black/64">
            <Link href={portalHref}>Sign in</Link>
          </Button>
          <Button asChild className="h-9 rounded-full bg-black px-4 text-sm text-white hover:bg-black/84">
            <Link href={signupHref}>Get started</Link>
          </Button>
        </div>
      </div>
    </header>
  )
}

function MobileHeroNav() {
  return (
    <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] text-white md:hidden">
      <Link href="/" className="text-[2rem] font-semibold tracking-[-0.08em]">
        UBEYE
      </Link>
      <div className="flex items-center gap-5">
        <Link href={portalHref} className="text-sm font-medium text-white/88">
          Sign in
        </Link>
        <Link
          href={signupHref}
          className="inline-flex min-h-11 items-center rounded-full bg-white px-5 text-sm font-semibold text-black"
        >
          Join
        </Link>
      </div>
    </div>
  )
}

export default function AdvertisePage() {
  return (
    <div className="min-h-screen bg-[#f4f2ec] text-black">
      <SiteHeader />

      <main className="overflow-hidden">
        <section className="border-b border-black/10">
        <div className="mx-auto md:max-w-[1180px] md:px-4 md:py-10">
          <div className="overflow-hidden bg-[#faf9f5] md:rounded-[2.5rem] md:border md:border-black/10 md:shadow-[0_20px_70px_-60px_rgba(15,23,42,0.28)]">
            <div className="relative min-h-[34rem] overflow-hidden sm:min-h-[32rem] lg:min-h-[40rem]">
              <MobileHeroNav />
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
                className="absolute inset-0 hidden h-full w-full object-cover motion-safe:block [filter:brightness(0.98)_contrast(0.95)_saturate(0.88)]"
              >
                <source src={heroVideo} type="video/mp4" />
              </video>
              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(8,14,20,0.62),rgba(8,14,20,0.3)_44%,rgba(8,14,20,0.14)_74%,rgba(8,14,20,0.08))]" />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(247,245,239,0.06),rgba(247,245,239,0)_24%,rgba(8,14,20,0.1)_58%,rgba(8,14,20,0.58)_100%)]" />

              <div className="relative flex min-h-[34rem] flex-col justify-between px-6 pb-6 pt-24 sm:min-h-[32rem] sm:px-8 sm:pb-8 sm:pt-7 lg:min-h-[40rem] lg:px-12 lg:pb-12 lg:pt-10">
                <p className="inline-flex w-fit max-w-full items-center gap-2 rounded-full border border-white/14 bg-white/8 px-3 py-1.5 text-[0.62rem] font-semibold uppercase leading-[1.15] tracking-[0.18em] text-white/78 backdrop-blur-sm sm:px-4 sm:text-[0.68rem] sm:tracking-[0.28em]">
                  <Landmark className="size-3.5" />
                  Advertiser-funded, people-first
                </p>

                <div className="max-w-[22rem] sm:max-w-[33rem] lg:max-w-[62rem]">
                  <h1 className="text-[3.05rem] font-semibold leading-[0.93] tracking-[-0.06em] text-white sm:text-6xl md:text-7xl lg:text-[6.2rem] lg:leading-[0.94]">
                    Fund attention people choose
                  </h1>
                </div>
              </div>
            </div>

            <div className="grid gap-6 border-t border-black/10 px-6 py-6 sm:px-8 sm:py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-10 lg:px-12 lg:py-8">
              <p className="max-w-2xl text-base leading-8 text-black/62 md:text-lg">
                UBEYE lets brands fund real social moments people choose to
                watch, discuss, and share. The advertising layer exists to fund
                the redistribution experiment, not interrupt it.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
                <Button
                  asChild
                  className="h-11 justify-between rounded-full bg-black px-6 text-sm text-white hover:bg-black/84 sm:justify-center"
                >
                  <Link href={signupHref}>
                    Create advertiser account
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="h-11 justify-between rounded-full border-black/12 bg-transparent px-6 text-sm text-black hover:bg-black/5 sm:justify-center"
                >
                  <Link href={portalHref}>Open advertiser portal</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
        </section>

        <section id="premise" className="border-b border-black/10 bg-[#faf9f5]">
        <div className="mx-auto max-w-[1180px] px-4 py-20 md:py-28">
          <div className="grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-16">
            <div className="pt-2">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-black/42">
                The premise
              </p>
            </div>
            <div className="max-w-5xl">
              <p className="text-4xl font-semibold tracking-[-0.07em] text-black md:text-6xl md:leading-[1.01]">
                Brands should fund the attention people choose, not the
                interruptions people skip.
              </p>
              <p className="mt-8 max-w-2xl text-base leading-8 text-black/58 md:text-lg">
                UBEYE gives advertisers a way to participate in a social
                network built around human attention, cultural signal, and user
                upside. When your brand funds qualified moments, that spend can
                become part of the wealth redistribution model.
              </p>
            </div>
          </div>
        </div>
        </section>

        <section id="setup" className="border-b border-black/10">
        <div className="mx-auto max-w-[1180px] px-4 py-20 md:py-28">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-20">
            <div className="max-w-[25rem]">
              <p className="text-4xl font-semibold tracking-[-0.07em] text-black md:text-6xl md:leading-[1.01]">
                Set the signal. Fund the account.
              </p>
              <p className="mt-8 max-w-md text-base leading-8 text-black/62 md:text-lg">
                Advertisers keep control over what qualifies, how much can be
                spent, and how funding reaches eligible social moments.
              </p>
            </div>

            <div className="grid gap-4">
              {setupSteps.map((step) => (
                <article
                  key={step.title}
                  className="rounded-[2rem] border border-black/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.62),rgba(250,249,245,1))] p-6 shadow-[0_18px_70px_-52px_rgba(15,23,42,0.16)] md:px-7 md:py-7"
                >
                  <div className="flex gap-5 md:gap-7">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-full border border-black/10 bg-black text-white">
                      <step.icon className="size-5" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/36">
                          {step.label}
                        </p>
                        <h3 className="text-2xl font-semibold tracking-[-0.04em] text-black">
                          {step.title}
                        </h3>
                      </div>
                      <p className="mt-4 max-w-2xl text-sm leading-7 text-black/58 md:text-base">
                        {step.copy}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
        </section>

        <section id="controls" className="border-b border-black/10 bg-[#111311] text-white">
        <div className="mx-auto grid max-w-[1180px] gap-12 px-4 py-20 md:py-28 lg:grid-cols-[minmax(0,1fr)_28rem] lg:items-end">
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-white/42">
              Controls
            </p>
            <h2 className="mt-5 max-w-4xl text-5xl font-semibold leading-[0.98] tracking-[-0.07em] md:text-7xl">
              Define the moments that are worth funding.
            </h2>
            <p className="mt-8 max-w-2xl text-base leading-8 text-white/58 md:text-lg">
              Instead of buying a forced placement, define the brand signals and
              guardrails. When real conversations naturally match those signals,
              UBEYE can route funding toward eligible participants.
            </p>
          </div>

          <div className="divide-y divide-white/12 border-y border-white/12">
            {controls.map((item) => (
              <div key={item} className="grid grid-cols-[3rem_1fr] gap-4 py-6">
                <div className="flex size-10 items-center justify-center rounded-full bg-white text-black">
                  <Check className="size-5" />
                </div>
                <p className="self-center text-sm leading-6 text-white/64">{item}</p>
              </div>
            ))}
          </div>
        </div>
        </section>

        <section id="funding" className="bg-[#f4f2ec]">
        <div className="mx-auto max-w-[1180px] px-4 py-16 md:py-24">
          <div className="grid overflow-hidden rounded-[2rem] border border-black/10 bg-[#faf9f5] md:grid-cols-[1.05fr_0.95fr]">
            <div className="p-6 sm:p-8 lg:p-10">
              <p className="inline-flex items-center gap-2 text-sm font-semibold text-black/48">
                <Landmark className="size-4" />
                Funding
              </p>
              <h2 className="mt-6 max-w-[12ch] text-4xl font-semibold leading-[1] tracking-[-0.06em] sm:text-6xl">
                Let organic moments do the rest.
              </h2>
              <p className="mt-7 max-w-xl text-base leading-8 text-black/58 md:text-lg">
                Your funds stay allocated to qualified brand moments. When UBEYE
                users create attention that matches your criteria, spend can
                move toward the people creating that value.
              </p>
              <Button
                asChild
                className="mt-8 h-11 rounded-full bg-black px-6 text-sm text-white hover:bg-black/84"
              >
                <Link href={signupHref}>
                  Start funding UBEYE
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>

            <div className="grid gap-3 border-t border-black/10 bg-black p-6 text-white sm:p-8 md:border-l md:border-t-0 lg:p-10">
              {fundingRows.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between gap-4 border-b border-white/12 pb-4 last:border-b-0 last:pb-0"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-full bg-white text-black">
                      <item.icon className="size-5" />
                    </span>
                    <p className="text-sm text-white/60">{item.label}</p>
                  </div>
                  <p className="text-sm font-semibold text-white">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  )
}
