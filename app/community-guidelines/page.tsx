import Link from "next/link"
import type { Metadata } from "next"

import { MarketingFooter } from "@/components/marketing-footer"

export const metadata: Metadata = {
  title: "Community Guidelines | UBEYE",
  description:
    "Review UBEYE's community guidelines for posting, replying, reporting, moderation, and safe participation.",
}

const lastUpdated = "May 8, 2026"

const sections = [
  {
    title: "Share Real Moments",
    body: [
      "UBEYE is built around stories, attention, and participation. Share content that reflects real moments, useful perspective, culture, taste, work, places, products, events, and the world around you.",
      "Do not mislead people about who you are, what you are posting, or whether content is sponsored, paid, staged, edited, or generated.",
    ],
  },
  {
    title: "Respect Other People",
    body: [
      "Do not harass, threaten, bully, shame, dox, stalk, or encourage others to target a person or group.",
      "Do not post hate, dehumanizing content, slurs, or attacks based on protected traits such as race, ethnicity, national origin, religion, sex, gender identity, sexual orientation, disability, age, or veteran status.",
      "Do not post private information about another person without permission, including addresses, phone numbers, financial information, government IDs, private messages, or sensitive personal details.",
    ],
  },
  {
    title: "Keep Content Safe",
    body: [
      "Do not post graphic violence, credible threats, self-harm encouragement, sexual exploitation, non-consensual intimate content, or content that exploits or endangers minors.",
      "Do not use UBEYE to sell, promote, or coordinate illegal goods, illegal services, fraud, scams, weapons misuse, or dangerous activity.",
      "Do not upload content that infringes someone else's copyright, trademark, privacy, publicity, or other rights.",
    ],
  },
  {
    title: "Protect the Revenue-Share System",
    body: [
      "Do not manipulate views, completion, replies, follows, engagement, advertiser matching, or payout eligibility.",
      "Do not use bots, fake accounts, coordinated fake activity, spam, scraping, click farms, or deceptive behavior to create artificial attention.",
      "Revenue-share eligibility can be limited, delayed, reversed, or removed when activity appears fraudulent, unsafe, policy-violating, or inauthentic.",
    ],
  },
  {
    title: "Advertiser-Funded Content",
    body: [
      "Creators and users should be honest about brand relationships, paid promotions, gifts, sponsorships, or incentives when disclosure is required by law or platform policy.",
      "Advertisers may not fund content that misleads users, targets people unfairly, promotes unsafe products or services, or violates UBEYE rules.",
      "Brand matching and payout systems may be reviewed for safety, fraud, eligibility, and compliance before funds are released.",
    ],
  },
  {
    title: "Reporting and Blocking",
    body: [
      "Use reporting tools to flag content, accounts, replies, or behavior that may violate these guidelines.",
      "Use blocking or restriction tools when you do not want another user to interact with you.",
      "False, abusive, or coordinated reports may lead to account restrictions.",
    ],
  },
  {
    title: "Moderation",
    body: [
      "UBEYE may remove content, reduce distribution, restrict features, suspend accounts, preserve records, or take other action when needed to protect users, advertisers, creators, the payout system, or the service.",
      "Moderation decisions may consider content, context, user history, legal obligations, safety risk, fraud signals, advertiser requirements, and product integrity.",
      "Serious violations may result in permanent account removal and loss of revenue-share eligibility.",
    ],
  },
  {
    title: "If You Disagree",
    body: [
      "If you believe moderation action was taken by mistake, contact UBEYE support through the support contact listed in the app or on the App Store listing.",
      "Include the account, content, or action you are asking us to review and any relevant context.",
    ],
  },
]

export default function CommunityGuidelinesPage() {
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
            Safety
          </p>
          <h1 className="mt-5 max-w-3xl text-5xl font-semibold leading-[0.98] tracking-[-0.07em] md:text-7xl">
            Community Guidelines
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-black/62 md:text-lg">
            These guidelines explain what is allowed on UBEYE and how we protect
            users, creators, advertisers, and the revenue-share system.
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
            For safety, moderation, or appeal questions, contact UBEYE support
            through the support contact listed in the app or on the App Store
            listing.
          </p>
        </section>
      </main>
      <MarketingFooter />
    </div>
  )
}
