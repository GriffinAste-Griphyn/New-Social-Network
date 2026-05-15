import Link from "next/link"
import type { Metadata } from "next"
import {
  ArrowRight,
  BadgeDollarSign,
  Check,
  Eye,
  Megaphone,
  Play,
  ShieldCheck,
} from "lucide-react"

import { Button } from "@/components/ui/button"

const mobileAppHref = "/app"
const advertiserSignInHref = "/login?next=%2Fadvertiser"
const heroPoster = "/ubeye/hero-manhattan-poster-v2.jpg"
const heroVideo = "/ubeye/hero-manhattan-loop-v2.mp4"

export const metadata: Metadata = {
  title: "UBEYE | Organic content, monetized",
  description:
    "UBEYE lets people earn from the real attention their stories create by sharing advertiser funding with eligible users.",
}

const navLinks = [
  { label: "Model", href: "#model" },
  { label: "Value loop", href: "#value-loop" },
  { label: "Advertisers", href: "/advertise" },
]

const ledgerEvents = [
  { label: "Maya posts a story", value: "A normal moment from her day" },
  { label: "People watch and react", value: "483 views / 61 replies" },
  { label: "A brand funds the moment", value: "The attention matches what they support" },
  { label: "Maya can earn", value: "Value moves back to the people who created it" },
]

const heroSignals = [
  { label: "Views", value: "483" },
  { label: "Replies", value: "61" },
  { label: "Saves", value: "22" },
]

const modelRows = [
  {
    label: "Traditional platforms",
    title: "You post. People watch. The platform keeps most of the money.",
    copy: "The photos, videos, replies, and taste that people share every day become the attention traditional platforms sell.",
  },
  {
    label: "UBEYE",
    title: "You post. People watch. The upside can come back to users.",
    copy: "UBEYE is built so advertiser funding can support the organic stories people already choose to watch.",
  },
]

const valueLoop = [
  {
    icon: Play,
    label: "Post",
    title: "Share what you already share",
    copy: "Post the everyday stories you already put on other apps: campus, work, food, fashion, products, taste, and real life.",
  },
  {
    icon: Eye,
    label: "Watch",
    title: "People show what they care about",
    copy: "Views, replies, saves, follows, and replays help show which stories are actually getting attention.",
  },
  {
    icon: Megaphone,
    label: "Fund",
    title: "Brands support real moments",
    copy: "Advertisers can fund organic attention people choose instead of only buying forced ad placements.",
  },
  {
    icon: BadgeDollarSign,
    label: "Route",
    title: "Users can share the upside",
    copy: "When a story qualifies, value can move back to the users who helped create the attention.",
  },
]

const principles = [
  "All users are creators. You do not need to be famous to participate.",
  "Stories are the value surface, not interruptive ad slots.",
  "Revenue share is part of the product model, not a limited creator fund.",
  "No follower-count economy keeps status metrics from becoming the whole game.",
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

        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 text-sm text-white/62 md:flex" aria-label="Primary">
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
          <Button asChild variant="ghost" className="hidden h-9 rounded-[8px] px-3 text-sm text-white/70 hover:bg-white/8 hover:text-white sm:inline-flex">
            <Link href={advertiserSignInHref}>Advertiser sign in</Link>
          </Button>
          <Button asChild className="h-9 rounded-[8px] bg-white px-4 text-sm text-black hover:bg-white/88">
            <Link href={mobileAppHref}>Get the app</Link>
          </Button>
        </div>
      </div>
    </header>
  )
}

function AttentionLedger() {
  return (
    <div className="border border-white/12 bg-black/54 p-4 text-white shadow-[0_24px_80px_-56px_rgba(0,0,0,0.9)] backdrop-blur-md md:p-5">
      <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <p className="text-xs uppercase text-white/42">How it works</p>
          <p className="mt-1 text-sm font-medium text-white">One story creates value</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-[8px] bg-[#e01616] px-2.5 py-1 text-xs font-semibold text-white">
          <span className="size-1.5 rounded-full bg-white" />
          Active
        </span>
      </div>

      <div className="grid grid-cols-3 divide-x divide-white/10 border-b border-white/10">
        {heroSignals.map((signal) => (
          <div key={signal.label} className="px-3 py-4 first:pl-0 last:pr-0">
            <p className="text-[0.7rem] uppercase text-white/38">{signal.label}</p>
            <p className="mt-1 text-2xl font-semibold text-white">{signal.value}</p>
          </div>
        ))}
      </div>

      <div className="divide-y divide-white/10">
        {ledgerEvents.map((event, index) => (
          <div key={event.label} className="grid grid-cols-[1.35rem_1fr] gap-3 py-4">
            <div className="pt-1">
              <span className="flex size-5 items-center justify-center rounded-full border border-[#e01616]/50 bg-[#e01616]/16 text-[0.65rem] font-semibold text-[#ffb4a6]">
                {index + 1}
              </span>
            </div>
            <div>
              <p className="text-xs uppercase text-white/38">{event.label}</p>
              <p className="mt-1 text-sm text-white/82">{event.value}</p>
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

export default function HomePage() {
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

          <div className="relative mx-auto grid min-h-[calc(100svh-4rem)] max-w-[1180px] gap-10 px-4 py-10 md:min-h-[calc(88vh-4rem)] md:grid-cols-[minmax(0,1.08fr)_24rem] md:items-center md:py-12 lg:grid-cols-[minmax(0,1fr)_28rem] lg:gap-14">
            <div className="max-w-4xl">
              <p className="inline-flex max-w-full items-center rounded-[8px] border border-white/14 bg-white/8 px-3 py-1.5 text-[0.68rem] font-semibold uppercase leading-[1.2] text-white/78 backdrop-blur-sm">
                A social experiment in wealth redistribution
              </p>
              <h1 className="mt-7 max-w-[12ch] text-[3.65rem] font-semibold leading-[0.92] text-white sm:text-[4.8rem] md:text-[5.5rem] lg:text-[6.2rem]">
                Organic content, monetized.
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-8 text-white/68 md:text-lg md:leading-8">
                People already create attention every day. UBEYE lets you keep
                posting what you already post, with a chance to earn when your
                stories create value.
              </p>

              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Button asChild className="h-12 justify-between rounded-[8px] bg-[#e01616] px-5 text-sm font-semibold text-white hover:bg-[#c91414] sm:justify-center">
                  <Link href={mobileAppHref}>
                    Get the app
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="h-12 justify-between rounded-[8px] border-white/16 bg-white/5 px-5 text-sm font-semibold text-white hover:bg-white/10 sm:justify-center">
                  <Link href="/advertise">Advertise on UBEYE</Link>
                </Button>
              </div>
            </div>

            <AttentionLedger />
          </div>
        </section>

        <section id="model" className="border-b border-white/10 bg-[#060606]">
          <div className="mx-auto max-w-[1180px] px-4 py-20 md:py-28">
            <div className="grid gap-12 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-16">
              <div>
                <p className="text-xs font-semibold uppercase text-[#e01616]">The model</p>
              </div>
              <div>
                <h2 className="max-w-4xl text-4xl font-semibold leading-tight text-white md:text-6xl md:leading-[1.02]">
                  UBEYE changes what happens after people pay attention.
                </h2>
                <div className="mt-12 grid gap-4 md:grid-cols-2">
                  {modelRows.map((row) => (
                    <article key={row.label} className="border border-white/10 bg-white/[0.03] p-5">
                      <p className="text-xs font-semibold uppercase text-white/82">{row.label}</p>
                      <h3 className="mt-5 text-2xl font-semibold leading-tight text-white">{row.title}</h3>
                      <p className="mt-5 text-sm leading-7 text-white/56 md:text-base">{row.copy}</p>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="value-loop" className="border-b border-white/10 bg-[#f7f3ea] text-black">
          <div className="mx-auto max-w-[1180px] px-4 py-20 md:py-28">
            <div className="grid gap-12 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] lg:gap-20">
              <div className="max-w-[29rem]">
                <p className="text-xs font-semibold uppercase text-[#e01616]">The value loop</p>
                <h2 className="mt-5 text-4xl font-semibold leading-tight md:text-6xl md:leading-[1.02]">
                  Same behavior. Better economics.
                </h2>
                <p className="mt-7 text-base leading-8 text-black/62 md:text-lg">
                  UBEYE is designed around one simple loop: people post stories,
                  other people watch and react, advertisers fund the moments
                  that matter, and users can share the upside.
                </p>
              </div>

              <div className="grid gap-3">
                {valueLoop.map((step, index) => (
                  <article key={step.label} className="grid gap-5 border border-black/10 bg-white p-5 sm:grid-cols-[3.25rem_1fr_auto] sm:items-start">
                    <div className="flex size-11 items-center justify-center rounded-[8px] bg-black text-white">
                      <step.icon className="size-5" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-[#e01616]">
                        {String(index + 1).padStart(2, "0")} / {step.label}
                      </p>
                      <h3 className="mt-2 text-2xl font-semibold leading-tight">{step.title}</h3>
                      <p className="mt-3 max-w-2xl text-sm leading-7 text-black/58 md:text-base">{step.copy}</p>
                    </div>
                    <ArrowRight className="hidden size-5 text-black/28 sm:block" />
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-white/10 bg-[#060606] text-white">
          <div className="mx-auto grid max-w-[1180px] gap-12 px-4 py-20 md:py-28 lg:grid-cols-[minmax(0,1fr)_25rem] lg:items-end">
            <div>
              <p className="text-xs font-semibold uppercase text-[#e01616]">Participation</p>
              <h2 className="mt-5 max-w-4xl text-5xl font-semibold leading-[0.98] md:text-7xl">
                Earning is not only for influencers.
              </h2>
              <p className="mt-8 max-w-2xl text-base leading-8 text-white/58 md:text-lg">
                On UBEYE, all users are creators. Every user can post, watch,
                reply, follow, save, and help create value in the network.
              </p>
            </div>

            <div className="divide-y divide-white/10 border-y border-white/10">
              {principles.map((principle) => (
                <div key={principle} className="grid grid-cols-[2.25rem_1fr] gap-3 py-5">
                  <span className="flex size-7 items-center justify-center rounded-[8px] bg-[#e01616] text-white">
                    <Check className="size-4" />
                  </span>
                  <p className="text-sm leading-7 text-white/66">{principle}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#f7f3ea] text-black">
          <div className="mx-auto max-w-[1180px] px-4 py-16 md:py-24">
            <div className="grid overflow-hidden border border-black/10 bg-white md:grid-cols-[1.05fr_0.95fr]">
              <div className="p-6 sm:p-8 lg:p-10">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-[#e01616]">
                  <ShieldCheck className="size-4" />
                  Advertiser-funded
                </p>
                <h2 className="mt-6 max-w-[12ch] text-4xl font-semibold leading-[1] sm:text-6xl">
                  Fund attention people choose.
                </h2>
                <p className="mt-7 max-w-xl text-base leading-8 text-black/58 md:text-lg">
                  Brands can support stories people choose to watch instead of
                  only buying interruptions. That funding can become part of the
                  user revenue-share model.
                </p>
                <Button asChild className="mt-8 h-11 rounded-[8px] bg-black px-5 text-sm text-white hover:bg-black/84">
                  <Link href="/advertise">
                    For advertisers
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </div>
              <div className="grid content-between gap-8 border-t border-black/10 bg-black p-6 text-white sm:p-8 md:border-l md:border-t-0 lg:p-10">
                <div className="flex size-12 items-center justify-center rounded-[8px] bg-[#e01616] text-white">
                  <BadgeDollarSign className="size-6" />
                </div>
                <div>
                  <p className="text-6xl font-semibold sm:text-7xl">75%</p>
                  <p className="mt-3 max-w-sm text-sm leading-6 text-white/56">
                    Target revenue share routed toward eligible users as the
                    experiment scales.
                  </p>
                </div>
                <div className="grid grid-cols-3 divide-x divide-white/10 border-y border-white/10 text-sm">
                  {["Post", "Watch", "Earn"].map((item) => (
                    <p key={item} className="py-3 text-center text-white/58">{item}</p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
