import { Link } from "react-router-dom";

import { LegalSectionBlock } from "@/components/legal/LegalSection";
import { SubProcessorsTable } from "@/components/legal/SubProcessorsTable";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import {
  PARTNER_AGREEMENT_EFFECTIVE_DATE,
  PARTNER_AGREEMENT_INTRO,
  PARTNER_AGREEMENT_LAST_UPDATED,
  PARTNER_AGREEMENT_SECTIONS,
  PARTNER_AGREEMENT_VERSION,
} from "@/lib/legal/partnerAgreementContent";
import { SUB_PROCESSORS_NOTICE_DAYS } from "@/lib/legal/subProcessors";

export default function PartnerAgreementPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-6xl px-6 py-12 sm:px-10 md:py-16">
        <div className="lg:flex lg:items-start lg:gap-12">
          {/* ── Main content ── */}
          <article className="min-w-0 max-w-3xl flex-1">
            <header className="mb-10 border-b border-border/40 pb-8">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">
                Legal · For Restaurant Partners
              </p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Restaurant Partner Agreement
              </h1>
              <p className="mt-3 text-sm text-text-muted">
                Version {PARTNER_AGREEMENT_VERSION} · Effective{" "}
                {PARTNER_AGREEMENT_EFFECTIVE_DATE} · Last updated{" "}
                {PARTNER_AGREEMENT_LAST_UPDATED}
              </p>
              <div className="mt-6 space-y-4 text-sm leading-relaxed text-text-secondary sm:text-base">
                {PARTNER_AGREEMENT_INTRO.split(/\n\n+/).map((para, idx) => (
                  <p key={`intro-${idx}`}>{para}</p>
                ))}
              </div>
            </header>

            <div className="space-y-10">
              {PARTNER_AGREEMENT_SECTIONS.map((section) => (
                <LegalSectionBlock key={section.id} section={section} />
              ))}
            </div>

            {/* ── Schedule A — Sub-Processors ── */}
            <section id="schedule-a" className="mt-16 scroll-mt-24">
              <h2 className="text-xl font-semibold text-white sm:text-2xl">
                Schedule A — Sub-Processors
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-text-secondary sm:text-base">
                Cenaiva engages the following Sub-Processors to deliver the
                Platform. Each Sub-Processor is bound by contractual
                data-protection obligations that are no less protective than
                those in this Agreement. Locations listed are the primary
                processing regions; some providers may operate global
                infrastructure.
              </p>
              <div className="mt-6">
                <SubProcessorsTable />
              </div>
              <p className="mt-6 text-sm leading-relaxed text-text-secondary sm:text-base">
                The most recent Sub-Processor list is also published at{" "}
                <Link
                  to="/partners/sub-processors"
                  className="text-gold underline-offset-4 hover:underline"
                >
                  cenaiva.com/partners/sub-processors
                </Link>{" "}
                and updated as changes are made under Section 10.5. Cenaiva
                will give at least {SUB_PROCESSORS_NOTICE_DAYS} days' notice
                before adding or replacing a Sub-Processor that processes
                personal information in a materially new way.
              </p>
            </section>

            <footer className="mt-16 border-t border-border/40 pt-8 text-sm text-text-secondary">
              <p>
                Questions? Contact{" "}
                <a
                  href="mailto:legal@cenaiva.com"
                  className="text-gold underline-offset-4 hover:underline"
                >
                  legal@cenaiva.com
                </a>
                . Prior versions of this Agreement are available at{" "}
                <Link
                  to="/partners/agreement-history"
                  className="text-gold underline-offset-4 hover:underline"
                >
                  cenaiva.com/partners/agreement-history
                </Link>
                . Diner-facing documents:{" "}
                <Link
                  to="/terms"
                  className="text-gold underline-offset-4 hover:underline"
                >
                  Terms of Service
                </Link>{" "}
                ·{" "}
                <Link
                  to="/privacy"
                  className="text-gold underline-offset-4 hover:underline"
                >
                  Privacy Policy
                </Link>
                .
              </p>
            </footer>
          </article>

          {/* ── Sticky ToC (lg+) ── */}
          <aside className="mt-12 hidden lg:sticky lg:top-28 lg:mt-0 lg:block lg:w-72 lg:shrink-0 lg:self-start">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">
              On this page
            </p>
            <nav
              aria-label="Table of contents"
              className="mt-4 max-h-[70vh] overflow-y-auto pr-2"
            >
              <ul className="space-y-1.5 text-xs">
                {PARTNER_AGREEMENT_SECTIONS.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="block rounded px-2 py-1 text-text-secondary transition-colors hover:bg-white/5 hover:text-white"
                    >
                      {section.number}. {section.title}
                    </a>
                  </li>
                ))}
                <li>
                  <a
                    href="#schedule-a"
                    className="block rounded px-2 py-1 text-text-secondary transition-colors hover:bg-white/5 hover:text-white"
                  >
                    Schedule A — Sub-Processors
                  </a>
                </li>
              </ul>
            </nav>
          </aside>
        </div>
      </div>
    </MarketingShell>
  );
}
