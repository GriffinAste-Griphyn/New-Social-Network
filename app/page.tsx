import Image from "next/image"
import Link from "next/link"
import type { Metadata } from "next"
import {
  ArrowRight,
  Camera,
  CircleDollarSign,
  Eye,
  Radio,
  Users,
} from "lucide-react"

import { Button } from "@/components/ui/button"

const signInHref = "/login?next=%2Ffeed"
const getStartedHref = "/signup"

export const metadata: Metadata = {
  title: "New Social Network",
  description:
    "Post stories, follow people, earn through built-in monetization, and fund qualified creator moments.",
}

const navLinks = [
  { label: "What it does", href: "#what-it-does" },
  { label: "Who earns", href: "#earning" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Advertisers", href: "/advertise" },
]

const feedCards = [
  {
    label: "Post",
    metric: "Story post",
    src: "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=900&q=82",
    alt: "Creator holding a camera",
  },
  {
    label: "Discover",
    metric: "Engagement signal",
    src: "https://images.unsplash.com/photo-1492724441997-5dc865305da7?auto=format&fit=crop&w=900&q=82",
    alt: "Phone and laptop on a minimal desk",
  },
  {
    label: "Earn",
    metric: "Built-in payout",
    src: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=82",
    alt: "Laptop screen in a clean workspace",
  },
]

const earningModes = [
  {
    icon: Camera,
    title: "Post stories",
    headline: "Share stories that can monetize.",
    copy: "Every account can publish photos, videos, and updates with earning tools already connected to the feed.",
    stat: "$128.40",
    statLabel: "story payout",
  },
  {
    icon: Users,
    title: "Participate",
    headline: "Get rewarded for useful engagement.",
    copy: "People can earn by discovering, following, replying, and helping valuable content move through the network.",
    stat: "+$6.80",
    statLabel: "user rewards",
  },
]

const howItWorks = [
  "Create an account and claim a handle.",
  "Post stories or follow accounts you care about.",
  "Earn through the monetization tools built into the feed.",
]

function SiteHeader() {
  return (
    <header className="absolute inset-x-0 top-0 z-20">
      <div className="relative mx-auto flex h-20 w-full max-w-[1440px] items-center justify-between px-5 sm:px-8">
        <Link
          href="/"
          className="text-sm font-semibold uppercase tracking-[0.24em] text-white"
          aria-label="New Social Network home"
        >
          NSN
        </Link>

        <nav
          className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 text-sm font-medium text-white/70 md:flex"
          aria-label="Primary"
        >
          {navLinks.map((link) => (
            <Link key={link.label} href={link.href} className="transition hover:text-white">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Button
            asChild
            variant="ghost"
            className="hidden h-10 rounded-full px-4 text-sm text-white hover:bg-white/10 hover:text-white sm:inline-flex"
          >
            <Link href={signInHref}>Sign in</Link>
          </Button>
          <Button
            asChild
            className="h-10 rounded-full bg-white px-4 text-sm text-black hover:bg-white/86"
          >
            <Link href={getStartedHref}>Create account</Link>
          </Button>
        </div>
      </div>
    </header>
  )
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#f5f6f1] text-black">
      <SiteHeader />

      <main>
        <section className="relative min-h-[92vh] overflow-hidden">
          <Image
            src="https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?auto=format&fit=crop&w=2200&q=86"
            alt="Person using a smartphone"
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-black/46" />
          <div className="absolute inset-x-0 bottom-0 h-52 bg-gradient-to-t from-black/64 to-transparent" />

          <div className="relative z-10 mx-auto flex min-h-[92vh] w-full max-w-[1440px] flex-col justify-end px-5 pb-8 pt-28 sm:px-8 lg:pb-10">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-end">
              <div>
                <p className="w-fit rounded-full border border-white/18 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-white/76 backdrop-blur">
                  Post. Follow. Earn.
                </p>
                <h1 className="mt-7 max-w-[12ch] text-5xl font-semibold leading-[0.96] text-white sm:text-7xl lg:text-8xl">
                  The social app where every account can earn
                </h1>
                <p className="mt-8 max-w-2xl text-lg leading-8 text-white/76">
                  New Social Network lets people post stories, follow accounts,
                  discover content, and earn from the value they create or help surface.
                </p>
              </div>

              <div className="grid gap-3 rounded-3xl border border-white/16 bg-black/24 p-3 text-white shadow-[0_24px_80px_rgba(0,0,0,0.22)] backdrop-blur-md">
                <div className="rounded-2xl bg-white p-4 text-black">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-[0.2em] text-black/42">
                        Story payout
                      </p>
                      <p className="mt-2 text-3xl font-semibold">$128.40</p>
                    </div>
                    <span className="flex size-11 items-center justify-center rounded-full bg-black text-white">
                      <CircleDollarSign className="size-5" />
                    </span>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-black/58">
                    A story earns while it moves through the feed.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-white/14 bg-white/10 p-4">
                    <Eye className="size-5 text-white/72" />
                    <p className="mt-5 text-2xl font-semibold">42k</p>
                    <p className="mt-1 text-xs text-white/58">user signals</p>
                  </div>
                  <div className="rounded-2xl border border-white/14 bg-white/10 p-4">
                    <Users className="size-5 text-white/72" />
                    <p className="mt-5 text-2xl font-semibold">+18%</p>
                    <p className="mt-1 text-xs text-white/58">reward pool</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="what-it-does" className="border-b border-black/10 bg-[#f5f6f1]">
          <div className="mx-auto grid w-full max-w-[1440px] gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-center lg:py-24">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/42">
                What it does
              </p>
              <h2 className="mt-5 max-w-[12ch] text-5xl font-semibold leading-[1] sm:text-6xl">
                A story feed with earning built into the product.
              </h2>
              <p className="mt-7 max-w-md text-lg leading-8 text-black/58">
                The app combines a familiar social feed with native monetization:
                create, follow, discover, engage, and get rewarded inside the same system.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {feedCards.map((card) => (
                <div
                  key={card.label}
                  className="group relative min-h-[26rem] overflow-hidden rounded-3xl border border-black/10 bg-white shadow-[0_20px_50px_rgba(0,0,0,0.07)]"
                >
                  <Image
                    src={card.src}
                    alt={card.alt}
                    fill
                    sizes="(min-width: 1024px) 28vw, (min-width: 640px) 33vw, 100vw"
                    className="object-cover transition duration-500 group-hover:scale-[1.03]"
                  />
                  <div className="absolute inset-0 bg-black/18" />
                  <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-white/18 bg-white/92 p-4 text-black shadow-[0_14px_40px_rgba(0,0,0,0.16)] backdrop-blur">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-black/42">
                      {card.label}
                    </p>
                    <p className="mt-2 text-xl font-semibold">{card.metric}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="earning" className="border-b border-black/10 bg-white">
          <div className="mx-auto w-full max-w-[1440px] px-5 py-16 sm:px-8 lg:py-24">
            <div className="grid gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-end">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/42">
                  Who earns
                </p>
                <h2 className="mt-5 max-w-[13ch] text-5xl font-semibold leading-[1] sm:text-6xl">
                  One account can post, participate, and earn.
                </h2>
              </div>
              <p className="max-w-2xl text-lg leading-8 text-black/58">
                People bring stories, attention, discovery, follows, and engagement.
                New Social Network keeps those actions in one account so earning
                does not require switching areas.
              </p>
            </div>

            <div className="mt-12 grid gap-4 lg:grid-cols-2">
              {earningModes.map((mode) => (
                <div
                  key={mode.title}
                  className="grid min-h-[25rem] overflow-hidden rounded-3xl border border-black/10 bg-[#f5f6f1] shadow-[0_20px_50px_rgba(0,0,0,0.05)] sm:grid-cols-[1fr_0.8fr]"
                >
                  <div className="flex flex-col justify-between p-6">
                    <div>
                      <span className="flex size-11 items-center justify-center rounded-full bg-black text-white">
                        <mode.icon className="size-5" />
                      </span>
                      <p className="mt-8 text-xs font-semibold uppercase tracking-[0.22em] text-black/42">
                        {mode.title}
                      </p>
                      <h3 className="mt-3 max-w-sm text-3xl font-semibold leading-tight">
                        {mode.headline}
                      </h3>
                      <p className="mt-4 text-base leading-7 text-black/58">
                        {mode.copy}
                      </p>
                    </div>
                    <div className="mt-8 border-t border-black/10 pt-5">
                      <p className="text-3xl font-semibold">{mode.stat}</p>
                      <p className="mt-1 text-sm text-black/48">{mode.statLabel}</p>
                    </div>
                  </div>
                  <div className="relative min-h-72 sm:min-h-full">
                    <Image
                      src={
                        mode.title === "Post stories"
                          ? "https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=900&q=82"
                          : "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=900&q=82"
                      }
                      alt={
                        mode.title === "Post stories"
                          ? "Creative team working in a bright studio"
                          : "People gathered around a laptop reviewing media"
                      }
                      fill
                      sizes="(min-width: 1024px) 24vw, 100vw"
                      className="object-cover"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="bg-[#10110f] text-white">
          <div className="mx-auto grid w-full max-w-[1440px] gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[1fr_0.72fr] lg:items-end lg:py-20">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-white/44">
                <Radio className="size-4" />
                How it works
              </p>
              <h2 className="mt-5 max-w-4xl text-5xl font-semibold leading-[1] sm:text-6xl">
                Use it like a social app. Earn like the value matters.
              </h2>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-white/58">
                No separate creator area, no patched-on reward system. The feed,
                profiles, follows, stories, and earning tools are designed to work together.
              </p>
            </div>
            <div className="space-y-5">
              {howItWorks.map((step, index) => (
                <div key={step} className="flex gap-4 border-t border-white/14 pt-5">
                  <span className="text-sm font-semibold text-white/44">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <p className="text-lg leading-7 text-white/78">{step}</p>
                </div>
              ))}
              <Button
                asChild
                className="h-11 rounded-full bg-white px-5 text-sm text-black hover:bg-white/86"
              >
                <Link href={getStartedHref}>
                  Get started
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
