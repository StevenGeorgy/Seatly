// Optional referral-code field surfaced on Step 8 of the onboarding
// wizard. Collapsed by default to keep the page calm — owners who
// don't have a code never see it.
//
// On change we debounce 300ms and POST the code to the anon-callable
// `validate-referral-code` edge fn. A valid match shows the
// referrer's restaurant name; an invalid one shows "Code not found"
// without leaking the difference between "bad format" and "no such
// row" (the edge fn deliberately returns the same shape for both).
//
// The resolved referrer restaurant id is bubbled up via
// `onReferrerResolved`, and we additionally surface the original code
// text via `onReferralCodeChanged` so the parent can forward it to
// the `save-subscription-payment-method` edge fn. `restaurants.
// referred_by_restaurant_id` is immutable after first set, so emit
// once and move on — server-side logic owns the actual write.

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getSupabaseAnonKey,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

type ValidationState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "valid"; referrer_name: string; referrer_restaurant_id: string }
  | { kind: "invalid" };

interface ReferralCodeFieldProps {
  onReferrerResolved: (referrerId: string | null) => void;
  onReferralCodeChanged?: (code: string | null) => void;
}

const DEBOUNCE_MS = 300;

export function ReferralCodeField({
  onReferrerResolved,
  onReferralCodeChanged,
}: ReferralCodeFieldProps) {
  const [expanded, setExpanded] = useState(false);
  const [code, setCode] = useState("");
  const [state, setState] = useState<ValidationState>({ kind: "idle" });
  const requestSeqRef = useRef(0);

  const validate = useCallback(
    async (rawCode: string) => {
      const normalized = rawCode.trim();
      if (!normalized) {
        setState({ kind: "idle" });
        onReferrerResolved(null);
        onReferralCodeChanged?.(null);
        return;
      }
      if (!isSupabaseConfigured()) {
        setState({ kind: "invalid" });
        return;
      }
      const mySeq = ++requestSeqRef.current;
      setState({ kind: "checking" });
      try {
        const res = await fetch(
          `${getSupabaseProjectUrl()}/functions/v1/validate-referral-code`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: getSupabaseAnonKey(),
              Authorization: `Bearer ${getSupabaseAnonKey()}`,
            },
            body: JSON.stringify({ code: normalized }),
          },
        );
        if (mySeq !== requestSeqRef.current) return; // superseded
        const data = (await res.json().catch(() => null)) as
          | {
              valid: boolean;
              referrer_name?: string;
              referrer_restaurant_id?: string;
            }
          | null;
        if (!res.ok || !data || !data.valid) {
          setState({ kind: "invalid" });
          onReferrerResolved(null);
          onReferralCodeChanged?.(null);
          return;
        }
        setState({
          kind: "valid",
          referrer_name: data.referrer_name ?? "Another Cenaiva restaurant",
          referrer_restaurant_id: data.referrer_restaurant_id ?? "",
        });
        onReferrerResolved(data.referrer_restaurant_id ?? null);
        onReferralCodeChanged?.(normalized);
      } catch (err) {
        if (mySeq !== requestSeqRef.current) return;
        console.error("[ReferralCodeField] validate failed", err);
        setState({ kind: "invalid" });
        onReferrerResolved(null);
        onReferralCodeChanged?.(null);
      }
    },
    [onReferrerResolved, onReferralCodeChanged],
  );

  // Debounce input → validate.
  useEffect(() => {
    if (!expanded) return;
    const handle = setTimeout(() => {
      void validate(code);
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [code, expanded, validate]);

  if (!expanded) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setExpanded(true)}
        className="w-fit gap-1.5 text-text-muted hover:text-white"
      >
        <ChevronDown className="size-3.5" />
        Have a referral code?
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-text-secondary" htmlFor="referral-code">
          Referral code
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setExpanded(false);
            setCode("");
            setState({ kind: "idle" });
            onReferrerResolved(null);
            onReferralCodeChanged?.(null);
          }}
          className="h-auto gap-1 px-1 py-0.5 text-xs text-text-muted hover:text-white"
        >
          <ChevronUp className="size-3" />
          Hide
        </Button>
      </div>
      <div className="relative">
        <Input
          id="referral-code"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="e.g. CENAIVA-FOO123"
          className="pr-9 uppercase"
        />
        <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
          {state.kind === "checking" ? (
            <Loader2 className="size-4 animate-spin text-text-muted" />
          ) : state.kind === "valid" ? (
            <CheckCircle2 className="size-4 text-emerald-400" />
          ) : null}
        </div>
      </div>
      {state.kind === "valid" ? (
        <p className="text-xs text-emerald-400">
          ✓ Referral from {state.referrer_name}
        </p>
      ) : state.kind === "invalid" && code.trim().length > 0 ? (
        <p className="text-xs text-warning">Code not found</p>
      ) : (
        <p className="text-xs text-text-muted">
          Your referrer gets credit when you publish.
        </p>
      )}
    </div>
  );
}
