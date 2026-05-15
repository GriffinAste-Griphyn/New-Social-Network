import Link from "next/link"
import type { Metadata } from "next"

const heroPoster = "/ubeye/hero-manhattan-poster-v2.jpg"
const heroVideo = "/ubeye/hero-manhattan-loop-v2.mp4"
const betaPhoneDisplay = "385-222-1952"
const betaPhoneHref = "sms:+13852221952"

export const metadata: Metadata = {
  title: "UBEYE Mobile App | Coming Very Soon",
  description:
    "The UBEYE mobile app is coming very soon. Text Griffin to become a beta user in TestFlight.",
}

export default function MobileAppPage() {
  return (
    <main className="min-h-screen bg-[#060606] text-white">
      <section className="relative isolate min-h-screen overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-50 motion-reduce:block"
          style={{ backgroundImage: `url(${heroPoster})` }}
        />
        <video
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          poster={heroPoster}
          className="absolute inset-0 hidden h-full w-full object-cover opacity-46 motion-safe:block [filter:contrast(1.05)_saturate(0.82)]"
        >
          <source src={heroVideo} type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(6,6,6,0.96),rgba(6,6,6,0.76)_58%,rgba(6,6,6,0.46))]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,6,6,0.18),rgba(6,6,6,0.5)_58%,rgba(6,6,6,1)_100%)]" />

        <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1180px] flex-col px-4 py-5 sm:px-6 lg:px-4">
          <header className="flex items-center justify-between gap-4">
            <Link href="/" className="text-xl font-semibold" aria-label="UBEYE home">
              UBEYE
            </Link>
          </header>

          <div className="flex flex-1 items-center">
            <div className="max-w-5xl">
              <h1 className="text-[3.35rem] font-semibold leading-[0.92] text-white sm:text-[4.8rem] md:text-[5.8rem] lg:text-[6.4rem]">
                <span className="block sm:inline">Coming very</span>{" "}
                <span className="block sm:inline">soon.</span>
              </h1>
              <p className="mt-7 max-w-2xl text-base leading-8 text-white/68 md:text-lg">
                Want to be a beta user in TestFlight? Text Griffin at{" "}
                <a href={betaPhoneHref} className="font-semibold text-white underline underline-offset-4">
                  {betaPhoneDisplay}
                </a>
                .
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
