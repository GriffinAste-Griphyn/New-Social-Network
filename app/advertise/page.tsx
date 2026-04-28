import Image from "next/image"
import Link from "next/link"
import type { Metadata } from "next"
import {
  ArrowRight,
  BadgeDollarSign,
  Building2,
  Check,
  CreditCard,
  Gauge,
  Landmark,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
} from "lucide-react"

const signupHref = "/signup?next=%2Fadvertiser"
const portalHref = "/login?next=%2Fadvertiser"

export const metadata: Metadata = {
  title: "Advertise on New Social Network",
  description:
    "Create an advertiser account, allocate funds, and pay creators when organic conversations create qualified brand moments.",
}

const navLinks = [
  { label: "Setup", href: "#setup" },
  { label: "Controls", href: "#controls" },
  { label: "Funding", href: "#funding" },
]

const setupSteps = [
  {
    icon: Building2,
    title: "Create account",
    copy: "Sign up, verify email, and set up the advertiser account that represents your brand.",
  },
  {
    icon: SlidersHorizontal,
    title: "Define signals",
    copy: "Add the names, handles, domains, products, categories, and exclusions that tell the system what moments matter.",
  },
  {
    icon: Wallet,
    title: "Allocate funds",
    copy: "Set aside budget once. As organic conversations qualify, creators are paid on your behalf from the funds you allocated.",
  },
]

const controls = [
  "Brand names, handles, domains, product terms, and exclusions",
  "Daily and monthly caps for account-funded payouts",
  "Automatic or manual approval modes for organic matches",
  "Funding controls that keep creator payouts tied to qualified moments",
]

const walletStats = [
  { label: "Allocated funds", value: "$12,450" },
  { label: "Reserved for matches", value: "$2,500" },
  { label: "Approval mode", value: "Guarded" },
]

export default function AdvertisePage() {
  return (
    <main className="min-h-screen bg-[#f4f5f7] text-[#17191f]">
      <section className="relative min-h-[84vh] overflow-hidden text-white">
        <Image
          src="https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=2200&q=86"
          alt="Brand team reviewing performance and media plans"
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-black/58" />
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/70 to-transparent" />

        <div className="relative z-10 mx-auto flex min-h-[84vh] w-full max-w-[1440px] flex-col px-5 py-6 sm:px-8">
          <nav className="flex items-center justify-between">
            <Link href="/" className="text-sm font-semibold tracking-[0.24em]">
              NSN
            </Link>
            <div className="hidden items-center gap-7 text-sm font-medium text-white/72 md:flex">
              {navLinks.map((link) => (
                <Link key={link.label} href={link.href} className="hover:text-white">
                  {link.label}
                </Link>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={portalHref}
                className="rounded-[8px] px-4 py-2 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white"
              >
                Sign in
              </Link>
              <Link
                href={signupHref}
                className="rounded-[8px] bg-white px-4 py-2 text-sm font-semibold text-[#17191f]"
              >
                Get started
              </Link>
            </div>
          </nav>

          <div className="grid flex-1 items-end gap-10 pb-7 pt-20 lg:grid-cols-[minmax(0,1fr)_24rem]">
            <div>
              <p className="w-fit rounded-full border border-white/18 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-white/76 backdrop-blur">
                Brand funding
              </p>
              <h1 className="mt-7 max-w-[12ch] text-5xl font-semibold leading-[0.96] tracking-tight sm:text-7xl lg:text-8xl">
                Fund creator moments as they happen.
              </h1>
              <p className="mt-8 max-w-2xl text-lg leading-8 text-white/76">
                Create an advertiser account, allocate funds, and define the
                brand moments that matter. As organic conversations happen, the
                system pays qualified creators on your behalf.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href={signupHref}
                  className="inline-flex h-12 items-center gap-2 rounded-[8px] bg-[#e01616] px-5 text-sm font-semibold text-white hover:bg-[#c91414]"
                >
                  Create advertiser account
                  <ArrowRight className="size-4" />
                </Link>
                <Link
                  href={portalHref}
                  className="inline-flex h-12 items-center rounded-[8px] bg-white px-5 text-sm font-semibold text-[#17191f]"
                >
                  Open advertiser portal
                </Link>
              </div>
            </div>

            <div className="grid gap-3">
              {walletStats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-[8px] border border-white/16 bg-white/12 p-4 backdrop-blur"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/48">
                    {stat.label}
                  </p>
                  <p className="mt-2 text-3xl font-semibold">{stat.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="setup" className="border-b border-black/10 bg-[#f4f5f7]">
        <div className="mx-auto w-full max-w-[1440px] px-5 py-16 sm:px-8 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/42">
                Setup
              </p>
              <h2 className="mt-5 max-w-[12ch] text-5xl font-semibold leading-[1] sm:text-6xl">
                Create an account and allocate funds.
              </h2>
            </div>
            <p className="max-w-2xl text-lg leading-8 text-black/58">
              Advertisers use the same secure signup and verification flow as
              everyone else, then land in a dedicated portal for brand setup,
              funding controls, and creator payout preferences.
            </p>
          </div>

          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            {setupSteps.map((step) => (
              <article
                key={step.title}
                className="rounded-[8px] border border-black/10 bg-white p-6 shadow-[0_16px_44px_rgba(15,23,42,0.06)]"
              >
                <span className="flex size-11 items-center justify-center rounded-full bg-[#111827] text-white">
                  <step.icon className="size-5" />
                </span>
                <h3 className="mt-8 text-2xl font-semibold">{step.title}</h3>
                <p className="mt-3 text-sm leading-6 text-black/58">{step.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="controls" className="border-b border-black/10 bg-white">
        <div className="mx-auto grid w-full max-w-[1440px] gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:py-24">
          <div className="relative min-h-[30rem] overflow-hidden rounded-[8px]">
            <Image
              src="https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=1400&q=84"
              alt="Team planning creator funding controls"
              fill
              sizes="(min-width: 1024px) 46vw, 100vw"
              className="object-cover"
            />
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/42">
              Controls
            </p>
            <h2 className="mt-5 max-w-[13ch] text-5xl font-semibold leading-[1] sm:text-6xl">
              Tell the system what moments matter.
            </h2>
            <p className="mt-7 max-w-xl text-lg leading-8 text-black/58">
              Instead of buying a forced placement, define the brand signals and
              guardrails. When real conversations naturally match those signals,
              the system can route payouts to creators.
            </p>

            <div className="mt-8 grid gap-3">
              {controls.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-[8px] bg-[#f4f5f7] p-4"
                >
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#111827] text-white">
                    <Check className="size-3" />
                  </span>
                  <p className="text-sm leading-6 text-[#374151]">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="funding" className="bg-[#111827] text-white">
        <div className="mx-auto grid w-full max-w-[1440px] gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[1fr_0.78fr] lg:items-end lg:py-24">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-white/44">
              <Landmark className="size-4" />
              Funding
            </p>
            <h2 className="mt-5 max-w-4xl text-5xl font-semibold leading-[1] sm:text-6xl">
              Fund the account. Let organic moments do the rest.
            </h2>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-white/60">
              Your funds stay allocated to qualified brand moments. When creators
              drive organic conversations that match your criteria, payouts happen
              automatically from the account you funded.
            </p>
          </div>

          <div className="grid gap-3">
            {[
              { icon: CreditCard, label: "Account funding", value: "Allocated" },
              { icon: Gauge, label: "Spend limits", value: "Daily + monthly" },
              { icon: ShieldCheck, label: "Brand safety", value: "Exclusions" },
              { icon: BadgeDollarSign, label: "Creator payouts", value: "Organic" },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between gap-4 rounded-[8px] border border-white/12 bg-white/8 p-4"
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-full bg-white text-[#111827]">
                    <item.icon className="size-5" />
                  </span>
                  <p className="text-sm text-white/60">{item.label}</p>
                </div>
                <p className="text-sm font-semibold">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
