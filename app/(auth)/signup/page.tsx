import Image from "next/image"
import Link from "next/link"
import { redirect } from "next/navigation"

import { AuthSubmitButton } from "@/components/app/auth-submit-button"
import { getSession, isProfileComplete, resolveNextPath } from "@/lib/auth"
import { signupAction } from "@/lib/auth-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type SignupPageProps = {
  searchParams: Promise<{
    error?: string
    next?: string
  }>
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const params = await searchParams
  const nextPath = resolveNextPath(params.next, "/feed")
  const defaultAccountType = nextPath === "/advertiser" ? "advertiser" : "user"
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
              Create your account
            </p>
            <h1 className="mt-5 max-w-[12ch] text-5xl font-semibold leading-[1] text-black sm:text-6xl">
              Choose how you want to join.
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-black/58">
              Start with an email and password. After verification, user
              accounts go to the feed, while advertisers continue into account
              funding and brand setup.
            </p>
          </div>

          <div className="relative min-h-72 overflow-hidden rounded-3xl border border-black/10 bg-black shadow-[0_22px_70px_rgba(0,0,0,0.12)] lg:min-h-[24rem]">
            <Image
              src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1400&q=86"
              alt="People gathered around a laptop reviewing media"
              fill
              priority
              sizes="(min-width: 1024px) 58vw, 100vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-black/14" />
            <div className="absolute bottom-4 left-4 right-4 rounded-2xl border border-white/20 bg-white/92 p-4 text-black shadow-[0_18px_45px_rgba(0,0,0,0.18)] backdrop-blur">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-black/42">
                    Posting
                  </p>
                  <p className="mt-2 text-2xl font-semibold">On</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-black/42">
                    Earning
                  </p>
                  <p className="mt-2 text-2xl font-semibold">On</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="flex items-center justify-center px-5 py-10 sm:px-6 lg:px-10">
        <div className="w-full max-w-sm space-y-6 rounded-2xl border border-black/10 bg-white p-6 shadow-[0_24px_70px_rgba(10,10,10,0.08)]">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-black/42">
              Create account
            </p>
            <h2 className="text-3xl font-semibold text-foreground">
              Enter your email
            </h2>
          </div>

          {params.error ? (
            <div className="rounded-xl border border-black/10 bg-[#f5f6f1] px-3 py-2 text-sm text-black/70">
              {params.error}
            </div>
          ) : null}

          <form action={signupAction} className="space-y-4">
            <input type="hidden" name="next" value={nextPath} />

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-foreground">
                I&apos;m signing up as
              </legend>
              <div className="grid gap-2">
                <label className="group flex cursor-pointer items-start gap-3 rounded-xl border border-black/10 bg-white p-3 text-left shadow-sm transition hover:border-black/20 has-[:checked]:border-black has-[:checked]:bg-[#f5f6f1]">
                  <input
                    type="radio"
                    name="accountType"
                    value="user"
                    defaultChecked={defaultAccountType === "user"}
                    className="mt-1 size-4 accent-black"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-foreground">
                      User
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      Post, follow, discover, and earn from activity in the feed.
                    </span>
                  </span>
                </label>

                <label className="group flex cursor-pointer items-start gap-3 rounded-xl border border-black/10 bg-white p-3 text-left shadow-sm transition hover:border-black/20 has-[:checked]:border-black has-[:checked]:bg-[#f5f6f1]">
                  <input
                    type="radio"
                    name="accountType"
                    value="advertiser"
                    defaultChecked={defaultAccountType === "advertiser"}
                    className="mt-1 size-4 accent-black"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-foreground">
                      Advertiser
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      Create an advertiser account, allocate funds, and pay creators
                      when organic conversations qualify.
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>

            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium text-foreground">
                Email
              </label>
              <Input id="email" name="email" type="email" required />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="text-sm font-medium text-foreground"
              >
                Password
              </label>
              <Input id="password" name="password" type="password" required />
              <p className="text-xs text-muted-foreground">
                Use at least 8 characters.
              </p>
            </div>

            <AuthSubmitButton idleLabel="Create account" pendingLabel="Creating account..." />
          </form>

          <div className="space-y-3">
            <Button asChild variant="outline" className="h-11 w-full rounded-full bg-white text-base">
              <Link href={`/login?next=${encodeURIComponent(nextPath)}`}>Back to sign in</Link>
            </Button>
            <p className="text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href={`/login?next=${encodeURIComponent(nextPath)}`} className="font-medium text-foreground">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
