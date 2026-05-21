import { Link } from "react-router-dom";

import { LegalSectionBlock } from "@/components/legal/LegalSection";
import { SubProcessorsTable } from "@/components/legal/SubProcessorsTable";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import {
  PRIVACY_EFFECTIVE_DATE,
  PRIVACY_INTRO,
  PRIVACY_LAST_UPDATED,
  PRIVACY_PLAIN_LANGUAGE_SUMMARY,
  PRIVACY_SECTIONS,
  PRIVACY_VERSION,
} from "@/lib/legal/privacyContent";
import { SUB_PROCESSORS_NOTICE_DAYS } from "@/lib/legal/subProcessors";

export default function PrivacyPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-6xl px-6 py-12 sm:px-10 md:py-16">
        <div className="lg:flex lg:items-start lg:gap-12">
          {/* ── Main content ── */}
          <article className="min-w-0 max-w-3xl flex-1">
            <header className="mb-10 border-b border-border/40 pb-8">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">
                Legal
              </p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Privacy Policy
              </h1>
              <p className="mt-3 text-sm text-text-muted">
                Version {PRIVACY_VERSION} · Effective {PRIVACY_EFFECTIVE_DATE} ·
                Last updated {PRIVACY_LAST_UPDATED}
              </p>
              <div className="mt-6 space-y-4 text-sm leading-relaxed text-text-secondary sm:text-base">
                {PRIVACY_INTRO.split(/\n\n+/).map((para, idx) => (
                  <p key={`intro-${idx}`}>{para}</p>
                ))}
              </div>
            </header>

            {/* ── Plain-language summary callout ── */}
            <section
              id="summary"
              className="mb-12 scroll-mt-24 rounded-lg border border-gold/30 bg-gold/[0.04] p-6"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">
                Plain-language summary
              </p>
              <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-text-secondary marker:text-gold/60 sm:text-base">
                {PRIVACY_PLAIN_LANGUAGE_SUMMARY.map((item, idx) => (
                  <li key={`summary-${idx}`}>{item}</li>
                ))}
              </ul>
            </section>

            <div className="space-y-10">
              {PRIVACY_SECTIONS.map((section) => (
                <LegalSectionBlock key={section.id} section={section} />
              ))}
            </div>

            {/* ── Schedule A — Sub-Processors ── */}
            <section id="schedule-a" className="mt-16 scroll-mt-24">
              <h2 className="text-xl font-semibold text-white sm:text-2xl">
                Schedule A — Sub-Processors
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-text-secondary sm:text-base">
                The following sub-processors may process personal information as
                described in this Policy. Each is bound by contractual
                data-protection obligations no less protective than those in
                this Policy.
              </p>
              <div className="mt-6">
                <SubProcessorsTable />
              </div>
              <p className="mt-6 text-sm leading-relaxed text-text-secondary sm:text-base">
                The most recent sub-processor list is published at{" "}
                <Link
                  to="/legal/sub-processors"
                  className="text-gold underline-offset-4 hover:underline"
                >
                  cenaiva.com/legal/sub-processors
                </Link>
                . We will give at least {SUB_PROCESSORS_NOTICE_DAYS} days'
                notice before adding a sub-processor that processes personal
                information in a materially new way.
              </p>
            </section>

            <footer className="mt-16 border-t border-border/40 pt-8 text-sm text-text-secondary">
              <p>
                This Privacy Policy v{PRIVACY_VERSION} was last reviewed and
                updated on {PRIVACY_LAST_UPDATED}. Privacy questions and rights
                requests:{" "}
                <a
                  href="mailto:privacy@cenaiva.com"
                  className="text-gold underline-offset-4 hover:underline"
                >
                  privacy@cenaiva.com
                </a>
                . See also our{" "}
                <Link
                  to="/terms"
                  className="text-gold underline-offset-4 hover:underline"
                >
                  Terms of Service
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
                <li>
                  <a
                    href="#summary"
                    className="block rounded px-2 py-1 text-text-secondary transition-colors hover:bg-white/5 hover:text-white"
                  >
                    Plain-language summary
                  </a>
                </li>
                {PRIVACY_SECTIONS.map((section) => (
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
