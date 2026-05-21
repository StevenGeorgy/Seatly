import { Link } from "react-router-dom";

import { MarketingShell } from "@/components/marketing/MarketingShell";
import {
  PARTNER_AGREEMENT_HISTORY,
  PARTNER_AGREEMENT_VERSION,
} from "@/lib/legal/partnerAgreementContent";

export default function PartnerAgreementHistoryPage() {
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
            Legal · For Restaurant Partners
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Restaurant Partner Agreement — Version History
          </h1>
          <p className="mt-6 text-sm leading-relaxed text-text-secondary sm:text-base">
            This page lists each published version of the Restaurant Partner
            Agreement. The current version is v{PARTNER_AGREEMENT_VERSION}.
            Earlier versions, where applicable, are available on request from{" "}
            <a
              href="mailto:legal@cenaiva.com"
              className="text-gold underline-offset-4 hover:underline"
            >
              legal@cenaiva.com
            </a>
            .
          </p>
        </header>

        <div className="overflow-x-auto rounded-lg border border-border/40">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-border/40 bg-white/[0.03] text-xs uppercase tracking-wider text-text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Version</th>
                <th className="px-4 py-3 font-semibold">Effective Date</th>
                <th className="px-4 py-3 font-semibold">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30 text-text-secondary">
              {PARTNER_AGREEMENT_HISTORY.map((entry) => (
                <tr key={entry.version} className="align-top">
                  <td className="px-4 py-3 font-medium text-white">
                    {entry.version}
                    {entry.version === PARTNER_AGREEMENT_VERSION && (
                      <span className="ml-2 rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold">
                        Current
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {entry.effectiveDate}
                  </td>
                  <td className="px-4 py-3">{entry.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="mt-16 border-t border-border/40 pt-8 text-sm text-text-secondary">
          <p>
            Need a copy of a prior version not listed here? Email{" "}
            <a
              href="mailto:legal@cenaiva.com"
              className="text-gold underline-offset-4 hover:underline"
            >
              legal@cenaiva.com
            </a>{" "}
            with your restaurant name and the version you need.
          </p>
        </footer>
      </div>
    </MarketingShell>
  );
}
