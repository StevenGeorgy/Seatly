import { useCallback, useEffect, useState } from "react";
import { CreditCard, Plus, Trash2, Star } from "lucide-react";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { isStripeConfigured, stripePromise } from "@/lib/stripe";
import { getSupabaseAnonKey, getSupabaseBrowserClient, getSupabaseProjectUrl } from "@/lib/supabase/client";
import { useUser } from "@/hooks/useUser";

type SavedCard = {
  id: string;
  brand: string;
  last4: string;
  exp_month: number | null;
  exp_year: number | null;
  is_default: boolean;
  stripe_payment_method_id?: string | null;
};

// ── Stripe CardElement form (live mode) ─────────────────────────────────────
function StripeCardForm({ onSuccess }: { onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!stripe || !elements) return;
    setSaving(true);
    setError(null);
    const cardEl = elements.getElement(CardElement);
    if (!cardEl) { setSaving(false); return; }

    // confirmCardSetup needs a client_secret — it was already embedded in the
    // Elements context when we initialized with the SetupIntent client_secret.
    const result = await stripe.confirmCardSetup("", {
      payment_method: { card: cardEl },
    });

    if (result.error) {
      setError(result.error.message || "Card setup failed.");
    } else {
      onSuccess();
    }
    setSaving(false);
  };

  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="rounded-lg border border-border bg-bg-surface px-3 py-2.5">
        <CardElement
          options={{
            style: {
              base: { fontSize: "14px", color: "#ffffff", "::placeholder": { color: "#6b7280" } },
              invalid: { color: "#ef4444" },
            },
          }}
        />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <Button size="sm" onClick={handleSubmit} disabled={saving || !stripe}>
        {saving ? "Saving..." : "Save Card"}
      </Button>
    </div>
  );
}

// ── Mock card form (test mode) ───────────────────────────────────────────────
function MockCardForm({ profileId, onSuccess }: { profileId: string; onSuccess: () => void }) {
  const client = getSupabaseBrowserClient();
  const [brand, setBrand] = useState("Visa");
  const [last4, setLast4] = useState("");
  const [expMonth, setExpMonth] = useState("");
  const [expYear, setExpYear] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (last4.length !== 4 || !/^\d{4}$/.test(last4)) {
      setError("Enter the last 4 digits of your card.");
      return;
    }
    setSaving(true);
    setError(null);
    const { error: dbErr } = await client.from("saved_cards").insert({
      user_profile_id: profileId,
      brand,
      last4,
      exp_month: parseInt(expMonth) || null,
      exp_year: parseInt(expYear) || null,
      is_default: false,
    });
    if (dbErr) { setError(dbErr.message); setSaving(false); return; }
    onSuccess();
    setSaving(false);
  };

  return (
    <div className="mt-3 flex flex-col gap-3">
      <p className="text-xs text-amber-400">
        Test mode — no real charge will occur. Enter any card details.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-muted">Brand</label>
          <select
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            className="rounded-md border border-border bg-bg-surface px-2 py-1.5 text-sm text-white"
          >
            {["Visa", "Mastercard", "Amex", "Discover"].map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-muted">Last 4 digits</label>
          <input
            type="text"
            maxLength={4}
            placeholder="4242"
            value={last4}
            onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))}
            className="rounded-md border border-border bg-bg-surface px-2 py-1.5 text-sm text-white placeholder:text-text-muted"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-muted">Exp. Month</label>
          <input
            type="number"
            min={1}
            max={12}
            placeholder="12"
            value={expMonth}
            onChange={(e) => setExpMonth(e.target.value)}
            className="rounded-md border border-border bg-bg-surface px-2 py-1.5 text-sm text-white placeholder:text-text-muted"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-muted">Exp. Year</label>
          <input
            type="number"
            min={2025}
            max={2040}
            placeholder="2028"
            value={expYear}
            onChange={(e) => setExpYear(e.target.value)}
            className="rounded-md border border-border bg-bg-surface px-2 py-1.5 text-sm text-white placeholder:text-text-muted"
          />
        </div>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <Button size="sm" onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : "Save Card"}
      </Button>
    </div>
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
  const [stripeMode, setStripeMode] = useState<"test" | "live">("test");

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
    if (isStripeConfigured) {
      const { data: { session } } = await client.auth.getSession();
      if (!session) return;
      const res = await fetch(
        `${getSupabaseProjectUrl()}/functions/v1/stripe-setup-intent`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: getSupabaseAnonKey(),
          },
        },
      );
      const data = await res.json();
      setStripeMode(data.mode || "test");
      setClientSecret(data.client_secret);
    } else {
      setStripeMode("test");
    }
    setShowAddForm(true);
  };

  const handleRemove = async (card: SavedCard) => {
    await client.from("saved_cards").delete().eq("id", card.id);
    if (isStripeConfigured && card.stripe_payment_method_id) {
      const { data: { session } } = await client.auth.getSession();
      if (session) {
        await fetch(
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
      }
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

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Saved Cards</p>
          <p className="text-xs text-text-muted">
            Cenaiva uses your default card to pay automatically.
          </p>
        </div>
        {!showAddForm && (
          <Button variant="outline" size="sm" onClick={() => void handleAddCard()} className="gap-1.5">
            <Plus className="size-3.5" />
            Add Card
          </Button>
        )}
      </div>

      {/* Add card form */}
      {showAddForm && (
        <div className="rounded-xl border border-border bg-bg-surface p-4">
          <p className="text-sm font-medium">Add a new card</p>
          {stripeMode === "live" && clientSecret && stripePromise ? (
            <Elements stripe={stripePromise} options={{ clientSecret }}>
              <StripeCardForm onSuccess={handleCardSaved} />
            </Elements>
          ) : (
            profile?.id && (
              <MockCardForm profileId={profile.id} onSuccess={handleCardSaved} />
            )
          )}
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => { setShowAddForm(false); setClientSecret(null); }}
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
  );
}
