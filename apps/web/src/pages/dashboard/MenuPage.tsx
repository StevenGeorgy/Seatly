import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon, Pencil, Plus, Search, Sparkles, Trash2, Upload, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { MenuSuggestionsPanel } from "@/components/dashboard/menu/MenuSuggestionsPanel";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import {
  MENU_IMAGE_ACCEPT,
  MENU_IMAGE_SUPPORT_MESSAGE,
  resolveMenuItemImage,
  useMenuCategories,
  useMenuItems,
  PRICE_LEVEL_MENU_CATEGORY_NAMES,
  type MenuCategoryRow,
  type MenuItemRow,
} from "@/hooks/useMenuItems";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/formatCurrency";

const DEMO_RESTAURANT_ID = "demo-menu";
const MENU_ITEM_DESCRIPTION_MAX_LENGTH = 120;
const MENU_CATEGORY_DESCRIPTION_MAX_LENGTH = 90;

const DEMO_CATEGORIES: MenuCategoryRow[] = [
  { id: "snacks", restaurant_id: DEMO_RESTAURANT_ID, name: "Snacks", name_fr: null, description: "Small bites", sort_order: 0, available_from: null, available_to: null, is_active: true },
  { id: "hors-doeuvre", restaurant_id: DEMO_RESTAURANT_ID, name: "Hors-d'oeuvre", name_fr: null, description: "Opening plates", sort_order: 1, available_from: null, available_to: null, is_active: true },
  { id: "mains", restaurant_id: DEMO_RESTAURANT_ID, name: "Mains", name_fr: null, description: "Larger plates", sort_order: 2, available_from: null, available_to: null, is_active: true },
  { id: "entrees", restaurant_id: DEMO_RESTAURANT_ID, name: "Entrées", name_fr: null, description: "Entrée plates", sort_order: 3, available_from: null, available_to: null, is_active: true },
  { id: "desserts", restaurant_id: DEMO_RESTAURANT_ID, name: "Desserts", name_fr: null, description: "Sweet finish", sort_order: 4, available_from: null, available_to: null, is_active: true },
  { id: "wine", restaurant_id: DEMO_RESTAURANT_ID, name: "Wine", name_fr: null, description: "By glass and bottle", sort_order: 5, available_from: null, available_to: null, is_active: true },
];

const DEMO_ITEMS: MenuItemRow[] = [
  { id: "demo-white-asparagus", restaurant_id: DEMO_RESTAURANT_ID, category_id: "hors-doeuvre", category: "Hors-d'oeuvre", name: "White asparagus", name_fr: null, description: "Smoked egg, brown butter", description_fr: null, price: 27, cost_price: 8.4, photo_url: null, allergens: ["GF"], dietary_flags: ["Vegetarian"], calories: null, is_available: true, is_preorderable: false, is_featured: true, is_active: true, preparation_time_minutes: 8, spice_level: null, loyalty_points_value: null, sort_order: 0 },
  { id: "demo-trout", restaurant_id: DEMO_RESTAURANT_ID, category_id: "hors-doeuvre", category: "Hors-d'oeuvre", name: "Trout · cured 18h", name_fr: null, description: "Côte-Nord, koji, sea aster", description_fr: null, price: 24, cost_price: 6.1, photo_url: null, allergens: ["GF"], dietary_flags: null, calories: null, is_available: true, is_preorderable: false, is_featured: false, is_active: true, preparation_time_minutes: 6, spice_level: null, loyalty_points_value: null, sort_order: 1 },
  { id: "demo-sardines", restaurant_id: DEMO_RESTAURANT_ID, category_id: "hors-doeuvre", category: "Hors-d'oeuvre", name: "Sardines · grilled", name_fr: null, description: "Citrus, olive, sourdough", description_fr: null, price: 19, cost_price: 0.4, photo_url: null, allergens: [], dietary_flags: null, calories: null, is_available: true, is_preorderable: false, is_featured: false, is_active: true, preparation_time_minutes: 10, spice_level: null, loyalty_points_value: null, sort_order: 2 },
  { id: "demo-bread", restaurant_id: DEMO_RESTAURANT_ID, category_id: "hors-doeuvre", category: "Hors-d'oeuvre", name: "Bread service", name_fr: null, description: "Sourdough, cultured butter", description_fr: null, price: 9, cost_price: 1.2, photo_url: null, allergens: [], dietary_flags: ["Vegetarian"], calories: null, is_available: true, is_preorderable: false, is_featured: false, is_active: true, preparation_time_minutes: 4, spice_level: null, loyalty_points_value: null, sort_order: 3 },
  { id: "demo-olives", restaurant_id: DEMO_RESTAURANT_ID, category_id: "snacks", category: "Snacks", name: "Warm olives", name_fr: null, description: "Bay, orange, coriander", description_fr: null, price: 8, cost_price: 1, photo_url: null, allergens: [], dietary_flags: ["Vegan", "GF"], calories: null, is_available: true, is_preorderable: false, is_featured: false, is_active: true, preparation_time_minutes: 3, spice_level: null, loyalty_points_value: null, sort_order: 0 },
  { id: "demo-hen", restaurant_id: DEMO_RESTAURANT_ID, category_id: "mains", category: "Mains", name: "Cornish hen", name_fr: null, description: "Leek, jus, turnip", description_fr: null, price: 38, cost_price: 12, photo_url: null, allergens: [], dietary_flags: null, calories: null, is_available: true, is_preorderable: false, is_featured: false, is_active: true, preparation_time_minutes: 22, spice_level: null, loyalty_points_value: null, sort_order: 0 },
  { id: "demo-ribeye", restaurant_id: DEMO_RESTAURANT_ID, category_id: "entrees", category: "Entrées", name: "Ribeye", name_fr: null, description: "12oz, peppercorn jus", description_fr: null, price: 58, cost_price: 19, photo_url: null, allergens: [], dietary_flags: null, calories: null, is_available: true, is_preorderable: false, is_featured: false, is_active: true, preparation_time_minutes: 24, spice_level: null, loyalty_points_value: null, sort_order: 0 },
  { id: "demo-tart", restaurant_id: DEMO_RESTAURANT_ID, category_id: "desserts", category: "Desserts", name: "Maple tart", name_fr: null, description: "Creme fraiche, buckwheat", description_fr: null, price: 13, cost_price: 3, photo_url: null, allergens: ["GF"], dietary_flags: ["Vegetarian"], calories: null, is_available: true, is_preorderable: false, is_featured: false, is_active: true, preparation_time_minutes: 5, spice_level: null, loyalty_points_value: null, sort_order: 0 },
  { id: "demo-gamay", restaurant_id: DEMO_RESTAURANT_ID, category_id: "wine", category: "Wine", name: "Gamay · Niagara", name_fr: null, description: "Red cherry, graphite", description_fr: null, price: 17, cost_price: 5, photo_url: null, allergens: [], dietary_flags: null, calories: null, is_available: true, is_preorderable: false, is_featured: false, is_active: true, preparation_time_minutes: 1, spice_level: null, loyalty_points_value: null, sort_order: 0 },
];

const TAG_OPTIONS = ["Vegetarian", "Vegan", "GF", "DF", "Spicy", "Signature"];
const PRICE_LEVEL_MENU_CATEGORY_NAMES_LOWER = PRICE_LEVEL_MENU_CATEGORY_NAMES.map((name) => name.toLowerCase());

function isPriceLevelCategory(category: MenuCategoryRow | null | undefined): boolean {
  return Boolean(
    category &&
    PRICE_LEVEL_MENU_CATEGORY_NAMES_LOWER.includes(category.name.trim().toLowerCase()),
  );
}

function CharacterLimitStatus({ value, max, helper }: { value: string; max: number; helper: string }) {
  const atLimit = value.length >= max;
  return (
    <div className="mt-2 text-[11px] text-text-muted">
      <p>{helper}</p>
      <p className={cn("mt-1 font-mono text-[10px]", atLimit && "text-warning")}>
        {value.length}/{max}
      </p>
      {atLimit && <p className="mt-1 text-warning">Character limit reached.</p>}
    </div>
  );
}

function MenuImageDropzone({
  file,
  imageUrl,
  onFile,
  onImageUrl,
  onClear,
}: {
  file: File | null;
  imageUrl: string;
  onFile: (file: File) => void;
  onImageUrl: (url: string) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    const next = files?.[0];
    if (!next) return;
    if (!resolveMenuItemImage(next)) {
      toast.error(MENU_IMAGE_SUPPORT_MESSAGE);
      return;
    }
    onFile(next);
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          handleFiles(event.dataTransfer.files);
        }}
        className="flex min-h-48 w-full flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-bg-base text-center text-text-muted transition-colors hover:border-gold/40 hover:text-text-secondary"
      >
        {imageUrl ? (
          <img src={imageUrl} alt="" className="h-48 w-full object-cover" />
        ) : (
          <>
            <Upload className="size-7" />
            <p className="mt-3 text-sm">Upload image</p>
            <p className="mt-1 max-w-52 text-xs leading-5">Drag an image here, or click to browse.</p>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={MENU_IMAGE_ACCEPT}
        className="hidden"
        onChange={(event) => handleFiles(event.target.files)}
      />
      <Input
        value={file ? file.name : imageUrl}
        onChange={(event) => onImageUrl(event.target.value)}
        placeholder="Paste photo URL"
      />
      {(file || imageUrl) && (
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          Clear image
        </Button>
      )}
    </div>
  );
}

export default function MenuPage() {
  const { t } = useTranslation();
  const { selectedRestaurant, selectedRestaurantId } = useRestaurantScope();
  const currency = selectedRestaurant?.currency ?? "cad";
  const { categories, loading: catLoading, createCategory, updateCategory, deleteCategory } = useMenuCategories();
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(undefined);
  const {
    items,
    loading: itemsLoading,
    createItem,
    updateItem,
    deleteItem,
    uploadMenuItemImage,
  } = useMenuItems();
  const [aiPanelOpen, setAiPanelOpen] = useState(false);

  const [localCategories, setLocalCategories] = useState<MenuCategoryRow[]>([]);
  const [localItems, setLocalItems] = useState<MenuItemRow[]>([]);
  const [hiddenCategoryIds, setHiddenCategoryIds] = useState<Set<string>>(() => new Set());
  const [hiddenItemIds, setHiddenItemIds] = useState<Set<string>>(() => new Set());

  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatDesc, setNewCatDesc] = useState("");
  const [editCategory, setEditCategory] = useState<MenuCategoryRow | null>(null);
  const [deleteCategoryId, setDeleteCategoryId] = useState<string | null>(null);
  const [savingCat, setSavingCat] = useState(false);

  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<MenuItemRow | null>(null);
  const [itemName, setItemName] = useState("");
  const [itemDesc, setItemDesc] = useState("");
  const [itemPrice, setItemPrice] = useState("");
  const [itemCategory, setItemCategory] = useState<string>("");
  const [itemTags, setItemTags] = useState<string[]>([]);
  const [itemPhotoUrl, setItemPhotoUrl] = useState("");
  const [selectedItemFile, setSelectedItemFile] = useState<File | null>(null);
  const [itemPhotoPreviewUrl, setItemPhotoPreviewUrl] = useState("");
  const itemPhotoObjectUrlRef = useRef<string | null>(null);
  const [savingItem, setSavingItem] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const displayCategories = useMemo(() => {
    const base = categories.length > 0 ? categories : selectedRestaurantId ? [] : DEMO_CATEGORIES;
    const byId = new Map<string, MenuCategoryRow>();
    [...base, ...localCategories].forEach((category) => {
      if (!hiddenCategoryIds.has(category.id)) byId.set(category.id, category);
    });
    const rows = [...byId.values()];
    const maxSortOrder = rows.reduce((max, category) => Math.max(max, category.sort_order), -1);
    PRICE_LEVEL_MENU_CATEGORY_NAMES.forEach((name, index) => {
      if (rows.some((category) => category.name.trim().toLowerCase() === name.toLowerCase())) return;
      rows.push({
        id: `required-price-category-${name.toLowerCase()}`,
        restaurant_id: selectedRestaurantId ?? DEMO_RESTAURANT_ID,
        name,
        name_fr: null,
        description: name === "Mains" ? "Main dishes used for price level" : "Entrées used for price level",
        sort_order: maxSortOrder + index + 1,
        available_from: null,
        available_to: null,
        is_active: true,
      });
    });
    return rows.sort((a, b) => a.sort_order - b.sort_order);
  }, [categories, hiddenCategoryIds, localCategories, selectedRestaurantId]);

  const activeCategoryId = selectedCategory && displayCategories.some((category) => category.id === selectedCategory)
    ? selectedCategory
    : displayCategories[0]?.id;
  const activeCategory = displayCategories.find((category) => category.id === activeCategoryId) ?? displayCategories[0];

  const displayItems = useMemo(() => {
    const baseItems = items.length > 0 ? items : selectedRestaurantId ? [] : DEMO_ITEMS;
    const rows = [...baseItems, ...localItems].filter((item) => !hiddenItemIds.has(item.id));
    return activeCategoryId ? rows.filter((item) => item.category_id === activeCategoryId) : rows;
  }, [activeCategoryId, hiddenItemIds, items, localItems, selectedRestaurantId]);

  const countsByCategory = useMemo(() => {
    const baseItems = items.length > 0 ? items : selectedRestaurantId ? [] : DEMO_ITEMS;
    const rows = [...baseItems, ...localItems].filter(
      (item) => !hiddenItemIds.has(item.id),
    );
    return new Map(displayCategories.map((category) => [
      category.id,
      rows.filter((item) => item.category_id === category.id).length,
    ]));
  }, [displayCategories, hiddenItemIds, items, localItems, selectedRestaurantId]);

  const loading = catLoading || itemsLoading;
  const availableCount = displayItems.filter((item) => item.is_available).length;

  const clearItemPhotoObjectUrl = () => {
    if (itemPhotoObjectUrlRef.current) {
      URL.revokeObjectURL(itemPhotoObjectUrlRef.current);
      itemPhotoObjectUrlRef.current = null;
    }
  };

  useEffect(() => () => clearItemPhotoObjectUrl(), []);

  const resetCategoryForm = () => {
    setNewCatName("");
    setNewCatDesc("");
    setEditCategory(null);
  };

  const openAddCategory = () => {
    resetCategoryForm();
    setCategoryModalOpen(true);
  };

  const openEditCategory = (category: MenuCategoryRow) => {
    if (isPriceLevelCategory(category)) {
      toast.info("Mains and Entrées are required for restaurant price level.");
      return;
    }
    setEditCategory(category);
    setNewCatName(category.name);
    setNewCatDesc((category.description ?? "").slice(0, MENU_CATEGORY_DESCRIPTION_MAX_LENGTH));
    setCategoryModalOpen(true);
  };

  const resetItemForm = () => {
    setItemName("");
    setItemDesc("");
    setItemPrice("");
    setItemCategory(activeCategory?.id ?? displayCategories[0]?.id ?? "");
    setItemTags([]);
    setItemPhotoUrl("");
    setSelectedItemFile(null);
    setItemPhotoPreviewUrl("");
    clearItemPhotoObjectUrl();
  };

  const openAddItem = () => {
    setEditItem(null);
    resetItemForm();
    setItemModalOpen(true);
  };

  const openEditItem = (item: MenuItemRow) => {
    setEditItem(item);
    setItemName(item.name);
    setItemDesc((item.description ?? "").slice(0, MENU_ITEM_DESCRIPTION_MAX_LENGTH));
    setItemPrice(String(item.price));
    setItemCategory(item.category_id ?? activeCategory?.id ?? "");
    setItemTags([...(item.dietary_flags ?? []), ...(item.allergens ?? [])]);
    setItemPhotoUrl(item.photo_url ?? "");
    setSelectedItemFile(null);
    setItemPhotoPreviewUrl(item.photo_url ?? "");
    clearItemPhotoObjectUrl();
    setItemModalOpen(true);
  };

  const toggleTag = (tag: string) => {
    setItemTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag],
    );
  };

  const handleSaveCategory = async () => {
    if (!newCatName.trim()) {
      toast.error("Category name is required.");
      return;
    }
    setSavingCat(true);
    try {
      const payload = {
        name: newCatName.trim(),
        description: newCatDesc.trim().slice(0, MENU_CATEGORY_DESCRIPTION_MAX_LENGTH) || null,
        sort_order: editCategory?.sort_order ?? displayCategories.length,
      };

      if (editCategory) {
        await updateCategory(editCategory.id, payload);
        if (!selectedRestaurantId || editCategory.id.startsWith("demo-") || editCategory.id.startsWith("local-")) {
          const updatedCategory: MenuCategoryRow = {
            ...editCategory,
            name: payload.name,
            description: payload.description,
          };
          setLocalCategories((current) => (
            current.some((category) => category.id === editCategory.id)
              ? current.map((category) => (category.id === editCategory.id ? updatedCategory : category))
              : [...current, updatedCategory]
          ));
        }
        setSelectedCategory(editCategory.id);
        toast.success("Category updated.");
      } else {
        const category = await createCategory(payload);
        if (category?.id.startsWith("local-")) {
          setLocalCategories((current) => [...current, category]);
        }
        if (category) setSelectedCategory(category.id);
        toast.success("Category added.");
      }
      setCategoryModalOpen(false);
      resetCategoryForm();
    } catch {
      toast.error(editCategory ? "Could not update category." : "Could not add category.");
    } finally {
      setSavingCat(false);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    const category = displayCategories.find((item) => item.id === id);
    if (isPriceLevelCategory(category)) {
      toast.error("Mains and Entrées cannot be removed because they set the restaurant price level.");
      setDeleteCategoryId(null);
      return;
    }

    const itemCount = countsByCategory.get(id) ?? 0;
    if (itemCount > 0) {
      toast.error("Move or delete this category's items first.");
      return;
    }

    try {
      if (id.startsWith("demo-") || id.startsWith("local-") || !selectedRestaurantId) {
        setHiddenCategoryIds((current) => new Set(current).add(id));
      } else {
        await deleteCategory(id);
      }
      setSelectedCategory((current) => (current === id ? undefined : current));
      setDeleteCategoryId(null);
      toast.success("Category removed.");
    } catch {
      toast.error("Could not delete category.");
    }
  };

  const handleSaveItem = async () => {
    if (!itemName.trim()) {
      toast.error("Name is required.");
      return;
    }

    setSavingItem(true);
    try {
      let photoUrl = itemPhotoUrl.trim() || null;
      if (selectedItemFile) {
        const uploadedUrl = await uploadMenuItemImage(selectedItemFile);
        if (!uploadedUrl.startsWith("http")) {
          toast.error(uploadedUrl);
          return;
        }
        photoUrl = uploadedUrl;
      }

      const selectedCategoryName = displayCategories.find((category) => category.id === itemCategory)?.name ?? null;
      const payload = {
        name: itemName.trim(),
        description: itemDesc.trim().slice(0, MENU_ITEM_DESCRIPTION_MAX_LENGTH) || null,
        price: parseFloat(itemPrice) || 0,
        category_id: itemCategory || null,
        category: selectedCategoryName,
        photo_url: photoUrl,
        dietary_flags: itemTags.filter((tag) => !tag.includes("GF") && !tag.includes("DF")),
        allergens: itemTags.filter((tag) => tag === "GF" || tag === "DF"),
        sort_order: displayItems.length,
      };

      if (editItem) {
        await updateItem(editItem.id, payload);
        if (editItem.id.startsWith("demo-") || editItem.id.startsWith("local-")) {
          setLocalItems((current) => {
            const updatedItem = { ...editItem, ...payload };
            return current.some((item) => item.id === editItem.id)
              ? current.map((item) => (item.id === editItem.id ? updatedItem : item))
              : [...current, updatedItem];
          });
        }
        toast.success("Item updated.");
      } else {
        const item = await createItem(payload);
        if (item?.id.startsWith("local-")) {
          setLocalItems((current) => [...current, item]);
        }
        toast.success("Item added.");
      }
      setItemModalOpen(false);
      setSelectedItemFile(null);
    } catch {
      toast.error(editItem ? "Could not update item." : "Could not add item.");
    } finally {
      setSavingItem(false);
    }
  };

  const handleDeleteItem = async (id: string) => {
    if (id.startsWith("demo-") || id.startsWith("local-")) {
      setHiddenItemIds((current) => new Set(current).add(id));
      setDeleteId(null);
      toast.success("Item removed.");
      return;
    }
    try {
      await deleteItem(id);
      toast.success("Item removed.");
      setDeleteId(null);
    } catch {
      toast.error("Could not delete item.");
    }
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
              {displayItems.length} items · {availableCount} available
            </p>
            {isPriceLevelCategory(activeCategory) ? (
              <p className="mt-2 max-w-xl text-xs text-gold">
                Items in Mains and Entrées are used to calculate the restaurant price level. Drinks, sauces, sides, and extras do not affect it.
              </p>
            ) : null}
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
                onClick={(event) => {
                  setSelectedCategory(category.id);
                  event.currentTarget.blur();
                }}
                className={cn(
                  "relative shrink-0 py-4 text-xs transition-colors focus:outline-none",
                  active
                    ? "text-gold"
                    : "text-text-muted hover:text-text-secondary",
                )}
              >
                {category.name} <span className="ml-1 text-[10px]">{countsByCategory.get(category.id) ?? 0}</span>
                {active && <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-gold" />}
              </button>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {activeCategory && (
            <>
              <Button
                variant="ghost"
                className="h-9 gap-2 rounded-lg px-3 text-xs text-text-secondary hover:bg-bg-elevated hover:text-white"
                onClick={() => openEditCategory(activeCategory)}
                disabled={isPriceLevelCategory(activeCategory)}
              >
                <Pencil className="size-3.5" />
                Edit category
              </Button>
              <Button
                variant="ghost"
                className="h-9 gap-2 rounded-lg px-3 text-xs text-danger hover:bg-danger/10 hover:text-danger"
                onClick={() => setDeleteCategoryId(activeCategory.id)}
                disabled={isPriceLevelCategory(activeCategory)}
              >
                <Trash2 className="size-3.5" />
                Delete category
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            className="h-9 gap-2 rounded-lg px-3 text-xs text-gold hover:bg-gold/10 hover:text-gold"
            onClick={openAddCategory}
          >
            <Plus className="size-3.5" />
            New category
          </Button>
        </div>
      </div>

      <div className="px-6 py-5">
        {aiPanelOpen && (
          <div className="mb-5">
            <MenuSuggestionsPanel onClose={() => setAiPanelOpen(false)} />
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
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <Dialog open={itemModalOpen} onOpenChange={setItemModalOpen}>
        <DialogContent className="flex max-h-[88vh] w-[calc(100vw-2rem)] max-w-5xl flex-col overflow-hidden border-gold/30 bg-bg-surface p-0 text-text-primary sm:max-w-5xl" showCloseButton={false}>
          <DialogHeader>
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.24em] text-text-muted">Add to menu</p>
                <DialogTitle className="mt-2 font-serif text-4xl font-normal text-white">
                  {editItem ? "Edit item" : "New item"}
                </DialogTitle>
                <p className="mt-2 text-sm text-text-muted">Create the diner-facing menu card with the essentials first.</p>
              </div>
              <button
                type="button"
                className="rounded-lg p-1 text-text-muted transition-colors hover:bg-bg-elevated hover:text-white"
                onClick={() => setItemModalOpen(false)}
              >
                <X className="size-5" />
              </button>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.85fr)] lg:items-start">
              <section className="min-w-0 rounded-2xl border border-border bg-bg-elevated/35 p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold">Item details</p>
                <div className="mt-4 grid gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="menu-item-name">Name</Label>
                    <Input
                      id="menu-item-name"
                      value={itemName}
                      maxLength={200}
                      onChange={(event) => setItemName(event.target.value.slice(0, 200))}
                      placeholder="e.g. Burrata & stone fruit"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="menu-item-description">Description</Label>
                    <Textarea
                      id="menu-item-description"
                      rows={3}
                      value={itemDesc}
                      maxLength={MENU_ITEM_DESCRIPTION_MAX_LENGTH}
                      onChange={(event) => setItemDesc(event.target.value.slice(0, MENU_ITEM_DESCRIPTION_MAX_LENGTH))}
                      className="min-h-24 resize-none rounded-xl border-border bg-bg-elevated text-sm leading-6"
                      placeholder="Two or three ingredients, plainly named."
                    />
                    <CharacterLimitStatus
                      value={itemDesc}
                      max={MENU_ITEM_DESCRIPTION_MAX_LENGTH}
                      helper="Keep this short so menu cards stay easy to scan."
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                    <div className="flex flex-col gap-1.5">
                      <Label>Category</Label>
                      <Select value={itemCategory} onValueChange={setItemCategory}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          {displayCategories.map((category) => (
                            <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="menu-item-price">Price ($)</Label>
                      <Input
                        id="menu-item-price"
                        type="number"
                        min="0"
                        max="10000"
                        step="0.01"
                        value={itemPrice}
                        onChange={(event) => setItemPrice(event.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                </div>
              </section>

              <section className="min-w-0 rounded-2xl border border-border bg-bg-elevated/35 p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold">Media</p>
                <p className="mt-1 text-xs text-text-muted">Upload an image or paste a photo URL.</p>
                <div className="mt-4">
                  <MenuImageDropzone
                    file={selectedItemFile}
                    imageUrl={itemPhotoPreviewUrl}
                    onFile={(file) => {
                      clearItemPhotoObjectUrl();
                      const objectUrl = URL.createObjectURL(file);
                      itemPhotoObjectUrlRef.current = objectUrl;
                      setSelectedItemFile(file);
                      setItemPhotoUrl("");
                      setItemPhotoPreviewUrl(objectUrl);
                    }}
                    onImageUrl={(url) => {
                      clearItemPhotoObjectUrl();
                      setSelectedItemFile(null);
                      setItemPhotoUrl(url);
                      setItemPhotoPreviewUrl(url);
                    }}
                    onClear={() => {
                      clearItemPhotoObjectUrl();
                      setSelectedItemFile(null);
                      setItemPhotoUrl("");
                      setItemPhotoPreviewUrl("");
                    }}
                  />
                </div>
              </section>
            </div>

            <section className="mt-4 rounded-2xl border border-border bg-bg-elevated/35 p-4">
              <div className="grid gap-5 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1fr)] lg:items-start">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold">Options</p>
                  <div className="mt-4">
                    <Label>Tags</Label>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {TAG_OPTIONS.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => toggleTag(tag)}
                          className={cn(
                            "rounded-full border px-3 py-2 text-xs transition-colors",
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

                </div>

                <div className="rounded-xl border border-border bg-bg-base/70 p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold">Preview</p>
                  <div className="mt-4 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      {itemPhotoPreviewUrl && (
                        <div className="mb-4 h-24 overflow-hidden rounded-lg border border-border bg-bg-elevated">
                          <img src={itemPhotoPreviewUrl} alt="" className="size-full object-cover" />
                        </div>
                      )}
                      <p className="truncate font-serif text-xl text-white">{itemName.trim() || "Menu item name"}</p>
                      <p className="mt-1 line-clamp-2 text-sm text-text-muted">
                        {itemDesc.trim() || "A short description will appear on the diner-facing menu card."}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {itemTags.slice(0, 3).map((tag) => (
                          <span key={tag} className="rounded-full border border-border px-2 py-1 text-[10px] text-text-muted">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span className="shrink-0 font-serif text-2xl text-gold">
                      {formatCurrency(parseFloat(itemPrice) || 0, currency)}
                    </span>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border bg-bg-surface px-6 py-4 sm:px-7 sm:py-5">
            <Button
              variant="ghost"
              onClick={() => setItemModalOpen(false)}
              className="h-11 rounded-xl px-5"
            >
              Cancel
            </Button>
            <Button
              disabled={savingItem}
              onClick={() => void handleSaveItem()}
              className="h-11 min-w-32 rounded-xl px-6"
            >
              {savingItem ? "Saving..." : editItem ? "Save changes" : "Save item"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={categoryModalOpen}
        onOpenChange={(open) => {
          setCategoryModalOpen(open);
          if (!open) resetCategoryForm();
        }}
      >
        <DialogContent className="max-w-xl border-gold/30 bg-bg-surface p-8 text-text-primary" showCloseButton={false}>
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.24em] text-text-muted">Add to menu</p>
                <DialogTitle className="mt-2 font-serif text-4xl font-normal text-white">
                  {editCategory ? "Edit category" : "New category"}
                </DialogTitle>
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
                maxLength={MENU_CATEGORY_DESCRIPTION_MAX_LENGTH}
                onChange={(event) => setNewCatDesc(event.target.value.slice(0, MENU_CATEGORY_DESCRIPTION_MAX_LENGTH))}
                className="mt-3 rounded-xl border-border bg-bg-base"
                placeholder="Short note for this section."
              />
              <CharacterLimitStatus
                value={newCatDesc}
                max={MENU_CATEGORY_DESCRIPTION_MAX_LENGTH}
                helper="Keep section descriptions brief."
              />
            </div>
          </div>
          <DialogFooter className="-mx-8 -mb-8 mt-7 border-border bg-bg-surface px-8 py-5">
            <Button variant="ghost" onClick={() => setCategoryModalOpen(false)}>Cancel</Button>
            <Button disabled={savingCat} onClick={() => void handleSaveCategory()} className="min-w-36">
              {savingCat ? "Saving..." : editCategory ? "Save changes" : "Add category"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteCategoryId} onOpenChange={(open) => { if (!open) setDeleteCategoryId(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Remove category?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-secondary">
            {deleteCategoryId && (countsByCategory.get(deleteCategoryId) ?? 0) > 0
              ? "This category still has menu items. Move or delete those items before removing the category."
              : deleteCategoryId && isPriceLevelCategory(displayCategories.find((category) => category.id === deleteCategoryId))
                ? "Mains and Entrées are required for restaurant price level and cannot be removed."
              : "This category will be hidden from the menu. This cannot be undone."}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteCategoryId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={
                !!deleteCategoryId &&
                (
                  (countsByCategory.get(deleteCategoryId) ?? 0) > 0 ||
                  isPriceLevelCategory(displayCategories.find((category) => category.id === deleteCategoryId))
                )
              }
              onClick={() => deleteCategoryId && void handleDeleteCategory(deleteCategoryId)}
            >
              Remove
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

type MenuCardProps = {
  item: MenuItemRow;
  index: number;
  currency: string;
  onEdit: () => void;
  onDelete: () => void;
};

const MenuCard = forwardRef<HTMLElement, MenuCardProps>(function MenuCard(
  { item, index, currency, onEdit, onDelete },
  ref,
) {
  const margin = item.cost_price && item.price > 0 ? ((item.price - item.cost_price) / item.price) * 100 : null;
  const orderDelta = item.id.includes("sardines") ? "-22%" : item.id.includes("trout") ? "+4%" : "+1%";

  return (
    <motion.article
      ref={ref}
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.24, delay: index * 0.03 }}
      className="group overflow-hidden rounded-xl border border-border bg-bg-surface shadow-xl shadow-black/20 transition-colors hover:border-gold/35"
    >
      <div className="relative h-32 overflow-hidden border-b border-border bg-gold/10">
        {item.photo_url ? (
          <img src={item.photo_url} alt="" className="size-full object-cover" />
        ) : (
          <>
            <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,rgba(201,168,76,0.14)_0,rgba(201,168,76,0.14)_4px,transparent_4px,transparent_12px)]" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex size-8 items-center justify-center rounded-full border border-gold/35 text-gold/45">
                <ImageIcon className="size-4" />
              </div>
            </div>
          </>
        )}
        {!item.is_available && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-base/70">
            <span className="rounded-full border border-border bg-bg-surface px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-text-muted">
              Unavailable
            </span>
          </div>
        )}
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-serif text-lg leading-tight text-white">{item.name}</h3>
            <p className="mt-2 line-clamp-1 text-xs text-text-muted">{item.description}</p>
          </div>
          <div className="shrink-0 text-right">
            <span className="font-serif text-xl text-gold">{formatCurrency(item.price, currency)}</span>
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

        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 rounded-lg text-xs"
            onClick={onEdit}
          >
            <Pencil className="size-3.5" />
            Edit item
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 rounded-lg border border-danger/20 bg-danger/10 text-xs text-danger hover:bg-danger/15 hover:text-danger"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
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
});
