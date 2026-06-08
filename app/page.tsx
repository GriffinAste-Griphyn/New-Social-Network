import Link from "next/link"
import type { Metadata } from "next"
import {
  ArrowRight,
  BrainCircuit,
  Check,
  CircleDollarSign,
  Eye,
  Megaphone,
  Play,
  Radar,
  ScanEye,
} from "lucide-react"

import { Button } from "@/components/ui/button"

const mobileAppHref = "https://apps.apple.com/us/app/ubeye/id6768760562"
const advertiserSignInHref = "/login?next=%2Fadvertiser"
const heroPoster = "/ubeye/hero-manhattan-poster-v2.jpg"
const heroVideo = "/ubeye/hero-manhattan-loop-v2.mp4"

export const metadata: Metadata = {
  title: "UBEYE | a social experiment in wealth redistribution",
  description: "a social experiment in wealth redistribution",
}

const navLinks = [
  { label: "Idea", href: "#idea" },
  { label: "Value loop", href: "#value-loop" },
  { label: "Advertisers", href: "/advertise" },
]

const marketSignals = [
  {
    icon: BrainCircuit,
    label: "AGI changes the market",
    copy: "As intelligence becomes abundant, human attention and consciousness become more scarce, more measurable, and more valuable.",
  },
  {
    icon: ScanEye,
    label: "Platforms monetize the scarce thing",
    copy: "People post, watch, react, remember, desire, and decide. Traditional networks sell those signals while users receive little of the upside.",
  },
  {
    icon: CircleDollarSign,
    label: "UBEYE routes value back",
    copy: "UBEYE is built to test whether ad dollars can move back to the people creating and spending attention in the feed.",
  },
]

const valueLoop = [
  {
    icon: Play,
    label: "Post",
    title: "People post real stories",
    copy: "Everyday moments, places, products, taste, work, culture, campus, nightlife, and the normal texture of a life.",
  },
  {
    icon: Eye,
    label: "Watch",
    title: "People spend attention",
    copy: "Views, completion, replies, saves, follows, and replays show what people actually care about.",
  },
  {
    icon: Megaphone,
    label: "Fund",
    title: "Advertisers fund attention",
    copy: "Brands buy into social attention that users helped create instead of extracting value from the feed alone.",
  },
  {
    icon: CircleDollarSign,
    label: "Return",
    title: "Rewards can flow back",
    copy: "When activity qualifies, value can return to participants instead of stopping at the platform.",
  },
]

const principles = [
  "You do not need to be famous to participate.",
  "Posting stories and watching stories both create economic signal.",
  "Rewards are funded from ad dollars, not a limited creator fund.",
  "The experiment is simple: redistribute more of the value created by attention.",
]

const footerLinks = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Guidelines", href: "/community-guidelines" },
]

function SiteHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-[#050505]/80 text-white backdrop-blur-xl">
      <div className="relative mx-auto flex h-16 w-full max-w-[1180px] items-center justify-between gap-4 px-4">
        <Link href="/" className="text-xl font-medium" aria-label="UBEYE home">
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

function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-[#050505] text-white">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-5 px-4 py-8 text-sm text-white/54 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="w-fit text-xl font-medium text-white" aria-label="UBEYE home">
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
    <div className="min-h-screen bg-[#050505] text-white">
      <SiteHeader />

      <main className="overflow-hidden">
        <section className="relative border-b border-white/10 pt-16">
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

          <div className="relative mx-auto flex min-h-[86svh] max-w-[1180px] items-center px-4 py-10 md:min-h-[82vh] md:py-12">
            <div className="max-w-4xl">
              <p className="inline-flex max-w-full items-center rounded-[8px] border border-white/14 bg-white/8 px-3 py-1.5 text-[0.68rem] font-medium uppercase leading-[1.2] text-white/78 backdrop-blur-sm">
                A social experiment in wealth redistribution
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

        <section id="idea" className="border-b border-white/10 bg-[#050505]">
          <div className="mx-auto max-w-[1180px] px-4 py-18 md:py-24">
            <div className="grid gap-12 lg:grid-cols-[19rem_minmax(0,1fr)] lg:gap-16">
              <div>
                <p className="text-xs font-medium uppercase text-[#e01616]">The idea</p>
              </div>
              <div>
                <h2 className="max-w-4xl text-4xl font-[340] leading-tight text-white md:text-6xl md:leading-[1.08]">
                  If attention is the asset, the people creating it should participate in the upside.
                </h2>
                <div className="mt-12 grid gap-3 md:grid-cols-3">
                  {marketSignals.map((signal) => (
                    <article key={signal.label} className="border border-white/10 bg-white/[0.035] p-5">
                      <div className="flex size-10 items-center justify-center rounded-[8px] bg-white text-black">
                        <signal.icon className="size-5" />
                      </div>
                      <h3 className="mt-6 text-xl font-normal leading-tight text-white">{signal.label}</h3>
                      <p className="mt-4 text-sm leading-7 text-white/56">{signal.copy}</p>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="value-loop" className="border-b border-black/10 bg-[#f4f0e6] text-black">
          <div className="mx-auto max-w-[1180px] px-4 py-18 md:py-24">
            <div className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20">
              <div className="max-w-[30rem]">
                <p className="text-xs font-medium uppercase text-[#e01616]">The value loop</p>
                <h2 className="mt-5 text-4xl font-[340] leading-tight md:text-6xl md:leading-[1.08]">
                  Post. Watch. Create value. Share value.
                </h2>
                <p className="mt-7 text-base leading-8 text-black/64 md:text-lg">
                  UBEYE is not a creator fund. It is an experiment in whether the
                  value of attention can be measured, funded by advertisers, and
                  routed back to everyday participants.
                </p>
              </div>

              <div className="grid gap-3">
                {valueLoop.map((step, index) => (
                  <article
                    key={step.label}
                    className="grid gap-5 border border-black/10 bg-white p-5 sm:grid-cols-[3.25rem_1fr_auto] sm:items-start"
                  >
                    <div className="flex size-11 items-center justify-center rounded-[8px] bg-black text-white">
                      <step.icon className="size-5" />
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase text-[#e01616]">
                        {String(index + 1).padStart(2, "0")} / {step.label}
                      </p>
                      <h3 className="mt-2 text-2xl font-normal leading-tight">{step.title}</h3>
                      <p className="mt-3 max-w-2xl text-sm leading-7 text-black/58 md:text-base">{step.copy}</p>
                    </div>
                    <ArrowRight className="hidden size-5 text-black/28 sm:block" />
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-white/10 bg-[#050505] text-white">
          <div className="mx-auto grid max-w-[1180px] gap-12 px-4 py-18 md:py-24 lg:grid-cols-[minmax(0,1fr)_25rem] lg:items-end">
            <div>
              <p className="text-xs font-medium uppercase text-[#e01616]">Participation</p>
              <h2 className="mt-5 max-w-4xl text-5xl font-[340] leading-[1.03] md:text-7xl">
                The feed is no longer just entertainment. It is economic signal.
              </h2>
              <p className="mt-8 max-w-2xl text-base leading-8 text-white/58 md:text-lg">
                UBEYE is for everyday users, not only influencers. Posting,
                watching, replying, following, and saving all help create the
                attention that ad dollars can reward.
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

        <section className="bg-[#f4f0e6] text-black">
          <div className="mx-auto max-w-[1180px] px-4 py-16 md:py-24">
            <div className="grid overflow-hidden border border-black/10 bg-white md:grid-cols-[1.05fr_0.95fr]">
              <div className="p-6 sm:p-8 lg:p-10">
                <p className="inline-flex items-center gap-2 text-sm font-medium text-[#e01616]">
                  <Radar className="size-4" />
                  Advertiser-funded
                </p>
                <h2 className="mt-6 max-w-[13ch] text-4xl font-[340] leading-[1.08] sm:text-6xl">
                  Buy attention without pretending users did not create it.
                </h2>
                <p className="mt-7 max-w-xl text-base leading-8 text-black/58 md:text-lg">
                  Brands can put ad dollars behind the stories people post and
                  watch. UBEYE uses that funding to test a more participatory
                  model for social advertising.
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
                  <CircleDollarSign className="size-6" />
                </div>
                <div>
                  <p className="text-6xl font-[340] sm:text-7xl">75%</p>
                  <p className="mt-3 max-w-sm text-sm leading-6 text-white/56">
                    Target share of eligible ad-funded value routed back to users
                    as the experiment scales.
                  </p>
                </div>
                <div className="grid grid-cols-3 divide-x divide-white/10 border-y border-white/10 text-sm">
                  {["Post", "Watch", "Earn"].map((item) => (
                    <p key={item} className="py-3 text-center text-white/58">
                      {item}
                    </p>
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
