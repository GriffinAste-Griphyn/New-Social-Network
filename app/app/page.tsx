import Link from "next/link"
import type { Metadata } from "next"
import { ArrowLeft, ArrowRight, Bell, Smartphone, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"

const advertiserSignInHref = "/login?next=%2Fadvertiser"
const heroPoster = "/ubeye/hero-manhattan-poster-v2.jpg"
const heroVideo = "/ubeye/hero-manhattan-loop-v2.mp4"
const betaPhoneDisplay = "385-222-1952"
const betaPhoneHref = "sms:+13852221952"

export const metadata: Metadata = {
  title: "UBEYE Mobile App | Coming Soon",
  description:
    "The UBEYE mobile app is coming soon. UBEYE lets people post stories and share in the value their attention creates.",
}

const previewRows = [
  {
    icon: Smartphone,
    label: "Post from your phone",
    value: "UBEYE is being built around fast, everyday story sharing.",
  },
  {
    icon: Sparkles,
    label: "All users are creators",
    value: "Post, watch, reply, save, and help create value in the network.",
  },
  {
    icon: Bell,
    label: "Launch updates soon",
    value: "The mobile app will be the home for consumer signup and posting.",
  },
]

export default function MobileAppPage() {
  return (
    <main className="min-h-screen bg-[#060606] text-white">
      <section className="relative isolate min-h-screen overflow-hidden">
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
          className="absolute inset-0 hidden h-full w-full object-cover opacity-52 motion-safe:block [filter:contrast(1.05)_saturate(0.82)]"
        >
          <source src={heroVideo} type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(6,6,6,0.96),rgba(6,6,6,0.74)_52%,rgba(6,6,6,0.38))]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,6,6,0.2),rgba(6,6,6,0.44)_54%,rgba(6,6,6,1)_100%)]" />

        <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1180px] flex-col px-4 py-5 text-white sm:px-6 lg:px-4">
          <header className="flex items-center justify-between gap-4">
            <Link href="/" className="text-xl font-semibold" aria-label="UBEYE home">
              UBEYE
            </Link>
            <Button asChild variant="ghost" className="hidden h-10 rounded-[8px] px-4 text-sm text-white/70 hover:bg-white/8 hover:text-white sm:inline-flex">
              <Link href={advertiserSignInHref}>Advertiser sign in</Link>
            </Button>
          </header>

          <div className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-14">
            <div className="max-w-4xl">
              <Link
                href="/"
                className="mb-8 flex w-fit items-center gap-2 text-sm font-medium text-white/68 transition hover:text-white"
              >
                <ArrowLeft className="size-4" />
                Back to UBEYE
              </Link>
              <p className="inline-flex max-w-full items-center rounded-[8px] border border-white/14 bg-white/8 px-3 py-1.5 text-[0.68rem] font-semibold uppercase leading-[1.2] text-white/78 backdrop-blur-sm">
                Mobile app
              </p>
              <h1 className="mt-7 max-w-[10ch] text-[3.8rem] font-semibold leading-[0.92] text-white sm:text-[5rem] md:text-[6.2rem]">
                Coming soon.
              </h1>
              <p className="mt-7 max-w-2xl text-base leading-8 text-white/68 md:text-lg">
                UBEYE is building the mobile home for organic content,
                monetized. Soon, you will be able to post stories, watch what
                moves through the network, and take part in the value your
                attention creates.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild className="h-12 justify-between rounded-[8px] bg-[#e01616] px-5 text-sm font-semibold text-white hover:bg-[#c91414] sm:justify-center">
                  <Link href="/">
                    Back to landing page
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="h-12 justify-between rounded-[8px] border-white/16 bg-white/5 px-5 text-sm font-semibold text-white hover:bg-white/10 hover:text-white sm:justify-center"
                >
                  <Link href="/advertise">Advertise on UBEYE</Link>
                </Button>
              </div>
              <p className="mt-5 max-w-xl text-sm leading-6 text-white/58">
                Want to be a beta user in TestFlight? Text Griffin at{" "}
                <a href={betaPhoneHref} className="font-semibold text-white underline underline-offset-4">
                  {betaPhoneDisplay}
                </a>
                .
              </p>
            </div>

            <div className="border border-white/12 bg-black/54 p-4 shadow-[0_24px_80px_-56px_rgba(0,0,0,0.9)] backdrop-blur-md md:p-5">
              <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
                <div>
                  <p className="text-xs uppercase text-white/42">Launch status</p>
                  <p className="mt-1 text-sm font-medium text-white">Mobile app in progress</p>
                </div>
                <span className="rounded-[8px] bg-[#e01616] px-2.5 py-1 text-xs font-semibold text-white">
                  Soon
                </span>
              </div>

              <div className="divide-y divide-white/10">
                {previewRows.map((row) => (
                  <div key={row.label} className="grid grid-cols-[2.75rem_1fr] gap-4 py-5">
                    <div className="flex size-10 items-center justify-center rounded-[8px] bg-white text-black">
                      <row.icon className="size-5" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-white">{row.label}</h2>
                      <p className="mt-2 text-sm leading-6 text-white/58">{row.value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
