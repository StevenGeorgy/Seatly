import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Plus, Sparkles, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { SectionCard } from "@/components/dashboard/SectionCard";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMenuCategories, useMenuItems, type MenuItemRow } from "@/hooks/useMenuItems";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils/formatCurrency";

export default function MenuPage() {
  const { t } = useTranslation();
  const { selectedRestaurant, selectedRestaurantId } = useRestaurantScope();
  const currency = selectedRestaurant?.currency ?? "cad";
  const { categories, loading: catLoading, refetch: refetchCats } = useMenuCategories();
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>();
  const { items, loading: itemsLoading, refetch } = useMenuItems(selectedCategory);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);

  // Add Category
  const [addingCat, setAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [savingCat, setSavingCat] = useState(false);

  // Add/Edit Item modal
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<MenuItemRow | null>(null);
  const [itemName, setItemName] = useState("");
  const [itemDesc, setItemDesc] = useState("");
  const [itemPrice, setItemPrice] = useState("");
  const [itemCategory, setItemCategory] = useState<string>("");
  const [savingItem, setSavingItem] = useState(false);

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const loading = catLoading || itemsLoading;

  const toggle86 = async (itemId: string, currentlyAvailable: boolean) => {
    if (!isSupabaseConfigured()) return;
    const client = getSupabaseBrowserClient();
    await client.from("menu_items").update({ is_available: !currentlyAvailable }).eq("id", itemId);
    void refetch();
  };

  const handleAddCategory = async () => {
    if (!newCatName.trim() || !selectedRestaurantId || !isSupabaseConfigured()) return;
    setSavingCat(true);
    const client = getSupabaseBrowserClient();
    const { error } = await client.from("menu_categories").insert({
      restaurant_id: selectedRestaurantId,
      name: newCatName.trim(),
      sort_order: categories.length,
      is_active: true,
    });
    setSavingCat(false);
    if (error) { toast.error("Could not add category."); return; }
    setNewCatName("");
    setAddingCat(false);
    void refetchCats();
    toast.success("Category added.");
  };

  const openAddItem = () => {
    setEditItem(null);
    setItemName(""); setItemDesc(""); setItemPrice(""); setItemCategory(categories[0]?.id ?? "");
    setItemModalOpen(true);
  };

  const openEditItem = (item: MenuItemRow) => {
    setEditItem(item);
    setItemName(item.name);
    setItemDesc(item.description ?? "");
    setItemPrice(String(item.price));
    setItemCategory(item.category_id ?? "");
    setItemModalOpen(true);
  };

  const handleSaveItem = async () => {
    if (!itemName.trim()) { toast.error("Name is required."); return; }
    if (!selectedRestaurantId || !isSupabaseConfigured()) return;
    setSavingItem(true);
    const client = getSupabaseBrowserClient();
    const payload = {
      name: itemName.trim(),
      description: itemDesc.trim() || null,
      price: parseFloat(itemPrice) || 0,
      category_id: itemCategory || null,
      restaurant_id: selectedRestaurantId,
    };
    if (editItem) {
      const { error } = await client.from("menu_items").update(payload).eq("id", editItem.id);
      if (error) { toast.error("Could not update item."); setSavingItem(false); return; }
      toast.success("Item updated.");
    } else {
      const { error } = await client.from("menu_items").insert({ ...payload, is_available: true, is_active: true, is_featured: false, is_preorderable: false, sort_order: items.length });
      if (error) { toast.error("Could not add item."); setSavingItem(false); return; }
      toast.success("Item added.");
    }
    setSavingItem(false);
    setItemModalOpen(false);
    void refetch();
  };

  const handleDeleteItem = async (id: string) => {
    if (!isSupabaseConfigured()) return;
    const client = getSupabaseBrowserClient();
    const { error } = await client.from("menu_items").update({ is_active: false }).eq("id", id);
    if (error) { toast.error("Could not delete item."); return; }
    toast.success("Item removed.");
    setDeleteId(null);
    void refetch();
  };

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <PageHeader
        title={t("dashboard.menu.title")}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="default"
              className="gap-2"
              onClick={() => setAiPanelOpen(!aiPanelOpen)}
            >
              <Sparkles className="size-4" />
              {t("dashboard.menu.aiSuggestions")}
            </Button>
            <Button size="default" className="gap-2" onClick={openAddItem}>
              <Plus className="size-4" />
              {t("dashboard.menu.addItem")}
            </Button>
          </div>
        }
      />

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Category sidebar */}
        <div className="w-full shrink-0 lg:w-52">
          <SectionCard title={t("dashboard.menu.categories")} actions={
            <Button variant="ghost" size="icon-sm" onClick={() => setAddingCat(true)}>
              <Plus className="size-4" />
            </Button>
          }>
            {addingCat ? (
              <div className="flex items-center gap-2 pb-2">
                <Input
                  autoFocus
                  placeholder="Category name"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleAddCategory();
                    if (e.key === "Escape") { setAddingCat(false); setNewCatName(""); }
                  }}
                  className="h-8 text-xs"
                />
                <Button size="icon-sm" disabled={savingCat} onClick={() => void handleAddCategory()}>
                  <Plus className="size-3" />
                </Button>
              </div>
            ) : null}
            {catLoading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 rounded-lg" />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedCategory(undefined)}
                  className={`rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${!selectedCategory ? "bg-gold/10 text-gold" : "text-text-secondary hover:bg-bg-elevated hover:text-text-primary"}`}
                >
                  {t("dashboard.reservations.all")}
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${selectedCategory === cat.id ? "bg-gold/10 text-gold" : "text-text-secondary hover:bg-bg-elevated hover:text-text-primary"}`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        {/* Main content */}
        <div className="flex-1">
          {aiPanelOpen ? (
            <div className="mb-6 rounded-lg border border-border bg-bg-surface p-5">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="size-4 text-gold" />
                <span className="text-sm font-semibold text-text-primary">{t("dashboard.menu.aiSuggestions")}</span>
                <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => setAiPanelOpen(false)}>
                  <span className="text-xs">✕</span>
                </Button>
              </div>
              <EmptyState
                icon={<Sparkles className="size-5" />}
                title="AI menu suggestions coming soon"
                description="Cenaiva will analyze your restaurant and suggest new menu items based on cuisine, trends, and guest preferences."
              />
            </div>
          ) : null}

          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-[180px] rounded-lg" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="size-5" />}
              title={t("dashboard.menu.noItems")}
              description={t("dashboard.menu.noItemsDesc")}
              action={
                <Button size="default" className="gap-2" onClick={openAddItem}>
                  <Plus className="size-4" />
                  {t("dashboard.menu.addItem")}
                </Button>
              }
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <AnimatePresence mode="popLayout">
                {items.map((item, i) => (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.25, delay: i * 0.03 }}
                    className="group overflow-hidden rounded-lg border border-border bg-bg-surface transition-colors hover:border-gold/30"
                  >
                    {item.photo_url ? (
                      <div className="relative h-28 w-full overflow-hidden bg-bg-elevated">
                        <img
                          src={item.photo_url}
                          alt={item.name}
                          className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                        {!item.is_available ? (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                            <span className="rounded-md bg-danger/20 px-2 py-1 text-xs font-semibold text-danger">
                              {t("dashboard.menu.unavailable")}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="flex flex-col gap-2 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-text-primary">{item.name}</p>
                          {item.description ? (
                            <p className="mt-0.5 line-clamp-2 text-xs text-text-muted">{item.description}</p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <span className="text-sm font-semibold text-gold">
                            {formatCurrency(item.price, currency)}
                          </span>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-sm" className="size-6 opacity-0 transition-opacity group-hover:opacity-100">
                                <MoreVertical className="size-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditItem(item)}>
                                <Pencil className="mr-2 size-3.5" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setDeleteId(item.id)}
                              >
                                <Trash2 className="mr-2 size-3.5" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {item.is_featured ? <StatusBadge status="active" label={t("dashboard.menu.featured")} /> : null}
                        {item.is_preorderable ? <StatusBadge status="confirmed" label={t("dashboard.menu.preorderable")} /> : null}
                        {item.allergens?.slice(0, 3).map((a) => (
                          <StatusBadge key={a} status="inactive" label={a} />
                        ))}
                      </div>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-xs text-text-muted">
                          {item.is_available ? t("dashboard.menu.available") : t("dashboard.menu.unavailable")}
                        </span>
                        <Switch
                          checked={item.is_available}
                          onCheckedChange={() => void toggle86(item.id, item.is_available)}
                        />
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit Item Dialog */}
      <Dialog open={itemModalOpen} onOpenChange={setItemModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editItem ? "Edit Item" : t("dashboard.menu.addItem")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>Name *</Label>
              <Input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="e.g. Margherita Pizza" />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Description</Label>
              <Textarea rows={2} value={itemDesc} onChange={(e) => setItemDesc(e.target.value)} placeholder="Short description…" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label>Price ({currency.toUpperCase()})</Label>
                <Input type="number" min="0" step="0.01" value={itemPrice} onChange={(e) => setItemPrice(e.target.value)} placeholder="0.00" />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Category</Label>
                <Select value={itemCategory} onValueChange={setItemCategory}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemModalOpen(false)}>Cancel</Button>
            <Button disabled={savingItem} onClick={() => void handleSaveItem()}>
              {savingItem ? "Saving…" : editItem ? "Save Changes" : "Add Item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
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
