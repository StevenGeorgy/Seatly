import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Plus, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { SectionCard } from "@/components/dashboard/SectionCard";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useMenuCategories, useMenuItems } from "@/hooks/useMenuItems";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export default function MenuPage() {
  const { t } = useTranslation();
  const { selectedRestaurant } = useRestaurantScope();
  const currency = selectedRestaurant?.currency ?? "cad";
  const { categories, loading: catLoading } = useMenuCategories();
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>();
  const { items, loading: itemsLoading, refetch } = useMenuItems(selectedCategory);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);

  const loading = catLoading || itemsLoading;

  const toggle86 = async (itemId: string, currentlyAvailable: boolean) => {
    if (!isSupabaseConfigured()) return;
    const client = getSupabaseBrowserClient();
    await client.from("menu_items").update({ is_available: !currentlyAvailable }).eq("id", itemId);
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
            <Button size="default" className="gap-2">
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
            <Button variant="ghost" size="icon-sm">
              <Plus className="size-4" />
            </Button>
          }>
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

        {/* Menu items grid */}
        <div className="flex-1">
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
                <Button size="default" className="gap-2">
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
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-text-primary">{item.name}</p>
                          {item.description ? (
                            <p className="mt-0.5 line-clamp-2 text-xs text-text-muted">{item.description}</p>
                          ) : null}
                        </div>
                        <span className="shrink-0 text-sm font-semibold text-gold">
                          {formatCurrency(item.price, currency)}
                        </span>
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
    </AnimatedPage>
  );
}
