import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useErrorToast } from "@/lib/errors";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

type Step5MenuProps = {
  restaurantId: string;
  onComplete: () => void;
  onBusyChange: (busy: boolean) => void;
};

type DraftCategory = {
  key: string;
  id: string | null;
  name: string;
  isTierSource: boolean;
  sortOrder: number;
};

type DraftItem = {
  key: string;
  id: string | null;
  categoryKey: string;
  name: string;
  priceDollars: string;
  sortOrder: number;
};

type CategoryRow = {
  id: string;
  name: string;
  is_pricing_tier_source: boolean | null;
  sort_order: number | null;
};

type ItemRow = {
  id: string;
  category_id: string | null;
  name: string;
  price: number | null;
  sort_order: number | null;
};

function makeKey(): string {
  return `m-${crypto.randomUUID()}`;
}

function priceLevelFromAverage(avg: number): 1 | 2 | 3 {
  if (avg < 20) return 1;
  if (avg < 40) return 2;
  return 3;
}

function priceLevelLabel(level: 1 | 2 | 3 | null): string {
  if (level === 1) return "$";
  if (level === 2) return "$$";
  if (level === 3) return "$$$";
  return "—";
}

const DEFAULT_TIER_CATEGORY_NAME = "Mains";

function defaultCategories(): DraftCategory[] {
  return [
    {
      key: makeKey(),
      id: null,
      name: DEFAULT_TIER_CATEGORY_NAME,
      isTierSource: true,
      sortOrder: 0,
    },
  ];
}

export function Step5Menu({ restaurantId, onComplete, onBusyChange }: Step5MenuProps) {
  const { errorToast } = useErrorToast();
  const [categories, setCategories] = useState<DraftCategory[]>(defaultCategories);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (hydrated) return;
    if (!isSupabaseConfigured()) {
      setHydrated(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      const client = getSupabaseBrowserClient();
      const [{ data: catRows }, { data: itemRows }] = await Promise.all([
        client
          .from("menu_categories")
          .select("id, name, is_pricing_tier_source, sort_order")
          .eq("restaurant_id", restaurantId)
          .eq("is_active", true)
          .order("sort_order", { ascending: true }),
        client
          .from("menu_items")
          .select("id, category_id, name, price, sort_order")
          .eq("restaurant_id", restaurantId)
          .eq("is_active", true)
          .order("sort_order", { ascending: true }),
      ]);
      if (cancelled) return;
      const cats = (catRows ?? []) as CategoryRow[];
      const itms = (itemRows ?? []) as ItemRow[];
      if (cats.length === 0) {
        setHydrated(true);
        return;
      }
      const drafts: DraftCategory[] = cats.map((c, index) => ({
        key: makeKey(),
        id: c.id,
        name: c.name,
        isTierSource: Boolean(c.is_pricing_tier_source),
        sortOrder: c.sort_order ?? index,
      }));
      if (!drafts.some((d) => d.isTierSource)) {
        const mains = drafts.find((d) => d.name.trim().toLowerCase() === "mains");
        if (mains) mains.isTierSource = true;
        else drafts[0].isTierSource = true;
      }
      const idToKey = new Map(drafts.filter((d) => d.id).map((d) => [d.id as string, d.key]));
      const draftItems: DraftItem[] = itms
        .filter((row) => row.category_id && idToKey.has(row.category_id))
        .map((row, index) => ({
          key: makeKey(),
          id: row.id,
          categoryKey: idToKey.get(row.category_id as string) as string,
          name: row.name,
          priceDollars: row.price != null ? row.price.toFixed(2) : "",
          sortOrder: row.sort_order ?? index,
        }));
      setCategories(drafts);
      setItems(draftItems);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, restaurantId]);

  const tierCategory = categories.find((c) => c.isTierSource) ?? null;
  const tierItems = useMemo(
    () => items.filter((i) => tierCategory && i.categoryKey === tierCategory.key),
    [items, tierCategory],
  );

  const averagePrice = useMemo(() => {
    const prices = tierItems
      .map((i) => Number.parseFloat(i.priceDollars))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (prices.length === 0) return null;
    return prices.reduce((a, b) => a + b, 0) / prices.length;
  }, [tierItems]);

  const derivedLevel = averagePrice != null ? priceLevelFromAverage(averagePrice) : null;

  const addCategory = () => {
    setCategories((prev) => [
      ...prev,
      {
        key: makeKey(),
        id: null,
        name: "",
        isTierSource: false,
        sortOrder: prev.length,
      },
    ]);
  };

  const removeCategory = (key: string) => {
    const cat = categories.find((c) => c.key === key);
    if (!cat) return;
    if (cat.isTierSource && categories.length > 1) {
      toast.error("Pick another tier source before removing this category.");
      return;
    }
    if (categories.length === 1) {
      toast.error("Keep at least one category.");
      return;
    }
    setCategories((prev) => prev.filter((c) => c.key !== key));
    setItems((prev) => prev.filter((i) => i.categoryKey !== key));
  };

  const renameCategory = (key: string, name: string) => {
    setCategories((prev) => prev.map((c) => (c.key === key ? { ...c, name } : c)));
  };

  const setTierSource = (key: string) => {
    setCategories((prev) => prev.map((c) => ({ ...c, isTierSource: c.key === key })));
  };

  const addItem = () => {
    if (!tierCategory) return;
    setItems((prev) => [
      ...prev,
      {
        key: makeKey(),
        id: null,
        categoryKey: tierCategory.key,
        name: "",
        priceDollars: "",
        sortOrder: prev.filter((i) => i.categoryKey === tierCategory.key).length,
      },
    ]);
  };

  const updateItem = (key: string, field: "name" | "priceDollars", value: string) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, [field]: value } : i)));
  };

  const removeItem = (key: string) => {
    setItems((prev) => prev.filter((i) => i.key !== key));
  };

  const onSubmit = async () => {
    if (!tierCategory) {
      toast.error("Pick one category as the pricing tier source.");
      return;
    }
    if (!tierCategory.name.trim()) {
      toast.error("Name your tier-source category.");
      return;
    }
    const trimmedTierItems = tierItems.filter((i) => i.name.trim().length > 0);
    if (trimmedTierItems.length < 3) {
      toast.error(`Add at least 3 items to "${tierCategory.name.trim()}".`);
      return;
    }
    for (const it of trimmedTierItems) {
      const price = Number.parseFloat(it.priceDollars);
      if (!Number.isFinite(price) || price <= 0) {
        toast.error(`"${it.name.trim()}" needs a price greater than $0.`);
        return;
      }
    }
    for (const c of categories) {
      if (!c.name.trim()) {
        toast.error("Every category needs a name.");
        return;
      }
    }
    if (!isSupabaseConfigured()) {
      toast.error("Supabase is not configured.");
      return;
    }
    setSubmitting(true);
    onBusyChange(true);
    try {
      const client = getSupabaseBrowserClient();

      // Clear is_pricing_tier_source on all existing categories first so the
      // unique partial index never sees two true rows during the upsert.
      const existingIds = categories.filter((c) => c.id).map((c) => c.id as string);
      if (existingIds.length > 0) {
        const { error: clearErr } = await client
          .from("menu_categories")
          .update({ is_pricing_tier_source: false })
          .eq("restaurant_id", restaurantId)
          .in("id", existingIds);
        if (clearErr) {
          errorToast(clearErr, {
            context: "Couldn't update categories",
            logTag: "[Step5Menu.clearTierFlags]",
          });
          return;
        }
      }
      const { error: clearAllErr } = await client
        .from("menu_categories")
        .update({ is_pricing_tier_source: false })
        .eq("restaurant_id", restaurantId)
        .eq("is_pricing_tier_source", true);
      if (clearAllErr) {
        errorToast(clearAllErr, {
          context: "Couldn't reset tier flag",
          logTag: "[Step5Menu.clearAllTierFlags]",
        });
        return;
      }

      const keyToCategoryId = new Map<string, string>();
      for (const cat of categories) {
        const trimmedName = cat.name.trim();
        if (cat.id) {
          const { error } = await client
            .from("menu_categories")
            .update({
              name: trimmedName,
              sort_order: cat.sortOrder,
              is_pricing_tier_source: cat.isTierSource,
            })
            .eq("id", cat.id);
          if (error) {
            errorToast(error, {
              context: `Couldn't save category "${trimmedName}"`,
              logTag: "[Step5Menu.updateCategory]",
            });
            return;
          }
          keyToCategoryId.set(cat.key, cat.id);
        } else {
          const { data: inserted, error } = await client
            .from("menu_categories")
            .insert({
              restaurant_id: restaurantId,
              name: trimmedName,
              sort_order: cat.sortOrder,
              is_active: true,
              is_pricing_tier_source: cat.isTierSource,
            })
            .select("id")
            .single();
          if (error || !inserted) {
            errorToast(error, {
              context: `Couldn't add category "${trimmedName}"`,
              fallback: "Couldn't add category. Try again.",
              logTag: "[Step5Menu.insertCategory]",
            });
            return;
          }
          keyToCategoryId.set(cat.key, (inserted as { id: string }).id);
        }
      }

      // Items: only persist for the tier-source category in this wizard step.
      for (const it of trimmedTierItems) {
        const categoryId = keyToCategoryId.get(it.categoryKey);
        if (!categoryId) continue;
        const price = Number.parseFloat(it.priceDollars);
        const categoryName = categories.find((c) => c.key === it.categoryKey)?.name.trim() ?? null;
        if (it.id) {
          const { error } = await client
            .from("menu_items")
            .update({
              name: it.name.trim(),
              price,
              category_id: categoryId,
              category: categoryName,
              sort_order: it.sortOrder,
              is_active: true,
              is_available: true,
            })
            .eq("id", it.id);
          if (error) {
            errorToast(error, {
              context: `Couldn't save item "${it.name.trim()}"`,
              logTag: "[Step5Menu.updateItem]",
            });
            return;
          }
        } else {
          const { error } = await client.from("menu_items").insert({
            restaurant_id: restaurantId,
            category_id: categoryId,
            category: categoryName,
            name: it.name.trim(),
            price,
            sort_order: it.sortOrder,
            is_active: true,
            is_available: true,
            is_preorderable: false,
            is_featured: false,
          });
          if (error) {
            errorToast(error, {
              context: `Couldn't add item "${it.name.trim()}"`,
              logTag: "[Step5Menu.insertItem]",
            });
            return;
          }
        }
      }

      if (derivedLevel != null) {
        const { error: priceErr } = await client
          .from("restaurants")
          .update({ price_range: derivedLevel })
          .eq("id", restaurantId);
        if (priceErr) {
          errorToast(priceErr, {
            context: "Couldn't update price level",
            logTag: "[Step5Menu.updatePriceLevel]",
          });
          return;
        }
      }

      toast.success("Menu saved.");
      onComplete();
    } finally {
      setSubmitting(false);
      onBusyChange(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Menu</h1>
        <p className="mt-1 text-sm text-text-muted">
          Add your menu sections and the dishes diners can order from. Pick one section to set
          your price level on Discover.
        </p>
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-bg-surface p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Categories</h2>
            <p className="text-xs text-text-muted">
              The "Use for pricing tier" section drives your $/$$/$$$ rating.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addCategory} className="gap-1.5">
            <Plus className="size-3.5" />
            Add category
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          {categories.map((cat) => (
            <div
              key={cat.key}
              className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-bg-elevated/40 p-3 sm:grid-cols-[1fr_auto_auto] sm:items-center"
            >
              <Input
                value={cat.name}
                onChange={(e) => renameCategory(cat.key, e.target.value)}
                placeholder="e.g. Mains"
                className="h-9"
              />
              <label className="flex items-center gap-2 text-xs text-text-secondary">
                <input
                  type="radio"
                  name="tier-source"
                  checked={cat.isTierSource}
                  onChange={() => setTierSource(cat.key)}
                  className="size-3.5 accent-[color:var(--gold,#c9a84c)]"
                />
                Use for pricing tier
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeCategory(cat.key)}
                aria-label="Remove category"
                className="text-danger hover:text-danger"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
        <p className="text-xs text-text-muted">
          Add items to other categories later from the Menu page.
        </p>
      </section>

      {tierCategory ? (
        <section className="flex flex-col gap-3 rounded-2xl border border-border bg-bg-surface p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">
                Items in "{tierCategory.name.trim() || "your tier section"}"
              </h2>
              <p className="text-xs text-text-muted">
                Add at least 3 items. Prices help us set your price level.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addItem} className="gap-1.5">
              <Plus className="size-3.5" />
              Add item
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            {tierItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 bg-bg-elevated/40 px-4 py-8 text-center text-sm text-text-muted">
                No items yet. Click "Add item" to start.
              </div>
            ) : (
              tierItems.map((item) => (
                <div
                  key={item.key}
                  className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-bg-elevated/40 p-3 sm:grid-cols-[1fr_140px_auto] sm:items-center"
                >
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`item-name-${item.key}`} className="sr-only">
                      Item name
                    </Label>
                    <Input
                      id={`item-name-${item.key}`}
                      value={item.name}
                      onChange={(e) => updateItem(item.key, "name", e.target.value)}
                      placeholder="e.g. Ribeye"
                      className="h-9"
                    />
                  </div>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-text-muted">
                      $
                    </span>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.priceDollars}
                      onChange={(e) => updateItem(item.key, "priceDollars", e.target.value)}
                      placeholder="0.00"
                      className="h-9 pl-7"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeItem(item.key)}
                    aria-label="Remove item"
                    className="text-danger hover:text-danger"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))
            )}
          </div>

          <div className="mt-2 flex items-center justify-between rounded-xl border border-gold/30 bg-gold/5 px-4 py-3">
            <div className="text-sm text-text-secondary">
              {averagePrice != null ? (
                <>
                  Based on your{" "}
                  <strong>{tierCategory.name.trim() || "tier section"}</strong> (avg{" "}
                  <strong>${averagePrice.toFixed(2)} CAD</strong>), your restaurant is{" "}
                  <strong className="text-gold">{priceLevelLabel(derivedLevel)}</strong>.
                  <br />
                  Diners see this in search filters.
                </>
              ) : (
                <>Add 3+ priced items to derive your price level.</>
              )}
            </div>
          </div>
        </section>
      ) : null}

      <div className="flex items-center justify-end">
        <Button id="wizard-step-submit" onClick={onSubmit} disabled={submitting} className="px-6">
          {submitting ? "Saving…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}
