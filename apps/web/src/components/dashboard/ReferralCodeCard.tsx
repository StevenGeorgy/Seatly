// ReferralCodeCard — surfaces the restaurant's referral_code + a credit
// history table (referral_credits) for the owner. Mounted on SettingsPage
// in the Billing section.
//
// Behavior:
//   - If `referralCode` is null (restaurant not yet published), shows a
//     muted "Your referral code will appear here once you publish." stub.
//   - Otherwise: prominent code display + copy-to-clipboard button +
//     credit history table.
//
// Credit history queries `referral_credits` (RLS-restricted to owners of
// the beneficiary OR referrer restaurant; see migration
// 20260520000400_referrals.sql). We filter to rows where either side
// matches the current restaurant.

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Gift } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { toUserFacingError } from "@/lib/errors";

const PLAN_REFERRAL_AMOUNT_LABEL = "$199.99 CAD";

type ReferralCreditRow = {
  id: string;
  beneficiary_restaurant_id: string;
  referrer_restaurant_id: string;
  triggered_by_restaurant_id: string;
  amount_cents: number;
  currency: string;
  status: "pending" | "applied" | "failed";
  failure_reason: string | null;
  created_at: string;
  applied_at: string | null;
};

type ReferralCodeCardProps = {
  restaurantId: string;
  referralCode: string | null;
};

function formatAmount(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function statusToneClass(status: ReferralCreditRow["status"]): string {
  if (status === "applied") return "text-success";
  if (status === "pending") return "text-amber-300";
  return "text-destructive";
}

export function ReferralCodeCard({ restaurantId, referralCode }: ReferralCodeCardProps) {
  const [credits, setCredits] = useState<ReferralCreditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const client = getSupabaseBrowserClient();
        const { data, error } = await client
          .from("referral_credits")
          .select(
            "id, beneficiary_restaurant_id, referrer_restaurant_id, triggered_by_restaurant_id, amount_cents, currency, status, failure_reason, created_at, applied_at",
          )
          .or(
            `beneficiary_restaurant_id.eq.${restaurantId},referrer_restaurant_id.eq.${restaurantId}`,
          )
          .order("created_at", { ascending: false })
          .limit(50);
        if (cancelled) return;
        if (error) {
          const friendly = toUserFacingError(error, "Couldn't load referral credits.");
          console.error("[ReferralCodeCard.fetch]", friendly.code, friendly.technical ?? error);
          setCredits([]);
          setLoading(false);
          return;
        }
        setCredits((data ?? []) as ReferralCreditRow[]);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        const friendly = toUserFacingError(e, "Couldn't load referral credits.");
        console.error("[ReferralCodeCard.catch]", friendly.code, friendly.technical ?? e);
        setCredits([]);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  const handleCopy = useCallback(async () => {
    if (!referralCode) return;
    try {
      await navigator.clipboard.writeText(referralCode);
      setCopied(true);
      toast.success("Referral code copied.");
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast.error("Couldn't copy to clipboard.");
      console.error("[ReferralCodeCard.copy]", err);
    }
  }, [referralCode]);

  return (
    <div className="rounded-2xl border border-border bg-bg-surface">
      <div className="flex items-start gap-3 border-b border-border/60 px-6 py-5 sm:px-7">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-gold/10">
          <Gift className="size-4 text-gold" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-xl text-white">Refer another restaurant</h3>
          <p className="mt-1 text-sm text-text-muted">
            Share this code with other restaurants. When they go live, you{" "}
            <span className="font-semibold text-white">BOTH</span> get{" "}
            {PLAN_REFERRAL_AMOUNT_LABEL} off your next bill (1 free month).
          </p>
        </div>
      </div>

      <div className="px-6 py-5 sm:px-7">
        {referralCode ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/60 bg-bg-base/60 p-4">
            <span className="font-mono text-2xl tracking-[0.18em] text-gold">
              {referralCode}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => void handleCopy()}
            >
              {copied ? (
                <Check className="mr-1.5 size-3.5 text-success" />
              ) : (
                <Copy className="mr-1.5 size-3.5" />
              )}
              {copied ? "Copied" : "Copy code"}
            </Button>
          </div>
        ) : (
          <div className="rounded-2xl border border-border/60 bg-bg-base/60 p-4 text-sm text-text-muted">
            Your referral code will appear here once you publish.
          </div>
        )}
      </div>

      {referralCode ? (
        <div className="border-t border-border/60">
          <div className="flex items-center justify-between px-6 py-4 sm:px-7">
            <h4 className="text-sm font-semibold text-text-primary">Credit history</h4>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
              {credits.length} {credits.length === 1 ? "credit" : "credits"}
            </span>
          </div>
          {loading ? (
            <div className="px-6 py-5 text-sm text-text-muted sm:px-7">Loading…</div>
          ) : credits.length === 0 ? (
            <div className="px-6 py-5 text-sm text-text-muted sm:px-7">
              No referral credits yet. Share your code to earn your first one.
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {credits.map((credit) => {
                const youAreBeneficiary =
                  credit.beneficiary_restaurant_id === restaurantId;
                const role = youAreBeneficiary ? "You earned" : "You shared";
                const counterparty = youAreBeneficiary ? "referrer" : "beneficiary";
                return (
                  <div
                    key={credit.id}
                    className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-4 px-6 py-3 text-sm sm:px-7"
                  >
                    <span className="font-mono text-text-muted">
                      {formatDate(credit.created_at)}
                    </span>
                    <span className="text-text-secondary">
                      <span className="font-semibold text-text-primary">{role}</span>{" "}
                      <span className="text-text-muted">· via {counterparty}</span>
                    </span>
                    <span className="text-text-primary">
                      {formatAmount(credit.amount_cents, credit.currency)}
                    </span>
                    <span
                      className={`justify-self-end text-xs ${statusToneClass(
                        credit.status,
                      )}`}
                    >
                      {credit.status.charAt(0).toUpperCase() + credit.status.slice(1)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
