import Link from "next/link"
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AuthSubmitButton } from "@/components/app/auth-submit-button"
import { PasswordInput } from "@/components/app/password-input"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getSession, isProfileComplete, resolveNextPath } from "@/lib/auth"
import { loginAction } from "@/lib/auth-actions"

const heroPoster = "/ubeye/hero-manhattan-poster-v2.jpg"
const heroVideo = "/ubeye/hero-manhattan-loop-v2.mp4"

export const metadata: Metadata = {
  title: "Advertiser sign in | UBEYE",
  description: "Sign in to the UBEYE advertiser portal.",
}

type LoginPageProps = {
  searchParams: Promise<{
    error?: string
    message?: string
    next?: string
  }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams
  const nextPath = resolveNextPath(params.next, "/advertiser")
  const session = await getSession()

  if (isProfileComplete(session)) {
    redirect(nextPath)
  }

  if (session) {
    redirect(`/onboarding/profile?next=${encodeURIComponent(nextPath)}`)
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#060606] text-white">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-52 motion-reduce:block"
        style={{ backgroundImage: `url(${heroPoster})` }}
      />
      <video
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        poster={heroPoster}
        className="absolute inset-0 hidden h-full w-full object-cover opacity-48 motion-safe:block [filter:contrast(1.05)_saturate(0.82)]"
      >
        <source src={heroVideo} type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(6,6,6,0.96),rgba(6,6,6,0.78)_52%,rgba(6,6,6,0.46))]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,6,6,0.1),rgba(6,6,6,0.62)_64%,rgba(6,6,6,1)_100%)]" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1180px] flex-col px-4 py-5 sm:px-6 lg:px-4">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="text-xl font-medium" aria-label="UBEYE home">
            UBEYE
          </Link>
          <Button asChild variant="ghost" className="h-10 rounded-[8px] px-4 text-sm text-white/70 hover:bg-white/8 hover:text-white">
            <Link href="/">Back to site</Link>
          </Button>
        </header>

        <div className="flex flex-1 items-center justify-center py-12">
          <section className="w-full max-w-[25rem] border border-white/12 bg-black/54 p-5 text-white shadow-[0_24px_80px_-56px_rgba(0,0,0,0.9)] backdrop-blur-md sm:p-6">
            <p className="text-xs font-medium uppercase text-[#ffb4a6]">
              Advertiser sign in
            </p>
            <h2 className="mt-3 text-2xl font-[350] tracking-tight text-white">
              Welcome back
            </h2>
            <p className="mt-2 text-sm leading-6 text-white/58">
              Access the desktop tools for advertiser accounts.
            </p>

          {params.error ? (
            <div className="mt-5 rounded-[8px] border border-[#e01616]/30 bg-[#e01616]/14 px-4 py-3 text-sm text-[#ffb4a6]">
              {params.error}
            </div>
          ) : null}

          {params.message ? (
            <div className="mt-5 rounded-[8px] border border-white/14 bg-white/8 px-4 py-3 text-sm text-white/72">
              {params.message}
            </div>
          ) : null}

          <form action={loginAction} className="mt-6 grid gap-4">
            <input type="hidden" name="next" value={nextPath} />

            <div>
              <label htmlFor="email" className="text-sm font-medium text-white/78">
                Email
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="mt-2 h-11 rounded-[8px] border-white/12 bg-white text-black"
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="password" className="text-sm font-medium text-white/78">
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="text-sm font-medium text-white/62 transition hover:text-white"
                >
                  Forgot?
                </Link>
              </div>
              <PasswordInput
                id="password"
                name="password"
                autoComplete="current-password"
                required
                wrapperClassName="mt-2"
                className="h-11 rounded-[8px] border-white/12 bg-white text-black"
              />
            </div>

            <AuthSubmitButton
              className="mt-2 rounded-[8px] bg-[#e01616] text-sm text-white hover:bg-[#c91414]"
              idleLabel="Sign in"
              pendingLabel="Signing in..."
            />
          </form>

          <Button
            asChild
            variant="outline"
            className="mt-4 h-11 w-full rounded-[8px] border-white/16 bg-white/5 text-sm text-white hover:bg-white/10 hover:text-white"
          >
            <Link href="/signup?next=%2Fadvertiser">Create advertiser account</Link>
          </Button>
          </section>
        </div>
      </div>
    </main>
  )
}
