import Link from "next/link"
import type { Metadata } from "next"
import {
  ArrowRight,
  BadgeDollarSign,
  Eye,
  Megaphone,
  MessageCircle,
  Play,
  Radio,
  ShieldCheck,
  Users,
} from "lucide-react"

import { Button } from "@/components/ui/button"

const mobileAppHref = "/app"
const advertiserSignInHref = "/login?next=%2Fadvertiser"
const heroPoster = "/ubeye/hero-manhattan-poster-v2.jpg"
const heroVideo = "/ubeye/hero-manhattan-loop-v2.mp4"

export const metadata: Metadata = {
  title: "UBEYE | A social experiment in wealth redistribution",
  description:
    "UBEYE is a social network where people post, watch, engage, and participate in the value their attention creates.",
}

const navLinks = [
  { label: "The experiment", href: "#experiment" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Advertisers", href: "/advertise" },
]

const incomeCards = [
  {
    eyebrow: "01",
    title: "Post",
    copy: "Share stories from the world around you. Culture, taste, work, fashion, food, campus, city life, product discoveries, and the moments people actually watch.",
    icon: Play,
  },
  {
    eyebrow: "02",
    title: "Pay attention",
    copy: "Watch what moves through the network. Your attention is no longer treated like free inventory.",
    icon: Eye,
  },
  {
    eyebrow: "03",
    title: "Participate",
    copy: "Reply, follow, save, and help useful signal move. UBEYE treats participation as part of the value creation loop.",
    icon: MessageCircle,
  },
]

const payoutRows = [
  {
    label: "For users",
    value: "Post, watch, engage, and participate in the upside.",
    icon: Users,
  },
  {
    label: "For creators",
    value: "Stories can qualify for brand-backed payouts when they create real demand.",
    icon: BadgeDollarSign,
  },
  {
    label: "For advertisers",
    value: "Fund attention that people choose instead of forcing placements into the feed.",
    icon: Megaphone,
  },
]

function SiteHeader() {
  return (
    <header className="hidden border-b border-black/10 bg-[#f4f2ec]/82 backdrop-blur-xl md:block">
      <div className="mx-auto grid h-16 w-full max-w-[1180px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-4">
        <Link href="/" className="justify-self-start text-xl font-semibold tracking-[-0.04em]" aria-label="UBEYE home">
          UBEYE
        </Link>

        <nav className="flex items-center justify-self-center text-sm text-black/58" aria-label="Primary">
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

        <div className="flex items-center gap-2 justify-self-end">
          <Button asChild variant="ghost" className="h-9 rounded-full px-4 text-sm text-black/64">
            <Link href={advertiserSignInHref}>Advertiser sign in</Link>
          </Button>
          <Button asChild className="h-9 rounded-full bg-black px-4 text-sm text-white hover:bg-black/84">
            <Link href={mobileAppHref}>Get the app</Link>
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
        <Link href="/advertise" className="text-sm font-medium text-white/88">
          Advertisers
        </Link>
        <Link
          href={mobileAppHref}
          className="inline-flex min-h-11 items-center rounded-full bg-white px-5 text-sm font-semibold text-black"
        >
          Get app
        </Link>
      </div>
    </div>
  )
}

export default function HomePage() {
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
                <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(8,14,20,0.58),rgba(8,14,20,0.28)_44%,rgba(8,14,20,0.12)_74%,rgba(8,14,20,0.08))]" />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(247,245,239,0.06),rgba(247,245,239,0)_24%,rgba(8,14,20,0.08)_58%,rgba(8,14,20,0.54)_100%)]" />

                <div className="relative flex min-h-[34rem] flex-col justify-between px-6 pb-6 pt-24 sm:min-h-[32rem] sm:px-8 sm:pb-8 sm:pt-7 lg:min-h-[40rem] lg:px-12 lg:pb-12 lg:pt-10">
                  <p className="inline-flex w-fit max-w-full items-center rounded-full border border-white/14 bg-white/8 px-3 py-1.5 text-[0.62rem] font-semibold uppercase leading-[1.15] tracking-[0.08em] text-white/78 backdrop-blur-sm sm:px-4 sm:text-[0.68rem] sm:tracking-[0.14em]">
                    A social experiment in wealth redistribution
                  </p>

                  <div className="max-w-[22rem] sm:max-w-[31rem] lg:max-w-[62rem]">
                    <h1 className="text-[3.25rem] font-semibold leading-[0.93] tracking-[-0.06em] text-white sm:text-6xl md:text-7xl lg:text-[6.4rem] lg:leading-[0.94]">
                      Earn from the attention you create
                    </h1>
                  </div>
                </div>
              </div>

              <div className="grid gap-6 border-t border-black/10 px-6 py-6 sm:px-8 sm:py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-10 lg:px-12 lg:py-8">
                <p className="max-w-2xl text-base leading-8 text-black/62 md:text-lg">
                  UBEYE is where people post, watch, engage, and earn from the
                  value their attention creates.
                </p>
                <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
                  <Button
                    asChild
                    className="h-11 justify-between rounded-full bg-black px-6 text-sm text-white hover:bg-black/84 sm:justify-center"
                  >
                    <Link href={mobileAppHref}>
                      Get the mobile app
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    className="h-11 justify-between rounded-full border-black/12 bg-transparent px-6 text-sm text-black hover:bg-black/5 sm:justify-center"
                  >
                    <Link href="/advertise">Advertise on UBEYE</Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="experiment" className="border-b border-black/10 bg-[#faf9f5]">
          <div className="mx-auto max-w-[1180px] px-4 py-20 md:py-28">
            <div className="grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-16">
              <div className="pt-2">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-black/42">
                  The premise
                </p>
              </div>
              <div className="max-w-5xl">
                <p className="text-4xl font-semibold tracking-[-0.07em] text-black md:text-6xl md:leading-[1.01]">
                  In the pursuit of AGI, human attention and consciousness will
                  be the new gold.
                </p>
                <p className="mt-8 max-w-2xl text-base leading-8 text-black/58 md:text-lg">
                  UBEYE turns that thesis into a social network. The experiment
                  is simple: if people create the attention, people should share
                  in the income.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="border-b border-black/10">
          <div className="mx-auto max-w-[1180px] px-4 py-20 md:py-28">
            <div className="grid gap-12 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-20">
              <div className="max-w-[25rem]">
                <p className="text-4xl font-semibold tracking-[-0.07em] text-black md:text-6xl md:leading-[1.01]">
                  Participate and earn income
                </p>
                <p className="mt-8 max-w-md text-base leading-8 text-black/62 md:text-lg">
                  UBEYE shares 75% of revenue with the creators and users who
                  help power the network.
                </p>
              </div>

              <div className="grid gap-4">
                {incomeCards.map((card) => (
                  <article
                    key={card.title}
                    className="rounded-[2rem] border border-black/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.62),rgba(250,249,245,1))] p-6 shadow-[0_18px_70px_-52px_rgba(15,23,42,0.16)] md:px-7 md:py-7"
                  >
                    <div className="flex gap-5 md:gap-7">
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-full border border-black/10 bg-black text-white">
                        <card.icon className="size-5" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/36">
                            {card.eyebrow}
                          </p>
                          <h3 className="text-2xl font-semibold tracking-[-0.04em] text-black">
                            {card.title}
                          </h3>
                        </div>
                        <p className="mt-4 max-w-2xl text-sm leading-7 text-black/58 md:text-base">
                          {card.copy}
                        </p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-black/10 bg-[#111311] text-white">
          <div className="mx-auto grid max-w-[1180px] gap-12 px-4 py-20 md:py-28 lg:grid-cols-[minmax(0,1fr)_28rem] lg:items-end">
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-white/42">
                Distribution
              </p>
              <h2 className="mt-5 max-w-4xl text-5xl font-semibold leading-[0.98] tracking-[-0.07em] md:text-7xl">
                Stories are the redistribution engine.
              </h2>
              <p className="mt-8 max-w-2xl text-base leading-8 text-white/58 md:text-lg">
                People create attention by sharing their lives on their stories. Attention
                creates advertiser demand. UBEYE shares this value back with
                the people who make the network possible.
              </p>
            </div>

            <div className="divide-y divide-white/12 border-y border-white/12">
              {payoutRows.map((row) => (
                <div key={row.label} className="grid grid-cols-[3rem_1fr] gap-4 py-6">
                  <div className="flex size-10 items-center justify-center rounded-full bg-white text-black">
                    <row.icon className="size-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{row.label}</p>
                    <p className="mt-2 text-sm leading-6 text-white/58">{row.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#f4f2ec]">
          <div className="mx-auto max-w-[1180px] px-4 py-16 md:py-24">
            <div className="grid overflow-hidden rounded-[2rem] border border-black/10 bg-[#faf9f5] md:grid-cols-[1.05fr_0.95fr]">
              <div className="p-6 sm:p-8 lg:p-10">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-black/48">
                  <Radio className="size-4" />
                  Advertiser-funded, people-first
                </p>
                <h2 className="mt-6 max-w-[11ch] text-4xl font-semibold leading-[1] tracking-[-0.06em] sm:text-6xl">
                  Fund attention without forcing it.
                </h2>
                <p className="mt-7 max-w-xl text-base leading-8 text-black/58 md:text-lg">
                  Brands can support real moments people choose to watch,
                  discuss, and share. The advertising layer exists to fund the
                  redistribution experiment, not interrupt it.
                </p>
              </div>
              <div className="grid content-between gap-8 border-t border-black/10 bg-black p-6 text-white sm:p-8 md:border-l md:border-t-0 lg:p-10">
                <ShieldCheck className="size-6 text-white/64" />
                <div>
                  <p className="text-5xl font-semibold tracking-[-0.07em] sm:text-6xl">
                    75%
                  </p>
                  <p className="mt-3 max-w-sm text-sm leading-6 text-white/56">
                    Target revenue share routed toward eligible network
                    participants as the experiment scales.
                  </p>
                </div>
                <Button asChild className="h-11 w-fit rounded-full bg-white px-6 text-sm text-black hover:bg-white/88">
                  <Link href="/advertise">
                    For advertisers
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
