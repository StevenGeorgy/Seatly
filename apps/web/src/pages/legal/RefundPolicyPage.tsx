import { Link } from "react-router-dom";

import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";
import {
  TERMS_EFFECTIVE_DATE,
  TERMS_LAST_UPDATED,
} from "@/lib/legal/termsContent";

type Row = { label: string; value: string; muted?: boolean; emphasis?: boolean };

const EXAMPLE_ROWS: Row[] = [
  { label: "Deposit / order base", value: "$20.00" },
  { label: "Platform fee (2%)", value: "$0.40", muted: true },
  { label: "Processing fee", value: "$0.93", muted: true },
  { label: "Total charged", value: "$21.33", emphasis: true },
  { label: "Refund (if eligible)", value: "$20.00", emphasis: true },
];

export default function RefundPolicyPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-3xl px-6 py-12 sm:px-10 md:py-16">
        <header className="mb-10 border-b border-border/40 pb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">
            Legal
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Refund Policy
          </h1>
          <p className="mt-3 text-sm text-text-muted">
            Effective {TERMS_EFFECTIVE_DATE} &middot; Last updated{" "}
            {TERMS_LAST_UPDATED}
          </p>
          <p className="mt-6 text-sm leading-relaxed text-text-secondary sm:text-base">
            This page explains how Cenaiva handles deposits, fees, and refunds.
            For the full legal text see{" "}
            <Link
              to="/terms#refunds-cancellations"
              className="text-gold underline-offset-4 hover:underline"
            >
              Section 11.3 of the Terms of Service
            </Link>
            .
          </p>
        </header>

        <div className="space-y-12">
          {/* 1. What you pay */}
          <section className="scroll-mt-24">
            <h2 className="text-xl font-semibold text-white sm:text-2xl">
              1. What you pay
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-text-secondary sm:text-base">
              Every checkout breaks down into three line items so you see
              exactly where your money goes before you pay. There are no
              hidden fees added after confirmation.
            </p>
            <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-bg-surface/60">
              <ul className="divide-y divide-border/60 text-sm">
                {EXAMPLE_ROWS.map((row) => (
                  <li
                    key={row.label}
                    className={
                      "flex items-center justify-between px-5 py-3 " +
                      (row.emphasis
                        ? "bg-white/5 font-semibold text-white"
                        : row.muted
                          ? "text-text-muted"
                          : "text-text-secondary")
                    }
                  >
                    <span>{row.label}</span>
                    <span className="font-mono">{row.value}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="mt-3 text-xs text-text-muted">
              Worked example on a $20 deposit. Exact totals scale linearly
              with your base amount.
            </p>
          </section>

          {/* 2. What gets refunded */}
          <section className="scroll-mt-24">
            <h2 className="text-xl font-semibold text-white sm:text-2xl">
              2. What gets refunded
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-text-secondary sm:text-base">
              The deposit (or order base) is fully refundable when the
              restaurant marks you seated, when you cancel under the
              restaurant's policy, or when the restaurant cancels on you.
              Platform and processing fees are non-refundable — both are
              disclosed before you pay, in exchange for full transparency on
              the deposit side.
            </p>
          </section>

          {/* 3. When you get refunded */}
          <section className="scroll-mt-24">
            <h2 className="text-xl font-semibold text-white sm:text-2xl">
              3. When you get refunded
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-success/30 bg-success/5 p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-success">
                  Full refund of base
                </p>
                <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-text-secondary marker:text-success/60">
                  <li>The restaurant marks you seated on arrival</li>
                  <li>You cancel within the restaurant's refund window</li>
                  <li>
                    A staff member undoes a "Mark Arrived" within the grace
                    window
                  </li>
                  <li>
                    Our auto-cron releases the deposit after the grace window
                    elapses without a no-show flag
                  </li>
                </ul>
              </div>
              <div className="rounded-2xl border border-danger/30 bg-danger/5 p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-danger">
                  Deposit forfeited
                </p>
                <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-text-secondary marker:text-danger/60">
                  <li>
                    No-show — the restaurant flags you as a no-show and the
                    grace window has elapsed
                  </li>
                </ul>
                <p className="mt-3 text-xs text-text-muted">
                  Reach out to the restaurant directly if you believe a
                  no-show flag was applied in error.
                </p>
              </div>
            </div>
          </section>

          {/* 4. Timing */}
          <section className="scroll-mt-24">
            <h2 className="text-xl font-semibold text-white sm:text-2xl">
              4. Timing
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-text-secondary sm:text-base">
              Refunds typically land on your card within 5–10 business days
              from when the refund is initiated. The exact timing depends on
              your card issuer.
            </p>
          </section>

          {/* 5. How to request a refund */}
          <section className="scroll-mt-24">
            <h2 className="text-xl font-semibold text-white sm:text-2xl">
              5. How to request a refund
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-text-secondary sm:text-base">
              The fastest path is to find your reservation and cancel it
              directly. If you booked as a guest (without an account), use
              your confirmation code and email on the find-reservation page.
            </p>
            <div className="mt-5">
              <Button asChild className="rounded-full">
                <Link to="/find-reservation">Find my reservation</Link>
              </Button>
            </div>
          </section>

          {/* 6. Disputes */}
          <section className="scroll-mt-24">
            <h2 className="text-xl font-semibold text-white sm:text-2xl">
              6. Disputes
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-text-secondary sm:text-base">
              If something looks wrong on your statement, contact{" "}
              <a
                href="mailto:help@cenaiva.com"
                className="text-gold underline-offset-4 hover:underline"
              >
                help@cenaiva.com
              </a>{" "}
              within 5 business days of the charge. We investigate per{" "}
              <Link
                to="/terms#refunds-cancellations"
                className="text-gold underline-offset-4 hover:underline"
              >
                Terms §11.3
              </Link>{" "}
              and aim to resolve duplicate charges or verified failed
              transactions within 5 business days. Please contact us before
              initiating a chargeback — see{" "}
              <Link
                to="/terms#chargebacks"
                className="text-gold underline-offset-4 hover:underline"
              >
                Terms §11.6
              </Link>
              .
            </p>
          </section>
        </div>
      </div>
    </MarketingShell>
  );
}
