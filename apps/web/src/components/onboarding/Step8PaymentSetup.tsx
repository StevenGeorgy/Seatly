// Step 8 — Payment setup. Phase D wire-up of:
//   A. Stripe Connect Embedded onboarding (KYC) — restaurants accept
//      deposits/orders.
//   B. Subscription card collection ($199.99 CAD/month, 90-day free
//      trial) — collected here as a card-on-file. The trial does NOT
//      start when the card is saved; it starts when the owner clicks
//      "Publish my restaurant" and confirms in the modal.
//
// 2026-05-20 lifecycle rework: card-save and trial-start are now
// decoupled. Three render states for the subscription card section
// (driven by `payment_method_attached_at` + `subscription_status`):
//   State A — no card on file, no sub → mount <SubscriptionCard>.
//   State B — card on file, no sub → "Card on file" notice with a
//             "Use a different card" toggle that mounts
//             <ChangeSubscriptionCard>.
//   State C — sub active → existing "Trial active · Free until …"
//             notice with the "Change card" toggle.
//
// Publish flow: the big "Publish my restaurant" button opens a
// shadcn Dialog confirming the trial-start. "Yes, publish" calls the
// `publish-restaurant` edge fn (which creates the Stripe subscription
// + flips `is_published=true` atomically).

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CreditCard, Loader2, Rocket } from "lucide-react";
import { toast } from "sonner";

import {
  loadConnectAndInitialize,
  type StripeConnectInstance,
} from "@stripe/connect-js";
import {
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
} from "@stripe/react-connect-js";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { RestaurantDepositTier } from "@/hooks/useStaffRestaurants";
import { stripePromise, isStripeConfigured } from "@/lib/stripe";
import { CENAIVA_CONNECT_APPEARANCE } from "@/lib/stripe/connectAppearance";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import {
  toUserFacingEdgeError,
  toUserFacingError,
} from "@/lib/errors";

import {
  PUBLISH_CONFIRM_DISCLOSURE,
} from "@/components/billing/disclosures";
import { SubscriptionCard } from "@/components/billing/SubscriptionCard";
import { ChangeSubscriptionCard } from "@/components/billing/ChangeSubscriptionCard";
import { CardOnFileBadge } from "@/components/billing/CardOnFileBadge";
import { StripeConnectVerifyPanel } from "@/components/billing/StripeConnectVerifyPanel";

type Step8PaymentSetupProps = {
  restaurantId: string;
  onPublished: () => void;
  onBusyChange: (busy: boolean) => void;
};

type SummaryRow = {
  cover_photo_url: string | null;
  name: string | null;
  city: string | null;
  price_range: number | null;
  deposit_tiers: RestaurantDepositTier[] | null;
  hours_json: Record<string, unknown> | null;
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean | null;
  stripe_payouts_enabled: boolean | null;
  stripe_details_submitted: boolean | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
  payment_method_attached_at: string | null;
  is_published: boolean | null;
};

type ShiftRow = { name: string | null; turn_time_minutes: number | null };
type TableRow = { capacity: number | null };
type TierItem = { category_name: string | null; count: number };

const SUBSCRIPTION_OK_STATUSES = new Set(["trialing", "active"]);

const RESTAURANT_SELECT_COLUMNS =
  "cover_photo_url, name, city, price_range, deposit_tiers, hours_json, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, subscription_status, trial_ends_at, payment_method_attached_at, is_published";

function priceLabel(level: number | null): string {
  if (level === 1) return "$";
  if (level === 2) return "$$";
  if (level === 3) return "$$$";
  return "—";
}

function depositSummary(tiers: RestaurantDepositTier[] | null): string {
  if (!tiers || tiers.length === 0) return "No deposits";
  if (tiers.length === 1) {
    const t = tiers[0];
    return `${tiers.length} tier — ${t.min_party_size}+ at $${(t.amount_per_person_cents / 100).toFixed(0)}/person`;
  }
  return `${tiers.length} tiers`;
}

function hoursSummary(hours: Record<string, unknown> | null): string {
  if (!hours) return "Not set";
  const days = Object.values(hours).filter((v) => v !== null).length;
  if (days === 0) return "No open days";
  return `${days} open day${days === 1 ? "" : "s"}/week`;
}

function formatTrialEnd(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

async function invokeEdgeFunction<TResult>(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: TResult } | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase is not configured." };
  }
  const client = getSupabaseBrowserClient();
  const { data: sessionData } = await client.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { ok: false, error: "You need to be signed in." };

  const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: getSupabaseAnonKey(),
    },
    body: JSON.stringify(body),
  });
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const friendly = toUserFacingEdgeError(
      res,
      parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null,
    );
    console.error(`[Step8PaymentSetup.invokeEdgeFunction:${path}]`, friendly.code, friendly.technical);
    return { ok: false, error: friendly.message };
  }
  return { ok: true, data: parsed as TResult };
}

// ─────────────────────────────────────────────────────────────────────────────
// Section A — Connect Embedded KYC
// ─────────────────────────────────────────────────────────────────────────────

function StripeConnectEmbeddedKYC({
  restaurantId,
  publishableKey,
  onExit,
}: {
  restaurantId: string;
  publishableKey: string;
  onExit: () => void;
}) {
  const [connectInstance, setConnectInstance] = useState<StripeConnectInstance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    const fetchClientSecret = async (): Promise<string> => {
      const accountRes = await invokeEdgeFunction<{ account_id: string }>(
        "create-stripe-account",
        { restaurant_id: restaurantId },
      );
      if (!accountRes.ok) throw new Error(accountRes.error);
      const sessionRes = await invokeEdgeFunction<{ client_secret: string }>(
        "create-account-session",
        { restaurant_id: restaurantId },
      );
      if (!sessionRes.ok) throw new Error(sessionRes.error);
      if (!sessionRes.data?.client_secret) {
        throw new Error("Stripe didn't return a client secret. Try again.");
      }
      return sessionRes.data.client_secret;
    };

    void (async () => {
      try {
        const instance = loadConnectAndInitialize({
          publishableKey,
          fetchClientSecret,
          appearance: CENAIVA_CONNECT_APPEARANCE,
        });
        if (cancelled) return;
        setConnectInstance(instance);
      } catch (err) {
        if (cancelled) return;
        const friendly = toUserFacingError(err, "Couldn't initialize Stripe.");
        setError(friendly.message);
        console.error("[Step8PaymentSetup.kyc.init]", friendly.code, friendly.technical ?? err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publishableKey, restaurantId]);

  if (error) {
    return (
      <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm text-text-secondary">
        <p className="font-semibold text-warning">Couldn't load Stripe.</p>
        <p className="mt-1">{error}</p>
      </div>
    );
  }
  if (!connectInstance) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-bg-surface p-6 text-sm text-text-muted">
        <Loader2 className="size-4 animate-spin" /> Loading Stripe onboarding…
      </div>
    );
  }

  return (
    <ConnectComponentsProvider connectInstance={connectInstance}>
      <ConnectAccountOnboarding onExit={onExit} />
    </ConnectComponentsProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Step 8 component
// ─────────────────────────────────────────────────────────────────────────────

export function Step8PaymentSetup({
  restaurantId,
  onPublished,
  onBusyChange,
}: Step8PaymentSetupProps) {
  const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
  const [summary, setSummary] = useState<SummaryRow | null>(null);
  const [shift, setShift] = useState<ShiftRow | null>(null);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [tierItems, setTierItems] = useState<TierItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  // Toggles between the "Trial active" / "Card on file" badge and
  // the in-page Change-card form (see ChangeSubscriptionCard). Owners
  // stay on cenaiva.com instead of being bounced to billing.stripe.com.
  const [showChangeCard, setShowChangeCard] = useState(false);
  // Bumped after a card-change so the CardOnFileBadge refetches.
  const [cardRefreshKey, setCardRefreshKey] = useState(0);
  // Poll counter for the KYC verification webhook after Connect onExit.
  const [pollingKyc, setPollingKyc] = useState(false);
  // Trial-start confirmation modal — gates the actual publish call so
  // owners explicitly opt into the 90-day clock starting.
  const [confirmPublish, setConfirmPublish] = useState(false);
  // Partner Agreement + Privacy Policy acceptance. Required before the
  // owner can publish. Writes a verifiable consent row to
  // subscription_consent_log via the publish-restaurant edge fn.
  const [partnerAgreementAccepted, setPartnerAgreementAccepted] = useState(false);
  // Referral program is dormant — UI removed, backend accepts but ignores.
  // Keep this null so the save-subscription-payment-method call never sends
  // a code. Re-enable by re-mounting <ReferralCodeField> + restoring the
  // setter wiring.
  const referralCode: string | null = null;

  const refreshRestaurantRow = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    const client = getSupabaseBrowserClient();
    const { data } = await client
      .from("restaurants")
      .select(RESTAURANT_SELECT_COLUMNS)
      .eq("id", restaurantId)
      .maybeSingle();
    setSummary((data ?? null) as SummaryRow | null);
  }, [restaurantId]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const client = getSupabaseBrowserClient();
      const [restRes, shiftRes, tableRes, catRes] = await Promise.all([
        client
          .from("restaurants")
          .select(RESTAURANT_SELECT_COLUMNS)
          .eq("id", restaurantId)
          .maybeSingle(),
        client
          .from("shifts")
          .select("name, turn_time_minutes")
          .eq("restaurant_id", restaurantId)
          .eq("is_active", true)
          .order("name")
          .limit(1)
          .maybeSingle(),
        client
          .from("tables")
          .select("capacity")
          .eq("restaurant_id", restaurantId)
          .eq("is_active", true),
        client
          .from("menu_categories")
          .select("id, name")
          .eq("restaurant_id", restaurantId)
          .eq("is_active", true)
          .eq("is_pricing_tier_source", true)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      setSummary((restRes.data ?? null) as SummaryRow | null);
      setShift((shiftRes.data ?? null) as ShiftRow | null);
      setTables((tableRes.data ?? []) as TableRow[]);
      const tierCat = (catRes.data ?? null) as { id: string; name: string | null } | null;
      if (tierCat) {
        const { count } = await client
          .from("menu_items")
          .select("id", { count: "exact", head: true })
          .eq("restaurant_id", restaurantId)
          .eq("category_id", tierCat.id)
          .eq("is_active", true);
        if (cancelled) return;
        setTierItems({ category_name: tierCat.name, count: count ?? 0 });
      } else {
        setTierItems(null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  const totalSeats = tables.reduce((sum, t) => sum + (t.capacity ?? 0), 0);

  const handleKycExit = useCallback(async () => {
    setPollingKyc(true);
    // Poll restaurants row up to ~30s waiting for the account.updated webhook
    // to flip the charges/payouts/details flags.
    let attempts = 0;
    const maxAttempts = 15;
    while (attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, 2000));
      await refreshRestaurantRow();
      const { data } = await getSupabaseBrowserClient()
        .from("restaurants")
        .select("stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted")
        .eq("id", restaurantId)
        .maybeSingle();
      const row = data as {
        stripe_charges_enabled: boolean | null;
        stripe_payouts_enabled: boolean | null;
        stripe_details_submitted: boolean | null;
      } | null;
      // Keep polling until payouts are enabled (the strictest gate) so the
      // user sees the "Verified" badge update without a manual refresh.
      if (row?.stripe_payouts_enabled) break;
      if (row?.stripe_charges_enabled || row?.stripe_details_submitted) break;
      attempts += 1;
    }
    setPollingKyc(false);
  }, [restaurantId, refreshRestaurantRow]);

  const handleCardChanged = useCallback(async () => {
    setShowChangeCard(false);
    setCardRefreshKey((k) => k + 1);
    toast.success("Card updated. The new card will be used for your next charge.");
    await refreshRestaurantRow();
  }, [refreshRestaurantRow]);

  const handlePaymentMethodSaved = useCallback(async () => {
    setCardRefreshKey((k) => k + 1);
    await refreshRestaurantRow();
    toast.success("Card saved. Your trial starts when you publish.");
  }, [refreshRestaurantRow]);

  // ────── Derived state (new lifecycle: card-save ≠ trial-start) ─────
  const kycVerified = summary?.stripe_charges_enabled === true;
  // Payouts capability is a separate Stripe gate — Stripe enables charges
  // first, then verifies identity + documents before unlocking payouts.
  // When charges are on but payouts aren't, the restaurant can take money
  // but it sits in Stripe holding until verification completes.
  const payoutsEnabled = summary?.stripe_payouts_enabled === true;
  const payoutsPending = kycVerified && !payoutsEnabled;
  const hasPaymentMethodOnFile = Boolean(summary?.payment_method_attached_at);
  const subscriptionStatus = summary?.subscription_status ?? null;
  const subscriptionActive =
    subscriptionStatus !== null && SUBSCRIPTION_OK_STATUSES.has(subscriptionStatus);
  const isPublished = summary?.is_published === true;
  // "Trial active" is only meaningful when the restaurant is actually live.
  // If a sub exists but the restaurant isn't published (test artifact, owner
  // manually unpublished, or grandfathered state) treat it as "card on file"
  // — don't celebrate the trial until publish has actually occurred.
  const showTrialActive = subscriptionActive && isPublished;
  const subscriptionAsCardOnFile = subscriptionActive && !isPublished;
  const publishReady =
    kycVerified
    && (hasPaymentMethodOnFile || subscriptionActive)
    && Boolean(summary?.cover_photo_url)
    && partnerAgreementAccepted;

  // Restaurant Partner Agreement version the user is consenting to. Stamped
  // into subscription_consent_log so each row records exactly which version
  // was accepted at the moment of publish.
  const PARTNER_AGREEMENT_VERSION = "2.1";
  const PARTNER_AGREEMENT_DISCLOSURE =
    `I have read and agree to the Cenaiva Restaurant Partner Agreement (v${PARTNER_AGREEMENT_VERSION}, effective 2026-05-21) and the Privacy Policy (v1.1).`;

  // Client-side preview of the trial end date for the confirm modal.
  // The server is authoritative — this is for display only.
  const previewTrialEnd = useMemo(
    () => formatTrialEnd(new Date(Date.now() + 90 * 86_400_000).toISOString()),
    [],
  );

  const publish = async () => {
    if (!isSupabaseConfigured()) {
      toast.error("Supabase is not configured.");
      return;
    }
    setPublishing(true);
    onBusyChange(true);
    try {
      const res = await invokeEdgeFunction<{
        ok: true;
        subscription_id: string;
        subscription_status: string;
        trial_ends_at: string;
      }>("publish-restaurant", {
        restaurant_id: restaurantId,
        disclosure_text: PUBLISH_CONFIRM_DISCLOSURE(previewTrialEnd),
        partner_agreement_accepted: partnerAgreementAccepted,
        partner_agreement_version: PARTNER_AGREEMENT_VERSION,
        partner_agreement_disclosure_text: PARTNER_AGREEMENT_DISCLOSURE,
      });
      if (!res.ok) {
        const friendly = toUserFacingError(res.error, "Couldn't publish your restaurant. Try again.");
        toast.error(friendly.message);
        console.error("[Step8PaymentSetup.publish]", friendly.code, friendly.technical ?? res.error);
        return;
      }
      toast.success("Your restaurant is live!");
      await refreshRestaurantRow();
      onPublished();
    } finally {
      setPublishing(false);
      onBusyChange(false);
    }
  };

  const stripeNotConfiguredOnFrontend = !isStripeConfigured || !publishableKey;

  // Label for the "Subscription" row in the setup summary list.
  const subscriptionSummaryLabel = subscriptionActive
    ? subscriptionStatus === "trialing"
      ? `Trialing — free until ${formatTrialEnd(summary?.trial_ends_at ?? null)}`
      : "Active"
    : hasPaymentMethodOnFile
      ? "Card on file · trial starts at publish"
      : "No card on file";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Payments &amp; publish</h1>
        <p className="mt-1 text-sm text-text-muted">
          Set up where your money lands and add a card for your monthly Cenaiva subscription.
          Free for 90 days, then $199.99 CAD/month.
        </p>
      </div>

      {stripeNotConfiguredOnFrontend ? (
        <div className="flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
          <div className="text-sm text-text-secondary">
            <p className="font-semibold text-warning">Stripe isn't configured.</p>
            <p className="mt-1">
              <code>VITE_STRIPE_PUBLISHABLE_KEY</code> is missing from the web app env. See
              <span className="font-mono"> STRIPE_SETUP.md §3</span>.
            </p>
          </div>
        </div>
      ) : null}

      {/* Summary list */}
      <section className="overflow-hidden rounded-2xl border border-border bg-bg-surface">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold">Setup summary</h2>
        </div>
        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-text-muted">Loading…</div>
        ) : (
          <ul className="divide-y divide-border">
            <SummaryItem
              ok
              label="Basics"
              value={
                summary
                  ? `${summary.name ?? "Untitled"}${summary.city ? `, ${summary.city}` : ""}`
                  : "—"
              }
            />
            <SummaryItem ok label="Hours" value={hoursSummary(summary?.hours_json ?? null)} />
            <SummaryItem
              ok
              label="Floor plan"
              value={`${tables.length} table${tables.length === 1 ? "" : "s"}, seats up to ${totalSeats}`}
            />
            <SummaryItem
              ok
              label="Booking rules"
              value={
                shift
                  ? `${shift.name ?? "Shift"}, ${shift.turn_time_minutes ?? 90} min turn`
                  : "No shift configured"
              }
            />
            <SummaryItem
              ok
              label="Menu"
              value={
                tierItems
                  ? `${tierItems.count} item${tierItems.count === 1 ? "" : "s"} in ${tierItems.category_name ?? "tier"} → ${priceLabel(summary?.price_range ?? null)}`
                  : "—"
              }
            />
            <SummaryItem
              ok={Boolean(summary?.cover_photo_url)}
              label="Cover photo"
              value={summary?.cover_photo_url ? "Set" : "Missing"}
            />
            <SummaryItem
              ok
              label="Deposit policy"
              value={depositSummary(summary?.deposit_tiers ?? null)}
            />
            <SummaryItem
              ok={kycVerified}
              label="Stripe Connect"
              value={
                kycVerified
                  ? "Verified"
                  : summary?.stripe_account_id
                    ? "Pending verification"
                    : "Not started"
              }
            />
            <SummaryItem
              ok={subscriptionActive || hasPaymentMethodOnFile}
              label="Subscription"
              value={subscriptionSummaryLabel}
            />
          </ul>
        )}
      </section>

      {/* Section A — Stripe Connect Embedded KYC */}
      {!stripeNotConfiguredOnFrontend ? (
        <section className="flex flex-col gap-3 rounded-2xl border border-border bg-bg-surface p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Set up payouts to your bank</h2>
              <p className="text-sm text-text-muted">
                Tell us where to send your money. We'll need your business details and a bank
                account so deposits and pre-orders can land in your account automatically.
              </p>
            </div>
            {kycVerified ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300">
                <CheckCircle2 className="size-3.5" /> Verified
              </span>
            ) : pollingKyc ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/15 px-3 py-1 text-xs font-medium text-warning">
                <Loader2 className="size-3.5 animate-spin" /> Verifying…
              </span>
            ) : null}
          </div>
          {kycVerified && payoutsEnabled ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
              You're fully verified — payments will land in your bank
              automatically (2–7 day rolling schedule).
            </div>
          ) : kycVerified && !payoutsEnabled ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
              You're ready to accept diner payments. Payouts to your bank
              will unlock once Stripe finishes reviewing your verification —
              see the panel below for status.
            </div>
          ) : null}
          {payoutsPending ? (
            <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-text-secondary">
              <p className="font-semibold text-warning">Payouts pending Stripe verification</p>
              <p className="mt-1">
                You can take deposits and pre-orders right now — that's
                already working. Payouts to your bank are paused while
                Stripe verifies your account.
              </p>
              <p className="mt-2 text-xs text-text-muted">
                If Stripe needs anything specific from you, it'll show as
                an actionable banner in the panel below. Otherwise this
                usually clears within 24 hours (up to 2-3 business days
                in some cases). In test mode it clears in seconds.
              </p>
            </div>
          ) : summary?.stripe_details_submitted && !kycVerified ? (
            <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-text-secondary">
              <p className="font-semibold text-warning">Almost there.</p>
              <p className="mt-1">
                We're still verifying your details. This usually takes a few minutes — you can
                come back to this page later.
              </p>
            </div>
          ) : null}
          {!kycVerified && publishableKey ? (
            // First-time onboarding — diner hasn't submitted yet OR Stripe
            // hasn't enabled charges. Use the standard account_onboarding flow.
            <StripeConnectEmbeddedKYC
              restaurantId={restaurantId}
              publishableKey={publishableKey}
              onExit={() => void handleKycExit()}
            />
          ) : payoutsPending ? (
            // Details submitted but payouts still gated on identity errors.
            // Switch to management-mode (notification_banner + account_management)
            // so the user can actually fix the flagged info — account_onboarding
            // shows a useless "Information submitted" placeholder here.
            <StripeConnectVerifyPanel
              restaurantId={restaurantId}
              onExit={() => void handleKycExit()}
            />
          ) : null}
        </section>
      ) : null}

      {/* Section B — Subscription card */}
      {!stripeNotConfiguredOnFrontend ? (
        <section className="flex flex-col gap-3 rounded-2xl border border-border bg-bg-surface p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Your Cenaiva subscription</h2>
              <p className="text-sm text-text-muted">
                $199.99 CAD/month. Free for the first 90 days — your trial starts when you
                publish. Cancel anytime.
              </p>
            </div>
            {showTrialActive ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300">
                <CheckCircle2 className="size-3.5" />{" "}
                {subscriptionStatus === "trialing" ? "Trial active" : "Active"}
              </span>
            ) : hasPaymentMethodOnFile || subscriptionAsCardOnFile ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300">
                <CheckCircle2 className="size-3.5" /> Card on file
              </span>
            ) : null}
          </div>

          {/* State C — subscription active AND restaurant published: trial badge. */}
          {showTrialActive ? (
            <div className="space-y-3">
              {showChangeCard && stripePromise ? (
                <ChangeSubscriptionCard
                  restaurantId={restaurantId}
                  stripePromiseRef={stripePromise}
                  onSuccess={() => void handleCardChanged()}
                  onCancel={() => setShowChangeCard(false)}
                />
              ) : (
                <>
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                    {subscriptionStatus === "trialing"
                      ? `Free until ${formatTrialEnd(summary?.trial_ends_at ?? null)}, then $199.99/month.`
                      : "Subscription is active."}
                  </div>
                  <div className="rounded-xl border border-border bg-bg-elevated/40 p-3">
                    <CardOnFileBadge restaurantId={restaurantId} refreshKey={cardRefreshKey} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!stripePromise}
                      onClick={() => setShowChangeCard(true)}
                    >
                      <CreditCard className="mr-1.5 size-3.5" />
                      Change card
                    </Button>
                    <p className="text-xs text-text-muted">
                      Replace the card on file. Used for your next charge.
                    </p>
                  </div>
                </>
              )}
            </div>
          ) : hasPaymentMethodOnFile || subscriptionAsCardOnFile ? (
            // State B — card on file, no sub yet. Trial starts at publish.
            <div className="space-y-3">
              {showChangeCard && stripePromise ? (
                <ChangeSubscriptionCard
                  restaurantId={restaurantId}
                  stripePromiseRef={stripePromise}
                  onSuccess={() => void handleCardChanged()}
                  onCancel={() => setShowChangeCard(false)}
                />
              ) : (
                <>
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                    ✓ Card on file. Your 90-day free trial starts when you publish.
                  </div>
                  <div className="rounded-xl border border-border bg-bg-elevated/40 p-3">
                    <CardOnFileBadge restaurantId={restaurantId} refreshKey={cardRefreshKey} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!stripePromise}
                      onClick={() => setShowChangeCard(true)}
                    >
                      <CreditCard className="mr-1.5 size-3.5" />
                      Use a different card
                    </Button>
                  </div>
                </>
              )}
            </div>
          ) : stripePromise ? (
            // State A — no card on file, no sub. Mount the card form.
            <SubscriptionCard
              restaurantId={restaurantId}
              stripePromiseRef={stripePromise}
              referralCode={referralCode}
              onPaymentMethodSaved={() => void handlePaymentMethodSaved()}
            />
          ) : null}
        </section>
      ) : null}

      {/* Publish button */}
      <div className="flex flex-col gap-3">
        {!loading && !publishReady ? (
          <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4">
            <p className="mb-2 text-sm font-semibold text-warning">
              Almost there — to publish:
            </p>
            <PublishHints
              kycVerified={kycVerified}
              hasPaymentMethodOnFile={hasPaymentMethodOnFile}
              subscriptionActive={subscriptionActive}
              hasCover={Boolean(summary?.cover_photo_url)}
              partnerAgreementAccepted={partnerAgreementAccepted}
            />
          </div>
        ) : null}
        <label className="flex items-start gap-3 rounded-2xl border border-border bg-bg-surface p-4 text-sm text-text-secondary">
          <Checkbox
            checked={partnerAgreementAccepted}
            onCheckedChange={(next) => setPartnerAgreementAccepted(next === true)}
            disabled={publishing}
            className="mt-0.5"
          />
          <span>
            I have read and agree to the{" "}
            <a
              href="/partners/agreement"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gold underline-offset-4 hover:underline"
            >
              Restaurant Partner Agreement (v{PARTNER_AGREEMENT_VERSION})
            </a>{" "}
            and{" "}
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gold underline-offset-4 hover:underline"
            >
              Privacy Policy
            </a>
            . By checking this box, you accept these documents as a binding contract between
            your restaurant and Cenaiva.
          </span>
        </label>
        <div className="flex justify-end">
          <Button
            type="button"
            size="lg"
            onClick={() => {
              if (publishing || loading || !publishReady) return;
              setConfirmPublish(true);
            }}
            disabled={publishing || loading || !publishReady}
            title={
              !publishReady
                ? "Complete the steps above to publish (see hints)."
                : undefined
            }
            className="gap-2 px-8"
          >
            <Rocket className="size-4" />
            {publishing ? "Publishing…" : "Publish my restaurant"}
          </Button>
        </div>
      </div>

      {/* Trial-start confirmation modal — required step before the
          publish-restaurant edge fn creates the Stripe subscription. */}
      <Dialog open={confirmPublish} onOpenChange={setConfirmPublish}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ready to go live?</DialogTitle>
            <DialogDescription>
              {PUBLISH_CONFIRM_DISCLOSURE(previewTrialEnd)}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmPublish(false)}
              disabled={publishing}
            >
              Not yet
            </Button>
            <Button
              onClick={() => {
                setConfirmPublish(false);
                void publish();
              }}
              disabled={publishing}
            >
              {publishing ? "Publishing…" : "Yes, publish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PublishHints({
  kycVerified,
  hasPaymentMethodOnFile,
  subscriptionActive,
  hasCover,
  partnerAgreementAccepted,
}: {
  kycVerified: boolean;
  hasPaymentMethodOnFile: boolean;
  subscriptionActive: boolean;
  hasCover: boolean;
  partnerAgreementAccepted: boolean;
}) {
  const missing = useMemo(() => {
    const out: string[] = [];
    if (!hasCover) out.push("Add a cover photo on Step 6.");
    if (!kycVerified) out.push("Complete Stripe verification (Section A).");
    if (!hasPaymentMethodOnFile && !subscriptionActive) {
      out.push("Save a card so your trial can start (Section B).");
    }
    if (!partnerAgreementAccepted) {
      out.push("Accept the Restaurant Partner Agreement and Privacy Policy.");
    }
    return out;
  }, [hasCover, kycVerified, hasPaymentMethodOnFile, subscriptionActive, partnerAgreementAccepted]);
  if (missing.length === 0) return null;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-warning">
      {missing.map((m) => (
        <li key={m}>{m}</li>
      ))}
    </ul>
  );
}

function SummaryItem({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-4">
      <div className="flex items-center gap-3">
        {ok ? (
          <CheckCircle2 className="size-4 text-emerald-400" />
        ) : (
          <AlertTriangle className="size-4 text-warning" />
        )}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <span className="text-right text-xs text-text-muted">{value}</span>
    </li>
  );
}
