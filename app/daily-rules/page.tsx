import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "The Daily Rules | UBEYE",
  description:
    "Eligibility and rules summary for The Daily sponsored video pool.",
}

const rules = [
  "The Daily is available only in the native UBEYE iOS app at launch.",
  "The Daily is intended for eligible U.S. users who are 18 years of age or older.",
  "Each eligible user may receive no more than one entry per Daily period.",
  "A Daily period runs from 9:00 PM Eastern Time to the following 9:00 PM Eastern Time, with the drawing targeted for 9:10 PM Eastern Time.",
  "A user must complete the required Daily sponsor video sequence to receive an in-app entry unless official production rules provide an alternate entry method.",
  "Five winners are targeted for each Daily drawing when at least five eligible entries exist. Winners split 75% of recognized Daily advertiser funds equally, subject to fraud, identity, payment, tax, and compliance review.",
  "Payouts may be delayed, withheld, reversed, or voided for suspected fraud, ineligible accounts, chargebacks, payment processor issues, tax requirements, or legal compliance.",
  "No purchase is required to use UBEYE. Full production official rules should be reviewed before real-money Daily payouts are launched.",
]

export default function DailyRulesPage() {
  return (
    <main className="min-h-screen bg-[#f7f7f4] px-5 py-10 text-[#18181b]">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="text-2xl font-medium tracking-tight">
          UBEYE
        </Link>
        <section className="mt-10 rounded-[8px] border border-[#e4e4e7] bg-white p-6 shadow-sm">
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-[#71717a]">
            The Daily
          </p>
          <h1 className="mt-3 text-4xl font-[350] tracking-tight">
            Rules summary
          </h1>
          <p className="mt-4 text-sm leading-6 text-[#52525b]">
            This page summarizes the intended launch rules for The Daily. It is
            not a substitute for final legal review or production official
            rules.
          </p>

          <div className="mt-7 grid gap-3">
            {rules.map((rule) => (
              <div key={rule} className="rounded-[8px] bg-[#fafafa] p-4 text-sm leading-6">
                {rule}
              </div>
            ))}
          </div>

          <div className="mt-7 rounded-[8px] border border-[#bfdbfe] bg-[#eff6ff] p-4 text-sm leading-6 text-[#1d4ed8]">
            Apple is not a sponsor of, involved in, or responsible for The
            Daily, entries, winner selection, rewards, payment processing, or
            payouts.
          </div>
        </section>
      </div>
    </main>
  )
}
