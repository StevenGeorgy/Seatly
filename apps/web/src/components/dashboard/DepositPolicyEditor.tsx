import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { RestaurantDepositTier } from "@/hooks/useStaffRestaurants";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

type DraftTier = {
  /** stable key for React */
  key: string;
  min_party_size: string;
  amount_dollars: string;
};

type Props = {
  restaurantId: string | null | undefined;
  initialTiers: RestaurantDepositTier[] | null | undefined;
  ceilingHint?: number | null;
  onSaved?: (tiers: RestaurantDepositTier[]) => void;
};

const ADD_KEY = () => `tier-${crypto.randomUUID()}`;

function tiersToDraft(tiers: RestaurantDepositTier[] | null | undefined): DraftTier[] {
  if (!tiers || tiers.length === 0) return [];
  return tiers
    .slice()
    .sort((a, b) => a.min_party_size - b.min_party_size)
    .map((t) => ({
      key: ADD_KEY(),
      min_party_size: String(t.min_party_size),
      amount_dollars: (t.amount_per_person_cents / 100).toFixed(2),
    }));
}

function draftToTiers(draft: DraftTier[]): RestaurantDepositTier[] | { error: string } {
  const seen = new Set<number>();
  const out: RestaurantDepositTier[] = [];
  for (const row of draft) {
    const minParty = Number.parseInt(row.min_party_size, 10);
    const dollars = Number.parseFloat(row.amount_dollars);
    if (!Number.isFinite(minParty) || minParty < 1) {
      return { error: `Tier "${row.min_party_size || "?"}+" — minimum party size must be 1 or more.` };
    }
    if (!Number.isFinite(dollars) || dollars < 0) {
      return { error: `Tier "${minParty}+" — deposit amount must be 0 or more.` };
    }
    if (seen.has(minParty)) {
      return { error: `Two tiers share the same threshold (${minParty}+). Each threshold must be unique.` };
    }
    seen.add(minParty);
    out.push({
      min_party_size: minParty,
      amount_per_person_cents: Math.round(dollars * 100),
    });
  }
  out.sort((a, b) => a.min_party_size - b.min_party_size);
  return out;
}

function tiersEqual(
  a: RestaurantDepositTier[] | null | undefined,
  b: RestaurantDepositTier[] | null | undefined,
): boolean {
  const aa = (a ?? []).slice().sort((x, y) => x.min_party_size - y.min_party_size);
  const bb = (b ?? []).slice().sort((x, y) => x.min_party_size - y.min_party_size);
  if (aa.length !== bb.length) return false;
  return aa.every((row, i) =>
    row.min_party_size === bb[i].min_party_size
    && row.amount_per_person_cents === bb[i].amount_per_person_cents
  );
}

export function DepositPolicyEditor({ restaurantId, initialTiers, ceilingHint, onSaved }: Props) {
  const [draft, setDraft] = useState<DraftTier[]>(() => tiersToDraft(initialTiers));
  const [saving, setSaving] = useState(false);
  const restaurantKey = restaurantId ?? "none";

  // Reset draft when switching restaurants or when parent reloads tiers.
  useEffect(() => {
    setDraft(tiersToDraft(initialTiers));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantKey, JSON.stringify(initialTiers ?? null)]);

  const parsed = useMemo(() => draftToTiers(draft), [draft]);
  const dirty = useMemo(() => {
    if ("error" in parsed) return true;
    return !tiersEqual(parsed, initialTiers);
  }, [parsed, initialTiers]);

  function handleAdd() {
    setDraft((prev) => {
      // Suggest a sensible next threshold: max existing + 4, or 8.
      const existing = prev
        .map((r) => Number.parseInt(r.min_party_size, 10))
        .filter((n) => Number.isFinite(n));
      const next = existing.length ? Math.max(...existing) + 4 : 8;
      return [...prev, { key: ADD_KEY(), min_party_size: String(next), amount_dollars: "" }];
    });
  }

  function handleRemove(key: string) {
    setDraft((prev) => prev.filter((r) => r.key !== key));
  }

  function handleField(key: string, field: "min_party_size" | "amount_dollars", value: string) {
    setDraft((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }

  function handleDiscard() {
    setDraft(tiersToDraft(initialTiers));
  }

  async function handleSave() {
    if (!restaurantId) {
      toast.error("No restaurant selected.");
      return;
    }
    if (!isSupabaseConfigured()) {
      toast.error("Supabase is not configured.");
      return;
    }
    if ("error" in parsed) {
      toast.error(parsed.error);
      return;
    }
    setSaving(true);
    const client = getSupabaseBrowserClient();
    const { error } = await client
      .from("restaurants")
      .update({ deposit_tiers: parsed })
      .eq("id", restaurantId);
    setSaving(false);
    if (error) {
      toast.error(`Couldn't save deposit policy: ${error.message}`);
      return;
    }
    toast.success(parsed.length === 0 ? "Deposit policy cleared." : "Deposit policy saved.");
    onSaved?.(parsed);
  }

  return (
    <Card>
      <div className="px-6 py-5 sm:px-7 sm:py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-serif text-xl text-white">Deposit policy</h3>
            <p className="mt-1 max-w-2xl text-sm text-text-muted">
              Charge a per-person deposit when parties cross a size threshold.
              Customers pay the <strong>highest applicable tier × party size</strong> — a
              party of 25 at a 20+ tier of $20/person pays $500 (not $750).
              {ceilingHint != null && ceilingHint > 0 ? (
                <>
                  {" "}
                  Your floor plan tops out at <strong>{ceilingHint} seats</strong>;
                  thresholds above that will never apply.
                </>
              ) : null}
            </p>
          </div>
        </div>
      </div>
      <div className="border-t border-border/50 px-6 py-5 sm:px-7">
        {draft.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 bg-bg-elevated/40 px-6 py-10 text-center">
            <p className="text-sm text-text-muted">No deposit policy yet.</p>
            <p className="max-w-md text-xs text-text-muted">
              Most restaurants leave this empty. Add a tier only if you want to
              collect a deposit for large parties.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
              <Plus className="mr-2 size-4" /> Add deposit tier
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-3 px-1 text-[10px] uppercase tracking-[0.2em] text-text-muted">
              <span>Min party size</span>
              <span>Amount per person</span>
              <span className="sr-only">Remove</span>
            </div>
            {draft.map((row) => (
              <div
                key={row.key}
                className="grid grid-cols-[1fr_1fr_auto] items-center gap-3"
              >
                <div className="relative">
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    step={1}
                    value={row.min_party_size}
                    onChange={(e) => handleField(row.key, "min_party_size", e.target.value)}
                    className="pr-12"
                    placeholder="8"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted">
                    +
                  </span>
                </div>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-text-muted">
                    $
                  </span>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={row.amount_dollars}
                    onChange={(e) => handleField(row.key, "amount_dollars", e.target.value)}
                    className="pl-7 pr-24"
                    placeholder="10.00"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted">
                    / person
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemove(row.key)}
                  aria-label="Remove tier"
                >
                  <Trash2 className="size-4 text-danger" />
                </Button>
              </div>
            ))}
            {"error" in parsed ? (
              <p className="text-xs text-warning">{parsed.error}</p>
            ) : null}
            <div className="flex items-center justify-between pt-2">
              <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
                <Plus className="mr-2 size-4" /> Add another tier
              </Button>
              <p className="text-xs text-text-muted">
                Stripe billing isn&apos;t live yet — tiers will display to customers
                but won&apos;t actually charge until payments are wired in.
              </p>
            </div>
          </div>
        )}
      </div>
      {dirty ? (
        <div className="flex items-center justify-end gap-2 border-t border-border/50 px-6 py-4 sm:px-7">
          <Button type="button" variant="outline" onClick={handleDiscard} disabled={saving}>
            Discard
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={saving || "error" in parsed}>
            {saving ? "Saving…" : "Save deposit policy"}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
