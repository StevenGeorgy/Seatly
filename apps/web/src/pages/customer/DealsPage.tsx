import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Star, Tag, Clock, MapPin } from "lucide-react";
import { motion } from "framer-motion";

import { Skeleton } from "@/components/ui/skeleton";
import {
  useAllActivePromotions,
  getPromotionLabel,
  getPromoTypeBadgeClasses,
  type PromoType,
  type PromotionWithRestaurant,
} from "@/hooks/usePromotions";

const PROMO_FILTERS: { label: string; value: PromoType | "all" }[] = [
  { label: "All Deals", value: "all" },
  { label: "BOGO", value: "bogo" },
  { label: "% Off", value: "percentage" },
  { label: "Fixed Discount", value: "fixed" },
  { label: "Free Item", value: "free_item" },
];

function formatExpiry(ends_at: string | null): string | null {
  if (!ends_at) return null;
  const d = new Date(ends_at);
  return `Valid until ${d.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" })}`;
}

function DealCard({ promo, index }: { promo: PromotionWithRestaurant; index: number }) {
  const r = promo.restaurants;
  const label = getPromotionLabel(promo);
  const badgeClasses = getPromoTypeBadgeClasses(promo.badge_color);
  const expiry = formatExpiry(promo.ends_at);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
    >
      <Link
        to={`/${r.slug}`}
        className="group flex flex-col overflow-hidden rounded-xl border border-border bg-bg-surface transition-all hover:border-amber-500/30 hover:shadow-lg hover:shadow-amber-500/5"
      >
        {/* Image / placeholder */}
        <div className="relative h-40 w-full overflow-hidden bg-bg-elevated">
          {r.cover_photo_url ? (
            <img
              src={r.cover_photo_url}
              alt={r.name}
              className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              <Tag className="size-10 text-text-muted/30" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-bg-base/80 via-transparent to-transparent" />

          {/* Deal badge */}
          <div className="absolute left-3 top-3">
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold tracking-wide ${badgeClasses}`}>
              {label}
            </span>
          </div>

          {/* Rating badge */}
          {r.cover_photo_url == null && (
            <div className="absolute right-3 top-3 flex items-center gap-1 rounded-lg bg-gold/10 px-2 py-1">
              <Star className="size-3 fill-gold text-gold" />
              <span className="text-xs font-bold text-gold">—</span>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex flex-1 flex-col gap-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-text-primary group-hover:text-amber-400 transition-colors">
                {r.name}
              </h3>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
                {r.cuisine_type && <span>{r.cuisine_type}</span>}
                {r.city && (
                  <span className="flex items-center gap-0.5">
                    <MapPin className="size-2.5" />
                    {r.city}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Promotion title */}
          <p className="text-sm font-medium text-text-primary">{promo.title}</p>
          {promo.description && (
            <p className="line-clamp-2 text-xs text-text-muted">{promo.description}</p>
          )}

          <div className="mt-auto flex items-center justify-between pt-1">
            {expiry ? (
              <span className="flex items-center gap-1 text-xs text-text-muted">
                <Clock className="size-3" />
                {expiry}
              </span>
            ) : (
              <span className="text-xs text-text-muted">No expiry</span>
            )}
            {promo.applies_to !== "all" && (
              <span className="rounded-full bg-bg-elevated px-2 py-0.5 text-[10px] font-medium capitalize text-text-muted">
                {promo.applies_to.replace("_", "-")}
              </span>
            )}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

function DealCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-bg-surface">
      <Skeleton className="h-40 w-full rounded-none" />
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

export default function DealsPage() {
  const navigate = useNavigate();
  const { promotions, loading } = useAllActivePromotions();
  const [activeFilter, setActiveFilter] = useState<PromoType | "all">("all");

  const filtered =
    activeFilter === "all"
      ? promotions
      : promotions.filter((p) => p.promo_type === activeFilter);

  return (
    <div className="flex min-h-screen flex-col bg-bg-base text-text-primary">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-bg-base/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => void navigate("/discover")}
            className="flex size-9 items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:text-text-primary"
            aria-label="Back to Discover"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div>
            <h1 className="text-sm font-bold text-text-primary">Deals &amp; Offers</h1>
            <p className="text-xs text-text-muted">Restaurants with active promotions</p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
        {/* Filter chips */}
        <div className="flex flex-wrap gap-2">
          {PROMO_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setActiveFilter(f.value)}
              className={`rounded-full border px-4 py-1.5 text-xs font-medium transition-all ${
                activeFilter === f.value
                  ? "border-amber-500/60 bg-amber-500/20 text-amber-400"
                  : "border-border bg-bg-surface text-text-secondary hover:border-amber-500/30 hover:text-amber-400"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Results */}
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <DealCardSkeleton key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-amber-500/10">
              <Tag className="size-6 text-amber-400" />
            </div>
            <p className="font-semibold text-text-primary">No active deals right now</p>
            <p className="text-sm text-text-muted">
              {activeFilter === "all"
                ? "Check back soon — restaurants update their offers regularly."
                : "Try a different deal type or check back later."}
            </p>
            <button
              type="button"
              onClick={() => setActiveFilter("all")}
              className="mt-1 text-xs text-amber-400 underline-offset-2 hover:underline"
            >
              Show all deals
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm text-text-muted">
              {filtered.length} deal{filtered.length !== 1 ? "s" : ""} available
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((promo, i) => (
                <DealCard key={promo.id} promo={promo} index={i} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
