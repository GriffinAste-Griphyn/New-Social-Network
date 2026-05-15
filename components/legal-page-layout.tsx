import Link from "next/link"

import { Button } from "@/components/ui/button"

type LegalSection = {
  title: string
  body: string[]
}

type LegalPageLayoutProps = {
  eyebrow: string
  title: string
  intro: string
  lastUpdated: string
  sections: LegalSection[]
  contactTitle: string
  contactBody: string
}

const legalLinks = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Guidelines", href: "/community-guidelines" },
]

function LegalHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-[#060606]/78 text-white backdrop-blur-xl">
      <div className="relative mx-auto flex h-16 w-full max-w-[1180px] items-center justify-between gap-4 px-4">
        <Link href="/" className="text-xl font-medium" aria-label="UBEYE home">
          UBEYE
        </Link>

        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 text-sm text-white/62 md:flex" aria-label="Legal pages">
          {legalLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-[8px] px-3 py-2 transition hover:bg-white/8 hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <Button asChild className="h-9 rounded-[8px] bg-white px-4 text-sm text-black hover:bg-white/88">
          <Link href="/app">Get the app</Link>
        </Button>
      </div>
    </header>
  )
}

function LegalFooter() {
  return (
    <footer className="border-t border-white/10 bg-[#060606] text-white">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-5 px-4 py-8 text-sm text-white/54 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="w-fit text-xl font-medium text-white" aria-label="UBEYE home">
          UBEYE
        </Link>
        <nav className="flex flex-wrap gap-x-5 gap-y-3" aria-label="Legal">
          {legalLinks.map((link) => (
            <Link key={link.href} href={link.href} className="transition hover:text-white">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  )
}

export function LegalPageLayout({
  eyebrow,
  title,
  intro,
  lastUpdated,
  sections,
  contactTitle,
  contactBody,
}: LegalPageLayoutProps) {
  return (
    <div className="min-h-screen bg-[#060606] text-white">
      <LegalHeader />

      <main>
        <section className="border-b border-white/10 pt-16">
          <div className="mx-auto max-w-[1180px] px-4 py-16 md:py-24">
            <p className="inline-flex max-w-full items-center rounded-[8px] border border-white/14 bg-white/8 px-3 py-1.5 text-[0.68rem] font-medium uppercase leading-[1.2] text-white/78">
              {eyebrow}
            </p>
            <h1 className="mt-7 max-w-4xl text-5xl font-[350] leading-[0.96] text-white md:text-7xl">
              {title}
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-8 text-white/64 md:text-lg">
              {intro}
            </p>
            <p className="mt-7 text-sm font-medium text-[#ffb4a6]">
              Last updated: {lastUpdated}
            </p>
          </div>
        </section>

        <section className="bg-[#f7f3ea] text-black">
          <div className="mx-auto grid max-w-[1180px] gap-10 px-4 py-16 md:grid-cols-[14rem_minmax(0,1fr)] md:py-24">
            <aside className="border-t border-black/12 pt-5">
              <p className="text-xs font-medium uppercase text-[#e01616]">Document</p>
              <p className="mt-3 text-sm leading-6 text-black/54">
                These pages explain the practical rules for using UBEYE.
              </p>
            </aside>

            <div className="border-t border-black/12">
              {sections.map((section, index) => (
                <section key={section.title} className="grid gap-5 border-b border-black/10 py-8 md:grid-cols-[4rem_minmax(0,1fr)]">
                  <p className="text-xs font-medium uppercase text-[#e01616]">
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <div>
                    <h2 className="text-2xl font-[350] leading-tight text-black">
                      {section.title}
                    </h2>
                    <div className="mt-5 grid gap-4 text-base leading-8 text-black/62">
                      {section.body.map((paragraph) => (
                        <p key={paragraph}>{paragraph}</p>
                      ))}
                    </div>
                  </div>
                </section>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#060606] text-white">
          <div className="mx-auto grid max-w-[1180px] gap-8 px-4 py-16 md:grid-cols-[14rem_minmax(0,1fr)] md:py-20">
            <p className="text-xs font-medium uppercase text-[#e01616]">Contact</p>
            <div className="border-t border-white/10 pt-6">
              <h2 className="text-3xl font-[350] leading-tight">{contactTitle}</h2>
              <p className="mt-5 max-w-2xl text-base leading-8 text-white/58">
                {contactBody}
              </p>
            </div>
          </div>
        </section>
      </main>

      <LegalFooter />
    </div>
  )
}
