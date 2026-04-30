import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import {
  Search,
  Star,
  MapPin,
  Flame,
  Tag,
  Mic,
  LogOut,
  Plus,
  User,
  Settings,
  LayoutDashboard,
  ChevronDown,
} from "lucide-react";
import { useUser } from "@/hooks/useUser";
import { usePublicRestaurants, type Restaurant } from "@/hooks/useRestaurant";
import { useStaffRestaurants } from "@/hooks/useStaffRestaurants";
import { motion } from "framer-motion";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAssistant } from "@/components/cenaiva/AssistantProvider";

const PRICE_LABELS = ["—", "$", "$$", "$$$", "$$$$"];

const CUISINE_GRADIENT: Record<string, string> = {
  French:   "from-indigo-900 to-blue-800",
  Japanese: "from-rose-900 to-pink-800",
  Italian:  "from-green-900 to-emerald-800",
  Mexican:  "from-orange-900 to-red-800",
  Seafood:  "from-cyan-900 to-teal-800",
  BBQ:      "from-stone-800 to-neutral-700",
  Indian:   "from-yellow-900 to-orange-800",
  Egyptian: "from-amber-900 to-yellow-800",
  Thai:     "from-lime-900 to-green-800",
  Chinese:  "from-red-900 to-rose-800",
  American: "from-blue-900 to-indigo-800",
  Greek:    "from-sky-900 to-blue-800",
};

const CUISINE_EMOJI: Record<string, string> = {
  French: "🥂", Japanese: "🍣", Italian: "🍝", Mexican: "🌮",
  Seafood: "🦞", BBQ: "🥩", Indian: "🍛", Egyptian: "🧆",
  Thai: "🍜", Chinese: "🥡", American: "🍔", Greek: "🥙",
};

const CUISINES = ["All", "Italian", "Japanese", "Mexican", "French", "Indian", "Thai", "Seafood", "BBQ"];

function RestaurantCard({ r, index }: { r: Restaurant; index: number }) {
  const gradient = CUISINE_GRADIENT[r.cuisine_type ?? ""] ?? "from-zinc-900 to-neutral-800";
  const emoji = CUISINE_EMOJI[r.cuisine_type ?? ""] ?? "🍽️";
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05 }}
    >
      <Link
        to={`/${r.slug}`}
        className="group block overflow-hidden rounded-xl border border-border bg-bg-surface transition-all hover:border-gold/30 hover:shadow-lg hover:shadow-gold/5"
      >
        {/* Photo area */}
        <div className={`relative h-44 w-full overflow-hidden`}>
          {r.cover_photo_url ? (
            <img src={r.cover_photo_url} alt={r.name} className="h-full w-full object-cover" />
          ) : (
            <div className={`h-full w-full bg-gradient-to-br ${gradient}`}>
              <div className="flex h-full items-center justify-center text-5xl opacity-30">{emoji}</div>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-bg-base/80 via-transparent to-transparent" />
          {r.cuisine_type && (
            <div className="absolute left-3 top-3">
              <span className="rounded-full bg-black/50 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
                {r.cuisine_type}
              </span>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-text-primary group-hover:text-gold transition-colors">
                {r.name}
              </h3>
              <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                {r.price_range != null && <span className="text-gold">{PRICE_LABELS[r.price_range]}</span>}
                {r.city && (
                  <span className="flex items-center gap-0.5">
                    <MapPin className="size-2.5" />
                    {r.city}
                  </span>
                )}
              </div>
            </div>
            {r.avg_rating != null && (
              <div className="flex shrink-0 items-center gap-1 rounded-lg bg-gold/10 px-2 py-1">
                <Star className="size-3 fill-gold text-gold" />
                <span className="text-xs font-bold text-gold">{r.avg_rating.toFixed(1)}</span>
              </div>
            )}
          </div>

          {/* Footer row */}
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-text-muted">
              {r.total_reviews != null ? `${r.total_reviews} reviews` : ""}
            </span>
            <span className="text-xs font-medium text-gold">Book a table →</span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

export default function DiscoverPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { profile, signOut, canUseCustomerView, isCustomerView, switchToCustomerView, switchToStaffView, restaurantRoles } = useUser();
  const { restaurants: staffRestaurants } = useStaffRestaurants(restaurantRoles);
  const { restaurants, loading: restaurantsLoading } = usePublicRestaurants();
  const [search, setSearch] = useState("");
  const [activeCuisine, setActiveCuisine] = useState("All");
  const assistant = useAssistant();

  const filtered = useMemo(() => {
    let list = restaurants;
    if (activeCuisine !== "All") {
      list = list.filter((r) => r.cuisine_type === activeCuisine);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.cuisine_type ?? "").toLowerCase().includes(q) ||
          (r.city ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [search, activeCuisine, restaurants]);

  const featured = restaurants.filter((r) => (r.avg_rating ?? 0) >= 4.7);
  const others = restaurants.filter((r) => (r.avg_rating ?? 0) < 4.7);

  const showFiltered = search.trim() !== "" || activeCuisine !== "All";
  const initials = (profile?.full_name ?? profile?.email ?? "?")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex min-h-screen flex-col bg-bg-base text-text-primary">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-bg-base/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="shrink-0 text-sm font-bold tracking-[0.2em] text-gold">
            CENAIVA
          </Link>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder={t("dashboard.shell.discoverSearchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-bg-elevated pl-9 pr-4 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-gold/40"
            />
          </div>
          <button
            type="button"
            onClick={() => assistant?.open(undefined, undefined, { autoListen: false })}
            className="shrink-0 flex items-center gap-1.5 rounded-full border border-[#C8A951]/60 bg-[#C8A951]/10 px-3 py-1.5 text-xs font-semibold text-[#C8A951] transition-colors hover:bg-[#C8A951]/20 whitespace-nowrap"
          >
            <Mic className="size-3" />
            Hey Cenaiva
          </button>
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            onClick={() => {
              if (canUseCustomerView) switchToCustomerView();
              void navigate("/account");
            }}
            title="Settings"
          >
            <Settings className="size-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="rounded-full outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-gold/40"
                aria-label={t("routes.account.title")}
              >
                <Avatar>
                  <AvatarImage src={profile?.avatar_url ?? undefined} />
                  <AvatarFallback className="bg-gold/10 text-gold">{initials}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 min-w-56">
              <DropdownMenuLabel className="truncate">
                {profile?.full_name ?? profile?.email ?? t("routes.account.title")}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void navigate("/account")}>
                <User className="size-4" />
                {t("routes.account.title")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void navigate("/setup")}>
                <Plus className="size-4" />
                {t("dashboard.shell.setupRestaurant")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => void signOut()}>
                <LogOut className="size-4" />
                {t("dashboard.shell.signOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {restaurantRoles.length > 0 && (
            staffRestaurants.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-transparent px-3 text-[0.8rem] font-medium text-foreground outline-none transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-primary/30">
                  <LayoutDashboard className="size-3.5" />
                  Dashboard
                  <ChevronDown className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {staffRestaurants.map((r) => (
                    <DropdownMenuItem
                      key={r.id}
                      onClick={() => {
                        localStorage.setItem("cenaiva.selectedRestaurantId", r.id);
                        if (isCustomerView) switchToStaffView();
                        void navigate("/dashboard");
                      }}
                    >
                      <LayoutDashboard className="size-4" />
                      {r.name ?? r.slug}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5"
                onClick={() => {
                  if (isCustomerView) switchToStaffView();
                  void navigate("/dashboard");
                }}
              >
                <LayoutDashboard className="size-4" />
                Dashboard
              </Button>
            )
          )}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-6 sm:px-6">
        {/* Cuisine filter chips */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void navigate("/deals")}
            className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/20 px-4 py-1.5 text-xs font-semibold text-amber-400 transition-colors hover:bg-amber-500/30 whitespace-nowrap"
          >
            <Tag className="size-3" />
            Deals &amp; Offers
          </button>
          {CUISINES.map((cuisine) => (
            <button
              key={cuisine}
              type="button"
              onClick={() => setActiveCuisine(cuisine)}
              className={`rounded-full border px-4 py-1.5 text-xs font-medium transition-all ${
                activeCuisine === cuisine
                  ? "border-gold bg-gold/10 text-gold"
                  : "border-border bg-bg-surface text-text-secondary hover:border-gold/40 hover:text-gold"
              }`}
            >
              {cuisine}
            </button>
          ))}
        </div>

        {/* Search / filtered results */}
        {restaurantsLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-64 animate-pulse rounded-xl border border-border bg-bg-surface" />
            ))}
          </div>
        ) : showFiltered ? (
          <section>
            <p className="mb-4 text-sm text-text-muted">
              {filtered.length} result{filtered.length !== 1 ? "s" : ""} found
            </p>
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <div className="flex size-14 items-center justify-center rounded-2xl bg-gold/10">
                  <Search className="size-6 text-gold" />
                </div>
                <p className="font-semibold text-text-primary">No restaurants found</p>
                <p className="text-sm text-text-muted">Try a different search or cuisine filter.</p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((r, i) => (
                  <RestaurantCard key={r.id} r={r} index={i} />
                ))}
              </div>
            )}
          </section>
        ) : (
          <>
            {/* Top Rated */}
            {featured.length > 0 && (
              <section>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
                    <Flame className="size-4 text-gold" />
                    Top Rated
                  </h2>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {featured.map((r, i) => (
                    <RestaurantCard key={r.id} r={r} index={i} />
                  ))}
                </div>
              </section>
            )}

            {/* All Restaurants */}
            {others.length > 0 && (
              <section>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
                    <MapPin className="size-4 text-gold" />
                    All Restaurants
                  </h2>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {others.map((r, i) => (
                    <RestaurantCard key={r.id} r={r} index={i} />
                  ))}
                </div>
              </section>
            )}

            {restaurants.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <p className="font-semibold text-text-primary">No restaurants yet</p>
                <p className="text-sm text-text-muted">Check back soon.</p>
              </div>
            )}
          </>
        )}
      </main>

    </div>
  );
}
