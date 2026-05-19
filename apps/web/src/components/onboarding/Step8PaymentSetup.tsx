// Step 8 — Payment setup. Phase D wire-up of:
//   A. Stripe Connect Embedded onboarding (KYC) — restaurants accept deposits/orders
//   B. $199 CAD/month Cenaiva subscription with 90-day free trial (Stripe Billing)
//
// Publish gate: enabled only when BOTH
//   - stripe_charges_enabled === true (set by stripe-webhook on account.updated)
//   - subscription_status in ('trialing', 'active') (set by create-subscription
//     immediately + reaffirmed by stripe-webhook on customer.subscription.*)
//
// Replaces the interim Step8InterimPublish component which only required a
// cover photo to flip is_published=true.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Rocket } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import {
  loadConnectAndInitialize,
  type StripeConnectInstance,
} from "@stripe/connect-js";
import {
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
} from "@stripe/react-connect-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import type { Stripe as StripeJs } from "@stripe/stripe-js";

import { Button } from "@/components/ui/button";
import type { RestaurantDepositTier } from "@/hooks/useStaffRestaurants";
import { stripePromise, isStripeConfigured } from "@/lib/stripe";
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
};

type ShiftRow = { name: string | null; turn_time_minutes: number | null };
type TableRow = { capacity: number | null };
type TierItem = { category_name: string | null; count: number };

const SUBSCRIPTION_OK_STATUSES = new Set(["trialing", "active"]);

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
          appearance: {
            overlays: "dialog",
            variables: {
              // Core palette — matches the wizard's gold-on-black aesthetic.
              colorPrimary: "#D4AF37",
              colorBackground: "#0A0A0A",
              colorText: "#FFFFFF",
              colorSecondaryText: "#B0B0B0",
              colorDanger: "#EF4444",
              // Buttons mirror the wizard's primary CTA (gold pill, dark text).
              buttonPrimaryColorBackground: "#D4AF37",
              buttonPrimaryColorText: "#0A0A0A",
              buttonPrimaryColorBorder: "#D4AF37",
              buttonSecondaryColorBackground: "#1A1A1A",
              buttonSecondaryColorText: "#FFFFFF",
              buttonSecondaryColorBorder: "#2A2A2A",
              // Form controls (inputs, selects) match the wizard's elevated
              // surface tokens so fields don't pop visually.
              formAccentColor: "#D4AF37",
              formHighlightColorBorder: "#D4AF37",
              colorBorder: "#2A2A2A",
              offsetBackgroundColor: "#121212",
              actionPrimaryColorText: "#D4AF37",
              // Typography + shape match the wizard's tokens.
              fontFamily: "system-ui, -apple-system, sans-serif",
              fontSizeBase: "14px",
              borderRadius: "10px",
              spacingUnit: "4px",
            },
          },
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
// Section B — Subscription card (Stripe Elements + SetupIntent)
// ─────────────────────────────────────────────────────────────────────────────

function SubscriptionCardInner({
  restaurantId,
  onSubscriptionReady,
}: {
  restaurantId: string;
  onSubscriptionReady: (info: { status: string; trial_ends_at: string | null }) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!stripe || !elements) return;
      setSubmitting(true);
      setError(null);
      try {
        const { error: submitError } = await elements.submit();
        if (submitError) {
          const friendly = toUserFacingError(submitError, "Please check your card details.");
          setError(friendly.message);
          console.error("[Step8PaymentSetup.subscription.submit]", friendly.code, friendly.technical ?? submitError);
          return;
        }
        const { setupIntent, error: confirmError } = await stripe.confirmSetup({
          elements,
          redirect: "if_required",
        });
        // Recovery path: if the SetupIntent was already confirmed in a prior
        // submit attempt (e.g., create-subscription failed downstream and the
        // user clicked Submit again without refreshing), Stripe returns
        // setup_intent_unexpected_state. The error includes the prior
        // SetupIntent — reuse its PaymentMethod and skip straight to
        // create-subscription.
        const recoveredSetupIntent =
          confirmError &&
          (confirmError as { code?: string }).code === "setup_intent_unexpected_state"
            ? (confirmError as { setup_intent?: { status?: string; payment_method?: string } })
                .setup_intent
            : null;
        if (
          confirmError &&
          !(recoveredSetupIntent && recoveredSetupIntent.status === "succeeded")
        ) {
          const friendly = toUserFacingError(confirmError, "Couldn't confirm your card.");
          setError(friendly.message);
          console.error("[Step8PaymentSetup.subscription.confirm]", friendly.code, friendly.technical ?? confirmError);
          return;
        }
        const paymentMethodId =
          typeof setupIntent?.payment_method === "string"
            ? setupIntent.payment_method
            : typeof recoveredSetupIntent?.payment_method === "string"
              ? recoveredSetupIntent.payment_method
              : null;
        if (!paymentMethodId) {
          setError("Stripe didn't return a payment method. Try again.");
          return;
        }
        const subRes = await invokeEdgeFunction<{
          subscription_id: string;
          status: string;
          trial_ends_at: string | null;
        }>("create-subscription", {
          restaurant_id: restaurantId,
          payment_method_id: paymentMethodId,
        });
        if (!subRes.ok) {
          setError(subRes.error);
          return;
        }
        onSubscriptionReady({
          status: subRes.data.status,
          trial_ends_at: subRes.data.trial_ends_at,
        });
      } finally {
        setSubmitting(false);
      }
    },
    [stripe, elements, restaurantId, onSubscriptionReady],
  );

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
      {/* Owners paying their monthly subscription won't benefit from Stripe
          Link (they pay once and forget). paymentMethodOrder=['card'] hides
          the "Secure, fast checkout with Link" badge and the Apple/Google
          Pay tabs — clean card-only form. Diner-side payments
          (StripePaymentForm.tsx) keep Link + wallets enabled for future
          returning-customer conversion uplift. */}
      <PaymentElement
        options={{
          layout: "tabs",
          paymentMethodOrder: ["card"],
          // Hide all wallet upsells including the Link "save your card" prompt
          // that mounts above the card form even when payment_method_types is
          // restricted to ["card"].
          wallets: { applePay: "never", googlePay: "never", link: "never" },
        }}
      />
      {error ? (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          {error}
        </div>
      ) : null}
      <Button type="submit" disabled={!stripe || !elements || submitting} className="w-fit">
        {submitting ? "Saving…" : "Start free trial"}
      </Button>
    </form>
  );
}

function SubscriptionCard({
  restaurantId,
  stripePromiseRef,
  onSubscriptionReady,
}: {
  restaurantId: string;
  stripePromiseRef: Promise<StripeJs | null>;
  onSubscriptionReady: (info: { status: string; trial_ends_at: string | null }) => void;
}) {
  // SetupIntent client_secret tied to the *restaurant's* Stripe customer.
  // stripe-setup-intent accepts restaurant_id to target the restaurant
  // customer — Stripe blocks moving a PaymentMethod between customers, so the
  // SetupIntent must be created on the same customer create-subscription bills.
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    void (async () => {
      const res = await invokeEdgeFunction<{ client_secret: string | null }>(
        "stripe-setup-intent",
        { restaurant_id: restaurantId },
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (!res.data.client_secret) {
        setError("Stripe is not configured on the server.");
        return;
      }
      setClientSecret(res.data.client_secret);
    })();
  }, [restaurantId]);

  if (error) {
    return (
      <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm text-text-secondary">
        <p className="font-semibold text-warning">Couldn't load card form.</p>
        <p className="mt-1">{error}</p>
      </div>
    );
  }
  if (!clientSecret) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-bg-surface p-6 text-sm text-text-muted">
        <Loader2 className="size-4 animate-spin" /> Preparing checkout…
      </div>
    );
  }

  return (
    <Elements
      stripe={stripePromiseRef}
      options={{
        clientSecret,
        appearance: {
          theme: "night",
          variables: {
            colorPrimary: "#D4AF37",
            colorBackground: "#0A0A0A",
            colorText: "#FFFFFF",
            colorDanger: "#EF4444",
            fontFamily: "system-ui, -apple-system, sans-serif",
            borderRadius: "10px",
            spacingUnit: "4px",
          },
        },
      }}
    >
      <SubscriptionCardInner
        restaurantId={restaurantId}
        onSubscriptionReady={onSubscriptionReady}
      />
    </Elements>
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
  // Poll counter for the KYC verification webhook after Connect onExit.
  const [pollingKyc, setPollingKyc] = useState(false);

  const refreshRestaurantRow = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    const client = getSupabaseBrowserClient();
    const { data } = await client
      .from("restaurants")
      .select(
        "cover_photo_url, name, city, price_range, deposit_tiers, hours_json, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, subscription_status, trial_ends_at",
      )
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
          .select(
            "cover_photo_url, name, city, price_range, deposit_tiers, hours_json, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, subscription_status, trial_ends_at",
          )
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
        .select("stripe_charges_enabled, stripe_details_submitted")
        .eq("id", restaurantId)
        .maybeSingle();
      const row = data as { stripe_charges_enabled: boolean | null; stripe_details_submitted: boolean | null } | null;
      if (row?.stripe_charges_enabled || row?.stripe_details_submitted) {
        break;
      }
      attempts += 1;
    }
    setPollingKyc(false);
  }, [restaurantId, refreshRestaurantRow]);

  const handleSubscriptionReady = useCallback(
    async (_info: { status: string; trial_ends_at: string | null }) => {
      await refreshRestaurantRow();
      toast.success("Subscription started — you're on the 90-day free trial.");
    },
    [refreshRestaurantRow],
  );

  const kycVerified = summary?.stripe_charges_enabled === true;
  const subscriptionStatus = summary?.subscription_status ?? null;
  const subscriptionActive =
    subscriptionStatus !== null && SUBSCRIPTION_OK_STATUSES.has(subscriptionStatus);
  const publishReady = kycVerified && subscriptionActive && Boolean(summary?.cover_photo_url);

  const publish = async () => {
    if (!isSupabaseConfigured()) {
      toast.error("Supabase is not configured.");
      return;
    }
    setPublishing(true);
    onBusyChange(true);
    try {
      const client = getSupabaseBrowserClient();
      const { error } = await client
        .from("restaurants")
        .update({ is_published: true })
        .eq("id", restaurantId);
      if (error) {
        const friendly = toUserFacingError(error, "Couldn't publish your restaurant.");
        toast.error(`Couldn't publish: ${friendly.message}`);
        console.error("[Step8PaymentSetup.publish]", friendly.code, friendly.technical ?? error);
        return;
      }
      toast.success("Your restaurant is live!");
      onPublished();
    } finally {
      setPublishing(false);
      onBusyChange(false);
    }
  };

  const stripeNotConfiguredOnFrontend = !isStripeConfigured || !publishableKey;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Payments &amp; publish</h1>
        <p className="mt-1 text-sm text-text-muted">
          Set up where your money lands and add a card for your monthly Cenaiva subscription.
          Free for 90 days, then $199 CAD/month.
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
              ok={subscriptionActive}
              label="Subscription"
              value={
                subscriptionActive
                  ? subscriptionStatus === "trialing"
                    ? `Trialing — free until ${formatTrialEnd(summary?.trial_ends_at ?? null)}`
                    : "Active"
                  : "No card on file"
              }
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
          {kycVerified ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
              You're verified and ready to accept payments.
            </div>
          ) : summary?.stripe_details_submitted && !kycVerified ? (
            <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-text-secondary">
              <p className="font-semibold text-warning">Almost there.</p>
              <p className="mt-1">
                We're still verifying your details. This usually takes a few minutes — you can
                come back to this page later.
              </p>
            </div>
          ) : publishableKey ? (
            <StripeConnectEmbeddedKYC
              restaurantId={restaurantId}
              publishableKey={publishableKey}
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
                $199 CAD/month. Free for the first 90 days — no charge until{" "}
                {formatTrialEnd(summary?.trial_ends_at ?? null)}. Cancel anytime.
              </p>
            </div>
            {subscriptionActive ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300">
                <CheckCircle2 className="size-3.5" />{" "}
                {subscriptionStatus === "trialing" ? "Trial active" : "Active"}
              </span>
            ) : null}
          </div>
          {subscriptionActive ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
              {subscriptionStatus === "trialing"
                ? `Free until ${formatTrialEnd(summary?.trial_ends_at ?? null)}, then $200/month.`
                : "Subscription is active."}
            </div>
          ) : stripePromise ? (
            <SubscriptionCard
              restaurantId={restaurantId}
              stripePromiseRef={stripePromise}
              onSubscriptionReady={(info) => void handleSubscriptionReady(info)}
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
              subscriptionActive={subscriptionActive}
              hasCover={Boolean(summary?.cover_photo_url)}
            />
          </div>
        ) : null}
        <div className="flex justify-end">
          <Button
            type="button"
            size="lg"
            onClick={() => {
              if (publishing || loading) return;
              if (!publishReady) {
                toast.error("Complete the steps above first.");
                return;
              }
              void publish();
            }}
            disabled={publishing || loading}
            className={cn(
              "gap-2 px-8",
              !publishReady && !loading && "opacity-60",
            )}
          >
            <Rocket className="size-4" />
            {publishing ? "Publishing…" : "Publish my restaurant"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PublishHints({
  kycVerified,
  subscriptionActive,
  hasCover,
}: {
  kycVerified: boolean;
  subscriptionActive: boolean;
  hasCover: boolean;
}) {
  const missing = useMemo(() => {
    const out: string[] = [];
    if (!hasCover) out.push("Add a cover photo on Step 6.");
    if (!kycVerified) out.push("Complete Stripe verification (Section A).");
    if (!subscriptionActive) out.push("Add a card for the subscription (Section B).");
    return out;
  }, [hasCover, kycVerified, subscriptionActive]);
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
