import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CreditCard, ExternalLink, Plus, Star, Trash2 } from "lucide-react";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { isStripeConfigured, stripePromise } from "@/lib/stripe";
import { getSupabaseAnonKey, getSupabaseBrowserClient, getSupabaseProjectUrl } from "@/lib/supabase/client";
import { useUser } from "@/hooks/useUser";
import { toUserFacingError } from "@/lib/errors";
import { formatBrand } from "@/lib/billing/cardBrand";
import { invokeEdgeFunction } from "@/lib/supabase/edge-fn";

type SavedCard = {
  id: string;
  brand: string;
  last4: string;
  exp_month: number | null;
  exp_year: number | null;
  is_default: boolean;
  stripe_payment_method_id?: string | null;
};

type RestaurantSubscriptionCard = {
  restaurant_id: string;
  restaurant_name: string;
  has_card: boolean;
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
};

// ── Stripe PaymentElement-based SetupIntent form ────────────────────────────
// Single code path for both test and live mode. In test mode the Stripe
// publishable key starts with `pk_test_`, the server returns a test-mode
// SetupIntent client_secret, and diners can enter Stripe test cards
// (4242 4242 4242 4242 etc.). The mock-card form has been removed — we
// no longer insert directly into `saved_cards`; the server attaches the
// PM and inserts the row via `stripe-attach-payment-method`.
function AddCardForm({ onSuccess }: { onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSaving(true);
    setError(null);

    const { error: submitError } = await elements.submit();
    if (submitError) {
      const friendly = toUserFacingError(submitError, "Please check your card details.");
      setError(friendly.message);
      console.error("[PaymentMethodsSection.elements.submit]", friendly.code, friendly.technical ?? submitError);
      setSaving(false);
      return;
    }

    const { setupIntent, error: confirmError } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });
    if (confirmError) {
      const friendly = toUserFacingError(confirmError, "Card setup failed.");
      setError(friendly.message);
      console.error("[PaymentMethodsSection.confirmSetup]", friendly.code, friendly.technical ?? confirmError);
      setSaving(false);
      return;
    }
    if (!setupIntent?.id) {
      setError("Stripe didn't return a SetupIntent. Try again.");
      setSaving(false);
      return;
    }

    // Mirror the attached PaymentMethod into our `saved_cards` table via the
    // edge fn so the diner's saved-card picker shows it immediately. The
    // webhook also fires `payment_method.attached`, but going through the
    // edge fn means the row exists before the next fetch.
    const attachRes = await invokeEdgeFunction<{ saved_card: { id: string } }>(
      "stripe-attach-payment-method",
      { setup_intent_id: setupIntent.id },
      { caller: "PaymentMethodsSection" },
    );
    if (!attachRes.ok) {
      setError(attachRes.error);
      setSaving(false);
      return;
    }
    onSuccess();
    setSaving(false);
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="mt-3 flex flex-col gap-3">
      <PaymentElement
        options={{
          layout: "tabs",
          paymentMethodOrder: ["card", "apple_pay", "google_pay"],
          wallets: { applePay: "auto", googlePay: "auto", link: "never" },
        }}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <Button type="submit" size="sm" disabled={saving || !stripe || !elements}>
        {saving ? "Saving..." : "Save Card"}
      </Button>
    </form>
  );
}

// ── Brand logo ───────────────────────────────────────────────────────────────
function BrandIcon({ brand }: { brand: string }) {
  const colors: Record<string, string> = {
    visa: "text-blue-400",
    mastercard: "text-orange-400",
    amex: "text-sky-400",
    discover: "text-amber-400",
  };
  const color = colors[brand.toLowerCase()] || "text-text-muted";
  return (
    <span className={`text-xs font-bold uppercase tracking-widest ${color}`}>
      {brand.slice(0, 4)}
    </span>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export function PaymentMethodsSection() {
  const { profile } = useUser();
  const client = getSupabaseBrowserClient();
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [addCardError, setAddCardError] = useState<string | null>(null);
  const [addCardLoading, setAddCardLoading] = useState(false);
  // Cards backing restaurant subscriptions the user owns. Loaded in parallel
  // with saved diner cards so /account shows one unified list. These live on
  // a DIFFERENT Stripe customer than the diner saved_cards — managed from
  // /dashboard/settings, surfaced here read-only.
  const [restaurantSubCards, setRestaurantSubCards] = useState<RestaurantSubscriptionCard[]>([]);
  const [restaurantSubsLoading, setRestaurantSubsLoading] = useState(true);

  const fetchRestaurantSubCards = useCallback(async () => {
    if (!profile?.id) {
      setRestaurantSubsLoading(false);
      return;
    }
    setRestaurantSubsLoading(true);

    // 1. Find the restaurants this user owns.
    const { data: roles } = await client
      .from("user_restaurant_roles")
      .select("restaurant_id, restaurants(id, name)")
      .eq("user_id", profile.id)
      .eq("role", "owner");
    const ownedRestaurants =
      (roles as Array<{
        restaurant_id: string;
        restaurants: { id: string; name: string | null } | null;
      }> | null) ?? [];
    if (ownedRestaurants.length === 0) {
      setRestaurantSubCards([]);
      setRestaurantSubsLoading(false);
      return;
    }

    const { data: { session } } = await client.auth.getSession();
    if (!session) {
      setRestaurantSubsLoading(false);
      return;
    }

    // 2. For each restaurant, fetch the default PM via the owner-auth fn.
    const results = await Promise.all(
      ownedRestaurants.map(async (row) => {
        const restaurant_id = row.restaurant_id;
        const restaurant_name = row.restaurants?.name ?? "Restaurant";
        try {
          const res = await fetch(
            `${getSupabaseProjectUrl()}/functions/v1/get-restaurant-payment-method`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${session.access_token}`,
                apikey: getSupabaseAnonKey(),
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ restaurant_id }),
            },
          );
          if (!res.ok) {
            return { restaurant_id, restaurant_name, has_card: false, brand: null, last4: null, exp_month: null, exp_year: null };
          }
          const body = (await res.json().catch(() => null)) as {
            has_card?: boolean;
            brand?: string | null;
            last4?: string | null;
            exp_month?: number | null;
            exp_year?: number | null;
          } | null;
          return {
            restaurant_id,
            restaurant_name,
            has_card: Boolean(body?.has_card),
            brand: body?.brand ?? null,
            last4: body?.last4 ?? null,
            exp_month: body?.exp_month ?? null,
            exp_year: body?.exp_year ?? null,
          };
        } catch (err) {
          console.warn("[PaymentMethods.fetchRestaurantSubCards] failed for restaurant", restaurant_id, err);
          return { restaurant_id, restaurant_name, has_card: false, brand: null, last4: null, exp_month: null, exp_year: null };
        }
      }),
    );
    setRestaurantSubCards(results);
    setRestaurantSubsLoading(false);
  }, [client, profile?.id]);

  useEffect(() => { void fetchRestaurantSubCards(); }, [fetchRestaurantSubCards]);

  const fetchCards = useCallback(async () => {
    setLoading(true);
    const { data: { session } } = await client.auth.getSession();
    if (!session) { setLoading(false); return; }

    const res = await fetch(
      `${getSupabaseProjectUrl()}/functions/v1/stripe-list-methods`,
      {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: getSupabaseAnonKey(),
        },
      },
    );
    if (res.ok) {
      const data = await res.json();
      setCards(data.methods || []);
    }
    setLoading(false);
  }, [client]);

  useEffect(() => { void fetchCards(); }, [fetchCards]);

  const handleAddCard = async () => {
    setShowAddForm(true);
    setAddCardError(null);
    setClientSecret(null);
    if (!isStripeConfigured) {
      setAddCardError(
        "Card payments aren't available here yet — VITE_STRIPE_PUBLISHABLE_KEY is missing.",
      );
      return;
    }
    setAddCardLoading(true);
    // SetupIntent on the diner's own Stripe customer (Branch B). Returns
    // the same client_secret shape in test + live mode — Stripe Elements
    // accepts test cards (4242 4242 4242 4242 etc.) when the publishable
    // key is a pk_test_… key.
    const res = await invokeEdgeFunction<{ client_secret: string | null; mode: string }>(
      "stripe-setup-intent",
      {},
      { caller: "PaymentMethodsSection.handleAddCard" },
    );
    if (!res.ok) {
      setAddCardError(res.error);
      setAddCardLoading(false);
      return;
    }
    if (!res.data.client_secret) {
      setAddCardError("Stripe is not configured on the server.");
      setAddCardLoading(false);
      return;
    }
    setClientSecret(res.data.client_secret);
    setAddCardLoading(false);
  };

  const handleRemove = async (card: SavedCard) => {
    // Reordered (2026-05-20): detach from Stripe FIRST, then delete the local
    // saved_cards row only on success. If Stripe detach fails we keep the
    // local row so the user can retry — otherwise the row vanishes but the
    // PaymentMethod lingers on the Stripe customer (orphan).
    if (isStripeConfigured && card.stripe_payment_method_id) {
      const { data: { session } } = await client.auth.getSession();
      if (!session) {
        const friendly = toUserFacingError(
          new Error("Not signed in."),
          "You need to be signed in to remove a card.",
        );
        toast.error(friendly.message);
        console.error("[PaymentMethodsSection.handleRemove.noSession]", friendly.code);
        return;
      }

      let detachRes: Response;
      try {
        detachRes = await fetch(
          `${getSupabaseProjectUrl()}/functions/v1/stripe-detach-method`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
              apikey: getSupabaseAnonKey(),
            },
            body: JSON.stringify({ payment_method_id: card.stripe_payment_method_id }),
          },
        );
      } catch (err) {
        const friendly = toUserFacingError(
          err,
          "Couldn't reach Stripe to remove the card. Try again.",
        );
        toast.error(friendly.message);
        console.error("[PaymentMethodsSection.handleRemove.network]", friendly.code, friendly.technical ?? err);
        return;
      }

      if (!detachRes.ok) {
        let parsed: unknown = null;
        try { parsed = await detachRes.json(); } catch { /* ignore */ }
        const friendly = toUserFacingError(
          parsed,
          "Couldn't remove the card. Try again.",
        );
        toast.error(friendly.message);
        console.error("[PaymentMethodsSection.handleRemove.detach]", detachRes.status, friendly.code, friendly.technical ?? parsed);
        return;
      }
    }

    const { error: dbErr } = await client.from("saved_cards").delete().eq("id", card.id);
    if (dbErr) {
      const friendly = toUserFacingError(dbErr, "Couldn't remove the card from your account.");
      toast.error(friendly.message);
      console.error("[PaymentMethodsSection.handleRemove.db]", friendly.code, friendly.technical ?? dbErr);
      return;
    }

    void fetchCards();
  };

  const handleSetDefault = async (card: SavedCard) => {
    // Clear all defaults then set this one
    await client.from("saved_cards").update({ is_default: false }).eq("user_profile_id", profile?.id || "");
    await client.from("saved_cards").update({ is_default: true }).eq("id", card.id);
    void fetchCards();
  };

  const handleCardSaved = () => {
    setShowAddForm(false);
    setClientSecret(null);
    void fetchCards();
  };

  // Restaurant subs always come back as a list (even if empty). Only render
  // the subsection if the user actually owns at least one restaurant.
  const hasOwnedRestaurants = restaurantSubCards.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Personal cards header */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Personal cards</p>
            <p className="text-xs text-text-muted">
              Saved for deposits + pre-orders when you book a reservation.
            </p>
          </div>
          {!showAddForm && (
            <Button variant="outline" size="sm" onClick={() => void handleAddCard()} className="gap-1.5">
              <Plus className="size-3.5" />
              Add Card
            </Button>
          )}
        </div>

      {/* Add card form — single Stripe Elements + SetupIntent path. In test
          mode the Stripe publishable key starts with pk_test_, the server
          returns a test SetupIntent, and Stripe accepts test cards like
          4242 4242 4242 4242. No more direct-to-DB mock inserts. */}
      {showAddForm && (
        <div className="rounded-xl border border-border bg-bg-surface p-4">
          <p className="text-sm font-medium">Add a new card</p>
          {addCardError ? (
            <p className="mt-3 text-xs text-red-400">{addCardError}</p>
          ) : addCardLoading || !clientSecret ? (
            <p className="mt-3 text-xs text-text-muted">Preparing secure checkout…</p>
          ) : stripePromise ? (
            <Elements
              stripe={stripePromise}
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
              <AddCardForm onSuccess={handleCardSaved} />
            </Elements>
          ) : (
            <p className="mt-3 text-xs text-red-400">
              Stripe failed to load. Refresh the page and try again.
            </p>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => {
              setShowAddForm(false);
              setClientSecret(null);
              setAddCardError(null);
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Cards list */}
      {loading ? (
        <p className="text-sm text-text-muted">Loading...</p>
      ) : cards.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-bg-surface p-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-gold/10">
            <CreditCard className="size-5 text-gold" />
          </div>
          <div>
            <p className="text-sm font-medium">No saved cards</p>
            <p className="mt-1 text-xs text-text-muted">
              Add a card to pay faster with Cenaiva.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {cards.map((card) => (
            <div
              key={card.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-bg-surface px-4 py-3"
            >
              <BrandIcon brand={card.brand} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  {card.brand} <span className="font-mono">****{card.last4}</span>
                  {card.is_default && (
                    <span className="ml-2 rounded bg-gold/15 px-1.5 py-0.5 text-[10px] font-semibold text-gold">
                      Default
                    </span>
                  )}
                </p>
                {card.exp_month && card.exp_year && (
                  <p className="text-xs text-text-muted">
                    Expires {String(card.exp_month).padStart(2, "0")}/{card.exp_year}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {!card.is_default && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title="Set as default"
                    onClick={() => void handleSetDefault(card)}
                  >
                    <Star className="size-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-red-400 hover:text-red-300"
                  title="Remove card"
                  onClick={() => void handleRemove(card)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

        {!isStripeConfigured && (
          <p className="text-xs text-text-muted">
            Running in test mode — no real charges will occur.{" "}
            <span className="text-amber-400">Add Stripe keys to enable real payments.</span>
          </p>
        )}
      </div>

      {/* Restaurant subscription cards — owners only. Read-only here; managed
          via the wizard / dashboard Settings for each restaurant. */}
      {hasOwnedRestaurants && (
        <div className="flex flex-col gap-4 border-t border-border pt-6">
          <div>
            <p className="text-sm font-medium">Restaurant subscription cards</p>
            <p className="text-xs text-text-muted">
              Cards Cenaiva charges for each restaurant&apos;s $199.99/month subscription.
              These live on the restaurant&apos;s billing — separate from your personal cards above.
            </p>
          </div>

          {restaurantSubsLoading ? (
            <p className="text-sm text-text-muted">Loading…</p>
          ) : (
            <div className="flex flex-col gap-2">
              {restaurantSubCards.map((sub) => (
                <div
                  key={sub.restaurant_id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-bg-surface px-4 py-3"
                >
                  {sub.has_card && sub.brand ? (
                    <BrandIcon brand={sub.brand} />
                  ) : (
                    <div className="flex size-9 items-center justify-center rounded-lg bg-bg-elevated">
                      <CreditCard className="size-4 text-text-muted" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {sub.restaurant_name}
                    </p>
                    {sub.has_card && sub.last4 ? (
                      <p className="text-xs text-text-muted">
                        {formatBrand(sub.brand)} <span className="font-mono">****{sub.last4}</span>
                        {sub.exp_month && sub.exp_year ? (
                          <> · Expires {String(sub.exp_month).padStart(2, "0")}/{sub.exp_year}</>
                        ) : null}
                      </p>
                    ) : (
                      <p className="text-xs text-text-muted">No card on file yet</p>
                    )}
                  </div>
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-xs"
                  >
                    <Link to="/dashboard/settings">
                      Manage
                      <ExternalLink className="size-3" />
                    </Link>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
