import Link from "next/link"
import type { Metadata } from "next"

import { MarketingFooter } from "@/components/marketing-footer"

export const metadata: Metadata = {
  title: "Terms | UBEYE",
  description:
    "Review the terms that apply when using UBEYE, including accounts, content, moderation, advertisers, and revenue-share features.",
}

const lastUpdated = "May 8, 2026"

const sections = [
  {
    title: "Using UBEYE",
    body: [
      "UBEYE is a social network and advertiser-funded revenue-share experiment. By using UBEYE, you agree to these Terms and to follow all applicable laws.",
      "You may use UBEYE only if you can form a binding agreement with us and are not barred from using the service under applicable law.",
      "You are responsible for your account, your login credentials, and activity that occurs under your account.",
    ],
  },
  {
    title: "Accounts",
    body: [
      "You agree to provide accurate account information and keep it current.",
      "You may not impersonate another person, claim a handle you do not have rights to use, or use UBEYE to mislead others.",
      "We may suspend, restrict, or terminate accounts that violate these Terms, create risk, abuse the service, or interfere with UBEYE operations.",
    ],
  },
  {
    title: "User Content",
    body: [
      "You own the content you create, subject to the rights you grant UBEYE to operate the service.",
      "By posting content, you grant UBEYE a worldwide, non-exclusive, royalty-free license to host, store, reproduce, display, distribute, adapt, analyze, and use that content to provide, improve, promote, moderate, and operate UBEYE.",
      "You represent that you have the rights needed to post your content and that your content does not violate another person's rights or applicable law.",
      "Do not post illegal, abusive, hateful, exploitative, harassing, deceptive, sexually explicit, violent, infringing, or otherwise harmful content.",
    ],
  },
  {
    title: "Community Safety",
    body: [
      "UBEYE may provide tools to report content, report users, block users, or restrict interactions.",
      "We may remove content, limit distribution, restrict accounts, preserve records, or take other action when needed for safety, legal compliance, moderation, service integrity, or fraud prevention.",
      "You may not use UBEYE to scrape data, spam users, manipulate engagement, evade restrictions, interfere with systems, or abuse payout or advertiser features.",
    ],
  },
  {
    title: "Revenue Share and Payouts",
    body: [
      "UBEYE may share a portion of eligible revenue with creators and users who help power the network. Public marketing may describe a target or planned revenue share, but actual eligibility and payment amounts depend on product rules, advertiser funding, moderation status, fraud prevention, payment provider requirements, tax requirements, and applicable law.",
      "Revenue-share features are not guaranteed income, wages, employment, securities, interest, dividends, or financial advice.",
      "We may delay, reduce, reverse, or withhold payouts where required for compliance, suspected fraud, payment processor issues, chargebacks, account restrictions, or violations of these Terms.",
      "You are responsible for taxes, payment account accuracy, and any information required to receive eligible payouts.",
    ],
  },
  {
    title: "Advertisers",
    body: [
      "Advertisers are responsible for their account information, funding activity, brand criteria, targeting inputs, exclusions, and campaign instructions.",
      "UBEYE may reject, pause, limit, or remove advertiser activity that creates risk, violates policy, misleads users, infringes rights, or does not fit the service.",
      "Advertiser-funded features may depend on third-party payment processors, account verification, and internal eligibility rules.",
    ],
  },
  {
    title: "Payments and Third Parties",
    body: [
      "Some features may rely on third-party services, including payment processors, hosting providers, email providers, storage providers, analytics providers, and app platform services.",
      "Your use of third-party services may be subject to their own terms and policies.",
      "UBEYE is not responsible for third-party service failures outside our control.",
    ],
  },
  {
    title: "App Store Terms",
    body: [
      "If you download UBEYE through Apple's App Store, your use of the app is also subject to Apple's applicable terms and policies.",
      "Apple is not responsible for UBEYE, our content, support, maintenance, claims, or third-party claims relating to the app, except as required by applicable law.",
    ],
  },
  {
    title: "Disclaimers",
    body: [
      "UBEYE is provided on an as-is and as-available basis. We do not guarantee that the service will be uninterrupted, error-free, secure, or available at all times.",
      "We do not guarantee any level of attention, engagement, advertiser demand, revenue, payout, account growth, or business result.",
    ],
  },
  {
    title: "Limitation of Liability",
    body: [
      "To the maximum extent permitted by law, UBEYE and its affiliates will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, lost revenue, lost data, or business interruption.",
      "Some jurisdictions do not allow certain limitations, so parts of this section may not apply to you.",
    ],
  },
  {
    title: "Changes to These Terms",
    body: [
      "We may update these Terms from time to time. If changes are material, we will provide notice through the app, website, or another reasonable method.",
      "Your continued use of UBEYE after changes become effective means you accept the updated Terms.",
    ],
  },
]

export default function TermsPage() {
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
            Terms
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-black/62 md:text-lg">
            These Terms explain the rules for using UBEYE, including accounts,
            user content, creator and user revenue-share features, advertisers,
            payments, and moderation.
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
            For questions about these Terms, contact UBEYE support through the
            support contact listed in the app or on the App Store listing.
          </p>
        </section>
      </main>
      <MarketingFooter />
    </div>
  )
}
