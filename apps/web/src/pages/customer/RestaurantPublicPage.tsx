import { useState, useMemo, useId, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { format, isValid, parse, startOfToday } from "date-fns";
import { useParams, Link, useSearchParams } from "react-router-dom";
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
  Split,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useRestaurant } from "@/hooks/useRestaurant";
import { usePublicMenuCategories, usePublicMenuItems } from "@/hooks/useMenuItems";
import { useAllActivePromotions, getPromotionLabel, getPromoTypeBadgeClasses } from "@/hooks/usePromotions";
import { useUser } from "@/hooks/useUser";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { applyRestaurantTheme, resetTheme } from "@/lib/theme";
import { computePromoDiscount } from "@/lib/computePromoDiscount";

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
  party_size: number | "";
  seating_preference: string;
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

type SplitCardRow = {
  number: string;
  expiry: string;
  cvc: string;
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
const SEATING_PREFERENCES = [
  "",
  "By the window",
  "Middle of dining room",
  "Booth seating",
  "Lounge seating",
  "Patio",
  "Bar seating",
  "Quiet corner",
];
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

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Convert "7:00 PM" → "19:00" for timestamptz storage. */
function convertTo24h(time12: string): string {
  const match = time12.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return "19:00";
  let h = parseInt(match[1], 10);
  const m = match[2];
  const period = match[3].toUpperCase();
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return `${h.toString().padStart(2, "0")}:${m}`;
}

/** Demo checkout: enough digits for a test PAN, expiry, and CVC. */
function isCardFilled(num: string, exp: string, cvc: string): boolean {
  const digits = num.replace(/\D/g, "");
  return digits.length >= 15 && exp.trim().length >= 4 && cvc.replace(/\D/g, "").length >= 3;
}

function formatCardPanInput(value: string): string {
  return value
    .replace(/\D/g, "")
    .slice(0, 16)
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

// ─── Step indicator ───────────────────────────────────────────────────────────
const STEPS: { key: Step; labelKey: string }[] = [
  { key: "type", labelKey: "customerPublic.booking.stepService" },
  { key: "menu", labelKey: "customerPublic.booking.stepMenu" },
  { key: "details", labelKey: "customerPublic.booking.stepDetails" },
  { key: "checkout", labelKey: "customerPublic.booking.stepPayment" },
];

function StepBar({
  current,
  onNavigate,
}: {
  current: Step;
  onNavigate?: (step: Step) => void;
}) {
  const { t } = useTranslation();
  const idx = STEPS.findIndex((s) => s.key === current);
  if (current === "confirmed") return null;
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        const clickable = Boolean(done && onNavigate);
        const label = t(s.labelKey);
        const circle = (
          <div
            className={`flex size-7 items-center justify-center rounded-full border-2 text-xs font-bold transition-all ${
              done
                ? "border-gold bg-gold text-bg-base"
                : active
                  ? "border-gold bg-gold/15 text-gold"
                  : "border-border bg-bg-elevated text-text-muted"
            }`}
          >
            {done ? <Check className="size-3.5" /> : i + 1}
          </div>
        );
        const caption = (
          <span
            className={`text-[10px] font-medium ${
              active ? "text-gold" : done ? "text-text-secondary" : "text-text-muted"
            }`}
          >
            {label}
          </span>
        );
        return (
          <div key={s.key} className="flex flex-1 items-center">
            <div className="flex flex-col items-center gap-1">
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onNavigate?.(s.key)}
                  aria-label={t("customerPublic.booking.goToStep", { step: label })}
                  className="flex flex-col items-center gap-1 rounded-lg p-0.5 outline-none transition-colors hover:bg-gold/10 focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
                >
                  {circle}
                  {caption}
                </button>
              ) : (
                <>
                  {circle}
                  {caption}
                </>
              )}
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`mb-4 h-px flex-1 mx-1 transition-colors ${i < idx ? "bg-gold" : "bg-border"}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function RestaurantPublicPage() {
  const { t } = useTranslation();
  const { restaurantSlug } = useParams<{ restaurantSlug: string }>();
  const [searchParams] = useSearchParams();
  const { restaurant, loading } = useRestaurant(restaurantSlug);
  const { profile } = useUser();
  const { promotions: allPromos } = useAllActivePromotions();
  const { categories: dbCategories } = usePublicMenuCategories(restaurant?.id);
  const { items: dbMenuItems, loading: menuLoading } = usePublicMenuItems(restaurant?.id);
  const restaurantPromos = useMemo(
    () => allPromos.filter((p) => p.restaurant_id === restaurant?.id),
    [allPromos, restaurant?.id],
  );

  // Map DB menu items to the local MenuItem shape used by the cart/allergen system
  const menuItems = useMemo<MenuItem[]>(() => {
    if (dbMenuItems.length === 0) return MENU;
    return dbMenuItems.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      price: row.price,
      category: row.category ?? (dbCategories.find((c) => c.id === row.category_id)?.name ?? "Other"),
      popular: row.is_featured,
      dietary: row.dietary_flags ?? [],
      emoji: "🍽️",
      allergens: row.allergens ?? [],
      ingredients: row.description ?? "",
    }));
  }, [dbMenuItems, dbCategories]);

  const categoryList = useMemo(
    () => ["All", ...dbCategories.map((c) => c.name)],
    [dbCategories],
  );

  const [step, setStep] = useState<Step>("type");
  const [orderType, setOrderType] = useState<OrderType | null>(null);
  const [activeCategory, setActiveCategory] = useState("All");
  const [activePromoId, setActivePromoId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);

  const [dineIn, setDineIn] = useState<DineInDetails>({
    date: "", time: "7:00 PM", party_size: 2,
    seating_preference: "",
    name: "", email: "", phone: "", allergies: "", occasion: "",
  });
  const [delivery, setDelivery] = useState<DeliveryDetails>({
    name: "", email: "", phone: "", address: "", unit: "", instructions: "",
  });
  const [pickup, setPickup] = useState<PickupDetails>({
    name: "", email: "", phone: "", time: "6:00 PM",
  });

  // Pre-fill contact fields from logged-in profile (only on first load)
  useEffect(() => {
    if (!profile) return;
    const name = profile.full_name ?? "";
    const email = profile.email ?? "";
    const phone = profile.phone ?? "";
    const allergies = profile.allergies?.join(", ") ?? "";
    const seating = profile.seating_preference ?? "";
    setDineIn((d) => ({
      ...d,
      name: d.name || name,
      email: d.email || email,
      phone: d.phone || phone,
      allergies: d.allergies || allergies,
      seating_preference: d.seating_preference || seating,
    }));
    setDelivery((d) => ({
      ...d,
      name: d.name || name,
      email: d.email || email,
      phone: d.phone || phone,
    }));
    setPickup((d) => ({
      ...d,
      name: d.name || name,
      email: d.email || email,
      phone: d.phone || phone,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  // Apply this restaurant's theme while on its public page; reset on leave.
  useEffect(() => {
    if (!restaurant?.settings_json?.theme) return;
    applyRestaurantTheme(restaurant.settings_json.theme);
    return () => { resetTheme(); };
  }, [restaurant?.id, restaurant?.settings_json]);

  // ── Deep-link from Cenaiva: ?order_id=xxx&step=checkout ──────────────────
  // When Cenaiva creates an order and the user wants to pay via the manual
  // checkout (split bill, different card), it links here with the order_id.
  // We fetch the order, populate cart state, and jump to the checkout step.
  useEffect(() => {
    const orderId = searchParams.get("order_id");
    const targetStep = searchParams.get("step") as Step | null;
    if (!orderId || targetStep !== "checkout" || !isSupabaseConfigured()) return;

    const client = getSupabaseBrowserClient();
    void (async () => {
      const { data: order } = await client
        .from("orders")
        .select("id, order_type, notes, order_items(name, quantity, unit_price, modifications, menu_item_id)")
        .eq("id", orderId)
        .single();
      if (!order) return;

      const orderItems = (order.order_items || []) as {
        name: string; quantity: number; unit_price: number;
        modifications: string | null; menu_item_id: string | null;
      }[];

      // Populate cart from order items — build minimal MenuItem shells
      const cartItems: CartItem[] = orderItems.map((item) => ({
        id: item.menu_item_id || `item-${Math.random()}`,
        name: item.name,
        description: "",
        price: item.unit_price,
        category: "",
        popular: false,
        dietary: [],
        emoji: "🍽️",
        allergens: [],
        ingredients: "",
        qty: item.quantity,
        note: item.modifications || undefined,
      }));

      setCart(cartItems);
      setOrderType(
        order.order_type === "dine_in" ? "dine_in"
          : order.order_type === "delivery" ? "delivery"
          : "pickup",
      );
      setStep("checkout");
    })();
  // Run once on mount — searchParams is stable for the initial URL
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvc, setCardCvc] = useState("");
  const [paymentSplitMode, setPaymentSplitMode] = useState<"single" | "split">("single");
  /** Raw input so the field can be cleared while typing; clamped on blur. Parsed as `splitPartyCount`. */
  const [splitPartyCountInput, setSplitPartyCountInput] = useState("2");
  const splitPartyCountParse = useMemo(() => {
    const raw = splitPartyCountInput.trim();
    if (raw === "") return { kind: "empty" as const };
    const n = Number.parseInt(splitPartyCountInput, 10);
    if (Number.isNaN(n)) return { kind: "invalid" as const };
    if (n < 2 || n > 10) return { kind: "out_of_range" as const };
    return { kind: "ok" as const, value: n };
  }, [splitPartyCountInput]);
  const splitPartyCount =
    splitPartyCountParse.kind === "ok" ? splitPartyCountParse.value : NaN;
  const [splitCardRows, setSplitCardRows] = useState<SplitCardRow[]>(() =>
    Array.from({ length: 2 }, () => ({ number: "", expiry: "", cvc: "" })),
  );

  useEffect(() => {
    if (paymentSplitMode !== "split") return;
    if (!Number.isFinite(splitPartyCount) || splitPartyCount < 2 || splitPartyCount > 10) return;
    setSplitCardRows((prev) => {
      if (prev.length === splitPartyCount) return prev;
      const next = prev.slice(0, splitPartyCount);
      while (next.length < splitPartyCount) {
        next.push({ number: "", expiry: "", cvc: "" });
      }
      return next;
    });
  }, [paymentSplitMode, splitPartyCount]);
  const [tipOption, setTipOption] = useState<"15" | "18" | "20" | "custom" | "after">("18");
  const [customTipAmount, setCustomTipAmount] = useState("");
  const [placing, setPlacing] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [confirmationCode, setConfirmationCode] = useState<string>("");

  const currency = restaurant?.currency ?? "cad";
  const gradient = CUISINE_GRADIENT[restaurant?.cuisine_type ?? ""] ?? "from-zinc-900 to-neutral-900";

  const dineInDateTriggerId = useId();
  const [dineInDatePopoverOpen, setDineInDatePopoverOpen] = useState(false);
  const dineInCalendarDay = useMemo(() => {
    if (!dineIn.date) return undefined;
    const d = parse(dineIn.date, "yyyy-MM-dd", new Date());
    return isValid(d) ? d : undefined;
  }, [dineIn.date]);

  const filteredMenu = useMemo(() => {
    let list = activeCategory === "All" ? menuItems : menuItems.filter((m) => m.category === activeCategory);
    if (activePromoId) {
      const promo = restaurantPromos.find((p) => p.id === activePromoId);
      if (promo) {
        if (promo.promo_type === "bogo" && promo.bogo_item_ids.length > 0) {
          const ids = new Set(promo.bogo_item_ids);
          list = list.filter((m) => ids.has(m.id));
        } else if (promo.promo_type === "free_item" && promo.free_item_id) {
          list = list.filter((m) => m.id === promo.free_item_id);
        }
        // bogo with empty bogo_item_ids = full menu — no item-level filter
        // percentage / fixed — no item-level filter
      }
    }
    return list;
  }, [activeCategory, activePromoId, menuItems, restaurantPromos]);

  const eligiblePromoItemIds = useMemo<Set<string>>(() => {
    if (!activePromoId) return new Set();
    const promo = restaurantPromos.find((p) => p.id === activePromoId);
    if (!promo) return new Set();
    if (promo.promo_type === "bogo") return new Set(promo.bogo_item_ids);
    if (promo.promo_type === "free_item") return promo.free_item_id ? new Set([promo.free_item_id]) : new Set();
    return new Set(promo.eligible_item_ids);
  }, [activePromoId, restaurantPromos]);

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

    const flagged = menuItems.filter((item) =>
      item.allergens.some((a) => matched.has(a)),
    ).map((item) => ({
      ...item,
      matchedAllergens: item.allergens.filter((a) => matched.has(a)),
    }));

    return { flaggedItems: flagged, allergenKeywords: Array.from(matched) };
  }, [dineIn.allergies, orderType, menuItems]);

  const cartTotal          = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const cartCount          = cart.reduce((s, i) => s + i.qty, 0);
  const taxRate            = restaurant?.tax_rate ?? 0.13;
  const activePromo        = activePromoId ? restaurantPromos.find((p) => p.id === activePromoId) ?? null : null;
  const { discount }       = activePromo ? computePromoDiscount(cart, activePromo) : { discount: 0 };
  const discountedSubtotal = Math.max(0, cartTotal - discount);
  const tax                = discountedSubtotal * taxRate;
  const total              = discountedSubtotal + tax;
  const deliveryFee = orderType === "delivery" ? 4.99 : 0;
  const parsedCustomTip = Number.parseFloat(customTipAmount);
  const tipAmount =
    tipOption === "after"
      ? 0
      : tipOption === "custom"
      ? Number.isFinite(parsedCustomTip) && parsedCustomTip > 0
        ? parsedCustomTip
        : 0
      : cartTotal * (Number.parseInt(tipOption, 10) / 100);
  const totalNow = total + deliveryFee + tipAmount;

  const splitEachShare = useMemo(() => {
    if (paymentSplitMode !== "split") return NaN;
    const n = splitPartyCount;
    if (!Number.isFinite(n) || n < 2 || n > 10) return NaN;
    return roundMoney(totalNow / n);
  }, [paymentSplitMode, splitPartyCount, totalNow]);

  const splitCheckoutValid = useMemo(() => {
    if (paymentSplitMode !== "split") return true;
    if (!Number.isFinite(splitPartyCount) || splitPartyCount < 2 || splitPartyCount > 10) return false;
    if (!Number.isFinite(splitEachShare) || splitEachShare <= 0) return false;
    if (splitCardRows.length !== splitPartyCount) return false;
    return splitCardRows.every((row) => isCardFilled(row.number, row.expiry, row.cvc));
  }, [paymentSplitMode, splitPartyCount, splitEachShare, splitCardRows]);

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
    if (orderType === "dine_in") {
      return (
        dineIn.date &&
        dineIn.name &&
        dineIn.email &&
        typeof dineIn.party_size === "number" &&
        dineIn.party_size >= 1
      );
    }
    if (orderType === "pickup")   return pickup.name && pickup.email && pickup.phone;
    if (orderType === "delivery") return delivery.name && delivery.email && delivery.phone && delivery.address;
    return false;
  };

  const handlePlaceOrder = useCallback(async () => {
    if (!restaurant || !orderType || cart.length === 0) return;
    const isRealUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(restaurant.id);
    if (!isSupabaseConfigured() || !isRealUuid) {
      // Mock mode — just show confirmation
      setConfirmationCode(`SEAT-${Math.random().toString(36).slice(2, 6).toUpperCase()}`);
      setStep("confirmed");
      return;
    }

    setPlacing(true);
    setOrderError(null);
    const code = `SEAT-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    try {
      const client = getSupabaseBrowserClient();

      // Determine contact info based on order type
      const contactName =
        orderType === "dine_in" ? dineIn.name :
        orderType === "pickup" ? pickup.name : delivery.name;
      const contactEmail =
        orderType === "dine_in" ? dineIn.email :
        orderType === "pickup" ? pickup.email : delivery.email;
      const contactPhone =
        orderType === "dine_in" ? dineIn.phone :
        orderType === "pickup" ? pickup.phone : delivery.phone;

      // 1. Upsert a guest record for this restaurant
      let guestId: string | null = null;
      if (profile) {
        // Check if guest record already exists for this user + restaurant
        const { data: existingGuest } = await client
          .from("guests")
          .select("id")
          .eq("restaurant_id", restaurant.id)
          .eq("user_profile_id", profile.id)
          .maybeSingle();

        if (existingGuest) {
          guestId = existingGuest.id;
        } else {
          const { data: newGuest, error: guestErr } = await client
            .from("guests")
            .insert({
              restaurant_id: restaurant.id,
              user_profile_id: profile.id,
              full_name: contactName,
              email: contactEmail,
              phone: contactPhone,
              dietary_restrictions: dineIn.allergies ? dineIn.allergies.split(",").map((s: string) => s.trim()).filter(Boolean) : [],
              seating_preference: orderType === "dine_in" ? dineIn.seating_preference : null,
            })
            .select("id")
            .single();
          if (guestErr) throw new Error(`Guest: ${guestErr.message}`);
          guestId = newGuest.id;
        }
      }

      // 2. For dine-in, create a reservation
      let reservationId: string | null = null;
      if (orderType === "dine_in") {
        const reservedAt = `${dineIn.date}T${convertTo24h(dineIn.time)}:00`;
        const { data: resData, error: resErr } = await client
          .from("reservations")
          .insert({
            restaurant_id: restaurant.id,
            guest_id: guestId,
            party_size: typeof dineIn.party_size === "number" ? dineIn.party_size : 1,
            reserved_at: reservedAt,
            status: "pending",
            source: "web",
            special_request: dineIn.allergies || null,
            occasion: dineIn.occasion || null,
            confirmation_code: code,
            is_guest_checkout: !profile,
            guest_full_name: contactName,
            guest_email: contactEmail,
            guest_phone: contactPhone,
            dietary_notes: dineIn.allergies || null,
          })
          .select("id")
          .single();
        if (resErr) throw new Error(`Reservation: ${resErr.message}`);
        reservationId = resData.id;
      }

      // 3. Create the order
      const { data: orderData, error: orderErr } = await client
        .from("orders")
        .insert({
          restaurant_id: restaurant.id,
          reservation_id: reservationId,
          guest_id: guestId,
          is_preorder: orderType !== "dine_in",
          order_type: orderType === "pickup" ? "takeout" : orderType,
          status: "pending",
          subtotal: roundMoney(discountedSubtotal),
          tax_amount: roundMoney(tax),
          tip_amount: roundMoney(tipAmount),
          total_amount: roundMoney(totalNow),
          discount_amount: discount > 0 ? roundMoney(discount) : null,
          discount_reason: activePromo?.title ?? null,
          promotion_id: activePromo?.id ?? null,
          payment_method: paymentSplitMode === "split" ? "split" : "card",
          confirmation_code: code,
        })
        .select("id")
        .single();
      if (orderErr) throw new Error(`Order: ${orderErr.message}`);

      // 4. Insert order items
      const items = cart.map((item) => ({
        order_id: orderData.id,
        menu_item_id: item.id.startsWith("m") ? null : item.id, // skip mock IDs
        name: item.name,
        quantity: item.qty,
        unit_price: roundMoney(item.price),
        line_total: roundMoney(item.price * item.qty),
        status: "pending",
      }));
      const { error: itemsErr } = await client.from("order_items").insert(items);
      if (itemsErr) throw new Error(`Order items: ${itemsErr.message}`);

      // 5. Increment promotion usage counter
      if (activePromo) {
        await client.from("promotions")
          .update({ current_uses: activePromo.current_uses + 1 })
          .eq("id", activePromo.id);
      }

      // 6. Save phone to user profile if it changed (so it's remembered next time)
      if (profile && contactPhone && contactPhone !== (profile.phone ?? "")) {
        await client
          .from("user_profiles")
          .update({ phone: contactPhone })
          .eq("id", profile.id);
      }

      setConfirmationCode(code);
      setStep("confirmed");
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : "Failed to place order");
    } finally {
      setPlacing(false);
    }
  }, [restaurant, orderType, cart, profile, dineIn, pickup, delivery, cartTotal, tax, tipAmount, totalNow, paymentSplitMode, discount, discountedSubtotal, activePromo, restaurantPromos]);

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
          <StepBar current={step} onNavigate={setStep} />
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
                    onClick={() => { setOrderType(key); setStep("menu"); }}
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
            <motion.div
              key="details"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.25 }}
              className="pointer-events-auto"
            >
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">
                  {orderType === "dine_in" ? "Book your table" : orderType === "pickup" ? "Pickup details" : "Delivery details"}
                </h2>
                <button type="button" onClick={() => setStep("menu")} className="text-xs text-text-muted hover:text-gold transition-colors">
                  ← Back to menu
                </button>
              </div>

              <div className="rounded-2xl border border-border bg-bg-surface p-5 sm:p-6">
                {/* ── Dine In ── */}
                {orderType === "dine_in" && (
                  <div className="space-y-4">
                    {/* Date + Time + Party */}
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <Label htmlFor={dineInDateTriggerId} className="mb-1.5 block text-xs text-text-muted">
                          Date <span className="text-danger">*</span>
                        </Label>
                        <Popover open={dineInDatePopoverOpen} onOpenChange={setDineInDatePopoverOpen}>
                          <PopoverTrigger asChild>
                            <button
                              id={dineInDateTriggerId}
                              type="button"
                              className="relative flex h-10 w-full cursor-pointer items-center rounded-lg border border-border bg-bg-elevated pl-9 pr-2 text-left outline-none transition-colors hover:border-gold/30 focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
                            >
                              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
                              <span
                                className={`truncate text-xs leading-none ${
                                  dineIn.date ? "text-text-primary" : "text-text-muted"
                                }`}
                              >
                                {dineIn.date
                                  ? new Date(`${dineIn.date}T12:00:00`).toLocaleDateString(undefined, {
                                      weekday: "short",
                                      month: "short",
                                      day: "numeric",
                                      year: "numeric",
                                    })
                                  : t("customerPublic.booking.selectDate")}
                              </span>
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="start"
                            className="w-auto border-border bg-bg-elevated p-0 text-text-primary shadow-2xl"
                          >
                            <Calendar
                              mode="single"
                              required={false}
                              selected={dineInCalendarDay}
                              onSelect={(d) => {
                                setDineIn((prev) => ({
                                  ...prev,
                                  date: d ? format(d, "yyyy-MM-dd") : "",
                                }));
                                if (d) {
                                  setDineInDatePopoverOpen(false);
                                }
                              }}
                              disabled={{ before: startOfToday() }}
                              className="rounded-md border-0 bg-transparent [--cell-size:--spacing(8)]"
                            />
                            {dineIn.date ? (
                              <div className="border-t border-border p-2">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="w-full text-text-secondary hover:bg-bg-surface hover:text-text-primary"
                                  onClick={() => {
                                    setDineIn((d) => ({ ...d, date: "" }));
                                    setDineInDatePopoverOpen(false);
                                  }}
                                >
                                  {t("customerPublic.booking.clearDate")}
                                </Button>
                              </div>
                            ) : null}
                          </PopoverContent>
                        </Popover>
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
                              const raw = e.target.value;
                              if (raw === "") {
                                setDineIn((d) => ({ ...d, party_size: "" }));
                                return;
                              }
                              const v = parseInt(raw, 10);
                              if (!isNaN(v) && v >= 1 && v <= 50) {
                                setDineIn((d) => ({ ...d, party_size: v }));
                              }
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

                    {/* Seating preference */}
                    <div>
                      <Label className="mb-1.5 block text-xs text-text-muted">Table preference (optional)</Label>
                      <div className="relative">
                        <select
                          value={dineIn.seating_preference}
                          onChange={(e) =>
                            setDineIn((d) => ({ ...d, seating_preference: e.target.value }))
                          }
                          className="h-10 w-full appearance-none rounded-lg border border-border bg-bg-elevated px-3 pr-8 text-sm text-text-primary outline-none focus:border-gold/40"
                        >
                          {SEATING_PREFERENCES.map((pref) => (
                            <option key={pref || "none"} value={pref}>
                              {pref || "No preference"}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
                      </div>
                    </div>

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
                onClick={() => setStep("checkout")}
              >
                Continue to Checkout
                <ChevronRight className="size-4 ml-1" />
              </Button>
            </motion.div>
          )}

          {/* ═══════════════════════════════════ STEP 3: MENU ══════════════════ */}
          {step === "menu" && (
            <motion.div key="menu" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.25 }}>
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Choose your items</h2>
                <button type="button" onClick={() => setStep("type")} className="text-xs text-text-muted hover:text-gold transition-colors">← Change type</button>
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

              {/* Active promotions strip */}
              {restaurantPromos.length > 0 && (
                <div className="mb-4 flex flex-col gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-400">Active Deals</p>
                  <div className="flex flex-wrap gap-2">
                    {restaurantPromos.map((promo) => {
                      const label = getPromotionLabel(promo);
                      const badgeClasses = getPromoTypeBadgeClasses(promo.badge_color);
                      const isSelected = activePromoId === promo.id;
                      const canFilter =
                        (promo.promo_type === "bogo" && promo.bogo_item_ids.length > 0) ||
                        (promo.promo_type === "free_item" && !!promo.free_item_id);
                      return (
                        <button
                          key={promo.id}
                          type="button"
                          onClick={() => setActivePromoId(isSelected ? null : promo.id)}
                          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-all ${badgeClasses} ${
                            isSelected
                              ? "ring-2 ring-current ring-offset-1 ring-offset-bg-base opacity-100"
                              : "opacity-80 hover:opacity-100"
                          }`}
                        >
                          <span className="font-bold tracking-wide">{label}</span>
                          <span className="font-medium opacity-90">{promo.title}</span>
                          {promo.free_item_name && (
                            <span className="opacity-75">· Free: {promo.free_item_name}</span>
                          )}
                          {canFilter && (
                            <span className="ml-1 rounded-full bg-current/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide">
                              {isSelected ? "Clear" : "Filter"}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {activePromoId && eligiblePromoItemIds.size > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-text-muted">Included:</span>
                      {menuItems.filter((m) => eligiblePromoItemIds.has(m.id)).map((m) => (
                        <span key={m.id} className="rounded-full border border-border bg-bg-elevated px-2 py-0.5 text-[11px] text-text-secondary">
                          {m.name} · {formatCurrency(m.price, currency)}
                        </span>
                      ))}
                    </div>
                  )}
                  {activePromoId && (
                    <p className="text-[11px] text-text-muted">
                      {eligiblePromoItemIds.size > 0 ? "Showing items included in this deal." : "This deal applies to your entire cart."}{" "}
                      <button
                        type="button"
                        onClick={() => setActivePromoId(null)}
                        className="text-gold underline hover:no-underline"
                      >
                        Show all
                      </button>
                    </p>
                  )}
                </div>
              )}

              {/* Category chips */}
              <div className="mb-4 flex flex-wrap gap-2">
                {(categoryList.length > 1 ? categoryList : ["All", "Starters", "Mains", "Desserts", "Drinks"]).map((cat) => (
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
                          {activePromo && eligiblePromoItemIds.has(item.id) && (
                            <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${getPromoTypeBadgeClasses(activePromo.badge_color)}`}>
                              {getPromotionLabel(activePromo)}
                            </span>
                          )}
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
                  onClick={() => setStep("details")}
                >
                  {cartCount === 0
                    ? "Add items to continue"
                    : `Continue · ${cartCount} item${cartCount !== 1 ? "s" : ""} · ${formatCurrency(cartTotal, currency)}`}
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
                <button type="button" onClick={() => setStep("details")} className="text-xs text-text-muted hover:text-gold transition-colors">← Edit details</button>
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
                  {discount > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-green-400">Discount {activePromo ? `(${activePromo.title})` : ""}</span>
                      <span className="text-green-400">- {formatCurrency(discount, currency)}</span>
                    </div>
                  )}
                  {orderType === "delivery" && (
                    <div className="flex justify-between text-sm">
                      <span className="text-text-secondary">Delivery fee</span>
                      <span className="text-text-primary">{formatCurrency(deliveryFee, currency)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">
                      Tip {tipOption === "after" ? "(after experience)" : ""}
                    </span>
                    <span className="text-text-primary">
                      {tipOption === "after" ? "Pay later" : formatCurrency(tipAmount, currency)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Tax ({(taxRate * 100).toFixed(0)}%)</span>
                    <span className="text-text-primary">{formatCurrency(tax, currency)}</span>
                  </div>
                  <div className="flex justify-between border-t border-border pt-2 text-base font-bold">
                    <span className="text-text-primary">Total due now</span>
                    <span className="text-gold">{formatCurrency(totalNow, currency)}</span>
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
                    <div><p className="text-text-muted text-xs">Party size</p><p className="font-medium text-text-primary">{dineIn.party_size || 1} guests</p></div>
                    {dineIn.seating_preference && (
                      <div>
                        <p className="text-text-muted text-xs">Table preference</p>
                        <p className="font-medium text-text-primary">{dineIn.seating_preference}</p>
                      </div>
                    )}
                    {dineIn.allergies && <div className="col-span-2"><p className="text-text-muted text-xs">Dietary notes</p><p className="font-medium text-text-primary">{dineIn.allergies}</p></div>}
                    {dineIn.occasion && <div><p className="text-text-muted text-xs">Occasion</p><p className="font-medium text-text-primary">{dineIn.occasion}</p></div>}
                  </div>
                </div>
              )}

              {/* Payment */}
              <div className="mt-3 rounded-2xl border border-border bg-bg-surface p-5">
                <div className="mb-4 rounded-xl border border-border bg-bg-elevated p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-text-muted">
                    Tip preference
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: "15", label: "15%" },
                      { id: "18", label: "18%" },
                      { id: "20", label: "20%" },
                      { id: "custom", label: "Custom" },
                      { id: "after", label: "Tip after experience" },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() =>
                          setTipOption(opt.id as "15" | "18" | "20" | "custom" | "after")
                        }
                        className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                          tipOption === opt.id
                            ? "border-gold bg-gold/10 text-gold"
                            : "border-border text-text-secondary hover:border-gold/30 hover:text-gold"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {tipOption === "custom" && (
                    <div className="mt-3">
                      <Label htmlFor="custom-tip" className="mb-1.5 block text-xs text-text-muted">
                        Custom tip amount
                      </Label>
                      <Input
                        id="custom-tip"
                        inputMode="decimal"
                        value={customTipAmount}
                        onChange={(e) =>
                          setCustomTipAmount(e.target.value.replace(/[^\d.]/g, "").slice(0, 8))
                        }
                        placeholder="0.00"
                      />
                    </div>
                  )}
                </div>
                <div className="mb-4 rounded-xl border border-border bg-bg-elevated p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Split className="size-4 text-gold" />
                    <p className="text-xs font-semibold uppercase tracking-widest text-text-muted">
                      {t("customerPublic.checkout.splitTenderTitle")}
                    </p>
                  </div>
                  <p className="mb-3 text-[11px] leading-relaxed text-text-muted">
                    {t("customerPublic.checkout.splitTenderHint")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setPaymentSplitMode("single")}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        paymentSplitMode === "single"
                          ? "border-gold bg-gold/10 text-gold"
                          : "border-border text-text-secondary hover:border-gold/30 hover:text-gold"
                      }`}
                    >
                      {t("customerPublic.checkout.paymentSingle")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentSplitMode("split")}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        paymentSplitMode === "split"
                          ? "border-gold bg-gold/10 text-gold"
                          : "border-border text-text-secondary hover:border-gold/30 hover:text-gold"
                      }`}
                    >
                      {t("customerPublic.checkout.paymentSplitTender")}
                    </button>
                  </div>
                  {paymentSplitMode === "split" && (
                    <div className="mt-3 space-y-3">
                      <div>
                        <Label htmlFor="split-party-count" className="mb-1.5 block text-xs text-text-muted">
                          {t("customerPublic.checkout.splitAmongPeopleLabel")}
                        </Label>
                        <Input
                          id="split-party-count"
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          value={splitPartyCountInput}
                          onChange={(e) => {
                            const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
                            setSplitPartyCountInput(digits);
                          }}
                          onBlur={() => {
                            const n = Number.parseInt(splitPartyCountInput, 10);
                            if (splitPartyCountInput.trim() === "" || Number.isNaN(n)) {
                              setSplitPartyCountInput("2");
                              return;
                            }
                            setSplitPartyCountInput(String(Math.min(10, Math.max(2, n))));
                          }}
                          className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        />
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-text-secondary">{t("customerPublic.checkout.splitEachShareLabel")}</span>
                        <span className="font-medium text-text-primary">
                          {Number.isFinite(splitEachShare) && splitEachShare > 0
                            ? formatCurrency(splitEachShare, currency)
                            : "—"}
                        </span>
                      </div>
                      {!splitCheckoutValid && splitPartyCountParse.kind !== "ok" && (
                        <p className="border-t border-border pt-3 text-xs leading-relaxed text-danger">
                          {t("customerPublic.checkout.splitPartyCountRangeHint")}
                        </p>
                      )}
                      {!splitCheckoutValid && splitPartyCountParse.kind === "ok" && (
                        <p className="border-t border-border pt-3 text-xs leading-relaxed text-danger">
                          {t("customerPublic.checkout.splitInvalidHintCompleteCards", {
                            count: splitPartyCount,
                          })}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <div className="mb-4 flex items-center gap-2">
                  <CreditCard className="size-4 text-gold" />
                  <p className="text-xs font-semibold uppercase tracking-widest text-text-muted">Payment</p>
                  <Lock className="ml-auto size-3 text-text-muted" />
                  <span className="text-[10px] text-text-muted">Secured</span>
                </div>
                <div className="space-y-3">
                  {paymentSplitMode === "single" ? (
                    <>
                      <div>
                        <Label htmlFor="card-num" className="mb-1.5 block text-xs text-text-muted">
                          {t("customerPublic.checkout.cardNumber")}
                        </Label>
                        <Input
                          id="card-num"
                          value={cardNumber}
                          onChange={(e) => setCardNumber(formatCardPanInput(e.target.value))}
                          placeholder="4242 4242 4242 4242"
                          maxLength={19}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label htmlFor="card-exp" className="mb-1.5 block text-xs text-text-muted">
                            {t("customerPublic.checkout.cardExpiry")}
                          </Label>
                          <Input
                            id="card-exp"
                            value={cardExpiry}
                            onChange={(e) => setCardExpiry(e.target.value)}
                            placeholder="MM / YY"
                            maxLength={7}
                          />
                        </div>
                        <div>
                          <Label htmlFor="card-cvc" className="mb-1.5 block text-xs text-text-muted">
                            {t("customerPublic.checkout.cardCvc")}
                          </Label>
                          <Input
                            id="card-cvc"
                            value={cardCvc}
                            onChange={(e) =>
                              setCardCvc(e.target.value.replace(/\D/g, "").slice(0, 4))
                            }
                            placeholder="•••"
                            maxLength={4}
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col gap-6 sm:gap-8">
                      {splitCardRows.map((row, i) => (
                        <div
                          key={i}
                          className="space-y-4 rounded-xl border border-border bg-bg-surface p-4 sm:p-5"
                        >
                          <p className="text-[11px] font-semibold uppercase tracking-widest text-text-muted sm:text-xs">
                            {t("customerPublic.checkout.cardNumberedLabel", { n: i + 1 })}
                          </p>
                          <div className="space-y-4">
                            <div>
                              <Label
                                htmlFor={`split-card-${i}-num`}
                                className="mb-2 block text-xs text-text-muted"
                              >
                                {t("customerPublic.checkout.cardNumber")}
                              </Label>
                              <Input
                                id={`split-card-${i}-num`}
                                value={row.number}
                                onChange={(e) => {
                                  const number = formatCardPanInput(e.target.value);
                                  setSplitCardRows((rows) =>
                                    rows.map((r, j) => (j === i ? { ...r, number } : r)),
                                  );
                                }}
                                placeholder="4242 4242 4242 4242"
                                maxLength={19}
                                className="h-11"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-3 sm:gap-4">
                              <div>
                                <Label
                                  htmlFor={`split-card-${i}-exp`}
                                  className="mb-2 block text-xs text-text-muted"
                                >
                                  {t("customerPublic.checkout.cardExpiry")}
                                </Label>
                                <Input
                                  id={`split-card-${i}-exp`}
                                  value={row.expiry}
                                  onChange={(e) => {
                                    const expiry = e.target.value;
                                    setSplitCardRows((rows) =>
                                      rows.map((r, j) => (j === i ? { ...r, expiry } : r)),
                                    );
                                  }}
                                  placeholder="MM / YY"
                                  maxLength={7}
                                  className="h-11"
                                />
                              </div>
                              <div>
                                <Label
                                  htmlFor={`split-card-${i}-cvc`}
                                  className="mb-2 block text-xs text-text-muted"
                                >
                                  {t("customerPublic.checkout.cardCvc")}
                                </Label>
                                <Input
                                  id={`split-card-${i}-cvc`}
                                  value={row.cvc}
                                  onChange={(e) => {
                                    const cvc = e.target.value.replace(/\D/g, "").slice(0, 4);
                                    setSplitCardRows((rows) =>
                                      rows.map((r, j) => (j === i ? { ...r, cvc } : r)),
                                    );
                                  }}
                                  placeholder="•••"
                                  maxLength={4}
                                  className="h-11"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {orderError && (
                <div className="mt-4 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
                  {orderError}
                </div>
              )}
              <Button
                className="mt-5 h-12 w-full text-base font-semibold"
                disabled={(paymentSplitMode === "split" && !splitCheckoutValid) || placing}
                onClick={() => void handlePlaceOrder()}
              >
                <Lock className="size-4 mr-2" />
                {placing ? "Placing order…" : "Place Order"}
              </Button>
              <p className="mt-2 text-center text-[11px] text-text-muted">
                By placing your order you agree to our terms.{" "}
                {tipOption === "after"
                  ? "Tip will be collected after your experience."
                  : "Selected tip is included in today's checkout."}
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
                    ? `Your table at ${restaurant.name} is reserved for ${dineIn.party_size || 1} on ${dineIn.date} at ${dineIn.time}.`
                    : orderType === "pickup"
                    ? `Your order will be ready for pickup at ${pickup.time}.`
                    : `Your order is being prepared and will arrive shortly.`}
                </p>
              </div>

              <div className="w-full rounded-2xl border border-success/20 bg-success/5 px-6 py-4">
                <p className="text-xs text-text-muted">Confirmation code</p>
                <p className="mt-1 font-mono text-xl font-bold tracking-widest text-gold">
                  {confirmationCode}
                </p>
                <p className="mt-1 text-xs text-text-muted">A confirmation has been sent to your email.</p>
              </div>

              <div className="flex w-full flex-col gap-2">
                <Button
                  onClick={() => {
                    setStep("type");
                    setCart([]);
                    setOrderType(null);
                    setTipOption("18");
                    setCustomTipAmount("");
                    setPaymentSplitMode("single");
                    setSplitPartyCountInput("2");
                    setCardNumber("");
                    setCardExpiry("");
                    setCardCvc("");
                    setConfirmationCode("");
                    setOrderError(null);
                  }}
                >
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
