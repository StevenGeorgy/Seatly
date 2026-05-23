import { Link } from "react-router-dom";

import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";

const SUPPORT_EMAIL = "support@cenaiva.com";
const SUPPORT_LAST_UPDATED = "May 23, 2026";

type FaqEntry = {
  question: string;
  answer: React.ReactNode;
};

const FAQ: FaqEntry[] = [
  {
    question: "How do I cancel a reservation?",
    answer: (
      <>
        The fastest path is to find your reservation and cancel it directly.
        If you booked as a guest, use your confirmation code and email on the{" "}
        <Link
          to="/find-reservation"
          className="text-gold underline-offset-4 hover:underline"
        >
          find-reservation page
        </Link>
        . Cancellations are fully refunded per our{" "}
        <Link
          to="/refund-policy"
          className="text-gold underline-offset-4 hover:underline"
        >
          refund policy
        </Link>
        .
      </>
    ),
  },
  {
    question: "Where's my refund?",
    answer: (
      <>
        Refunds typically land on your card within 5–10 business days from
        when they're initiated. Exact timing depends on your card issuer.
        Full details:{" "}
        <Link
          to="/refund-policy"
          className="text-gold underline-offset-4 hover:underline"
        >
          refund policy
        </Link>
        .
      </>
    ),
  },
  {
    question: "How do I modify my reservation?",
    answer: (
      <>
        Open the confirmation email you received when you booked — it contains
        a direct link to modify the time, party size, or pre-order. If the
        link has expired, email us at{" "}
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="text-gold underline-offset-4 hover:underline"
        >
          {SUPPORT_EMAIL}
        </a>{" "}
        and we'll help.
      </>
    ),
  },
  {
    question: "How do I delete my account?",
    answer: (
      <>
        Email{" "}
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="text-gold underline-offset-4 hover:underline"
        >
          {SUPPORT_EMAIL}
        </a>{" "}
        from the address on file. Deletions enter a 30-day grace period during
        which you can recover the account. After that, personal data is
        removed. Payment records are retained for the period required by
        Canadian tax law (CRA), as disclosed in our{" "}
        <Link
          to="/privacy"
          className="text-gold underline-offset-4 hover:underline"
        >
          privacy policy
        </Link>
        .
      </>
    ),
  },
  {
    question: "I'm a restaurant owner — how do I get help?",
    answer: (
      <>
        Same inbox:{" "}
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="text-gold underline-offset-4 hover:underline"
        >
          {SUPPORT_EMAIL}
        </a>
        . For billing, subscription, or payout questions, include your
        restaurant name and the email on the account. Partner terms live on
        the{" "}
        <Link
          to="/partners/agreement"
          className="text-gold underline-offset-4 hover:underline"
        >
          partner agreement page
        </Link>
        .
      </>
    ),
  },
  {
    question: "How does Hey Cenaiva voice work?",
    answer: (
      <>
        Hey Cenaiva is our hands-free voice concierge for finding and booking
        restaurants. It's available for signed-in users on the web and works
        end-to-end without leaving the page. Learn more on the{" "}
        <Link
          to="/hey-cenaiva"
          className="text-gold underline-offset-4 hover:underline"
        >
          Hey Cenaiva page
        </Link>
        .
      </>
    ),
  },
];

export default function SupportPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-3xl px-6 py-12 sm:px-10 md:py-16">
        <header className="mb-10 border-b border-border/40 pb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">
            Support
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Help &amp; Support
          </h1>
          <p className="mt-3 text-sm text-text-muted">
            Last updated {SUPPORT_LAST_UPDATED}
          </p>
          <p className="mt-6 text-sm leading-relaxed text-text-secondary sm:text-base">
            We typically respond within 1 business day. Customer-service hours
            are weekdays, 9am–6pm Eastern Time.
          </p>
        </header>

        <div className="space-y-12">
          <section className="scroll-mt-24">
            <h2 className="text-xl font-semibold text-white sm:text-2xl">
              1. Contact us
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-text-secondary sm:text-base">
              The fastest way to reach us is email. Send your question, and
              if it relates to a specific reservation, include your
              confirmation code.
            </p>
            <div className="mt-5">
              <Button asChild className="rounded-full">
                <a href={`mailto:${SUPPORT_EMAIL}`}>Email {SUPPORT_EMAIL}</a>
              </Button>
            </div>
          </section>

          <section className="scroll-mt-24">
            <h2 className="text-xl font-semibold text-white sm:text-2xl">
              2. Frequently asked questions
            </h2>
            <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-bg-surface/60">
              <ul className="divide-y divide-border/60">
                {FAQ.map((entry) => (
                  <li key={entry.question}>
                    <details className="group px-5 py-4">
                      <summary className="cursor-pointer list-none text-sm font-semibold text-white marker:hidden sm:text-base">
                        <span className="inline-flex w-full items-center justify-between gap-3">
                          {entry.question}
                          <span
                            aria-hidden="true"
                            className="text-gold transition-transform group-open:rotate-45"
                          >
                            +
                          </span>
                        </span>
                      </summary>
                      <div className="mt-3 text-sm leading-relaxed text-text-secondary sm:text-base">
                        {entry.answer}
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="scroll-mt-24">
            <h2 className="text-xl font-semibold text-white sm:text-2xl">
              3. Legal &amp; policies
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-text-secondary sm:text-base">
              The pages below answer most questions about how Cenaiva
              operates, what we charge, and how we handle your data.
            </p>
            <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              <li>
                <Link
                  to="/terms"
                  className="text-gold underline-offset-4 hover:underline"
                >
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link
                  to="/privacy"
                  className="text-gold underline-offset-4 hover:underline"
                >
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link
                  to="/refund-policy"
                  className="text-gold underline-offset-4 hover:underline"
                >
                  Refund Policy
                </Link>
              </li>
              <li>
                <Link
                  to="/legal/sub-processors"
                  className="text-gold underline-offset-4 hover:underline"
                >
                  Sub-processors
                </Link>
              </li>
            </ul>
          </section>
        </div>

        <footer className="mt-16 border-t border-border/40 pt-8 text-sm leading-relaxed text-text-secondary">
          Still need help? Email{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-gold underline-offset-4 hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>{" "}
          and we'll get back to you within 1 business day.
        </footer>
      </div>
    </MarketingShell>
  );
}
