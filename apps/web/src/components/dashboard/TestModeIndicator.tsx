// TestModeIndicator — small persistent banner mounted in the dashboard
// shell that surfaces when the build is talking to Stripe TEST mode.
// Lets owners see at a glance that no real money is moving — important
// during onboarding test runs and pre-launch QA.
//
// Detection: the Stripe publishable key prefix. `pk_test_…` always means
// test-mode (live keys are `pk_live_…`). When the env var is missing,
// we treat it as "not configured" and show nothing — the customer-facing
// surfaces already handle that case loudly.
//
// Style: bottom-of-viewport, dismissible, info-tone blue. Dismissal is
// session-scoped (sessionStorage) so the banner returns on refresh —
// owners shouldn't be able to permanently hide a real production safety
// signal.

import { useEffect, useState } from "react";
import { Info, X } from "lucide-react";

const DISMISS_KEY = "cenaiva.testModeBanner.dismissed";

function isTestModeKey(key: string | undefined | null): boolean {
  return Boolean(key && key.startsWith("pk_test_"));
}

export function TestModeIndicator() {
  const publishable = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as
    | string
    | undefined;
  const isTestMode = isTestModeKey(publishable);

  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!dismissed) return;
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore — session storage may be unavailable (e.g. private browsing)
    }
  }, [dismissed]);

  if (!isTestMode || dismissed) return null;

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4"
    >
      <div className="pointer-events-auto flex max-w-2xl items-center gap-2 rounded-full border border-blue-400/40 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-200 shadow-lg backdrop-blur">
        <Info className="size-3.5 shrink-0" aria-hidden />
        <span className="leading-snug">
          Stripe <span className="font-semibold">TEST</span> mode — no real
          money is moving. Configure live keys before launch.
        </span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="ml-1 rounded-full p-0.5 text-blue-200/70 transition hover:bg-white/10 hover:text-white"
          aria-label="Dismiss test-mode banner"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
