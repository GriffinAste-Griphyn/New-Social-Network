"use client";

import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export default function GlobalError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html
      lang="en"
      className={`${inter.className} ${inter.variable} h-full antialiased`}
    >
      <title>UBEYE error</title>
      <body className="min-h-screen bg-background text-foreground">
        <main className="flex min-h-screen items-center justify-center px-6 py-16">
          <section className="w-full max-w-md space-y-6 text-center">
            <div className="space-y-3">
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
                UBEYE
              </p>
              <h1 className="text-3xl font-semibold tracking-tight">
                Something went wrong.
              </h1>
              <p className="text-sm leading-6 text-muted-foreground">
                The app hit an unexpected error. Try again, or return to the feed.
              </p>
            </div>
            <div className="flex flex-col justify-center gap-3 sm:flex-row">
              <button
                type="button"
                onClick={unstable_retry}
                className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
              >
                Try again
              </button>
              <a
                href="/feed"
                className="inline-flex h-11 items-center justify-center rounded-md border border-border px-5 text-sm font-semibold transition hover:bg-muted"
              >
                Go to feed
              </a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
