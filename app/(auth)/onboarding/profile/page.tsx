import Image from "next/image"
import Link from "next/link"
import { redirect } from "next/navigation"

import { AuthSubmitButton } from "@/components/app/auth-submit-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getSession, isProfileComplete, resolveNextPath } from "@/lib/auth"
import { completeProfileAction, logoutAction } from "@/lib/auth-actions"

type ProfileOnboardingPageProps = {
  searchParams: Promise<{
    error?: string
    message?: string
    next?: string
  }>
}

export default async function ProfileOnboardingPage({
  searchParams,
}: ProfileOnboardingPageProps) {
  const session = await getSession()
  const params = await searchParams
  const nextPath = resolveNextPath(params.next, "/app")

  if (!session) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`)
  }

  if (isProfileComplete(session)) {
    redirect(nextPath)
  }

  return (
    <main className="grid min-h-screen bg-[#f5f6f1] lg:grid-cols-[minmax(0,1fr)_460px]">
      <section className="flex min-h-[42vh] flex-col justify-between border-b border-black/10 px-5 py-6 sm:px-8 lg:min-h-screen lg:border-b-0 lg:border-r lg:py-8">
        <Link
          href="/"
          className="w-fit text-sm font-medium uppercase tracking-[0.24em] text-black/72"
        >
          UBEYE
        </Link>

        <div className="grid gap-8 py-10 lg:py-14">
          <div className="max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-[0.24em] text-black/42">
              Profile setup
            </p>
            <h1 className="mt-5 max-w-[12ch] text-5xl font-[350] leading-[1] text-black sm:text-6xl">
              Choose how people see you.
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-black/58">
              Your email is verified. Now choose a display name and a handle
              for posting, replies, follows, and discovery.
            </p>
          </div>

          <div className="relative min-h-72 overflow-hidden rounded-3xl border border-black/10 bg-black shadow-[0_22px_70px_rgba(0,0,0,0.12)] lg:min-h-[24rem]">
            <Image
              src="https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1400&q=86"
              alt="Person setting up a profile on a laptop"
              fill
              priority
              sizes="(min-width: 1024px) 58vw, 100vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-black/18" />
            <div className="absolute bottom-4 left-4 right-4 rounded-2xl border border-white/20 bg-white/92 p-4 text-black shadow-[0_18px_45px_rgba(0,0,0,0.18)] backdrop-blur">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-black/42">
                    Next
                  </p>
                  <p className="mt-2 text-2xl font-medium">Claim handle</p>
                </div>
                <p className="rounded-full bg-black px-3 py-1 text-sm font-medium text-white">
                  Verified
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="flex items-center justify-center px-5 py-10 sm:px-6 lg:px-10">
        <div className="w-full max-w-sm space-y-6 rounded-2xl border border-black/10 bg-white p-6 shadow-[0_24px_70px_rgba(10,10,10,0.08)]">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-black/42">
              Final step
            </p>
            <h2 className="text-3xl font-[350] text-foreground">
              Claim your handle
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

          <form action={completeProfileAction} className="space-y-4">
            <input type="hidden" name="next" value={nextPath} />
            <input type="hidden" name="onboardingIntent" value="both" />

            <div className="space-y-1.5">
              <label
                htmlFor="displayName"
                className="text-sm font-medium text-foreground"
              >
                Display name
              </label>
              <Input
                id="displayName"
                name="displayName"
                required
                autoComplete="name"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="handle" className="text-sm font-medium text-foreground">
                Handle
              </label>
              <div className="overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm transition-all focus-within:border-black/20 focus-within:ring-4 focus-within:ring-black/5">
                <div className="flex h-11 items-center">
                  <span className="flex h-full items-center border-r border-black/8 bg-muted/55 px-3 text-lg text-muted-foreground">
                    @
                  </span>
                  <Input
                    id="handle"
                    name="handle"
                    required
                    autoCapitalize="off"
                    autoCorrect="off"
                    autoComplete="username"
                    spellCheck={false}
                    placeholder="yourhandle"
                    className="h-full rounded-none border-0 bg-transparent px-3 text-base shadow-none focus-visible:border-transparent focus-visible:ring-0"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                3-20 characters. Lowercase letters, numbers, periods, and
                underscores.
              </p>
            </div>

            <AuthSubmitButton idleLabel="Finish setup" pendingLabel="Saving..." />
          </form>

          <form action={logoutAction}>
            <Button
              type="submit"
              variant="outline"
              className="h-11 w-full rounded-full bg-white text-base"
            >
              Use a different account
            </Button>
          </form>
        </div>
      </section>
    </main>
  )
}
