import { Link } from "react-router-dom";

import { SubProcessorsTable } from "@/components/legal/SubProcessorsTable";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import {
  SUB_PROCESSORS_LAST_REVIEWED,
  SUB_PROCESSORS_NOTICE_DAYS,
} from "@/lib/legal/subProcessors";

export default function PartnerSubProcessorsPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-4xl px-6 py-12 sm:px-10 md:py-16">
        <nav className="mb-6 text-xs text-text-muted">
          <Link
            to="/partners/agreement"
            className="text-gold underline-offset-4 hover:underline"
          >
            ← Back to Restaurant Partner Agreement
          </Link>
        </nav>

        <header className="mb-10 border-b border-border/40 pb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">
            Legal · Schedule A
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Sub-Processors — Restaurant Partners
          </h1>
          <p className="mt-3 text-sm text-text-muted">
            Last reviewed {SUB_PROCESSORS_LAST_REVIEWED}
          </p>
          <p className="mt-6 text-sm leading-relaxed text-text-secondary sm:text-base">
            Cenaiva engages the following Sub-Processors to deliver the Platform
            described in the{" "}
            <Link
              to="/partners/agreement"
              className="text-gold underline-offset-4 hover:underline"
            >
              Restaurant Partner Agreement
            </Link>
            . Each Sub-Processor is bound by contractual data-protection
            obligations that are no less protective than those in the
            Agreement. Locations listed are the primary processing regions;
            some providers may operate global infrastructure.
          </p>
        </header>

        <SubProcessorsTable />

        <p className="mt-8 text-sm leading-relaxed text-text-secondary sm:text-base">
          Under Section 10.5 of the Restaurant Partner Agreement, Cenaiva will
          give at least {SUB_PROCESSORS_NOTICE_DAYS} days' notice (by email or
          in the Partner Dashboard) before adding or replacing a Sub-Processor
          that processes personal information in a materially new way. Partners
          may object in writing within {SUB_PROCESSORS_NOTICE_DAYS} days; if the
          objection cannot be resolved, the partner may terminate the Agreement
          and receive a pro-rata refund of prepaid Subscription Fees as their
          sole remedy.
        </p>

        <footer className="mt-16 border-t border-border/40 pt-8 text-sm text-text-secondary">
          <p>
            Questions about how we share data? Contact{" "}
            <a
              href="mailto:privacy@cenaiva.com"
              className="text-gold underline-offset-4 hover:underline"
            >
              privacy@cenaiva.com
            </a>
            .
          </p>
        </footer>
      </div>
    </MarketingShell>
  );
}
