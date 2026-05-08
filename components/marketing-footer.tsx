import Link from "next/link"

const footerLinks = [
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Community Guidelines", href: "/community-guidelines" },
]

export function MarketingFooter() {
  return (
    <footer className="border-t border-black/10 bg-[#f4f2ec]">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-5 px-4 py-8 text-sm text-black/56 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href="/"
          className="w-fit text-xl font-semibold tracking-[-0.04em] text-black"
          aria-label="UBEYE home"
        >
          UBEYE
        </Link>
        <nav className="flex flex-wrap gap-x-5 gap-y-3" aria-label="Legal">
          {footerLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="transition hover:text-black"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  )
}
