import { Link } from "react-router-dom";

import { LegalSectionBlock } from "@/components/legal/LegalSection";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import {
  TERMS_EFFECTIVE_DATE,
  TERMS_INTRO,
  TERMS_LAST_UPDATED,
  TERMS_SECTIONS,
} from "@/lib/legal/termsContent";

export default function TermsPage() {
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
                Terms of Service
              </h1>
              <p className="mt-3 text-sm text-text-muted">
                Effective {TERMS_EFFECTIVE_DATE} &middot; Last updated{" "}
                {TERMS_LAST_UPDATED}
              </p>
              <p className="mt-6 text-sm leading-relaxed text-text-secondary sm:text-base">
                {TERMS_INTRO}
              </p>
            </header>

            <div className="space-y-10">
              {TERMS_SECTIONS.map((section) => (
                <LegalSectionBlock key={section.id} section={section} />
              ))}
            </div>

            <footer className="mt-16 border-t border-border/40 pt-8 text-sm text-text-secondary">
              <p>
                Questions? Contact{" "}
                <a
                  href="mailto:legal@cenaiva.com"
                  className="text-gold underline-offset-4 hover:underline"
                >
                  legal@cenaiva.com
                </a>
                . For privacy-specific inquiries, see our{" "}
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
                {TERMS_SECTIONS.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="block rounded px-2 py-1 text-text-secondary transition-colors hover:bg-white/5 hover:text-white"
                    >
                      {section.number}. {section.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>
        </div>
      </div>
    </MarketingShell>
  );
}
