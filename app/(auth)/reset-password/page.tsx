import Link from "next/link"

import { AuthSubmitButton } from "@/components/app/auth-submit-button"
import { resetPasswordAction } from "@/lib/auth-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type ResetPasswordPageProps = {
  searchParams: Promise<{
    error?: string
    token?: string
  }>
}

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams
  const token = typeof params.token === "string" ? params.token : ""

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f6f1] px-5 py-10">
      <section className="w-full max-w-sm space-y-6 rounded-2xl border border-black/10 bg-white p-6 shadow-[0_24px_70px_rgba(10,10,10,0.08)]">
        <div className="space-y-2">
          <Link
            href="/"
            className="text-xs font-medium uppercase tracking-[0.22em] text-black/42"
          >
            UBEYE
          </Link>
          <h1 className="text-3xl font-[350] text-foreground">
            Choose a new password
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Reset links expire after 1 hour and can only be used once.
          </p>
        </div>

        {params.error ? (
          <div className="rounded-xl border border-black/10 bg-[#f5f6f1] px-3 py-2 text-sm text-black/70">
            {params.error}
          </div>
        ) : null}

        {token ? (
          <form action={resetPasswordAction} className="space-y-4">
            <input type="hidden" name="token" value={token} />

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium text-foreground">
                New password
              </label>
              <Input id="password" name="password" type="password" required />
              <p className="text-xs text-muted-foreground">
                Use at least 8 characters.
              </p>
            </div>

            <AuthSubmitButton idleLabel="Update password" pendingLabel="Updating..." />
          </form>
        ) : (
          <div className="rounded-xl border border-black/10 bg-[#f5f6f1] px-3 py-2 text-sm text-black/70">
            This reset link is missing a token. Request a new reset link.
          </div>
        )}

        <Button asChild variant="outline" className="h-11 w-full rounded-full bg-white text-base">
          <Link href="/forgot-password">Request another link</Link>
        </Button>
      </section>
    </main>
  )
}
