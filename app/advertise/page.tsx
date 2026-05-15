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

const signupHref = "/signup?next=%2Fadvertiser"
const portalHref = "/login?next=%2Fadvertiser"
const heroPoster = "/ubeye/hero-manhattan-poster-v2.jpg"
const heroVideo = "/ubeye/hero-manhattan-loop-v2.mp4"

export const metadata: Metadata = {
  title: "Advertise on UBEYE",
  description:
    "Fund organic stories on UBEYE, define the attention that matters, and help route advertiser dollars back to the users creating value.",
}

const navLinks = [
  { label: "Premise", href: "#premise" },
  { label: "Setup", href: "#setup" },
  { label: "Controls", href: "#controls" },
]

const attentionPath = [
  { label: "User story", value: "A normal post starts earning attention" },
  { label: "Organic activity", value: "Views, replies, saves, and shares show demand" },
  { label: "Brand match", value: "The story fits the criteria you choose" },
  { label: "User upside", value: "Funding can move back to eligible participants" },
]

const heroMetrics = [
  { label: "Surface", value: "Stories" },
  { label: "Funding", value: "Organic" },
  { label: "Upside", value: "Users" },
]

const premiseRows = [
  {
    label: "Traditional social ads",
    title: "Buy an ad slot around the attention users create.",
    copy: "The platform sells impressions against the feed. Users create the culture, but most of the upside stays with the platform.",
  },
  {
    label: "UBEYE",
    title: "Fund the organic stories already creating attention.",
    copy: "Advertiser funding can attach to qualified user stories, so the people creating and engaging with the value can participate in the upside.",
  },
]

const setupSteps = [
  {
    icon: Megaphone,
    label: "01",
    title: "Create an advertiser account",
    copy: "Set up the brand account that decides what kinds of organic stories your funding can support.",
  },
  {
    icon: SlidersHorizontal,
    label: "02",
    title: "Define the attention you value",
    copy: "Add brand names, handles, product terms, domains, categories, exclusions, and the kinds of moments you want to be near.",
  },
  {
    icon: Wallet,
    label: "03",
    title: "Fund qualified stories",
    copy: "Set a budget once. When user stories qualify, that funding can move toward the people creating and engaging with the attention.",
  },
]

const controls = [
  "Brand names, handles, domains, product terms, and exclusions",
  "Daily and monthly caps for account-funded payouts",
  "Automatic or manual approval modes for qualified stories",
  "Funding controls tied to views, replies, saves, and other organic activity",
]

const fundingRows = [
  { icon: CreditCard, label: "Account funding", value: "Pre-funded" },
  { icon: Gauge, label: "Spend limits", value: "Daily + monthly" },
  { icon: ShieldCheck, label: "Brand safety", value: "Exclusions" },
  { icon: BadgeDollarSign, label: "User upside", value: "Built in" },
]

const footerLinks = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Guidelines", href: "/community-guidelines" },
]

function SiteHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-[#060606]/78 text-white backdrop-blur-xl">
      <div className="relative mx-auto flex h-16 w-full max-w-[1180px] items-center justify-between gap-4 px-4">
        <Link href="/" className="text-xl font-semibold" aria-label="UBEYE home">
          UBEYE
        </Link>

        <nav
          className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 text-sm text-white/62 md:flex"
          aria-label="Primary"
        >
          {navLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="rounded-[8px] px-3 py-2 transition hover:bg-white/8 hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </nav>

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
            <Link href={signupHref}>Get the app</Link>
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
          <p className="text-xs uppercase text-white/42">Funding path</p>
          <p className="mt-1 text-sm font-medium text-white">One story can create value</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-[8px] bg-[#e01616] px-2.5 py-1 text-xs font-semibold text-white">
          <span className="size-1.5 rounded-full bg-white" />
          Organic
        </span>
      </div>

      <div className="grid grid-cols-3 divide-x divide-white/10 border-b border-white/10">
        {heroMetrics.map((metric) => (
          <div key={metric.label} className="px-3 py-4 first:pl-0 last:pr-0">
            <p className="text-[0.7rem] uppercase text-white/38">{metric.label}</p>
            <p className="mt-1 text-xl font-semibold text-white md:text-2xl">{metric.value}</p>
          </div>
        ))}
      </div>

      <div className="divide-y divide-white/10">
        {attentionPath.map((item, index) => (
          <div key={item.label} className="grid grid-cols-[1.35rem_1fr] gap-3 py-4">
            <div className="pt-1">
              <span className="flex size-5 items-center justify-center rounded-full border border-[#e01616]/50 bg-[#e01616]/16 text-[0.65rem] font-semibold text-[#ffb4a6]">
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

function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-[#060606] text-white">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-5 px-4 py-8 text-sm text-white/54 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="w-fit text-xl font-semibold text-white" aria-label="UBEYE home">
          UBEYE
        </Link>
        <nav className="flex flex-wrap gap-x-5 gap-y-3" aria-label="Legal">
          {footerLinks.map((link) => (
            <Link key={link.href} href={link.href} className="transition hover:text-white">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  )
}

export default function AdvertisePage() {
  return (
    <div className="min-h-screen bg-[#060606] text-white">
      <SiteHeader />

      <main className="overflow-hidden">
        <section className="relative min-h-[100svh] border-b border-white/10 pt-16 md:min-h-[88vh]">
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

          <div className="relative mx-auto grid max-w-[1180px] gap-10 px-4 md:min-h-[calc(88vh-4rem)] md:grid-cols-[minmax(0,1.08fr)_24rem] md:items-center md:py-12 lg:grid-cols-[minmax(0,1fr)_28rem] lg:gap-14">
            <div className="flex min-h-[calc(100svh-4rem)] max-w-4xl flex-col pb-8 pt-17 md:block md:min-h-0 md:py-0">
              <div>
                <p className="inline-flex max-w-full items-center rounded-[8px] border border-white/14 bg-white/8 px-3 py-1.5 text-[0.68rem] font-semibold uppercase leading-[1.2] text-white/78 backdrop-blur-sm">
                  Advertiser-funded organic attention
                </p>
                <h1 className="mt-10 max-w-[15ch] text-[3.65rem] font-semibold leading-[0.92] text-white sm:text-[4.8rem] md:mt-7 md:text-[4.5rem] md:leading-[0.94] lg:text-[5.2rem]">
                  Fund organic content people choose.
                </h1>
                <p className="mt-9 max-w-2xl text-base leading-8 text-white/68 md:mt-6 md:text-lg md:leading-8">
                  <span className="md:hidden">
                    UBEYE gives brands a way to fund stories people already
                    choose to watch, reply to, save, and share.
                  </span>
                  <span className="hidden md:inline">
                    UBEYE gives brands a way to put budget behind stories people
                    already choose to watch, reply to, save, and share. The ad value
                    attaches to organic attention, then the upside can flow back to
                    the users who helped create it.
                  </span>
                </p>
              </div>

              <div className="mt-auto flex flex-col gap-3 pt-10 sm:flex-row md:mt-6 md:pt-0">
                <Button
                  asChild
                  className="h-12 justify-between rounded-[8px] bg-[#e01616] px-5 text-sm font-semibold text-white hover:bg-[#c91414] sm:justify-center"
                >
                  <Link href={signupHref}>
                    Create advertiser account
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="h-12 justify-between rounded-[8px] border-white/16 bg-white/5 px-5 text-sm font-semibold text-white hover:bg-white/10 sm:justify-center"
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

        <section id="premise" className="border-b border-white/10 bg-[#060606]">
          <div className="mx-auto max-w-[1180px] px-4 py-20 md:py-28">
            <div className="grid gap-12 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-16">
              <div>
                <p className="text-xs font-semibold uppercase text-[#e01616]">The premise</p>
              </div>
              <div>
                <h2 className="max-w-4xl text-4xl font-semibold leading-tight text-white md:text-6xl md:leading-[1.02]">
                  People already create the attention brands want to reach.
                  UBEYE lets advertisers help pay the people creating it.
                </h2>
                <p className="mt-8 max-w-2xl text-base leading-8 text-white/62 md:text-lg">
                  Instead of buying interruptions in a feed, advertisers can fund
                  qualified stories already earning attention. Every user is a
                  creator here, so the model is designed around broad
                  participation instead of a small influencer class.
                </p>

                <div className="mt-12 grid gap-4 md:grid-cols-2">
                  {premiseRows.map((row) => (
                    <article key={row.label} className="border border-white/10 bg-white/[0.03] p-5">
                      <p className="text-xs font-semibold uppercase text-white/36">{row.label}</p>
                      <h3 className="mt-5 text-2xl font-semibold leading-tight text-white">
                        {row.title}
                      </h3>
                      <p className="mt-4 text-sm leading-7 text-white/58">{row.copy}</p>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="setup" className="border-b border-white/10 bg-[#0b0b0b]">
          <div className="mx-auto max-w-[1180px] px-4 py-20 md:py-28">
            <div className="grid gap-12 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-20">
              <div className="max-w-[28rem]">
                <p className="text-xs font-semibold uppercase text-[#e01616]">Setup</p>
                <h2 className="mt-5 text-4xl font-semibold leading-tight text-white md:text-6xl md:leading-[1.02]">
                  Choose what qualifies. Fund the stories.
                </h2>
                <p className="mt-7 max-w-md text-base leading-8 text-white/62 md:text-lg">
                  Advertisers keep control over what qualifies, how much can be
                  spent, and the kinds of organic moments their budget can
                  support.
                </p>
              </div>

              <div className="grid gap-4">
                {setupSteps.map((step) => (
                  <article key={step.title} className="border border-white/10 bg-[#060606] p-5 md:p-6">
                    <div className="grid gap-5 sm:grid-cols-[3rem_1fr]">
                      <div className="flex size-11 items-center justify-center rounded-[8px] border border-[#e01616]/30 bg-[#e01616]/14 text-[#ffb4a6]">
                        <step.icon className="size-5" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase text-white/36">{step.label}</p>
                        <h3 className="mt-2 text-2xl font-semibold leading-tight text-white">
                          {step.title}
                        </h3>
                        <p className="mt-3 max-w-2xl text-sm leading-7 text-white/58 md:text-base">
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

        <section id="controls" className="border-b border-white/10 bg-[#060606]">
          <div className="mx-auto grid max-w-[1180px] gap-12 px-4 py-20 md:py-28 lg:grid-cols-[minmax(0,1fr)_28rem] lg:items-start">
            <div>
              <p className="text-xs font-semibold uppercase text-[#e01616]">Controls</p>
              <h2 className="mt-5 max-w-4xl text-4xl font-semibold leading-tight text-white md:text-6xl md:leading-[1.02]">
                Define the organic attention worth funding.
              </h2>
              <p className="mt-8 max-w-2xl text-base leading-8 text-white/62 md:text-lg">
                Instead of buying forced placements, define the brand criteria
                and guardrails. When user stories naturally match those
                criteria, UBEYE can route funding toward eligible participants.
              </p>

              <div className="mt-10 grid gap-3 sm:grid-cols-2">
                {controls.map((item) => (
                  <div key={item} className="grid grid-cols-[2rem_1fr] gap-3 border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex size-7 items-center justify-center rounded-[8px] bg-[#e01616] text-white">
                      <Check className="size-4" />
                    </div>
                    <p className="self-center text-sm leading-6 text-white/68">{item}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="border border-white/12 bg-black/54 p-5 text-white">
              <p className="inline-flex items-center gap-2 text-sm font-semibold text-white/58">
                <Landmark className="size-4 text-[#ffb4a6]" />
                Funding
              </p>
              <h3 className="mt-6 text-3xl font-semibold leading-tight text-white">
                Let organic stories do the rest.
              </h3>
              <p className="mt-5 text-sm leading-7 text-white/58">
                Your funds stay allocated to qualified attention. When UBEYE
                users create stories that match your criteria, spend can move
                toward the people creating that value.
              </p>

              <div className="mt-7 divide-y divide-white/10 border-y border-white/10">
                {fundingRows.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-4 py-4">
                    <div className="flex items-center gap-3">
                      <span className="flex size-9 items-center justify-center rounded-[8px] bg-white text-black">
                        <item.icon className="size-4" />
                      </span>
                      <p className="text-sm text-white/58">{item.label}</p>
                    </div>
                    <p className="text-sm font-semibold text-white">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-[#0b0b0b]">
          <div className="mx-auto grid max-w-[1180px] gap-8 px-4 py-16 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:py-20">
            <div>
              <p className="text-xs font-semibold uppercase text-[#e01616]">Advertise on UBEYE</p>
              <h2 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight text-white md:text-5xl">
                Put brand budget behind the stories people already care about.
              </h2>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row md:justify-end">
              <Button
                asChild
                className="h-12 justify-between rounded-[8px] bg-[#e01616] px-5 text-sm font-semibold text-white hover:bg-[#c91414] sm:justify-center"
              >
                <Link href={signupHref}>
                  Start funding stories
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="h-12 justify-between rounded-[8px] border-white/16 bg-white/5 px-5 text-sm font-semibold text-white hover:bg-white/10 sm:justify-center"
              >
                <Link href={portalHref}>Sign in</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
