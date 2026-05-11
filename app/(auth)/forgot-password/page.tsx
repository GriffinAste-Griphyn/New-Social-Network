import Link from "next/link"

import { AuthSubmitButton } from "@/components/app/auth-submit-button"
import { requestPasswordResetAction } from "@/lib/auth-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type ForgotPasswordPageProps = {
  searchParams: Promise<{
    error?: string
    message?: string
  }>
}

export default async function ForgotPasswordPage({
  searchParams,
}: ForgotPasswordPageProps) {
  const params = await searchParams

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f6f1] px-5 py-10">
      <section className="w-full max-w-sm space-y-6 rounded-2xl border border-black/10 bg-white p-6 shadow-[0_24px_70px_rgba(10,10,10,0.08)]">
        <div className="space-y-2">
          <Link
            href="/"
            className="text-xs font-semibold uppercase tracking-[0.22em] text-black/42"
          >
            UBEYE
          </Link>
          <h1 className="text-3xl font-semibold text-foreground">
            Reset your password
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Enter the email on your account and we&apos;ll send a reset link if
            the account exists.
          </p>
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

        <form action={requestPasswordResetAction} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium text-foreground">
              Email
            </label>
            <Input id="email" name="email" type="email" required />
          </div>

          <AuthSubmitButton idleLabel="Send reset link" pendingLabel="Sending..." />
        </form>

        <Button asChild variant="outline" className="h-11 w-full rounded-full bg-white text-base">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </section>
    </main>
  )
}
