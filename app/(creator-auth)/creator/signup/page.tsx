import Link from "next/link"
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AuthSubmitButton } from "@/components/app/auth-submit-button"
import { PasswordInput } from "@/components/app/password-input"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  getSession,
  isProfileComplete,
  resolveNextPath,
} from "@/lib/auth"
import { creatorSignupAction } from "@/lib/auth-actions"

const defaultNextPath = "/creator/payouts"

export const metadata: Metadata = {
  title: "Create creator account | UBEYE",
  description: "Create a UBEYE creator account for payout setup.",
}

type CreatorSignupPageProps = {
  searchParams: Promise<{
    error?: string
    next?: string
  }>
}

export default async function CreatorSignupPage({
  searchParams,
}: CreatorSignupPageProps) {
  const params = await searchParams
  const nextPath = resolveNextPath(params.next, defaultNextPath)
  const session = await getSession()

  if (isProfileComplete(session)) {
    redirect(nextPath)
  }

  if (session) {
    redirect(`/onboarding/profile?next=${encodeURIComponent(nextPath)}`)
  }

  return (
    <main className="min-h-screen bg-[#f6f5f2] px-4 py-6 text-[#18181b] sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl flex-col">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="text-xl font-medium" aria-label="UBEYE home">
            UBEYE
          </Link>
          <Button asChild variant="ghost" className="h-10 rounded-[8px] px-4">
            <Link href="/">Back to site</Link>
          </Button>
        </header>

        <div className="flex flex-1 items-center justify-center py-12">
          <section className="grid w-full max-w-4xl gap-6 rounded-[8px] border border-[#e4e4e7] bg-white p-6 shadow-sm lg:grid-cols-[0.9fr_1.1fr]">
            <div className="flex flex-col justify-between rounded-[8px] bg-[#18181b] p-5 text-white">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/50">
                  Creator payouts
                </p>
                <h1 className="mt-4 text-4xl font-[350] tracking-tight">
                  Set up your creator account.
                </h1>
                <p className="mt-4 text-sm leading-6 text-white/62">
                  Create an account, verify your email, claim your handle, and
                  then connect Stripe from the payout page.
                </p>
              </div>
              <p className="mt-10 text-xs leading-5 text-white/42">
                Stripe handles sensitive payout details for UBEYE creators.
              </p>
            </div>

            <div className="p-1 sm:p-3">
              <p className="text-sm font-medium text-[#71717a]">
                Creator signup
              </p>
              <h2 className="mt-2 text-3xl font-[350] tracking-tight">
                Create your account
              </h2>

              {params.error ? (
                <div className="mt-5 rounded-[8px] border border-[#fecdd3] bg-[#fff1f2] px-4 py-3 text-sm text-[#be123c]">
                  {params.error}
                </div>
              ) : null}

              <form action={creatorSignupAction} className="mt-6 grid gap-4">
                <input type="hidden" name="next" value={nextPath} />
                <input type="hidden" name="accountType" value="user" />

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
                  <PasswordInput
                    id="password"
                    name="password"
                    autoComplete="new-password"
                    required
                    wrapperClassName="mt-2"
                    className="h-11 rounded-[8px]"
                  />
                </div>

                <AuthSubmitButton
                  className="mt-2 rounded-[8px] bg-[#18181b] text-sm text-white hover:bg-[#27272a]"
                  idleLabel="Create account"
                  pendingLabel="Creating..."
                />
              </form>

              <Button
                asChild
                variant="outline"
                className="mt-4 h-11 w-full rounded-[8px] bg-white text-sm"
              >
                <Link href={`/creator/login?next=${encodeURIComponent(nextPath)}`}>
                  Sign in
                </Link>
              </Button>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
