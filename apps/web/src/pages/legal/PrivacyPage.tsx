import { Link } from "react-router-dom";

import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";
import {
  TERMS_EFFECTIVE_DATE,
  TERMS_LAST_UPDATED,
} from "@/lib/legal/termsContent";

export default function PrivacyPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-3xl px-6 py-12 sm:px-10 md:py-16">
        <header className="mb-10 border-b border-border/40 pb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">
            Legal
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Privacy Policy
          </h1>
          <p className="mt-3 text-sm text-text-muted">
            Effective {TERMS_EFFECTIVE_DATE} &middot; Last updated{" "}
            {TERMS_LAST_UPDATED}
          </p>
        </header>

        <div className="space-y-6 text-sm leading-relaxed text-text-secondary sm:text-base">
          <p>
            Cenaiva's full Privacy Policy is currently maintained at{" "}
            <a
              href="https://cenaiva.com/privacy"
              className="text-gold underline-offset-4 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              cenaiva.com/privacy
            </a>{" "}
            and is incorporated by reference into our Terms of Service
            (Section 24).
          </p>
          <p>
            We are working to surface the full text on this site. In the
            meantime, the canonical version is available at the link above. If
            you have any privacy-related questions or want to exercise your
            data rights (access, correction, deletion, portability), please
            contact{" "}
            <a
              href="mailto:privacy@cenaiva.com"
              className="text-gold underline-offset-4 hover:underline"
            >
              privacy@cenaiva.com
            </a>
            .
          </p>
          <p>
            For details about how Cenaiva handles your data, see also{" "}
            <Link
              to="/terms#cross-border-data"
              className="text-gold underline-offset-4 hover:underline"
            >
              Section 18 (Cross-Border Data Transfers)
            </Link>
            ,{" "}
            <Link
              to="/terms#data-rights"
              className="text-gold underline-offset-4 hover:underline"
            >
              Section 19 (Your Data Rights)
            </Link>
            , and{" "}
            <Link
              to="/terms#third-party-services"
              className="text-gold underline-offset-4 hover:underline"
            >
              Section 20 (Third-Party Services)
            </Link>{" "}
            of the Terms of Service.
          </p>
        </div>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Button asChild className="rounded-full">
            <Link to="/terms">Read Terms of Service</Link>
          </Button>
          <Button asChild variant="outline" className="rounded-full">
            <a href="mailto:privacy@cenaiva.com">Contact Privacy Team</a>
          </Button>
        </div>
      </div>
    </MarketingShell>
  );
}
