import Image from "next/image"
import Link from "next/link"
import { redirect } from "next/navigation"

import { AuthSubmitButton } from "@/components/app/auth-submit-button"
import { getSession, isProfileComplete, resolveNextPath } from "@/lib/auth"
import { loginAction } from "@/lib/auth-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type LoginPageProps = {
  searchParams: Promise<{
    error?: string
    message?: string
    next?: string
  }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams
  const nextPath = resolveNextPath(params.next, "/feed")
  const session = await getSession()

  if (isProfileComplete(session)) {
    redirect(nextPath)
  }

  if (session) {
    redirect(`/onboarding/profile?next=${encodeURIComponent(nextPath)}`)
  }

  return (
    <main className="grid min-h-screen bg-[#f5f6f1] lg:grid-cols-[minmax(0,1fr)_460px]">
      <section className="flex min-h-[42vh] flex-col justify-between border-b border-black/10 px-5 py-6 sm:px-8 lg:min-h-screen lg:border-b-0 lg:border-r lg:py-8">
        <Link
          href="/"
          className="w-fit text-sm font-semibold uppercase tracking-[0.24em] text-black/72"
        >
          NSN
        </Link>

        <div className="grid gap-8 py-10 lg:py-14">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/42">
              Back to earning
            </p>
            <h1 className="mt-5 max-w-[12ch] text-5xl font-semibold leading-[1] text-black sm:text-6xl">
              Sign in to post, follow, discover, and earn.
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-black/58">
              Your account connects posting, replies, discovery, and earning in
              one place.
            </p>
          </div>

          <div className="relative min-h-72 overflow-hidden rounded-3xl border border-black/10 bg-black shadow-[0_22px_70px_rgba(0,0,0,0.12)] lg:min-h-[24rem]">
            <Image
              src="https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?auto=format&fit=crop&w=1400&q=86"
              alt="Person using a smartphone"
              fill
              priority
              sizes="(min-width: 1024px) 58vw, 100vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-black/18" />
            <div className="absolute bottom-4 left-4 right-4 rounded-2xl border border-white/20 bg-white/92 p-4 text-black shadow-[0_18px_45px_rgba(0,0,0,0.18)] backdrop-blur">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-black/42">
                    Account value
                  </p>
                  <p className="mt-2 text-2xl font-semibold">Stories + rewards</p>
                </div>
                <p className="rounded-full bg-black px-3 py-1 text-sm font-medium text-white">
                  Live
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="flex items-center justify-center px-5 py-10 sm:px-6 lg:px-10">
        <div className="w-full max-w-sm space-y-6 rounded-2xl border border-black/10 bg-white p-6 shadow-[0_24px_70px_rgba(10,10,10,0.08)]">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-black/42">
              Sign in
            </p>
            <h2 className="text-3xl font-semibold text-foreground">
              Welcome back
            </h2>
          </div>

          {params.error ? (
            <div className="rounded-xl border border-black/10 bg-[#f5f6f1] px-3 py-2 text-sm text-black/70">
              {params.error}
            </div>
          ) : null}

          {params.message ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              {params.message}
            </div>
          ) : null}

          <form action={loginAction} className="space-y-4">
            <input type="hidden" name="next" value={nextPath} />

            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium text-foreground">
                Email
              </label>
              <Input id="email" name="email" type="email" required />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="password"
                  className="text-sm font-medium text-foreground"
                >
                  Password
                </label>
                <Link href="/forgot-password" className="text-sm font-medium text-foreground">
                  Forgot?
                </Link>
              </div>
              <Input id="password" name="password" type="password" required />
            </div>

            <AuthSubmitButton idleLabel="Sign in" pendingLabel="Signing in..." />
          </form>

          <div className="space-y-3">
            <Button asChild variant="outline" className="h-11 w-full rounded-full bg-white text-base">
              <Link href={`/signup?next=${encodeURIComponent(nextPath)}`}>Create account</Link>
            </Button>
            <p className="text-sm text-muted-foreground">
              New here?{" "}
              <Link href={`/signup?next=${encodeURIComponent(nextPath)}`} className="font-medium text-foreground">
                Create an account
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
