import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16 text-foreground">
      <section className="w-full max-w-md space-y-6 text-center">
        <div className="space-y-3">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            404
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Page not found.</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            This page may have moved, or the link may no longer be available.
          </p>
        </div>
        <div className="flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            Go home
          </Link>
          <Link
            href="/feed"
            className="inline-flex h-11 items-center justify-center rounded-md border border-border px-5 text-sm font-semibold transition hover:bg-muted"
          >
            Go to feed
          </Link>
        </div>
      </section>
    </main>
  );
}
