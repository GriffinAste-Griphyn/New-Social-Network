import Link from "next/link"
import type { Metadata } from "next"

import { MarketingFooter } from "@/components/marketing-footer"

export const metadata: Metadata = {
  title: "Privacy Policy | UBEYE",
  description:
    "Learn what information UBEYE collects, how it is used, and the choices available to users.",
}

const lastUpdated = "May 8, 2026"

const sections = [
  {
    title: "Information We Collect",
    body: [
      "Account information, including your email address, display name, handle, password credentials, profile photo, and account settings.",
      "Content you create or share, including stories, captions, replies, reactions, uploaded media, and other information you choose to provide.",
      "Activity information, including follows, views, watch time, story completion, replies, comments, reports, moderation actions, and creator payout activity.",
      "Device and technical information, including IP address, device type, operating system, app version, log data, crash information, and basic security data.",
      "Payment and advertiser information when applicable, including advertiser account details, funding activity, payout status, and payment processor identifiers. Payment card and bank details may be handled by third-party payment providers such as Stripe.",
    ],
  },
  {
    title: "How We Use Information",
    body: [
      "To create and manage accounts, authenticate users, and provide the UBEYE app and website.",
      "To publish stories, show creator profiles, deliver feeds, enable replies, and support social features.",
      "To measure attention, engagement, views, completion, and other signals used to operate creator analytics and revenue-share features.",
      "To support advertiser-funded campaigns, brand matching, payout calculations, fraud prevention, safety, moderation, and abuse detection.",
      "To communicate with users about account activity, support requests, security, product updates, and policy changes.",
      "To improve reliability, debug issues, understand usage, and develop new features.",
    ],
  },
  {
    title: "Sharing and Disclosure",
    body: [
      "Public profile information and stories may be visible to other users depending on product settings and feature design.",
      "We may share information with service providers that help us host, store, analyze, secure, process payments, send email, or operate the service.",
      "We may share information with advertisers or partners in aggregated, limited, or campaign-related forms needed to operate advertiser-funded features. We do not sell personal information as a standalone data product.",
      "We may disclose information if required by law, to protect rights and safety, to investigate abuse, or in connection with a merger, acquisition, financing, or sale of assets.",
    ],
  },
  {
    title: "User Content and Public Activity",
    body: [
      "UBEYE is a social network. Content you post, your handle, profile photo, public creator profile, and engagement with public features may be visible to other users.",
      "Do not post private information, sensitive personal information, or content you do not have the right to share.",
      "We may review, remove, restrict, or preserve user content when needed for safety, moderation, legal compliance, or service integrity.",
    ],
  },
  {
    title: "Revenue Share and Creator Analytics",
    body: [
      "UBEYE may use story activity, view data, completion data, replies, advertiser matching, and other engagement signals to support analytics and eligible revenue-share features.",
      "Revenue-share calculations and eligibility may depend on product rules, advertiser funding, moderation status, fraud prevention, payment provider requirements, and applicable law.",
    ],
  },
  {
    title: "Your Choices",
    body: [
      "You can update certain account information in the app, including your profile photo where available.",
      "You can request account deletion or data deletion by using in-app account deletion features where available or by contacting support.",
      "You can manage device permissions, including camera, photo library, and notification permissions, through your device settings.",
      "You can stop using UBEYE at any time. Some information may be retained where required for security, legal, fraud prevention, payment, tax, or accounting reasons.",
    ],
  },
  {
    title: "Data Retention",
    body: [
      "We keep information for as long as needed to provide UBEYE, comply with legal obligations, resolve disputes, prevent abuse, enforce agreements, and maintain business records.",
      "Stories and other content may expire or be removed from public views before all related records are deleted from backup, safety, analytics, payment, or moderation systems.",
    ],
  },
  {
    title: "Children",
    body: [
      "UBEYE is not intended for children under 13. If you believe a child has provided personal information to UBEYE, contact us so we can review and take appropriate action.",
    ],
  },
  {
    title: "Security",
    body: [
      "We use reasonable administrative, technical, and organizational safeguards designed to protect information. No system is perfectly secure, and we cannot guarantee absolute security.",
    ],
  },
  {
    title: "Changes to This Policy",
    body: [
      "We may update this Privacy Policy from time to time. If changes are material, we will provide notice through the app, website, or another reasonable method.",
    ],
  },
]

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#f4f2ec] text-black">
      <main className="mx-auto max-w-[940px] px-4 py-10 md:py-16">
        <Link
          href="/"
          className="text-xl font-semibold tracking-[-0.04em]"
          aria-label="UBEYE home"
        >
          UBEYE
        </Link>

        <section className="mt-12 border-y border-black/10 py-10 md:py-14">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-black/42">
            Legal
          </p>
          <h1 className="mt-5 max-w-3xl text-5xl font-semibold leading-[0.98] tracking-[-0.07em] md:text-7xl">
            Privacy Policy
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-black/62 md:text-lg">
            This policy explains what UBEYE collects, how we use it, and the
            choices users have when using the app, website, creator tools, and
            advertiser tools.
          </p>
          <p className="mt-5 text-sm font-semibold text-black/42">
            Last updated: {lastUpdated}
          </p>
        </section>

        <div className="divide-y divide-black/10">
          {sections.map((section) => (
            <section key={section.title} className="py-9">
              <h2 className="text-2xl font-semibold tracking-[-0.04em]">
                {section.title}
              </h2>
              <div className="mt-5 grid gap-4 text-base leading-8 text-black/64">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <section className="mt-6 rounded-[1.5rem] border border-black/10 bg-[#faf9f5] p-6">
          <h2 className="text-2xl font-semibold tracking-[-0.04em]">
            Contact
          </h2>
          <p className="mt-4 text-base leading-8 text-black/64">
            For privacy, support, or deletion requests, contact UBEYE support
            through the support contact listed in the app or on the App Store
            listing.
          </p>
        </section>
      </main>
      <MarketingFooter />
    </div>
  )
}
