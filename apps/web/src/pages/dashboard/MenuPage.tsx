import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon, MoreVertical, Pencil, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { MenuSuggestionsPanel } from "@/components/dashboard/menu/MenuSuggestionsPanel";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { useMenuCategories, useMenuItems, type MenuCategoryRow, type MenuItemRow } from "@/hooks/useMenuItems";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/formatCurrency";

const DEMO_RESTAURANT_ID = "demo-menu";

const DEMO_CATEGORIES: MenuCategoryRow[] = [
  { id: "snacks", restaurant_id: DEMO_RESTAURANT_ID, name: "Snacks", name_fr: null, description: "Small bites", sort_order: 0, available_from: null, available_to: null, is_active: true },
  { id: "hors-doeuvre", restaurant_id: DEMO_RESTAURANT_ID, name: "Hors-d'oeuvre", name_fr: null, description: "Opening plates", sort_order: 1, available_from: null, available_to: null, is_active: true },
  { id: "mains", restaurant_id: DEMO_RESTAURANT_ID, name: "Mains", name_fr: null, description: "Larger plates", sort_order: 2, available_from: null, available_to: null, is_active: true },
  { id: "desserts", restaurant_id: DEMO_RESTAURANT_ID, name: "Desserts", name_fr: null, description: "Sweet finish", sort_order: 3, available_from: null, available_to: null, is_active: true },
  { id: "wine", restaurant_id: DEMO_RESTAURANT_ID, name: "Wine", name_fr: null, description: "By glass and bottle", sort_order: 4, available_from: null, available_to: null, is_active: true },
];

const DEMO_ITEMS: MenuItemRow[] = [
  { id: "demo-white-asparagus", restaurant_id: DEMO_RESTAURANT_ID, category_id: "hors-doeuvre", category: "Hors-d'oeuvre", name: "White asparagus", name_fr: null, description: "Smoked egg, brown butter", description_fr: null, price: 27, cost_price: 8.4, photo_url: null, allergens: ["GF"], dietary_flags: ["Vegetarian"], calories: null, is_available: true, is_preorderable: false, is_featured: true, is_active: true, preparation_time_minutes: 8, spice_level: null, loyalty_points_value: null, sort_order: 0 },
  { id: "demo-trout", restaurant_id: DEMO_RESTAURANT_ID, category_id: "hors-doeuvre", category: "Hors-d'oeuvre", name: "Trout · cured 18h", name_fr: null, description: "Côte-Nord, koji, sea aster", description_fr: null, price: 24, cost_price: 6.1, photo_url: null, allergens: ["GF"], dietary_flags: null, calories: null, is_available: true, is_preorderable: false, is_featured: false, is_active: true, preparation_time_minutes: 6, spice_level: null, loyalty_points_value: null, sort_order: 1 },
  { id: "demo-sardines", restaurant_id: DEMO_RESTAURANT_ID, category_id: "hors-doeuvre", category: "Hors-d'oeuvre", name: "Sardines · grilled", name_fr: null, description: "Citrus, olive, sourdough", description_fr: null, price: 19, cost_price: 0.4, photo_url: null, allergens: [], dietary_flags: null, calories: null, is_available: true, is_preorderable: false, is_featured: false, is_active: true, preparation_time_minutes: 10, spice_level: null, loyalty_points_value: null, sort_order: 2 },
  { id: "demo-bread", restaurant_id: DEMO_RESTAURANT_ID, category_id: "hors-doeuvre", category: "Hors-d'oeuvre", name: "Bread service", name_fr: null, description: "Sourdough, cultured butter", description_fr: null, price: 9, cost_price: 1.2, photo_url: null, allergens: [], dietary_flags: ["Vegetarian"], calories: null, is_available: true, is_preorderable: false, is_featured: false, is_active: true, preparation_time_minutes: 4, spice_level: null, loyalty_points_value: null, sort_order: 3 },
  { id: "demo-olives", restaurant_id: DEMO_RESTAURANT_ID, category_id: "snacks", category: "Snacks", name: "Warm olives", name_fr: null, description: "Bay, orange, coriander", description_fr: null, price: 8, cost_price: 1, photo_url: null, allergens: [], dietary_flags: ["Vegan", "GF"], calories: null, is_available: true, is_preorderable: false, is_featured: false, is_active: true, preparation_time_minutes: 3, spice_level: null, loyalty_points_value: null, sort_order: 0 },
  { id: "demo-hen", restaurant_id: DEMO_RESTAURANT_ID, category_id: "mains", category: "Mains", name: "Cornish hen", name_fr: null, description: "Leek, jus, turnip", description_fr: null, price: 38, cost_price: 12, photo_url: null, allergens: [], dietary_flags: null, calories: null, is_available: true, is_preorderable: false, is_featured: false, is_active: true, preparation_time_minutes: 22, spice_level: null, loyalty_points_value: null, sort_order: 0 },
  { id: "demo-tart", restaurant_id: DEMO_RESTAURANT_ID, category_id: "desserts", category: "Desserts", name: "Maple tart", name_fr: null, description: "Creme fraiche, buckwheat", description_fr: null, price: 13, cost_price: 3, photo_url: null, allergens: ["GF"], dietary_flags: ["Vegetarian"], calories: null, is_available: true, is_preorderable: false, is_featured: false, is_active: true, preparation_time_minutes: 5, spice_level: null, loyalty_points_value: null, sort_order: 0 },
  { id: "demo-gamay", restaurant_id: DEMO_RESTAURANT_ID, category_id: "wine", category: "Wine", name: "Gamay · Niagara", name_fr: null, description: "Red cherry, graphite", description_fr: null, price: 17, cost_price: 5, photo_url: null, allergens: [], dietary_flags: null, calories: null, is_available: true, is_preorderable: false, is_featured: false, is_active: true, preparation_time_minutes: 1, spice_level: null, loyalty_points_value: null, sort_order: 0 },
];

const TAG_OPTIONS = ["Vegetarian", "Vegan", "GF", "DF", "Spicy", "Signature"];

export default function MenuPage() {
  const { t } = useTranslation();
  const { selectedRestaurant, selectedRestaurantId } = useRestaurantScope();
  const currency = selectedRestaurant?.currency ?? "cad";
  const { categories, loading: catLoading, refetch: refetchCats } = useMenuCategories();
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>("hors-doeuvre");
  const { items, loading: itemsLoading, refetch } = useMenuItems(selectedCategory);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);

  const [localCategories, setLocalCategories] = useState<MenuCategoryRow[]>([]);
  const [localItems, setLocalItems] = useState<MenuItemRow[]>([]);
  const [hiddenItemIds, setHiddenItemIds] = useState<Set<string>>(() => new Set());
  const [availabilityOverrides, setAvailabilityOverrides] = useState<Record<string, boolean>>({});

  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatDesc, setNewCatDesc] = useState("");
  const [savingCat, setSavingCat] = useState(false);

  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<MenuItemRow | null>(null);
  const [itemName, setItemName] = useState("");
  const [itemDesc, setItemDesc] = useState("");
  const [itemPrice, setItemPrice] = useState("");
  const [itemCategory, setItemCategory] = useState<string>("");
  const [itemTags, setItemTags] = useState<string[]>([]);
  const [itemFeatured, setItemFeatured] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const displayCategories = useMemo(() => {
    const base = categories.length > 0 ? categories : DEMO_CATEGORIES;
    return [...base, ...localCategories].sort((a, b) => a.sort_order - b.sort_order);
  }, [categories, localCategories]);

  const activeCategoryId = selectedCategory ?? displayCategories[0]?.id;
  const activeCategory = displayCategories.find((category) => category.id === activeCategoryId) ?? displayCategories[0];

  const displayItems = useMemo(() => {
    const baseItems = items.length > 0 ? items : DEMO_ITEMS;
    const rows = [...baseItems, ...localItems]
      .filter((item) => !hiddenItemIds.has(item.id))
      .map((item) => ({
        ...item,
        is_available: availabilityOverrides[item.id] ?? item.is_available,
      }));
    return activeCategoryId ? rows.filter((item) => item.category_id === activeCategoryId) : rows;
  }, [activeCategoryId, availabilityOverrides, hiddenItemIds, items, localItems]);

  const countsByCategory = useMemo(() => {
    const rows = [...(items.length > 0 ? items : DEMO_ITEMS), ...localItems].filter(
      (item) => !hiddenItemIds.has(item.id),
    );
    return new Map(displayCategories.map((category) => [
      category.id,
      rows.filter((item) => item.category_id === category.id).length,
    ]));
  }, [displayCategories, hiddenItemIds, items, localItems]);

  const loading = catLoading || itemsLoading;
  const featuredCount = displayItems.filter((item) => item.is_featured).length;

  const resetItemForm = () => {
    setItemName("");
    setItemDesc("");
    setItemPrice("");
    setItemCategory(activeCategory?.id ?? displayCategories[0]?.id ?? "");
    setItemTags([]);
    setItemFeatured(false);
  };

  const openAddItem = () => {
    setEditItem(null);
    resetItemForm();
    setItemModalOpen(true);
  };

  const openEditItem = (item: MenuItemRow) => {
    setEditItem(item);
    setItemName(item.name);
    setItemDesc(item.description ?? "");
    setItemPrice(String(item.price));
    setItemCategory(item.category_id ?? activeCategory?.id ?? "");
    setItemTags([...(item.dietary_flags ?? []), ...(item.allergens ?? [])]);
    setItemFeatured(item.is_featured);
    setItemModalOpen(true);
  };

  const toggleTag = (tag: string) => {
    setItemTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag],
    );
  };

  const handleAddCategory = async () => {
    if (!newCatName.trim()) {
      toast.error("Category name is required.");
      return;
    }
    setSavingCat(true);
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      const category: MenuCategoryRow = {
        id: `local-cat-${Date.now()}`,
        restaurant_id: DEMO_RESTAURANT_ID,
        name: newCatName.trim(),
        name_fr: null,
        description: newCatDesc.trim() || null,
        sort_order: displayCategories.length,
        available_from: null,
        available_to: null,
        is_active: true,
      };
      setLocalCategories((current) => [...current, category]);
      setSelectedCategory(category.id);
      setSavingCat(false);
      setCategoryModalOpen(false);
      setNewCatName("");
      setNewCatDesc("");
      toast.success("Category added.");
      return;
    }

    const client = getSupabaseBrowserClient();
    const { error } = await client.from("menu_categories").insert({
      restaurant_id: selectedRestaurantId,
      name: newCatName.trim(),
      description: newCatDesc.trim() || null,
      sort_order: displayCategories.length,
      is_active: true,
    });
    setSavingCat(false);
    if (error) {
      toast.error("Could not add category.");
      return;
    }
    setCategoryModalOpen(false);
    setNewCatName("");
    setNewCatDesc("");
    void refetchCats();
    toast.success("Category added.");
  };

  const handleSaveItem = async () => {
    if (!itemName.trim()) {
      toast.error("Name is required.");
      return;
    }

    const payload = {
      name: itemName.trim(),
      description: itemDesc.trim() || null,
      price: parseFloat(itemPrice) || 0,
      category_id: itemCategory || null,
      restaurant_id: selectedRestaurantId ?? DEMO_RESTAURANT_ID,
      dietary_flags: itemTags.filter((tag) => !tag.includes("GF") && !tag.includes("DF")),
      allergens: itemTags.filter((tag) => tag === "GF" || tag === "DF"),
      is_featured: itemFeatured,
    };

    setSavingItem(true);
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      if (editItem) {
        setLocalItems((current) =>
          current.map((item) => (item.id === editItem.id ? { ...item, ...payload } : item)),
        );
      } else {
        setLocalItems((current) => [
          ...current,
          {
            id: `local-item-${Date.now()}`,
            name_fr: null,
            description_fr: null,
            cost_price: null,
            photo_url: null,
            calories: null,
            is_available: true,
            is_preorderable: false,
            is_active: true,
            preparation_time_minutes: null,
            spice_level: itemTags.includes("Spicy") ? "medium" : null,
            loyalty_points_value: null,
            sort_order: displayItems.length,
            category: displayCategories.find((category) => category.id === itemCategory)?.name ?? null,
            ...payload,
          },
        ]);
      }
      setSavingItem(false);
      setItemModalOpen(false);
      toast.success(editItem ? "Item updated." : "Item added.");
      return;
    }

    const client = getSupabaseBrowserClient();
    if (editItem) {
      const { error } = await client.from("menu_items").update(payload).eq("id", editItem.id);
      if (error) {
        toast.error("Could not update item.");
        setSavingItem(false);
        return;
      }
      toast.success("Item updated.");
    } else {
      const { error } = await client.from("menu_items").insert({
        ...payload,
        is_available: true,
        is_active: true,
        is_preorderable: false,
        sort_order: displayItems.length,
      });
      if (error) {
        toast.error("Could not add item.");
        setSavingItem(false);
        return;
      }
      toast.success("Item added.");
    }
    setSavingItem(false);
    setItemModalOpen(false);
    void refetch();
  };

  const toggle86 = async (itemId: string, currentlyAvailable: boolean) => {
    if (!selectedRestaurantId || !isSupabaseConfigured() || itemId.startsWith("demo-") || itemId.startsWith("local-")) {
      setAvailabilityOverrides((current) => ({ ...current, [itemId]: !currentlyAvailable }));
      return;
    }
    const client = getSupabaseBrowserClient();
    await client.from("menu_items").update({ is_available: !currentlyAvailable }).eq("id", itemId);
    void refetch();
  };

  const handleDeleteItem = async (id: string) => {
    if (!selectedRestaurantId || !isSupabaseConfigured() || id.startsWith("demo-") || id.startsWith("local-")) {
      setHiddenItemIds((current) => new Set(current).add(id));
      setDeleteId(null);
      toast.success("Item removed.");
      return;
    }
    const client = getSupabaseBrowserClient();
    const { error } = await client.from("menu_items").update({ is_active: false }).eq("id", id);
    if (error) {
      toast.error("Could not delete item.");
      return;
    }
    toast.success("Item removed.");
    setDeleteId(null);
    void refetch();
  };

  return (
    <AnimatedPage className="min-h-full bg-bg-base">
      <div className="border-b border-border bg-bg-base px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-gold/70">
              Spring 2026 · {displayCategories.length} categories · {displayItems.length} items
            </p>
            <h1 className="mt-2 font-serif text-4xl leading-none text-white">Menu</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-border bg-bg-surface px-3 py-2 text-xs text-text-secondary"
            >
              Sat, Apr 27
            </button>
            <button
              type="button"
              className="rounded-full border border-border bg-bg-surface p-2 text-text-secondary"
              onClick={() => setAiPanelOpen((open) => !open)}
            >
              <Sparkles className="size-4" />
            </button>
          </div>
        </div>
      </div>

      <section className="border-b border-border bg-bg-base px-6 py-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-muted">Section</p>
            <h2 className="mt-2 font-serif text-5xl leading-none text-white">{activeCategory?.name ?? "Menu"}</h2>
            <p className="mt-2 text-xs text-text-muted">
              {displayItems.length} items · {featuredCount} featured
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
              <Input
                className="h-9 w-64 rounded-lg border-border bg-bg-base pl-9 text-xs"
                placeholder="Search this section"
              />
            </div>
            <Button className="h-9 gap-2 rounded-lg px-4 text-xs" onClick={openAddItem}>
              <Plus className="size-3.5" />
              New item
            </Button>
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between border-b border-border bg-bg-base px-6">
        <div className="flex min-w-0 items-center gap-6 overflow-x-auto">
          {displayCategories.map((category) => {
            const active = category.id === activeCategory?.id;
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => setSelectedCategory(category.id)}
                className={cn(
                  "shrink-0 border-b py-4 text-xs transition-colors",
                  active
                    ? "border-gold text-gold"
                    : "border-transparent text-text-muted hover:text-text-secondary",
                )}
              >
                {category.name} <span className="ml-1 text-[10px]">{countsByCategory.get(category.id) ?? 0}</span>
              </button>
            );
          })}
        </div>
        <Button
          variant="ghost"
          className="h-9 shrink-0 gap-2 rounded-lg px-3 text-xs text-gold hover:bg-gold/10 hover:text-gold"
          onClick={() => setCategoryModalOpen(true)}
        >
          <Plus className="size-3.5" />
          New category
        </Button>
      </div>

      <div className="px-6 py-5">
        {aiPanelOpen ? (
          <div className="mb-5">
            <MenuSuggestionsPanel onClose={() => setAiPanelOpen(false)} />
          </div>
        ) : (
          <div className="mb-5 flex items-center justify-between rounded-xl border border-gold/20 bg-gold/5 px-4 py-3">
            <p className="text-xs text-text-secondary">
              <span className="font-mono uppercase tracking-[0.18em] text-gold">CenaIva AI</span>
              {" "}Replace Sardines (0.4% order rate) with Burrata & stone fruit — trending in similar venues.
            </p>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="h-8 text-xs text-text-muted">Dismiss</Button>
              <Button size="sm" className="h-8 rounded-lg px-3 text-xs" onClick={() => setAiPanelOpen(true)}>
                Try it
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-[292px] rounded-xl" />
            ))}
          </div>
        ) : displayItems.length === 0 ? (
          <EmptyState
            title={t("dashboard.menu.noItems")}
            description={t("dashboard.menu.noItemsDesc")}
            action={<Button onClick={openAddItem}>New item</Button>}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <AnimatePresence mode="popLayout">
              {displayItems.map((item, index) => (
                <MenuCard
                  key={item.id}
                  item={item}
                  index={index}
                  currency={currency}
                  onEdit={() => openEditItem(item)}
                  onDelete={() => setDeleteId(item.id)}
                  onToggleAvailable={() => void toggle86(item.id, item.is_available)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <Dialog open={itemModalOpen} onOpenChange={setItemModalOpen}>
        <DialogContent className="max-w-3xl border-gold/30 bg-bg-surface p-8 text-text-primary" showCloseButton={false}>
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.24em] text-text-muted">Add to menu</p>
                <DialogTitle className="mt-2 font-serif text-4xl font-normal text-white">
                  {editItem ? "Edit item" : "New item"}
                </DialogTitle>
              </div>
              <button type="button" className="text-text-muted hover:text-white" onClick={() => setItemModalOpen(false)}>
                <X className="size-5" />
              </button>
            </div>
          </DialogHeader>

          <div className="mt-4 space-y-6">
            <div>
              <Label className="font-mono text-xs uppercase tracking-[0.22em] text-text-muted">Photo</Label>
              <div className="mt-3 flex h-36 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-bg-base text-text-muted">
                <ImageIcon className="size-7" />
                <p className="mt-3 text-sm">Add a photo</p>
                <p className="mt-1 text-xs">JPG or PNG · drop or click</p>
              </div>
            </div>

            <div>
              <Label className="font-mono text-xs uppercase tracking-[0.22em] text-text-muted">Name</Label>
              <Input
                value={itemName}
                onChange={(event) => setItemName(event.target.value)}
                className="mt-3 h-14 rounded-xl border-border bg-bg-elevated text-base"
                placeholder="e.g. Burrata & stone fruit"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
              <div>
                <Label className="font-mono text-xs uppercase tracking-[0.22em] text-text-muted">Category</Label>
                <Select value={itemCategory} onValueChange={setItemCategory}>
                  <SelectTrigger className="mt-3 h-12 rounded-xl border-border bg-bg-base">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {displayCategories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="font-mono text-xs uppercase tracking-[0.22em] text-text-muted">Price ($)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={itemPrice}
                  onChange={(event) => setItemPrice(event.target.value)}
                  className="mt-3 h-12 rounded-xl border-border bg-bg-base text-base"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div>
              <Label className="font-mono text-xs uppercase tracking-[0.22em] text-text-muted">Description</Label>
              <Textarea
                rows={3}
                value={itemDesc}
                onChange={(event) => setItemDesc(event.target.value)}
                className="mt-3 rounded-xl border-border bg-bg-base text-base"
                placeholder="Two or three ingredients, plainly named."
              />
            </div>

            <div>
              <Label className="font-mono text-xs uppercase tracking-[0.22em] text-text-muted">Tags</Label>
              <div className="mt-3 flex flex-wrap gap-2">
                {TAG_OPTIONS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={cn(
                      "rounded-full border px-4 py-2 text-sm transition-colors",
                      itemTags.includes(tag)
                        ? "border-gold bg-gold/15 text-gold"
                        : "border-border bg-bg-base text-text-secondary hover:text-white",
                    )}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-3 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={itemFeatured}
                onChange={(event) => setItemFeatured(event.target.checked)}
                className="size-4 accent-gold"
              />
              Mark as featured
            </label>
          </div>

          <DialogFooter className="-mx-8 -mb-8 mt-7 border-border bg-bg-surface px-8 py-5">
            <Button variant="ghost" onClick={() => setItemModalOpen(false)}>Cancel</Button>
            <Button disabled={savingItem} onClick={() => void handleSaveItem()} className="min-w-36">
              {savingItem ? "Saving..." : editItem ? "Save changes" : "Add to menu"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={categoryModalOpen} onOpenChange={setCategoryModalOpen}>
        <DialogContent className="max-w-xl border-gold/30 bg-bg-surface p-8 text-text-primary" showCloseButton={false}>
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.24em] text-text-muted">Add to menu</p>
                <DialogTitle className="mt-2 font-serif text-4xl font-normal text-white">New category</DialogTitle>
              </div>
              <button type="button" className="text-text-muted hover:text-white" onClick={() => setCategoryModalOpen(false)}>
                <X className="size-5" />
              </button>
            </div>
          </DialogHeader>
          <div className="mt-5 space-y-5">
            <div>
              <Label className="font-mono text-xs uppercase tracking-[0.22em] text-text-muted">Name</Label>
              <Input
                value={newCatName}
                onChange={(event) => setNewCatName(event.target.value)}
                className="mt-3 h-12 rounded-xl border-border bg-bg-elevated"
                placeholder="e.g. Hors-d'oeuvre"
              />
            </div>
            <div>
              <Label className="font-mono text-xs uppercase tracking-[0.22em] text-text-muted">Description</Label>
              <Textarea
                value={newCatDesc}
                onChange={(event) => setNewCatDesc(event.target.value)}
                className="mt-3 rounded-xl border-border bg-bg-base"
                placeholder="Short note for this section."
              />
            </div>
          </div>
          <DialogFooter className="-mx-8 -mb-8 mt-7 border-border bg-bg-surface px-8 py-5">
            <Button variant="ghost" onClick={() => setCategoryModalOpen(false)}>Cancel</Button>
            <Button disabled={savingCat} onClick={() => void handleAddCategory()} className="min-w-36">
              {savingCat ? "Saving..." : "Add category"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteId} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Remove menu item?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-secondary">This item will be hidden from the menu. This cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteId && void handleDeleteItem(deleteId)}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AnimatedPage>
  );
}

function MenuCard({
  item,
  index,
  currency,
  onEdit,
  onDelete,
  onToggleAvailable,
}: {
  item: MenuItemRow;
  index: number;
  currency: string;
  onEdit: () => void;
  onDelete: () => void;
  onToggleAvailable: () => void;
}) {
  const margin = item.cost_price && item.price > 0 ? ((item.price - item.cost_price) / item.price) * 100 : null;
  const orderDelta = item.id.includes("sardines") ? "-22%" : item.id.includes("trout") ? "+4%" : "+1%";

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.24, delay: index * 0.03 }}
      className="group overflow-hidden rounded-xl border border-border bg-bg-surface shadow-xl shadow-black/20 transition-colors hover:border-gold/35"
    >
      <div className="relative h-32 overflow-hidden border-b border-border bg-gold/10">
        <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,rgba(201,168,76,0.14)_0,rgba(201,168,76,0.14)_4px,transparent_4px,transparent_12px)]" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex size-8 items-center justify-center rounded-full border border-gold/35 text-gold/45">
            <ImageIcon className="size-4" />
          </div>
        </div>
        {item.is_featured ? (
          <span className="absolute left-3 top-3 rounded bg-gold/80 px-2 py-1 text-[10px] font-medium text-bg-base">
            Featured
          </span>
        ) : null}
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-serif text-lg leading-tight text-white">{item.name}</h3>
            <p className="mt-2 line-clamp-1 text-xs text-text-muted">{item.description}</p>
          </div>
          <div className="flex shrink-0 items-start gap-1">
            <span className="font-serif text-xl text-gold">{formatCurrency(item.price, currency)}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="size-7 text-text-muted opacity-0 transition-opacity group-hover:opacity-100">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="mr-2 size-3.5" /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onToggleAvailable}>
                  {item.is_available ? "86 item" : "Restore item"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
                  <Trash2 className="mr-2 size-3.5" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="mt-5 flex min-h-5 flex-wrap gap-1.5">
          {item.dietary_flags?.slice(0, 2).map((tag) => (
            <span key={tag} className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
              {tag}
            </span>
          ))}
          {item.allergens?.slice(0, 2).map((tag) => (
            <span key={tag} className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
              {tag}
            </span>
          ))}
          {!item.is_available ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-danger">86'd</span>
          ) : null}
        </div>

        <div className="mt-5 flex items-end justify-between">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Margin</p>
            <p className="mt-1 text-xs text-white">{margin == null ? "-" : `${margin.toFixed(1)}%`}</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Orders</p>
            <p className="mt-1 text-xs text-white">{item.cost_price?.toFixed(1) ?? "1.2"}% · {orderDelta}</p>
          </div>
        </div>

        {item.id.includes("sardines") ? (
          <div className="mt-3 rounded-lg border border-danger/20 bg-danger/10 p-3 text-[11px] text-text-muted">
            Underperforming — consider revising or rotating out.
          </div>
        ) : null}
      </div>
    </motion.article>
  );
}
