import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { format, parse, isValid } from "date-fns";
import {
  Bell,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Plus,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import { motion } from "framer-motion";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { Button } from "@/components/ui/button";
import { ColorPicker, BACKGROUND_PRESETS } from "@/components/ui/color-picker";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { applyRestaurantTheme } from "@/lib/theme";
import type { RestaurantSettings } from "@/hooks/useStaffRestaurants";
import { cn } from "@/lib/utils";
import { formatCompactTimeLabel } from "@/lib/utils/time";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of [0, 30]) {
    const ampm = h < 12 ? "AM" : "PM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    TIME_OPTIONS.push(`${h12}:${m === 0 ? "00" : "30"} ${ampm}`);
  }
}

type DayHours = { open: boolean; from: string; to: string };
type SpecialDay = {
  id: string;
  date: string;
  label: string;
  closed: boolean;
  from: string;
  to: string;
};

function defaultHours(): DayHours[] {
  return DAYS.map((_, i) => ({
    open: true,
    from: i < 5 ? "11:00 AM" : "10:00 AM",
    to: i < 5 ? "10:00 PM" : "11:00 PM",
  }));
}

function hoursJsonToState(json: Record<string, unknown> | null): { regular: DayHours[]; special: SpecialDay[] } {
  if (!json) return { regular: defaultHours(), special: [] };
  const regular = DAYS.map((day) => {
    const val = json[day.toLowerCase()] as { open: string; close: string } | null | undefined;
    if (!val) return { open: false, from: "11:00 AM", to: "10:00 PM" };
    return { open: true, from: val.open, to: val.close };
  });
  const rawSpecial = Array.isArray(json.special) ? json.special : [];
  const special: SpecialDay[] = (rawSpecial as Record<string, unknown>[]).map((s) => ({
    id: String(s.id ?? crypto.randomUUID()),
    date: String(s.date ?? ""),
    label: String(s.label ?? ""),
    closed: Boolean(s.closed),
    from: String(s.from ?? "12:00 PM"),
    to: String(s.to ?? "10:00 PM"),
  }));
  return { regular, special };
}

function stateToHoursJson(hours: DayHours[], special: SpecialDay[]): Record<string, unknown> {
  const result: Record<string, unknown> = Object.fromEntries(
    DAYS.map((day, i) => [
      day.toLowerCase(),
      hours[i].open ? { open: hours[i].from, close: hours[i].to } : null,
    ]),
  );
  if (special.length > 0) {
    result.special = special.map(({ id, date, label, closed, from, to }) => ({ id, date, label, closed, from, to }));
  }
  return result;
}

function TimeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full appearance-none rounded-lg border border-border bg-bg-elevated px-3 pr-7 text-xs text-text-primary outline-none focus:border-gold/40"
      >
        {TIME_OPTIONS.map((t) => <option key={t} value={t}>{formatCompactTimeLabel(t)}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-text-muted" />
    </div>
  );
}

const CURRENCY_OPTIONS = [
  { value: "cad", label: "CAD — Canadian Dollar" },
  { value: "usd", label: "USD — US Dollar" },
  { value: "eur", label: "EUR — Euro" },
  { value: "gbp", label: "GBP — British Pound" },
  { value: "aud", label: "AUD — Australian Dollar" },
  { value: "mxn", label: "MXN — Mexican Peso" },
];

const RESTAURANT_DESCRIPTION_MAX_LENGTH = 360;
const DEFAULT_TURN_TIME_MINUTES = 90;
const MIN_TURN_TIME_MINUTES = 30;
const MAX_TURN_TIME_MINUTES = 240;

function isLight(hex: string): boolean {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return false;
  const r = parseInt(match[1], 16);
  const g = parseInt(match[2], 16);
  const b = parseInt(match[3], 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
}

type SectionKey = "restaurant" | "hours" | "billing" | "notifications" | "theme";
type RestaurantInfoSectionKey = Extract<SectionKey, "restaurant" | "hours" | "theme">;
type SettingsSectionKey = Extract<SectionKey, "billing" | "notifications">;

const RESTAURANT_INFO_NAV: { key: RestaurantInfoSectionKey; label: string }[] = [
  { key: "restaurant", label: "Restaurant info" },
  { key: "hours", label: "Hours & calendar" },
  { key: "theme", label: "Theme" },
];

const SETTINGS_NAV: { key: SettingsSectionKey; label: string; icon: typeof CreditCard }[] = [
  { key: "billing", label: "Billing", icon: CreditCard },
  { key: "notifications", label: "Notifications", icon: Bell },
];

const SECTION_META: Record<SectionKey, { eyebrow: string; title: string; subtitle: string }> = {
  restaurant: {
    eyebrow: "Configuration",
    title: "Restaurant info",
    subtitle: "How Cenaiva and your guests see your restaurant.",
  },
  hours: {
    eyebrow: "Configuration",
    title: "Hours & calendar",
    subtitle: "Service windows, closures, and exceptions.",
  },
  billing: {
    eyebrow: "Configuration",
    title: "Settings",
    subtitle: "Billing and notifications that keep operations running.",
  },
  notifications: {
    eyebrow: "Configuration",
    title: "Settings",
    subtitle: "Billing and notifications that keep operations running.",
  },
  theme: {
    eyebrow: "Configuration",
    title: "Theme",
    subtitle: "Customize the colors that brand the dashboard for your restaurant.",
  },
};

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="font-serif text-2xl text-white">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-text-muted">{subtitle}</p>}
    </div>
  );
}

function FieldRow({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid items-start gap-3 border-t border-border/50 px-6 py-5 first:border-t-0 sm:grid-cols-[200px_1fr] sm:gap-6 sm:px-7 sm:py-6">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        {hint && <div className="mt-1 text-xs text-text-muted">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function normalizeTurnTime(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < MIN_TURN_TIME_MINUTES || parsed > MAX_TURN_TIME_MINUTES) return null;
  return parsed;
}

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-border bg-bg-surface">{children}</div>;
}

const PLAN_FEATURES = [
  "Unlimited reservations",
  "Full CRM & marketing",
  "Floor plan + KDS",
  "5 staff seats included",
  "Priority support",
];

const INVOICES = [
  { date: "Apr 1, 2026", id: "INV-04261", amount: "$280.00" },
  { date: "Mar 1, 2026", id: "INV-03261", amount: "$280.00" },
  { date: "Feb 1, 2026", id: "INV-02261", amount: "$280.00" },
  { date: "Jan 1, 2026", id: "INV-01261", amount: "$280.00" },
];

const NOTIFICATION_GROUPS = [
  {
    title: "Reservations",
    rows: [
      { id: "n-new-res", label: "New reservation", desc: "Email + push the host on duty.", email: true, push: true },
      { id: "n-cancel", label: "Cancellations", desc: "Within the no-show window.", email: true, push: false },
      { id: "n-vip", label: "VIP arriving tonight", desc: "Notify floor lead 90 min before seating.", email: false, push: true },
    ],
  },
  {
    title: "Operations",
    rows: [
      { id: "n-86", label: "86'd menu items", desc: "When inventory hits zero.", email: false, push: true },
      { id: "n-late", label: "Staff late / no-show", desc: "After 10 minutes past clock-in.", email: true, push: true },
    ],
  },
  {
    title: "Billing",
    rows: [
      { id: "n-invoice", label: "Invoice ready", desc: "Sent to the billing contact.", email: true, push: false },
      { id: "n-failed", label: "Payment failed", desc: "Card declined or balance issue.", email: true, push: true },
    ],
  },
];

// ─── Page ────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { selectedRestaurant, refreshRestaurants } = useRestaurantScope();
  const [restaurantInfoSection, setRestaurantInfoSection] = useState<RestaurantInfoSectionKey>("restaurant");
  const [settingsSection, setSettingsSection] = useState<SettingsSectionKey>("billing");
  const normalizedPathname = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const isRestaurantInfoRoute = normalizedPathname === "/dashboard/restaurant";
  const section: SectionKey = isRestaurantInfoRoute ? restaurantInfoSection : settingsSection;
  const isStandaloneSection = isRestaurantInfoRoute;
  const pageMeta = isRestaurantInfoRoute ? SECTION_META.restaurant : SECTION_META[section];

  // Restaurant info state
  const [restaurantName, setRestaurantName] = useState(selectedRestaurant?.name ?? "");
  const [cuisine, setCuisine] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [description, setDescription] = useState("");
  const [currency, setCurrency] = useState(selectedRestaurant?.currency ?? "cad");
  const [hasBar, setHasBar] = useState(selectedRestaurant?.has_bar ?? false);
  const [turnTimeMinutes, setTurnTimeMinutes] = useState(
    String(selectedRestaurant?.settings_json?.turnTimeMinutes ?? DEFAULT_TURN_TIME_MINUTES),
  );
  const [savingRestaurant, setSavingRestaurant] = useState(false);
  const [restaurantInitial, setRestaurantInitial] = useState<{
    name: string; cuisine: string; address: string; phone: string; description: string; currency: string; hasBar: boolean; turnTimeMinutes: string;
  } | null>(null);
  const restaurantDescriptionAtLimit = description.length >= RESTAURANT_DESCRIPTION_MAX_LENGTH;
  const normalizedTurnTime = normalizeTurnTime(turnTimeMinutes);

  // Hours
  const [hours, setHours] = useState<DayHours[]>(defaultHours);
  const [specialDays, setSpecialDays] = useState<SpecialDay[]>([]);
  const [openPopoverId, setOpenPopoverId] = useState<string | null>(null);
  const [savingHours, setSavingHours] = useState(false);

  // Billing
  const [currentPlan, setCurrentPlan] = useState<string | null>(null);

  // Theme
  const existingTheme = selectedRestaurant?.settings_json?.theme;
  const [primaryColor, setPrimaryColor] = useState(existingTheme?.primaryColor ?? "#C9A84C");
  const [accentColor, setAccentColor] = useState(existingTheme?.accentColor ?? "#22C55E");
  const [backgroundColor, setBackgroundColor] = useState(existingTheme?.backgroundColor ?? "#0A0A0A");
  const [savingTheme, setSavingTheme] = useState(false);

  // Notifications local state
  const [notifPrefs, setNotifPrefs] = useState(() =>
    Object.fromEntries(
      NOTIFICATION_GROUPS.flatMap((g) => g.rows.map((r) => [r.id, { email: r.email, push: r.push }])),
    ) as Record<string, { email: boolean; push: boolean }>,
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset editable form fields when switching restaurants
    setRestaurantName(selectedRestaurant?.name ?? "");
    setCurrency(selectedRestaurant?.currency ?? "cad");
    setHasBar(selectedRestaurant?.has_bar ?? false);
    setTurnTimeMinutes(String(selectedRestaurant?.settings_json?.turnTimeMinutes ?? DEFAULT_TURN_TIME_MINUTES));
    setPrimaryColor(selectedRestaurant?.settings_json?.theme?.primaryColor ?? "#C9A84C");
    setAccentColor(selectedRestaurant?.settings_json?.theme?.accentColor ?? "#22C55E");
    setBackgroundColor(selectedRestaurant?.settings_json?.theme?.backgroundColor ?? "#0A0A0A");
  }, [selectedRestaurant?.id, selectedRestaurant?.name, selectedRestaurant?.currency, selectedRestaurant?.settings_json, selectedRestaurant?.has_bar]);

  useEffect(() => {
    if (!selectedRestaurant?.id || !isSupabaseConfigured()) return;
    const client = getSupabaseBrowserClient();
    void client
      .from("restaurants")
      .select("cuisine_type, address, phone, description, hours_json, plan")
      .eq("id", selectedRestaurant.id)
      .single()
      .then(({ data }) => {
        if (!data) return;
        const c = data.cuisine_type ?? "";
        const a = data.address ?? "";
        const p = (data as { phone?: string | null }).phone ?? "";
        const d = (data.description ?? "").slice(0, RESTAURANT_DESCRIPTION_MAX_LENGTH);
        setCuisine(c);
        setAddress(a);
        setPhone(p);
        setDescription(d);
        setRestaurantInitial({
          name: selectedRestaurant.name ?? "",
          cuisine: c, address: a, phone: p, description: d,
          currency: selectedRestaurant.currency ?? "cad",
          hasBar: selectedRestaurant.has_bar ?? false,
          turnTimeMinutes: String(selectedRestaurant.settings_json?.turnTimeMinutes ?? DEFAULT_TURN_TIME_MINUTES),
        });
        const parsed = hoursJsonToState(data.hours_json as Record<string, unknown> | null);
        setHours(parsed.regular);
        setSpecialDays(parsed.special);
        setCurrentPlan(data.plan ?? null);
      });
  }, [selectedRestaurant?.id, selectedRestaurant?.name, selectedRestaurant?.currency, selectedRestaurant?.has_bar]);

  const restaurantDirty = useMemo(() => {
    if (!restaurantInitial) return false;
    return (
      restaurantInitial.name !== restaurantName ||
      restaurantInitial.cuisine !== cuisine ||
      restaurantInitial.address !== address ||
      restaurantInitial.phone !== phone ||
      restaurantInitial.description !== description ||
      restaurantInitial.currency !== currency ||
      restaurantInitial.hasBar !== hasBar ||
      restaurantInitial.turnTimeMinutes !== turnTimeMinutes
    );
  }, [restaurantInitial, restaurantName, cuisine, address, phone, description, currency, hasBar, turnTimeMinutes]);

  const saveRestaurantSettings = async () => {
    if (!selectedRestaurant) return;
    if (!isSupabaseConfigured()) { toast.error(t("auth.errors.supabaseNotConfigured")); return; }
    const nextName = restaurantName.trim();
    if (!nextName) return;
    if (!normalizedTurnTime) {
      toast.error(t("dashboard.settings.invalidTurnTime"));
      return;
    }
    setSavingRestaurant(true);
    const client = getSupabaseBrowserClient();
    const existingSettings = (selectedRestaurant.settings_json ?? {}) as RestaurantSettings;
    const updatedSettings: RestaurantSettings = {
      ...existingSettings,
      turnTimeMinutes: normalizedTurnTime,
    };
    const { error } = await client
      .from("restaurants")
      .update({
        name: nextName,
        cuisine_type: cuisine.trim() || null,
        address: address.trim() || null,
        phone: phone.trim() || null,
        description: description.trim().slice(0, RESTAURANT_DESCRIPTION_MAX_LENGTH) || null,
        currency,
        has_bar: hasBar,
        settings_json: updatedSettings,
      })
      .eq("id", selectedRestaurant.id);
    setSavingRestaurant(false);
    if (error) { toast.error(t("dashboard.settings.saveFailed")); return; }
    setRestaurantInitial({ name: nextName, cuisine, address, phone, description, currency, hasBar, turnTimeMinutes });
    refreshRestaurants();
    toast.success(t("dashboard.settings.saved"));
  };

  const discardRestaurant = () => {
    if (!restaurantInitial) return;
    setRestaurantName(restaurantInitial.name);
    setCuisine(restaurantInitial.cuisine);
    setAddress(restaurantInitial.address);
    setPhone(restaurantInitial.phone);
    setDescription(restaurantInitial.description);
    setCurrency(restaurantInitial.currency);
    setHasBar(restaurantInitial.hasBar);
    setTurnTimeMinutes(restaurantInitial.turnTimeMinutes);
  };

  const saveHours = async () => {
    if (!selectedRestaurant) return;
    if (!isSupabaseConfigured()) { toast.error(t("auth.errors.supabaseNotConfigured")); return; }
    setSavingHours(true);
    const client = getSupabaseBrowserClient();
    const { error } = await client
      .from("restaurants")
      .update({ hours_json: stateToHoursJson(hours, specialDays) })
      .eq("id", selectedRestaurant.id);
    setSavingHours(false);
    if (error) { toast.error(t("dashboard.settings.saveFailed")); return; }
    toast.success(t("dashboard.settings.saved"));
  };

  function handlePrimaryChange(color: string) {
    setPrimaryColor(color);
    applyRestaurantTheme({ primaryColor: color, accentColor, backgroundColor });
  }
  function handleAccentChange(color: string) { setAccentColor(color); }
  function handleBackgroundChange(color: string) {
    setBackgroundColor(color);
    applyRestaurantTheme({ primaryColor, accentColor, backgroundColor: color });
  }

  async function saveTheme() {
    if (!selectedRestaurant) return;
    if (!isSupabaseConfigured()) { toast.error(t("auth.errors.supabaseNotConfigured")); return; }
    setSavingTheme(true);
    const client = getSupabaseBrowserClient();
    const existingSettings = (selectedRestaurant.settings_json ?? {}) as RestaurantSettings;
    const updatedSettings: RestaurantSettings = {
      ...existingSettings,
      theme: { primaryColor, accentColor, backgroundColor },
    };
    const { error } = await client
      .from("restaurants")
      .update({ settings_json: updatedSettings })
      .eq("id", selectedRestaurant.id);
    setSavingTheme(false);
    if (error) { toast.error(t("dashboard.settings.saveFailed")); return; }
    refreshRestaurants();
    toast.success(t("dashboard.settings.saved"));
  }

  function resetTheme() {
    setPrimaryColor("#C9A84C");
    setAccentColor("#22C55E");
    setBackgroundColor("#0A0A0A");
    applyRestaurantTheme({ primaryColor: "#C9A84C", accentColor: "#22C55E", backgroundColor: "#0A0A0A" });
  }

  return (
    <AnimatedPage className="flex flex-col gap-8">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="min-w-0"
      >
        <p className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
          <SettingsIcon className="size-3.5" />
          {pageMeta.eyebrow}
        </p>
        <h1 className="mt-2 font-serif text-3xl text-white sm:text-4xl">{pageMeta.title}</h1>
        <p className="mt-1 text-sm italic text-text-muted">{pageMeta.subtitle}</p>
      </motion.header>

      {isRestaurantInfoRoute && (
        <div className="flex w-fit max-w-full flex-wrap gap-1.5 rounded-2xl border border-border bg-bg-surface p-1.5">
          {RESTAURANT_INFO_NAV.map((item) => {
            const active = restaurantInfoSection === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setRestaurantInfoSection(item.key)}
                className={cn(
                  "rounded-xl px-4 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-gold text-bg-base"
                    : "text-text-muted hover:bg-bg-elevated/70 hover:text-text-primary",
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}

      <div className={cn("grid gap-8", !isStandaloneSection && "lg:grid-cols-[220px_1fr]")}>
        {!isStandaloneSection && (
          <nav className="flex flex-col gap-1">
            {SETTINGS_NAV.map((item) => {
              const Icon = item.icon;
              const active = settingsSection === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setSettingsSection(item.key)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                    active
                      ? "border border-gold/30 bg-gold/10 text-gold"
                      : "text-text-muted hover:bg-bg-elevated/40 hover:text-text-secondary",
                  )}
                >
                  <Icon className={cn("size-[18px]", active ? "text-gold" : "text-text-muted")} />
                  {item.label}
                </button>
              );
            })}
          </nav>
        )}

        <div className="min-w-0">
          {section === "restaurant" && (
            <div className="flex flex-col gap-6">
              <SectionHeading title="Restaurant identity" subtitle="How Cenalva and your guests see you." />
              <Card>
                <FieldRow label="Name">
                  <Input value={restaurantName} onChange={(e) => setRestaurantName(e.target.value)} />
                </FieldRow>
                <FieldRow label="Cuisine" hint="Shown on listings and search filters.">
                  <Input value={cuisine} onChange={(e) => setCuisine(e.target.value)} placeholder="Modern French" />
                </FieldRow>
                <FieldRow label="Address">
                  <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="142 Yorkville Ave, Toronto, ON M5R 1C2" />
                </FieldRow>
                <FieldRow label="Phone">
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(416) 555-0142" />
                </FieldRow>
                <FieldRow
                  label="Description"
                  hint={(
                    <>
                      <span className="block">2–3 sentences. Appears on your public page.</span>
                      <span
                        className={cn(
                          "mt-1 block font-mono text-[10px]",
                          restaurantDescriptionAtLimit && "text-warning",
                        )}
                      >
                        {description.length}/{RESTAURANT_DESCRIPTION_MAX_LENGTH}
                      </span>
                      {restaurantDescriptionAtLimit && (
                        <span className="mt-1 block text-warning">Character limit reached.</span>
                      )}
                    </>
                  )}
                >
                  <div className="space-y-2">
                    <Textarea
                      rows={3}
                      value={description}
                      maxLength={RESTAURANT_DESCRIPTION_MAX_LENGTH}
                      onChange={(e) => setDescription(e.target.value.slice(0, RESTAURANT_DESCRIPTION_MAX_LENGTH))}
                    />
                  </div>
                </FieldRow>
                <FieldRow label="Currency">
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger className="max-w-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CURRENCY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldRow>
                <FieldRow label="Bar / drinks station" hint="Enables the Bar Only filter on Orders.">
                  <Switch checked={hasBar} onCheckedChange={setHasBar} />
                </FieldRow>
                <FieldRow
                  label={t("dashboard.settings.turnTime")}
                  hint={t("dashboard.settings.turnTimeHint")}
                >
                  <div className="flex max-w-sm flex-col gap-2">
                    <div className="relative">
                      <Input
                        type="number"
                        min={MIN_TURN_TIME_MINUTES}
                        max={MAX_TURN_TIME_MINUTES}
                        step={15}
                        value={turnTimeMinutes}
                        onChange={(event) => setTurnTimeMinutes(event.target.value)}
                        className="pr-16"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted">
                        {t("dashboard.settings.minutesShort")}
                      </span>
                    </div>
                    {!normalizedTurnTime ? (
                      <p className="text-xs text-warning">
                        {t("dashboard.settings.turnTimeValidation", {
                          min: MIN_TURN_TIME_MINUTES,
                          max: MAX_TURN_TIME_MINUTES,
                        })}
                      </p>
                    ) : null}
                  </div>
                </FieldRow>
                <FieldRow label="Logo & cover" hint="Square logo · 16:9 cover image.">
                  <div className="flex items-center gap-3">
                    <div className="flex size-14 items-center justify-center rounded-lg border border-gold/30 bg-gold/10 font-serif text-lg text-gold">
                      {(restaurantName || "MV").slice(0, 2).toUpperCase()}
                    </div>
                    <Button variant="outline" size="sm">Replace</Button>
                    <Button variant="outline" size="sm">Upload cover</Button>
                  </div>
                </FieldRow>
              </Card>
              <div className="flex justify-end gap-2">
                <Button variant="outline" disabled={!restaurantDirty} onClick={discardRestaurant}>Discard</Button>
                <Button
                  disabled={!restaurantDirty || savingRestaurant || !restaurantName.trim() || !selectedRestaurant}
                  onClick={() => void saveRestaurantSettings()}
                >
                  {savingRestaurant ? t("routes.loading") : "Save changes"}
                </Button>
              </div>
            </div>
          )}

          {section === "hours" && (
            <div className="flex flex-col gap-6">
              <SectionHeading title="Hours & calendar" subtitle="Service windows and exceptions." />
              <Card>
                <div className="px-6 py-5 sm:px-7 sm:py-6">
                  <h3 className="font-serif text-xl text-white">Weekly hours</h3>
                </div>
                <div>
                  {DAYS.map((day, i) => (
                    <div key={day} className="grid grid-cols-[120px_1fr_auto] items-center gap-4 border-t border-border/50 px-6 py-4 sm:px-7">
                      <span className={cn("text-sm", hours[i].open ? "text-text-primary" : "text-text-muted")}>{day}</span>
                      {hours[i].open ? (
                        <div className="flex items-center gap-2 text-sm text-text-primary">
                          <TimeSelect value={hours[i].from} onChange={(v) => setHours((h) => h.map((d, idx) => idx === i ? { ...d, from: v } : d))} />
                          <span className="text-xs text-text-muted">—</span>
                          <TimeSelect value={hours[i].to} onChange={(v) => setHours((h) => h.map((d, idx) => idx === i ? { ...d, to: v } : d))} />
                        </div>
                      ) : (
                        <span className="text-sm text-text-muted">Closed</span>
                      )}
                      <button
                        type="button"
                        onClick={() => setHours((h) => h.map((d, idx) => idx === i ? { ...d, open: !d.open } : d))}
                        className="text-xs text-text-muted transition-colors hover:text-gold"
                      >
                        {hours[i].open ? "Edit" : "Open"}
                      </button>
                    </div>
                  ))}
                </div>
              </Card>

              <Card>
                <div className="flex items-start justify-between gap-3 px-6 py-5 sm:px-7 sm:py-6">
                  <div>
                    <h3 className="font-serif text-xl text-white">Closures & exceptions</h3>
                    <p className="mt-1 text-sm text-text-muted">Holidays, private events, maintenance days.</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() =>
                      setSpecialDays((days) => [
                        ...days,
                        { id: crypto.randomUUID(), date: "", label: "", closed: true, from: "12:00 PM", to: "10:00 PM" },
                      ])
                    }
                  >
                    <Plus className="size-3.5" /> Add
                  </Button>
                </div>
                <div className="flex flex-col gap-2 px-6 pb-6 sm:px-7 sm:pb-7">
                  {specialDays.length === 0 && (
                    <p className="rounded-lg border border-dashed border-border bg-bg-elevated/30 px-4 py-6 text-center text-sm text-text-muted">
                      No exceptions yet.
                    </p>
                  )}
                  {specialDays.map((sd) => (
                    <div
                      key={sd.id}
                      className="relative flex items-start gap-3 rounded-lg bg-bg-elevated/40 px-4 py-3"
                    >
                      <span className={cn("absolute inset-y-2 left-0 w-[3px] rounded-r", sd.closed ? "bg-danger" : "bg-warning")} />
                      <div className="flex-1 pl-3">
                        <Popover open={openPopoverId === sd.id} onOpenChange={(o) => setOpenPopoverId(o ? sd.id : null)}>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="text-sm font-medium text-text-primary transition-colors hover:text-gold"
                            >
                              {sd.date
                                ? new Date(`${sd.date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", weekday: "short" })
                                : "Pick a date"}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-auto border-border bg-bg-elevated p-0">
                            <Calendar
                              mode="single"
                              required={false}
                              selected={(() => {
                                if (!sd.date) return undefined;
                                const d = parse(sd.date, "yyyy-MM-dd", new Date());
                                return isValid(d) ? d : undefined;
                              })()}
                              onSelect={(d) => {
                                setSpecialDays((days) =>
                                  days.map((s) => s.id === sd.id ? { ...s, date: d ? format(d, "yyyy-MM-dd") : "" } : s),
                                );
                                if (d) setOpenPopoverId(null);
                              }}
                              className="rounded-md border-0 bg-transparent [--cell-size:--spacing(8)]"
                            />
                          </PopoverContent>
                        </Popover>
                        <input
                          type="text"
                          value={sd.label}
                          onChange={(e) => setSpecialDays((days) => days.map((d) => d.id === sd.id ? { ...d, label: e.target.value } : d))}
                          placeholder="Closed for private buyout · Westin Group"
                          className="mt-0.5 block w-full bg-transparent text-xs text-text-muted outline-none placeholder:text-text-muted"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setSpecialDays((days) => days.filter((d) => d.id !== sd.id))}
                        className="text-text-muted transition-colors hover:text-danger"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </Card>

              <div className="flex justify-end">
                <Button disabled={savingHours || !selectedRestaurant} onClick={() => void saveHours()}>
                  {savingHours ? t("routes.loading") : "Save changes"}
                </Button>
              </div>
            </div>
          )}

          {section === "billing" && (
            <div className="flex flex-col gap-6">
              <SectionHeading title="Billing" subtitle="Your Cenalva subscription and invoices." />
              <Card>
                <div className="flex flex-col gap-6 px-6 py-7 sm:flex-row sm:items-start sm:justify-between sm:px-7">
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold">Current plan</p>
                    <h3 className="mt-2 font-serif text-3xl text-white">Cenalva · Atelier</h3>
                    <p className="mt-1 text-sm text-text-muted">For full-service restaurants up to 200 covers/night.</p>
                    <p className="mt-6">
                      <span className="font-serif text-4xl text-white">$280</span>
                      <span className="ml-2 text-sm text-text-muted">/month, billed annually</span>
                    </p>
                  </div>
                  <ul className="space-y-1.5 text-sm text-text-secondary">
                    {PLAN_FEATURES.map((feature) => (
                      <li key={feature} className="flex items-center gap-2">
                        <CheckCircle2 className="size-4 text-gold" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t border-border/50 px-6 py-4 sm:px-7">
                  <Button size="sm">Upgrade to Maison</Button>
                  <Button size="sm" variant="outline">Manage payment</Button>
                  <Button size="sm" variant="ghost">Cancel plan</Button>
                  {currentPlan && currentPlan !== "free" && (
                    <span className="ml-auto text-xs text-text-muted">Stripe status: <span className="text-text-primary">active</span></span>
                  )}
                </div>
              </Card>

              <Card>
                <div className="flex items-center justify-between px-6 py-5 sm:px-7">
                  <h3 className="font-serif text-xl text-white">Invoice history</h3>
                  <Button variant="outline" size="sm">Download all</Button>
                </div>
                <div className="divide-y divide-border/50">
                  {INVOICES.map((inv) => (
                    <div key={inv.id} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-4 px-6 py-4 text-sm sm:px-7">
                      <span className="font-mono text-text-muted">{inv.date}</span>
                      <span className="font-mono text-text-muted">{inv.id}</span>
                      <span className="text-text-primary">{inv.amount}</span>
                      <div className="flex items-center gap-3 justify-self-end">
                        <span className="text-success">Paid</span>
                        <button
                          type="button"
                          className="font-mono text-xs text-text-muted transition-colors hover:text-gold"
                        >
                          PDF
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {section === "notifications" && (
            <div className="flex flex-col gap-6">
              <SectionHeading title="Notifications" subtitle="Choose which events page you and your team." />
              {NOTIFICATION_GROUPS.map((group) => (
                <Card key={group.title}>
                  <div className="px-6 py-5 sm:px-7">
                    <h3 className="font-serif text-xl text-white">{group.title}</h3>
                  </div>
                  {group.rows.map((row) => {
                    const value = notifPrefs[row.id];
                    return (
                      <div key={row.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-t border-border/50 px-6 py-4 sm:px-7">
                        <div>
                          <p className="text-sm text-text-primary">{row.label}</p>
                          <p className="text-xs text-text-muted">{row.desc}</p>
                        </div>
                        <label className="flex items-center gap-2 text-xs text-text-muted">
                          Email
                          <Switch
                            checked={value.email}
                            onCheckedChange={(v) => setNotifPrefs((p) => ({ ...p, [row.id]: { ...p[row.id], email: v } }))}
                          />
                        </label>
                        <label className="flex items-center gap-2 text-xs text-text-muted">
                          Push
                          <Switch
                            checked={value.push}
                            onCheckedChange={(v) => setNotifPrefs((p) => ({ ...p, [row.id]: { ...p[row.id], push: v } }))}
                          />
                        </label>
                      </div>
                    );
                  })}
                </Card>
              ))}
            </div>
          )}

          {section === "theme" && (
            <div className="flex flex-col gap-6">
              <SectionHeading title="Theme" subtitle="Customize the colors that brand the dashboard for your restaurant." />
              <Card>
                <div className="px-6 py-6 sm:px-7">
                  <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
                    <ColorPicker label="Primary color" value={primaryColor} onChange={handlePrimaryChange} />
                    <ColorPicker label="Accent color" value={accentColor} onChange={handleAccentChange} />
                    <ColorPicker label="Background color" value={backgroundColor} onChange={handleBackgroundChange} presets={BACKGROUND_PRESETS} />
                  </div>

                  <div className="mt-6">
                    <span className="mb-2 block font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Preview</span>
                    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-bg-elevated p-4">
                      <div className="flex h-9 items-center rounded-md px-4 text-sm font-medium" style={{ backgroundColor: primaryColor, color: isLight(primaryColor) ? "#0A0A0A" : "#FFFFFF" }}>
                        Primary button
                      </div>
                      <div className="flex h-9 items-center rounded-md border-2 px-4 text-sm font-medium" style={{ borderColor: primaryColor, color: primaryColor }}>
                        Outline button
                      </div>
                      <div className="flex h-9 items-center rounded-md px-4 text-sm font-medium" style={{ backgroundColor: accentColor, color: isLight(accentColor) ? "#0A0A0A" : "#FFFFFF" }}>
                        Accent
                      </div>
                      <span className="text-sm font-semibold" style={{ color: primaryColor }}>Highlighted text</span>
                    </div>
                  </div>
                </div>
              </Card>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={resetTheme}>Reset to default</Button>
                <Button disabled={savingTheme || !selectedRestaurant} onClick={() => void saveTheme()}>
                  {savingTheme ? t("routes.loading") : "Save changes"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AnimatedPage>
  );
}
