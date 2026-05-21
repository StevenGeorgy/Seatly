import { Link } from "react-router-dom";

import { SubProcessorsTable } from "@/components/legal/SubProcessorsTable";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import {
  SUB_PROCESSORS_LAST_REVIEWED,
  SUB_PROCESSORS_NOTICE_DAYS,
} from "@/lib/legal/subProcessors";

export default function SubProcessorsPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-4xl px-6 py-12 sm:px-10 md:py-16">
        <nav className="mb-6 text-xs text-text-muted">
          <Link
            to="/privacy"
            className="text-gold underline-offset-4 hover:underline"
          >
            ← Back to Privacy Policy
          </Link>
        </nav>

        <header className="mb-10 border-b border-border/40 pb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">
            Legal · Schedule A
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Sub-Processors
          </h1>
          <p className="mt-3 text-sm text-text-muted">
            Last reviewed {SUB_PROCESSORS_LAST_REVIEWED}
          </p>
          <p className="mt-6 text-sm leading-relaxed text-text-secondary sm:text-base">
            The following sub-processors may process personal information as
            described in our{" "}
            <Link
              to="/privacy"
              className="text-gold underline-offset-4 hover:underline"
            >
              Privacy Policy
            </Link>
            . Each is bound by contractual data-protection obligations no less
            protective than those in the Policy.
          </p>
        </header>

        <SubProcessorsTable />

        <p className="mt-8 text-sm leading-relaxed text-text-secondary sm:text-base">
          We will give at least {SUB_PROCESSORS_NOTICE_DAYS} days' notice in the
          app or by email before adding a sub-processor that processes personal
          information in a materially new way.
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
