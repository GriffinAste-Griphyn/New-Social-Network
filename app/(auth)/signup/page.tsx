import Link from "next/link"
import { redirect } from "next/navigation"

import { AuthSubmitButton } from "@/components/app/auth-submit-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getSession, isProfileComplete, resolveNextPath } from "@/lib/auth"
import { signupAction } from "@/lib/auth-actions"

type SignupPageProps = {
  searchParams: Promise<{
    error?: string
    next?: string
  }>
}

function isConsumerPath(pathname: string) {
  return ["/feed", "/stories", "/stats", "/payouts", "/blocked-users"].some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  )
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const params = await searchParams
  const nextPath = resolveNextPath(params.next, "/feed")
  const isConsumerSignup = isConsumerPath(nextPath)
  const session = await getSession()

  if (isProfileComplete(session)) {
    redirect(nextPath)
  }

  if (session) {
    redirect(`/onboarding/profile?next=${encodeURIComponent(nextPath)}`)
  }

  return (
    <main className="min-h-screen bg-[#f7f7f4] px-5 py-8 text-[#18181b]">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-sm flex-col justify-center">
        <Link href="/" className="mb-10 text-2xl font-semibold tracking-tight">
          UBEYE
        </Link>

        <section className="rounded-[8px] border border-[#e4e4e7] bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-[#71717a]">
            {isConsumerSignup ? "Mobile web signup" : "Advertiser signup"}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Create your account
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#71717a]">
            {isConsumerSignup
              ? "Create an account from your phone to start using UBEYE mobile web."
              : "Create an account to manage advertiser funding and campaign settings."}
          </p>

          {params.error ? (
            <div className="mt-5 rounded-[8px] border border-[#fecdd3] bg-[#fff1f2] px-4 py-3 text-sm text-[#be123c]">
              {params.error}
            </div>
          ) : null}

          <form action={signupAction} className="mt-6 grid gap-4">
            <input type="hidden" name="next" value={nextPath} />
            <input
              type="hidden"
              name="accountType"
              value={isConsumerSignup ? "user" : "advertiser"}
            />

            <div>
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="mt-2 h-11 rounded-[8px]"
              />
            </div>

            <div>
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                className="mt-2 h-11 rounded-[8px]"
              />
            </div>

            <AuthSubmitButton
              className="mt-2 rounded-[8px] bg-[#18181b] text-sm hover:bg-[#27272a]"
              idleLabel="Create account"
              pendingLabel="Creating..."
            />
          </form>

          <Button
            asChild
            variant="outline"
            className="mt-4 h-11 w-full rounded-[8px] border-[#d4d4d8] bg-white text-sm"
          >
            <Link href={`/login?next=${encodeURIComponent(nextPath)}`}>
              Sign in
            </Link>
          </Button>
        </section>
      </div>
    </main>
  )
}
