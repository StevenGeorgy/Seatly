import { useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  Star,
  MapPin,
  Phone,
  ChevronRight,
  Plus,
  Minus,
  Check,
  Flame,
  UtensilsCrossed,
  Package,
  Bike,
  CalendarDays,
  Clock,
  Users,
  ChevronDown,
  Trash2,
  CreditCard,
  Lock,
  AlertTriangle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useRestaurant } from "@/hooks/useRestaurant";
import { formatCurrency } from "@/lib/utils/formatCurrency";

// ─── Types ───────────────────────────────────────────────────────────────────
type OrderType = "dine_in" | "pickup" | "delivery";
type Step = "type" | "details" | "menu" | "checkout" | "confirmed";

type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  popular: boolean;
  dietary: string[];
  emoji: string;
  /** Key allergens present in this dish */
  allergens: string[];
  /** Human-readable ingredient highlights shown in the warning section */
  ingredients: string;
};

type CartItem = MenuItem & { qty: number; note?: string };

type DineInDetails = {
  date: string;
  time: string;
  party_size: number;
  name: string;
  email: string;
  phone: string;
  allergies: string;
  occasion: string;
};

type DeliveryDetails = {
  name: string;
  email: string;
  phone: string;
  address: string;
  unit: string;
  instructions: string;
};

type PickupDetails = {
  name: string;
  email: string;
  phone: string;
  time: string;
};

// ─── Menu data ───────────────────────────────────────────────────────────────
const MENU: MenuItem[] = [
  {
    id: "m1",  name: "Bruschetta",          category: "Starters",  popular: true,  price: 14,
    dietary: ["V"],       emoji: "🍅",
    description: "Toasted sourdough, heirloom tomatoes, fresh basil, aged balsamic.",
    allergens: ["gluten"],
    ingredients: "Sourdough bread (wheat/gluten), tomatoes, basil, garlic, olive oil, balsamic vinegar",
  },
  {
    id: "m2",  name: "Burrata & Prosciutto", category: "Starters",  popular: false, price: 18,
    dietary: [],          emoji: "🧀",
    description: "Creamy burrata, San Daniele prosciutto, honey, toasted walnuts.",
    allergens: ["dairy", "nuts", "pork"],
    ingredients: "Burrata (milk/dairy), prosciutto (pork), walnuts (tree nuts), honey, arugula, olive oil",
  },
  {
    id: "m3",  name: "French Onion Soup",    category: "Starters",  popular: true,  price: 16,
    dietary: [],          emoji: "🥣",
    description: "Rich beef broth, caramelized onions, croutons, and a gruyère crust.",
    allergens: ["gluten", "dairy"],
    ingredients: "Beef broth, onions, croutons (wheat/gluten), gruyère cheese (dairy), butter (dairy), thyme",
  },
  {
    id: "m4",  name: "Pan-Seared Salmon",    category: "Mains",     popular: true,  price: 34,
    dietary: ["GF"],      emoji: "🐟",
    description: "Atlantic salmon, lemon beurre blanc, seasonal vegetables, wild rice.",
    allergens: ["fish", "dairy"],
    ingredients: "Atlantic salmon (fish), butter (dairy), lemon, shallots, wild rice, seasonal vegetables",
  },
  {
    id: "m5",  name: "Grilled Ribeye 12oz",  category: "Mains",     popular: true,  price: 56,
    dietary: ["GF"],      emoji: "🥩",
    description: "Prime dry-aged ribeye, truffle butter, house frites, seasonal greens.",
    allergens: ["dairy"],
    ingredients: "Beef ribeye, truffle butter (dairy), potatoes, seasonal greens, herbs",
  },
  {
    id: "m6",  name: "Wild Mushroom Risotto", category: "Mains",    popular: false, price: 28,
    dietary: ["V", "GF"], emoji: "🍄",
    description: "Porcini & shiitake, parmesan foam, truffle oil.",
    allergens: ["dairy"],
    ingredients: "Arborio rice, porcini mushrooms, shiitake mushrooms, parmesan (dairy), butter (dairy), truffle oil, vegetable stock",
  },
  {
    id: "m7",  name: "Duck Confit",           category: "Mains",    popular: false, price: 38,
    dietary: ["GF"],      emoji: "🦆",
    description: "Slow-cooked duck leg, lentilles du Puy, braised red cabbage, jus.",
    allergens: [],
    ingredients: "Duck leg, green lentils, red cabbage, duck jus, herbs, garlic",
  },
  {
    id: "m8",  name: "Crème Brûlée",          category: "Desserts", popular: true,  price: 12,
    dietary: ["V", "GF"], emoji: "🍮",
    description: "Classic vanilla custard with a caramelized sugar crust.",
    allergens: ["dairy", "eggs"],
    ingredients: "Heavy cream (dairy), egg yolks (eggs), vanilla bean, sugar",
  },
  {
    id: "m9",  name: "Chocolate Fondant",     category: "Desserts", popular: true,  price: 14,
    dietary: ["V"],       emoji: "🍫",
    description: "Warm dark chocolate lava cake, vanilla ice cream, berry coulis.",
    allergens: ["gluten", "dairy", "eggs"],
    ingredients: "Dark chocolate (may contain traces of nuts), butter (dairy), eggs, flour (gluten), vanilla ice cream (dairy), mixed berries",
  },
  {
    id: "m10", name: "House Red Wine",         category: "Drinks",   popular: false, price: 14,
    dietary: ["V", "GF"], emoji: "🍷",
    description: "Côtes du Rhône — glass pour.",
    allergens: ["sulphites"],
    ingredients: "Red wine (sulphites)",
  },
  {
    id: "m11", name: "Seasonal Cocktail",      category: "Drinks",   popular: true,  price: 16,
    dietary: [],          emoji: "🍸",
    description: "Ask about today's house-crafted cocktail.",
    allergens: ["sulphites"],
    ingredients: "Seasonal spirits, fresh fruit juice, syrups — ask your server for today's full ingredient list",
  },
  {
    id: "m12", name: "Sparkling Water",        category: "Drinks",   popular: false, price: 7,
    dietary: ["V", "GF"], emoji: "💧",
    description: "San Pellegrino 750ml.",
    allergens: [],
    ingredients: "Sparkling mineral water",
  },
];

const CATEGORIES = ["All", "Starters", "Mains", "Desserts", "Drinks"];
const TIMES = ["5:00 PM","5:30 PM","6:00 PM","6:30 PM","7:00 PM","7:30 PM","8:00 PM","8:30 PM","9:00 PM","9:30 PM"];
const PICKUP_TIMES = ["12:00 PM","12:30 PM","1:00 PM","1:30 PM","2:00 PM","5:00 PM","5:30 PM","6:00 PM","6:30 PM","7:00 PM"];
const OCCASIONS = ["", "Anniversary", "Birthday", "Business Dinner", "Date Night", "Family Gathering"];
const CUISINE_GRADIENT: Record<string, string> = {
  French:   "from-indigo-900 to-blue-900",
  Japanese: "from-rose-900 to-pink-900",
  Italian:  "from-green-900 to-emerald-900",
  Mexican:  "from-orange-900 to-red-900",
  Seafood:  "from-cyan-900 to-teal-900",
  BBQ:      "from-stone-800 to-neutral-800",
  Indian:   "from-yellow-900 to-orange-900",
};
const PRICE_LABELS = ["—", "$", "$$", "$$$", "$$$$"];

// ─── Step indicator ───────────────────────────────────────────────────────────
const STEPS: { key: Step; label: string }[] = [
  { key: "type",     label: "Service" },
  { key: "details",  label: "Details" },
  { key: "menu",     label: "Menu" },
  { key: "checkout", label: "Payment" },
];

function StepBar({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.key === current);
  if (current === "confirmed") return null;
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={s.key} className="flex flex-1 items-center">
            <div className="flex flex-col items-center gap-1">
              <div className={`flex size-7 items-center justify-center rounded-full border-2 text-xs font-bold transition-all ${
                done   ? "border-gold bg-gold text-bg-base" :
                active ? "border-gold bg-gold/15 text-gold" :
                         "border-border bg-bg-elevated text-text-muted"
              }`}>
                {done ? <Check className="size-3.5" /> : i + 1}
              </div>
              <span className={`text-[10px] font-medium ${active ? "text-gold" : done ? "text-text-secondary" : "text-text-muted"}`}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`mb-4 h-px flex-1 mx-1 transition-colors ${i < idx ? "bg-gold" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function RestaurantPublicPage() {
  const { restaurantSlug } = useParams<{ restaurantSlug: string }>();
  const { restaurant, loading } = useRestaurant(restaurantSlug);

  const [step, setStep] = useState<Step>("type");
  const [orderType, setOrderType] = useState<OrderType | null>(null);
  const [activeCategory, setActiveCategory] = useState("All");
  const [cart, setCart] = useState<CartItem[]>([]);

  const [dineIn, setDineIn] = useState<DineInDetails>({
    date: "", time: "7:00 PM", party_size: 2,
    name: "", email: "", phone: "", allergies: "", occasion: "",
  });
  const [delivery, setDelivery] = useState<DeliveryDetails>({
    name: "", email: "", phone: "", address: "", unit: "", instructions: "",
  });
  const [pickup, setPickup] = useState<PickupDetails>({
    name: "", email: "", phone: "", time: "6:00 PM",
  });

  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvc, setCardCvc] = useState("");

  const currency = restaurant?.currency ?? "cad";
  const gradient = CUISINE_GRADIENT[restaurant?.cuisine_type ?? ""] ?? "from-zinc-900 to-neutral-900";

  const filteredMenu = useMemo(
    () => activeCategory === "All" ? MENU : MENU.filter((m) => m.category === activeCategory),
    [activeCategory],
  );

  // Parse the user's allergy text into individual keywords and find flagged items
  const { flaggedItems, allergenKeywords } = useMemo(() => {
    const raw = orderType === "dine_in" ? dineIn.allergies : "";
    if (!raw.trim()) return { flaggedItems: [], allergenKeywords: [] };

    // Split on commas, spaces, common separators and lowercase
    const keywords = raw
      .toLowerCase()
      .split(/[,;/\s]+/)
      .map((k) => k.trim())
      .filter((k) => k.length > 2);

    // Canonical allergen map — maps user words → allergen tag
    const ALIAS: Record<string, string> = {
      nut: "nuts", nuts: "nuts", peanut: "nuts", peanuts: "nuts", almond: "nuts",
      walnut: "nuts", cashew: "nuts", hazelnut: "nuts", pistachio: "nuts",
      tree: "nuts",
      dairy: "dairy", milk: "dairy", cream: "dairy", cheese: "dairy",
      butter: "dairy", lactose: "dairy",
      gluten: "gluten", wheat: "gluten", bread: "gluten", flour: "gluten",
      barley: "gluten", rye: "gluten",
      egg: "eggs", eggs: "eggs",
      fish: "fish", salmon: "fish", tuna: "fish", cod: "fish",
      shellfish: "shellfish", shrimp: "shellfish", prawn: "shellfish",
      lobster: "shellfish", crab: "shellfish", oyster: "shellfish",
      soy: "soy", soya: "soy",
      pork: "pork", bacon: "pork", ham: "pork", prosciutto: "pork",
      sulphite: "sulphites", sulphites: "sulphites", sulfite: "sulphites",
      vegan: "dairy", vegetarian: "pork",
    };

    const matched = new Set<string>();
    keywords.forEach((k) => {
      if (ALIAS[k]) matched.add(ALIAS[k]);
      // also check if any allergen tag contains the keyword
      else Object.values(ALIAS).forEach((v) => { if (v.includes(k) || k.includes(v)) matched.add(v); });
    });

    const flagged = MENU.filter((item) =>
      item.allergens.some((a) => matched.has(a)),
    ).map((item) => ({
      ...item,
      matchedAllergens: item.allergens.filter((a) => matched.has(a)),
    }));

    return { flaggedItems: flagged, allergenKeywords: Array.from(matched) };
  }, [dineIn.allergies, orderType]);

  const cartTotal   = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const cartCount   = cart.reduce((s, i) => s + i.qty, 0);
  const taxRate     = restaurant?.tax_rate ?? 0.13;
  const tax         = cartTotal * taxRate;
  const total       = cartTotal + tax;

  function addToCart(item: MenuItem) {
    setCart((prev) => {
      const ex = prev.find((c) => c.id === item.id);
      if (ex) return prev.map((c) => c.id === item.id ? { ...c, qty: c.qty + 1 } : c);
      return [...prev, { ...item, qty: 1 }];
    });
  }
  function removeFromCart(id: string) {
    setCart((prev) => {
      const ex = prev.find((c) => c.id === id);
      if (!ex) return prev;
      if (ex.qty === 1) return prev.filter((c) => c.id !== id);
      return prev.map((c) => c.id === id ? { ...c, qty: c.qty - 1 } : c);
    });
  }
  function deleteFromCart(id: string) {
    setCart((prev) => prev.filter((c) => c.id !== id));
  }

  const canProceedDetails = () => {
    if (orderType === "dine_in")  return dineIn.date && dineIn.name && dineIn.email;
    if (orderType === "pickup")   return pickup.name && pickup.email && pickup.phone;
    if (orderType === "delivery") return delivery.name && delivery.email && delivery.phone && delivery.address;
    return false;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-base">
        <Skeleton className="h-44 w-full" />
        <div className="mx-auto max-w-2xl space-y-4 p-6">
          <Skeleton className="h-8 w-48" /><Skeleton className="h-4 w-32" /><Skeleton className="h-20 w-full" />
        </div>
      </div>
    );
  }

  if (!restaurant) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg-base text-text-primary">
        <p className="text-lg font-semibold">Restaurant not found</p>
        <Button variant="outline" asChild><Link to="/discover">Back to Discover</Link></Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-base text-text-primary">
      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <div className={`relative h-40 w-full bg-gradient-to-b ${gradient}`}>
        <div className="absolute inset-0 bg-gradient-to-t from-bg-base via-bg-base/20 to-transparent" />
        <div className="absolute left-4 top-4">
          <Button variant="ghost" size="sm" className="gap-1.5 bg-black/30 backdrop-blur-sm hover:bg-black/50" asChild>
            <Link to="/discover"><ArrowLeft className="size-4" />Back</Link>
          </Button>
        </div>
      </div>

      {/* ── Restaurant info ───────────────────────────────────────────────────── */}
      <div className="mx-auto -mt-8 max-w-2xl px-4 sm:px-6">
        <div className="flex items-end justify-between gap-4 pb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{restaurant.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              {restaurant.cuisine_type && <span className="text-text-secondary">{restaurant.cuisine_type}</span>}
              {restaurant.price_range != null && <span className="font-medium text-gold">{PRICE_LABELS[restaurant.price_range]}</span>}
              {restaurant.avg_rating != null && (
                <span className="flex items-center gap-1 rounded-full bg-gold/10 px-2 py-0.5">
                  <Star className="size-3 fill-gold text-gold" />
                  <span className="font-bold text-gold">{restaurant.avg_rating.toFixed(1)}</span>
                  {restaurant.total_reviews && <span className="text-text-muted">({restaurant.total_reviews})</span>}
                </span>
              )}
              {restaurant.address && (
                <span className="flex items-center gap-1 text-text-muted"><MapPin className="size-3" />{restaurant.city}</span>
              )}
              {restaurant.phone && (
                <a href={`tel:${restaurant.phone}`} className="flex items-center gap-1 text-text-muted hover:text-gold transition-colors">
                  <Phone className="size-3" />{restaurant.phone}
                </a>
              )}
            </div>
          </div>
        </div>

        {/* ── Step bar ─────────────────────────────────────────────────────────── */}
        <div className="mb-6">
          <StepBar current={step} />
        </div>

        {/* ── Step content ─────────────────────────────────────────────────────── */}
        <AnimatePresence mode="wait">

          {/* ═══════════════════════════════════ STEP 1: SERVICE TYPE ══════════ */}
          {step === "type" && (
            <motion.div key="type" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.25 }}>
              <h2 className="mb-5 text-lg font-bold text-white">How would you like to order?</h2>
              <div className="flex flex-col gap-3">
                {([
                  { key: "dine_in",  icon: UtensilsCrossed, label: "Dine In",  sub: "Book a table and order at the restaurant" },
                  { key: "pickup",   icon: Package,          label: "Pickup",   sub: "Order ahead and pick up when ready"       },
                  { key: "delivery", icon: Bike,             label: "Delivery", sub: "Get it delivered to your door"            },
                ] as const).map(({ key, icon: Icon, label, sub }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setOrderType(key); setStep("details"); }}
                    className="flex items-center gap-4 rounded-2xl border border-border bg-bg-surface p-5 text-left transition-all hover:border-gold/40 hover:bg-bg-elevated group"
                  >
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gold/10 transition-colors group-hover:bg-gold/20">
                      <Icon className="size-5 text-gold" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-text-primary">{label}</p>
                      <p className="text-xs text-text-muted">{sub}</p>
                    </div>
                    <ChevronRight className="size-4 text-text-muted group-hover:text-gold transition-colors" />
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* ═══════════════════════════════════ STEP 2: DETAILS ═══════════════ */}
          {step === "details" && (
            <motion.div key="details" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.25 }}>
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">
                  {orderType === "dine_in" ? "Book your table" : orderType === "pickup" ? "Pickup details" : "Delivery details"}
                </h2>
                <button type="button" onClick={() => setStep("type")} className="text-xs text-text-muted hover:text-gold transition-colors">
                  ← Change
                </button>
              </div>

              <div className="rounded-2xl border border-border bg-bg-surface p-5 sm:p-6">
                {/* ── Dine In ── */}
                {orderType === "dine_in" && (
                  <div className="space-y-4">
                    {/* Date + Time + Party */}
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <Label className="mb-1.5 block text-xs text-text-muted">Date <span className="text-danger">*</span></Label>
                        <div className="relative">
                          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
                          <input
                            type="date"
                            required
                            value={dineIn.date}
                            onChange={(e) => setDineIn((d) => ({ ...d, date: e.target.value }))}
                            className="h-10 w-full rounded-lg border border-border bg-bg-elevated pl-9 pr-2 text-xs text-text-primary outline-none focus:border-gold/40 [color-scheme:dark]"
                          />
                        </div>
                      </div>
                      <div>
                        <Label className="mb-1.5 block text-xs text-text-muted">Time</Label>
                        <div className="relative">
                          <Clock className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted z-10" />
                          <select
                            value={dineIn.time}
                            onChange={(e) => setDineIn((d) => ({ ...d, time: e.target.value }))}
                            className="h-10 w-full appearance-none rounded-lg border border-border bg-bg-elevated pl-9 pr-2 text-xs text-text-primary outline-none focus:border-gold/40"
                          >
                            {TIMES.map((t) => <option key={t}>{t}</option>)}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-text-muted" />
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="di-party" className="mb-1.5 block text-xs text-text-muted">Guests</Label>
                        <div className="relative">
                          <Users className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
                          <input
                            id="di-party"
                            type="number"
                            min={1}
                            max={50}
                            value={dineIn.party_size}
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10);
                              if (!isNaN(v) && v >= 1) setDineIn((d) => ({ ...d, party_size: v }));
                            }}
                            className="h-10 w-full rounded-lg border border-border bg-bg-elevated pl-9 pr-3 text-sm text-text-primary outline-none focus:border-gold/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="h-px bg-border" />

                    {/* Contact */}
                    <div>
                      <Label htmlFor="di-name" className="mb-1.5 block text-xs text-text-muted">Full Name <span className="text-danger">*</span></Label>
                      <Input id="di-name" required value={dineIn.name} onChange={(e) => setDineIn((d) => ({ ...d, name: e.target.value }))} placeholder="Jane Smith" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="di-email" className="mb-1.5 block text-xs text-text-muted">Email <span className="text-danger">*</span></Label>
                        <Input id="di-email" type="email" required value={dineIn.email} onChange={(e) => setDineIn((d) => ({ ...d, email: e.target.value }))} placeholder="jane@example.com" />
                      </div>
                      <div>
                        <Label htmlFor="di-phone" className="mb-1.5 block text-xs text-text-muted">Phone</Label>
                        <Input id="di-phone" type="tel" value={dineIn.phone} onChange={(e) => setDineIn((d) => ({ ...d, phone: e.target.value }))} placeholder="+1 (416) 555-0100" />
                      </div>
                    </div>

                    <div className="h-px bg-border" />

                    {/* Occasion */}
                    <div>
                      <Label className="mb-1.5 block text-xs text-text-muted">Occasion (optional)</Label>
                      <div className="relative">
                        <select
                          value={dineIn.occasion}
                          onChange={(e) => setDineIn((d) => ({ ...d, occasion: e.target.value }))}
                          className="h-10 w-full appearance-none rounded-lg border border-border bg-bg-elevated px-3 pr-8 text-sm text-text-primary outline-none focus:border-gold/40"
                        >
                          {OCCASIONS.map((o) => <option key={o} value={o}>{o || "Select occasion…"}</option>)}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
                      </div>
                    </div>

                    {/* Dietary restrictions */}
                    <div>
                      <Label htmlFor="di-allergies" className="mb-1.5 block text-xs text-text-muted">Dietary restrictions & allergies</Label>
                      <Input id="di-allergies" value={dineIn.allergies} onChange={(e) => setDineIn((d) => ({ ...d, allergies: e.target.value }))} placeholder="e.g. Nut allergy (2 guests), 1 vegan, gluten-free" />
                      <p className="mt-1.5 text-[11px] text-text-muted">Please list restrictions for every guest in your party.</p>
                    </div>
                  </div>
                )}

                {/* ── Pickup ── */}
                {orderType === "pickup" && (
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="pu-name" className="mb-1.5 block text-xs text-text-muted">Full Name <span className="text-danger">*</span></Label>
                      <Input id="pu-name" required value={pickup.name} onChange={(e) => setPickup((p) => ({ ...p, name: e.target.value }))} placeholder="Jane Smith" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="pu-email" className="mb-1.5 block text-xs text-text-muted">Email <span className="text-danger">*</span></Label>
                        <Input id="pu-email" type="email" required value={pickup.email} onChange={(e) => setPickup((p) => ({ ...p, email: e.target.value }))} placeholder="jane@example.com" />
                      </div>
                      <div>
                        <Label htmlFor="pu-phone" className="mb-1.5 block text-xs text-text-muted">Phone <span className="text-danger">*</span></Label>
                        <Input id="pu-phone" type="tel" required value={pickup.phone} onChange={(e) => setPickup((p) => ({ ...p, phone: e.target.value }))} placeholder="+1 (416) 555-0100" />
                      </div>
                    </div>
                    <div>
                      <Label className="mb-1.5 block text-xs text-text-muted">Pickup time</Label>
                      <div className="relative">
                        <Clock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted z-10" />
                        <select
                          value={pickup.time}
                          onChange={(e) => setPickup((p) => ({ ...p, time: e.target.value }))}
                          className="h-10 w-full appearance-none rounded-lg border border-border bg-bg-elevated pl-10 pr-8 text-sm text-text-primary outline-none focus:border-gold/40"
                        >
                          {PICKUP_TIMES.map((t) => <option key={t}>{t}</option>)}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Delivery ── */}
                {orderType === "delivery" && (
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="dv-name" className="mb-1.5 block text-xs text-text-muted">Full Name <span className="text-danger">*</span></Label>
                      <Input id="dv-name" required value={delivery.name} onChange={(e) => setDelivery((d) => ({ ...d, name: e.target.value }))} placeholder="Jane Smith" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="dv-email" className="mb-1.5 block text-xs text-text-muted">Email <span className="text-danger">*</span></Label>
                        <Input id="dv-email" type="email" required value={delivery.email} onChange={(e) => setDelivery((d) => ({ ...d, email: e.target.value }))} placeholder="jane@example.com" />
                      </div>
                      <div>
                        <Label htmlFor="dv-phone" className="mb-1.5 block text-xs text-text-muted">Phone <span className="text-danger">*</span></Label>
                        <Input id="dv-phone" type="tel" required value={delivery.phone} onChange={(e) => setDelivery((d) => ({ ...d, phone: e.target.value }))} placeholder="+1 (416) 555-0100" />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="dv-address" className="mb-1.5 block text-xs text-text-muted">Delivery address <span className="text-danger">*</span></Label>
                      <Input id="dv-address" required value={delivery.address} onChange={(e) => setDelivery((d) => ({ ...d, address: e.target.value }))} placeholder="123 Main St, Toronto, ON" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="dv-unit" className="mb-1.5 block text-xs text-text-muted">Apt / Unit</Label>
                        <Input id="dv-unit" value={delivery.unit} onChange={(e) => setDelivery((d) => ({ ...d, unit: e.target.value }))} placeholder="Apt 4B" />
                      </div>
                      <div>
                        <Label htmlFor="dv-instructions" className="mb-1.5 block text-xs text-text-muted">Instructions</Label>
                        <Input id="dv-instructions" value={delivery.instructions} onChange={(e) => setDelivery((d) => ({ ...d, instructions: e.target.value }))} placeholder="Ring doorbell" />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <Button
                className="mt-5 h-12 w-full text-base font-semibold"
                disabled={!canProceedDetails()}
                onClick={() => setStep("menu")}
              >
                Continue to Menu
                <ChevronRight className="size-4 ml-1" />
              </Button>
            </motion.div>
          )}

          {/* ═══════════════════════════════════ STEP 3: MENU ══════════════════ */}
          {step === "menu" && (
            <motion.div key="menu" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.25 }}>
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Choose your items</h2>
                <button type="button" onClick={() => setStep("details")} className="text-xs text-text-muted hover:text-gold transition-colors">← Back</button>
              </div>

              {/* ── Allergen warning section ── */}
              {flaggedItems.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-5 rounded-2xl border border-danger/30 bg-danger/5 p-4"
                >
                  <div className="mb-3 flex items-center gap-2">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-danger/15">
                      <AlertTriangle className="size-4 text-danger" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-danger">Avoid these items</p>
                      <p className="text-xs text-text-muted">
                        Based on your restrictions:{" "}
                        <span className="font-medium text-text-secondary">
                          {allergenKeywords.join(", ")}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    {flaggedItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-start gap-3 rounded-xl border border-danger/20 bg-danger/5 p-3"
                      >
                        <span className="mt-0.5 text-xl">{item.emoji}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-text-primary">{item.name}</p>
                          <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{item.ingredients}</p>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {item.matchedAllergens.map((a) => (
                              <span key={a} className="rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-danger">
                                {a}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Category chips */}
              <div className="mb-4 flex flex-wrap gap-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveCategory(cat)}
                    className={`rounded-full border px-4 py-1.5 text-xs font-medium transition-all ${
                      activeCategory === cat
                        ? "border-gold bg-gold/10 text-gold"
                        : "border-border bg-bg-surface text-text-secondary hover:border-gold/40 hover:text-gold"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Items */}
              <div className="flex flex-col gap-2.5">
                <AnimatePresence mode="popLayout">
                  {filteredMenu.map((item, i) => {
                    const inCart = cart.find((c) => c.id === item.id);
                    return (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2, delay: i * 0.03 }}
                        className="flex items-center gap-3 rounded-xl border border-border bg-bg-surface p-4 transition-colors hover:border-gold/20"
                      >
                        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-bg-elevated text-2xl">{item.emoji}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-semibold text-text-primary">{item.name}</span>
                            {item.popular && (
                              <span className="flex items-center gap-0.5 rounded-full bg-gold/10 px-1.5 py-0.5 text-[10px] font-bold text-gold">
                                <Flame className="size-2.5" />Popular
                              </span>
                            )}
                            {item.dietary.map((d) => (
                              <span key={d} className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-text-muted">{d}</span>
                            ))}
                          </div>
                          <p className="mt-0.5 line-clamp-1 text-xs text-text-muted">{item.description}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <span className="text-sm font-bold text-text-primary">{formatCurrency(item.price, currency)}</span>
                          {inCart ? (
                            <div className="flex items-center gap-1">
                              <button type="button" onClick={() => removeFromCart(item.id)} className="flex size-7 items-center justify-center rounded-lg border border-border text-text-secondary hover:border-gold/40 hover:text-gold transition-colors">
                                <Minus className="size-3" />
                              </button>
                              <span className="w-5 text-center text-sm font-bold text-gold">{inCart.qty}</span>
                              <button type="button" onClick={() => addToCart(item)} className="flex size-7 items-center justify-center rounded-lg bg-gold text-bg-base hover:bg-gold-dark transition-colors">
                                <Plus className="size-3" />
                              </button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => addToCart(item)} className="flex size-7 items-center justify-center rounded-lg border border-gold/40 bg-gold/10 text-gold hover:bg-gold/20 transition-colors">
                              <Plus className="size-3.5" />
                            </button>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>

              {/* Continue button — only enabled when cart has items */}
              <div className="sticky bottom-4 mt-5">
                <Button
                  className="h-12 w-full text-base font-semibold shadow-xl"
                  disabled={cartCount === 0}
                  onClick={() => setStep("checkout")}
                >
                  {cartCount === 0
                    ? "Add items to continue"
                    : `Review order · ${cartCount} item${cartCount !== 1 ? "s" : ""} · ${formatCurrency(cartTotal, currency)}`}
                  {cartCount > 0 && <ChevronRight className="size-4 ml-1" />}
                </Button>
              </div>
            </motion.div>
          )}

          {/* ═══════════════════════════════════ STEP 4: CHECKOUT ══════════════ */}
          {step === "checkout" && (
            <motion.div key="checkout" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.25 }}>
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Review & Pay</h2>
                <button type="button" onClick={() => setStep("menu")} className="text-xs text-text-muted hover:text-gold transition-colors">← Edit order</button>
              </div>

              {/* Order summary */}
              <div className="rounded-2xl border border-border bg-bg-surface p-5">
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-text-muted">Order Summary</p>
                <div className="flex flex-col gap-2">
                  {cart.map((item) => (
                    <div key={item.id} className="flex items-center gap-3">
                      <span className="text-base">{item.emoji}</span>
                      <span className="flex-1 text-sm text-text-secondary">
                        {item.qty}× {item.name}
                      </span>
                      <span className="text-sm font-medium text-text-primary">{formatCurrency(item.price * item.qty, currency)}</span>
                      <button type="button" onClick={() => deleteFromCart(item.id)} className="text-text-muted hover:text-danger transition-colors">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-4 space-y-2 border-t border-border pt-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Subtotal</span>
                    <span className="text-text-primary">{formatCurrency(cartTotal, currency)}</span>
                  </div>
                  {orderType === "delivery" && (
                    <div className="flex justify-between text-sm">
                      <span className="text-text-secondary">Delivery fee</span>
                      <span className="text-text-primary">{formatCurrency(4.99, currency)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Tax ({(taxRate * 100).toFixed(0)}%)</span>
                    <span className="text-text-primary">{formatCurrency(tax, currency)}</span>
                  </div>
                  <div className="flex justify-between border-t border-border pt-2 text-base font-bold">
                    <span className="text-text-primary">Total</span>
                    <span className="text-gold">{formatCurrency(total + (orderType === "delivery" ? 4.99 : 0), currency)}</span>
                  </div>
                </div>
              </div>

              {/* Booking summary for dine in */}
              {orderType === "dine_in" && (
                <div className="mt-3 rounded-2xl border border-border bg-bg-surface p-5">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-text-muted">Reservation</p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><p className="text-text-muted text-xs">Name</p><p className="font-medium text-text-primary">{dineIn.name}</p></div>
                    <div><p className="text-text-muted text-xs">Date & Time</p><p className="font-medium text-text-primary">{dineIn.date} · {dineIn.time}</p></div>
                    <div><p className="text-text-muted text-xs">Party size</p><p className="font-medium text-text-primary">{dineIn.party_size} guests</p></div>
                    {dineIn.allergies && <div className="col-span-2"><p className="text-text-muted text-xs">Dietary notes</p><p className="font-medium text-text-primary">{dineIn.allergies}</p></div>}
                    {dineIn.occasion && <div><p className="text-text-muted text-xs">Occasion</p><p className="font-medium text-text-primary">{dineIn.occasion}</p></div>}
                  </div>
                </div>
              )}

              {/* Payment */}
              <div className="mt-3 rounded-2xl border border-border bg-bg-surface p-5">
                <div className="mb-4 flex items-center gap-2">
                  <CreditCard className="size-4 text-gold" />
                  <p className="text-xs font-semibold uppercase tracking-widest text-text-muted">Payment</p>
                  <Lock className="ml-auto size-3 text-text-muted" />
                  <span className="text-[10px] text-text-muted">Secured</span>
                </div>
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="card-num" className="mb-1.5 block text-xs text-text-muted">Card number</Label>
                    <Input
                      id="card-num"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim())}
                      placeholder="4242 4242 4242 4242"
                      maxLength={19}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="card-exp" className="mb-1.5 block text-xs text-text-muted">Expiry</Label>
                      <Input id="card-exp" value={cardExpiry} onChange={(e) => setCardExpiry(e.target.value)} placeholder="MM / YY" maxLength={7} />
                    </div>
                    <div>
                      <Label htmlFor="card-cvc" className="mb-1.5 block text-xs text-text-muted">CVC</Label>
                      <Input id="card-cvc" value={cardCvc} onChange={(e) => setCardCvc(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="•••" maxLength={4} />
                    </div>
                  </div>
                </div>
              </div>

              <Button
                className="mt-5 h-12 w-full text-base font-semibold"
                onClick={() => setStep("confirmed")}
              >
                <Lock className="size-4 mr-2" />
                Place Order
              </Button>
              <p className="mt-2 text-center text-[11px] text-text-muted">
                By placing your order you agree to our terms. Your card won't be charged until checkout.
              </p>
            </motion.div>
          )}

          {/* ═══════════════════════════════════ CONFIRMED ══════════════════════ */}
          {step === "confirmed" && (
            <motion.div
              key="confirmed"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, type: "spring", stiffness: 260, damping: 20 }}
              className="flex flex-col items-center gap-6 py-12 text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: "spring", stiffness: 300, damping: 18 }}
                className="flex size-20 items-center justify-center rounded-full bg-success/15 ring-4 ring-success/20"
              >
                <Check className="size-9 text-success" />
              </motion.div>

              <div>
                <h2 className="text-2xl font-bold text-white">
                  {orderType === "dine_in" ? "Table Booked!" : orderType === "pickup" ? "Order Placed!" : "Order on its way!"}
                </h2>
                <p className="mt-2 text-sm text-text-secondary">
                  {orderType === "dine_in"
                    ? `Your table at ${restaurant.name} is reserved for ${dineIn.party_size} on ${dineIn.date} at ${dineIn.time}.`
                    : orderType === "pickup"
                    ? `Your order will be ready for pickup at ${pickup.time}.`
                    : `Your order is being prepared and will arrive shortly.`}
                </p>
              </div>

              <div className="w-full rounded-2xl border border-success/20 bg-success/5 px-6 py-4">
                <p className="text-xs text-text-muted">Confirmation code</p>
                <p className="mt-1 font-mono text-xl font-bold tracking-widest text-gold">
                  SEAT-{Math.random().toString(36).slice(2, 6).toUpperCase()}
                </p>
                <p className="mt-1 text-xs text-text-muted">A confirmation has been sent to your email.</p>
              </div>

              <div className="flex w-full flex-col gap-2">
                <Button onClick={() => { setStep("type"); setCart([]); setOrderType(null); }}>
                  Order again
                </Button>
                <Button variant="outline" asChild>
                  <Link to="/discover">Back to Discover</Link>
                </Button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>

        <div className="h-10" />
      </div>
    </div>
  );
}
