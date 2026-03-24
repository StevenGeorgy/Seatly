import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  Search,
  Star,
  MapPin,
  Clock,
  Flame,
  ChevronRight,
  SlidersHorizontal,
  MessageCircle,
  X,
  Store,
  LogOut,
} from "lucide-react";
import { useUser } from "@/hooks/useUser";
import { motion, AnimatePresence } from "framer-motion";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PRICE_LABELS = ["—", "$", "$$", "$$$", "$$$$"];

type MockRestaurant = {
  id: string;
  slug: string;
  name: string;
  cuisine_type: string;
  avg_rating: number;
  total_reviews: number;
  price_range: number;
  city: string;
  address: string;
  distance_km: number;
  wait_minutes: number | null;
  is_open: boolean;
  featured: boolean;
  tags: string[];
  gradient: string;
  emoji: string;
};

const MOCK_RESTAURANTS: MockRestaurant[] = [
  {
    id: "r-1", slug: "the-golden-fork", name: "The Golden Fork",
    cuisine_type: "French", avg_rating: 4.8, total_reviews: 312, price_range: 3,
    city: "Toronto", address: "142 King St W", distance_km: 0.4, wait_minutes: null,
    is_open: true, featured: true, tags: ["Date Night", "Fine Dining"],
    gradient: "from-amber-900 to-yellow-800", emoji: "🍽️",
  },
  {
    id: "r-2", slug: "sakura-house", name: "Sakura House",
    cuisine_type: "Japanese", avg_rating: 4.6, total_reviews: 481, price_range: 2,
    city: "Toronto", address: "88 Queen St E", distance_km: 0.9, wait_minutes: 20,
    is_open: true, featured: true, tags: ["Sushi", "Ramen"],
    gradient: "from-rose-900 to-pink-800", emoji: "🍣",
  },
  {
    id: "r-3", slug: "brasserie-lumiere", name: "Brasserie Lumière",
    cuisine_type: "French", avg_rating: 4.7, total_reviews: 198, price_range: 3,
    city: "Montreal", address: "350 Rue Saint-Denis", distance_km: 1.2, wait_minutes: null,
    is_open: true, featured: true, tags: ["Brunch", "Cocktails"],
    gradient: "from-indigo-900 to-blue-800", emoji: "🥂",
  },
  {
    id: "r-4", slug: "casa-fuego", name: "Casa Fuego",
    cuisine_type: "Mexican", avg_rating: 4.4, total_reviews: 276, price_range: 2,
    city: "Toronto", address: "210 Ossington Ave", distance_km: 1.6, wait_minutes: 35,
    is_open: true, featured: false, tags: ["Tacos", "Tequila Bar"],
    gradient: "from-orange-900 to-red-800", emoji: "🌮",
  },
  {
    id: "r-5", slug: "terra-verde", name: "Terra Verde",
    cuisine_type: "Italian", avg_rating: 4.5, total_reviews: 389, price_range: 2,
    city: "Toronto", address: "77 College St", distance_km: 0.7, wait_minutes: 15,
    is_open: true, featured: false, tags: ["Pasta", "Vegetarian-Friendly"],
    gradient: "from-green-900 to-emerald-800", emoji: "🍝",
  },
  {
    id: "r-6", slug: "harbour-grill", name: "Harbour Grill",
    cuisine_type: "Seafood", avg_rating: 4.9, total_reviews: 156, price_range: 4,
    city: "Toronto", address: "1 Harbour Square", distance_km: 2.1, wait_minutes: null,
    is_open: true, featured: false, tags: ["Waterfront", "Business Dinner"],
    gradient: "from-cyan-900 to-teal-800", emoji: "🦞",
  },
  {
    id: "r-7", slug: "spice-route", name: "Spice Route",
    cuisine_type: "Indian", avg_rating: 4.3, total_reviews: 521, price_range: 2,
    city: "Mississauga", address: "3025 Hurontario St", distance_km: 3.4, wait_minutes: 10,
    is_open: true, featured: false, tags: ["Vegetarian", "Halal"],
    gradient: "from-yellow-900 to-orange-800", emoji: "🍛",
  },
  {
    id: "r-8", slug: "le-petit-bistro", name: "Le Petit Bistro",
    cuisine_type: "French", avg_rating: 4.6, total_reviews: 94, price_range: 3,
    city: "Montreal", address: "485 Rue Laurier O", distance_km: 1.8, wait_minutes: null,
    is_open: false, featured: false, tags: ["Quiet", "Romantic"],
    gradient: "from-purple-900 to-violet-800", emoji: "🥗",
  },
  {
    id: "r-9", slug: "smoke-and-barrel", name: "Smoke & Barrel",
    cuisine_type: "BBQ", avg_rating: 4.7, total_reviews: 633, price_range: 2,
    city: "Toronto", address: "512 Adelaide St W", distance_km: 1.1, wait_minutes: 25,
    is_open: true, featured: false, tags: ["Casual", "Craft Beer"],
    gradient: "from-stone-800 to-neutral-700", emoji: "🥩",
  },
];

const CUISINES = ["All", "Italian", "Japanese", "Mexican", "French", "Indian", "Thai", "Seafood", "BBQ"];

function RestaurantCard({ r, index }: { r: MockRestaurant; index: number }) {
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
        <div className={`relative h-44 w-full bg-gradient-to-br ${r.gradient} overflow-hidden`}>
          <div className="absolute inset-0 flex items-center justify-center text-5xl opacity-30">
            {r.emoji}
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-bg-base/80 via-transparent to-transparent" />

          {/* Badges */}
          <div className="absolute left-3 top-3 flex gap-1.5">
            {r.tags.slice(0, 1).map((tag) => (
              <span key={tag} className="rounded-full bg-black/50 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
                {tag}
              </span>
            ))}
          </div>

          {!r.is_open && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <span className="rounded-full bg-black/70 px-3 py-1 text-xs font-semibold text-text-muted">
                Closed
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
                <span>{r.cuisine_type}</span>
                <span className="text-gold">{PRICE_LABELS[r.price_range]}</span>
                <span className="flex items-center gap-0.5">
                  <MapPin className="size-2.5" />
                  {r.distance_km} km
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1 rounded-lg bg-gold/10 px-2 py-1">
              <Star className="size-3 fill-gold text-gold" />
              <span className="text-xs font-bold text-gold">{r.avg_rating.toFixed(1)}</span>
            </div>
          </div>

          {/* Footer row */}
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-text-muted">{r.total_reviews} reviews</span>
            {r.wait_minutes != null ? (
              <span className="flex items-center gap-1 text-xs text-warning">
                <Clock className="size-3" />
                {r.wait_minutes} min wait
              </span>
            ) : r.is_open ? (
              <span className="text-xs font-medium text-success">Book instantly</span>
            ) : null}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

export default function DiscoverPage() {
  const { t } = useTranslation();
  const { signOut } = useUser();
  const [search, setSearch] = useState("");
  const [activeCuisine, setActiveCuisine] = useState("All");
  const [chatOpen, setChatOpen] = useState(false);

  const filtered = useMemo(() => {
    let list = MOCK_RESTAURANTS;
    if (activeCuisine !== "All") {
      list = list.filter((r) => r.cuisine_type === activeCuisine);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.cuisine_type.toLowerCase().includes(q) ||
          r.city.toLowerCase().includes(q),
      );
    }
    return list;
  }, [search, activeCuisine]);

  const featured = MOCK_RESTAURANTS.filter((r) => r.featured);
  const nearYou = MOCK_RESTAURANTS.filter((r) => !r.featured).sort((a, b) => a.distance_km - b.distance_km);

  const showFiltered = search.trim() !== "" || activeCuisine !== "All";

  return (
    <div className="flex min-h-screen flex-col bg-bg-base text-text-primary">
      {/* Restaurant owner banner */}
      <div className="border-b border-gold/20 bg-gold/8">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-2 text-xs text-gold">
            <Store className="size-3.5 shrink-0" />
            <span className="font-medium">Are you a restaurant owner or staff member?</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/setup"
              className="rounded-lg bg-gold px-3 py-1.5 text-xs font-bold text-bg-base transition-opacity hover:opacity-90"
            >
              Set up your restaurant
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:border-gold/40 hover:text-gold"
            >
              <LogOut className="size-3" />
              Sign out
            </button>
          </div>
        </div>
      </div>

      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-bg-base/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="shrink-0 text-sm font-bold tracking-[0.2em] text-gold">
            SEATLY
          </Link>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search restaurants, cuisine, or city..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-bg-elevated pl-9 pr-4 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-gold/40"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            title="Filters"
          >
            <SlidersHorizontal className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            onClick={() => setChatOpen(!chatOpen)}
            title="AI Assistant"
          >
            <MessageCircle className="size-4" />
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-6 sm:px-6">
        {/* Cuisine filter chips */}
        <div className="flex flex-wrap gap-2">
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
        {showFiltered ? (
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
            {/* Featured */}
            <section>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
                  <Flame className="size-4 text-gold" />
                  Featured Tonight
                </h2>
                <button type="button" className="flex items-center gap-1 text-xs text-text-muted hover:text-gold transition-colors">
                  View all <ChevronRight className="size-3" />
                </button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {featured.map((r, i) => (
                  <RestaurantCard key={r.id} r={r} index={i} />
                ))}
              </div>
            </section>

            {/* Near You */}
            <section>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
                  <MapPin className="size-4 text-gold" />
                  Near You
                  <span className="text-xs font-normal text-text-muted">Southern Ontario</span>
                </h2>
                <button type="button" className="flex items-center gap-1 text-xs text-text-muted hover:text-gold transition-colors">
                  View all <ChevronRight className="size-3" />
                </button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {nearYou.map((r, i) => (
                  <RestaurantCard key={r.id} r={r} index={i} />
                ))}
              </div>
            </section>
          </>
        )}
      </main>

      {/* AI Chat panel */}
      <AnimatePresence>
        {chatOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
              onClick={() => setChatOpen(false)}
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-border bg-bg-surface shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <div className="flex items-center gap-2">
                  <div className="flex size-7 items-center justify-center rounded-lg bg-gold/15">
                    <MessageCircle className="size-3.5 text-gold" />
                  </div>
                  <h2 className="text-sm font-semibold text-text-primary">AI Assistant</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setChatOpen(false)}
                  className="flex size-7 items-center justify-center rounded-lg text-text-muted hover:text-white transition-colors"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Suggested prompts */}
              <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5">
                <p className="text-xs font-medium text-text-muted">Suggested</p>
                {[
                  "Best date night restaurants near me",
                  "Where can I get sushi under $30?",
                  "I have a nut allergy, what's safe?",
                  "Plan a birthday dinner for 6",
                ].map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="rounded-xl border border-border bg-bg-elevated p-3 text-left text-xs font-medium text-text-secondary transition-all hover:border-gold/30 hover:text-text-primary"
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              <div className="border-t border-border p-4">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Ask anything about restaurants..."
                    className="h-10 flex-1 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-gold/40"
                  />
                  <Button size="sm" className="h-10 px-4">
                    Send
                  </Button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
