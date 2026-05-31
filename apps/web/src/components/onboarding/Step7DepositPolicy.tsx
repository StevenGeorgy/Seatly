import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RestaurantDepositTier } from "@/hooks/useStaffRestaurants";
import { useErrorToast } from "@/lib/errors";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { clearDraft, readDraft, useDraftAutosave } from "./draftPersistence";

type Step7DepositPolicyProps = {
  restaurantId: string;
  onComplete: () => void;
  onBusyChange: (busy: boolean) => void;
};

type DraftTier = {
  key: string;
  minParty: string;
  dollars: string;
};

type DepositChoice = "take" | "none";

const DEFAULT_TIER: DraftTier = {
  key: "seed",
  minParty: "8",
  dollars: "10.00",
};

function makeKey(): string {
  return `t-${crypto.randomUUID()}`;
}

function tiersToDraft(tiers: RestaurantDepositTier[] | null): DraftTier[] {
  if (!tiers || tiers.length === 0) return [];
  return tiers
    .slice()
    .sort((a, b) => a.min_party_size - b.min_party_size)
    .map((t) => ({
      key: makeKey(),
      minParty: String(t.min_party_size),
      dollars: (t.amount_per_person_cents / 100).toFixed(2),
    }));
}

type Step7DraftPayload = { choice: DepositChoice; draft: DraftTier[] };

export function Step7DepositPolicy({ restaurantId, onComplete, onBusyChange }: Step7DepositPolicyProps) {
  const { errorToast } = useErrorToast();
  const draftKey = `step7.${restaurantId}`;
  const draftSeed = useMemo(
    () => readDraft<Step7DraftPayload>(draftKey),
    // Read once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [choice, setChoice] = useState<DepositChoice>(draftSeed?.choice ?? "none");
  const [draft, setDraft] = useState<DraftTier[]>(draftSeed?.draft ?? []);
  // If we hydrated from a draft, skip the DB read so it can't clobber the
  // pending edits with whatever was last saved.
  const [hydrated, setHydrated] = useState<boolean>(draftSeed !== null);
  const [submitting, setSubmitting] = useState(false);

  useDraftAutosave<Step7DraftPayload>(draftKey, { choice, draft });

  useEffect(() => {
    if (hydrated) return;
    if (!isSupabaseConfigured()) {
      setHydrated(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      const client = getSupabaseBrowserClient();
      const { data } = await client
        .from("restaurants")
        .select("deposit_tiers")
        .eq("id", restaurantId)
        .maybeSingle();
      if (cancelled) return;
      const row = (data ?? null) as {
        deposit_tiers: RestaurantDepositTier[] | null;
      } | null;
      if (row?.deposit_tiers && row.deposit_tiers.length > 0) {
        setChoice("take");
        setDraft(tiersToDraft(row.deposit_tiers));
      } else if (row?.deposit_tiers && row.deposit_tiers.length === 0) {
        setChoice("none");
        setDraft([]);
      } else {
        setChoice("none");
        setDraft([]);
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, restaurantId]);

  const handleChoice = (next: DepositChoice) => {
    setChoice(next);
    if (next === "take" && draft.length === 0) {
      setDraft([{ ...DEFAULT_TIER, key: makeKey() }]);
    }
  };

  const addTier = () => {
    setDraft((prev) => {
      const existing = prev
        .map((r) => Number.parseInt(r.minParty, 10))
        .filter((n) => Number.isFinite(n));
      const next = existing.length ? Math.max(...existing) + 4 : 8;
      return [...prev, { key: makeKey(), minParty: String(next), dollars: "" }];
    });
  };

  const removeTier = (key: string) => {
    setDraft((prev) => prev.filter((r) => r.key !== key));
  };

  const updateTier = (key: string, field: "minParty" | "dollars", value: string) => {
    setDraft((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  };

  const parsed = useMemo<RestaurantDepositTier[] | { error: string }>(() => {
    if (choice === "none") return [];
    if (draft.length === 0) {
      return { error: "Add at least one deposit tier, or pick \"We don't take deposits\"." };
    }
    const seen = new Set<number>();
    const out: RestaurantDepositTier[] = [];
    for (const row of draft) {
      const minParty = Number.parseInt(row.minParty, 10);
      const dollars = Number.parseFloat(row.dollars);
      if (!Number.isFinite(minParty) || minParty < 1 || minParty > 50) {
        return { error: `Tier minimum party size must be between 1 and 50.` };
      }
      if (!Number.isFinite(dollars) || dollars < 0) {
        return { error: `Tier "${minParty}+" — amount must be 0 or more.` };
      }
      if (seen.has(minParty)) {
        return { error: `Two tiers share the same threshold (${minParty}+). Use unique thresholds.` };
      }
      seen.add(minParty);
      out.push({
        min_party_size: minParty,
        amount_per_person_cents: Math.round(dollars * 100),
      });
    }
    out.sort((a, b) => a.min_party_size - b.min_party_size);
    return out;
  }, [choice, draft]);

  const onSubmit = async () => {
    if ("error" in parsed) {
      toast.error(parsed.error);
      return;
    }
    if (!isSupabaseConfigured()) {
      toast.error("Supabase is not configured.");
      return;
    }
    setSubmitting(true);
    onBusyChange(true);
    try {
      const client = getSupabaseBrowserClient();
      const { error } = await client
        .from("restaurants")
        .update({
          deposit_tiers: parsed,
        })
        .eq("id", restaurantId);
      if (error) {
        errorToast(error, {
          context: "Couldn't save deposit policy",
          logTag: "[Step7DepositPolicy.saveRestaurant]",
        });
        return;
      }
      toast.success(parsed.length === 0 ? "No deposits set." : "Deposit policy saved.");
      clearDraft(draftKey);
      onComplete();
    } finally {
      setSubmitting(false);
      onBusyChange(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Deposit policy</h1>
        <p className="mt-1 text-sm text-text-muted">
          Decide whether you want to take a per-person deposit for large parties.
        </p>
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-bg-surface p-5">
        <h2 className="text-lg font-semibold">Choose an approach</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label
            className={`flex cursor-pointer flex-col gap-2 rounded-xl border p-4 transition-colors ${
              choice === "take" ? "border-gold bg-gold/5" : "border-border bg-bg-elevated/40"
            }`}
          >
            <div className="flex items-center gap-2">
              <input
                type="radio"
                name="deposit-choice"
                checked={choice === "take"}
                onChange={() => handleChoice("take")}
                className="size-4 accent-[color:var(--gold,#c9a84c)]"
              />
              <span className="text-sm font-semibold">We take deposits for large parties</span>
            </div>
            <p className="text-xs text-text-muted">
              Charge a per-person deposit when parties hit a threshold.
            </p>
          </label>
          <label
            className={`flex cursor-pointer flex-col gap-2 rounded-xl border p-4 transition-colors ${
              choice === "none" ? "border-gold bg-gold/5" : "border-border bg-bg-elevated/40"
            }`}
          >
            <div className="flex items-center gap-2">
              <input
                type="radio"
                name="deposit-choice"
                checked={choice === "none"}
                onChange={() => handleChoice("none")}
                className="size-4 accent-[color:var(--gold,#c9a84c)]"
              />
              <span className="text-sm font-semibold">We don't take deposits</span>
            </div>
            <p className="text-xs text-text-muted">
              Skip deposits. Diners book without paying upfront.
            </p>
          </label>
        </div>
      </section>

      <AnimatePresence initial={false}>
        {choice === "take" ? (
        <motion.section
          key="deposit-tiers"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          className="flex flex-col gap-3 overflow-hidden rounded-2xl border border-border bg-bg-surface p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Tiers</h2>
            <Button type="button" variant="outline" size="sm" onClick={addTier} className="gap-1.5">
              <Plus className="size-3.5" />
              Add another tier
            </Button>
          </div>
          {draft.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-bg-elevated/40 px-4 py-6 text-center text-sm text-text-muted">
              No tiers yet — add one to start.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-3 px-1 text-[10px] uppercase tracking-[0.2em] text-text-muted">
                <span>Min party size</span>
                <span>Amount per person</span>
                <span className="sr-only">Remove</span>
              </div>
              {draft.map((row) => (
                <div key={row.key} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
                  <div className="relative">
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      step={1}
                      value={row.minParty}
                      onChange={(e) => updateTier(row.key, "minParty", e.target.value)}
                      className="pr-10"
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
                      value={row.dollars}
                      onChange={(e) => updateTier(row.key, "dollars", e.target.value)}
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
                    onClick={() => removeTier(row.key)}
                    aria-label="Remove tier"
                  >
                    <Trash2 className="size-4 text-danger" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <p className="rounded-lg border border-border/50 bg-bg-elevated/40 px-3 py-2 text-xs text-text-muted">
            Customers pay the <strong>highest applicable tier × party size</strong> — a party of 25
            at a 20+ tier of $20/person pays $500.
          </p>
          {"error" in parsed ? (
            <p className="text-xs text-warning">{parsed.error}</p>
          ) : null}
        </motion.section>
        ) : null}
      </AnimatePresence>

      <div className="flex items-center justify-end">
        <Button id="wizard-step-submit" onClick={onSubmit} disabled={submitting} className="px-6">
          {submitting ? "Saving…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}
