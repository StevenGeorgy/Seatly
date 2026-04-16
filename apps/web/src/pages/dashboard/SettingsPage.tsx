import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { SectionCard } from "@/components/dashboard/SectionCard";
import { Button } from "@/components/ui/button";
import { ColorPicker, BACKGROUND_PRESETS } from "@/components/ui/color-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { applyRestaurantTheme } from "@/lib/theme";
import type { RestaurantSettings } from "@/hooks/useStaffRestaurants";

// ─── Hours constants (mirrors SetupPage) ─────────────────────────────────────
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

function defaultHours(): DayHours[] {
  return DAYS.map((_, i) => ({
    open: true,
    from: i < 5 ? "11:00 AM" : "10:00 AM",
    to:   i < 5 ? "10:00 PM" : "11:00 PM",
  }));
}

function hoursJsonToState(json: Record<string, { open: string; close: string } | null> | null): DayHours[] {
  if (!json) return defaultHours();
  return DAYS.map((day) => {
    const val = json[day.toLowerCase()];
    if (!val) return { open: false, from: "11:00 AM", to: "10:00 PM" };
    return { open: true, from: val.open, to: val.close };
  });
}

function stateToHoursJson(hours: DayHours[]): Record<string, { open: string; close: string } | null> {
  return Object.fromEntries(
    DAYS.map((day, i) => [
      day.toLowerCase(),
      hours[i].open ? { open: hours[i].from, close: hours[i].to } : null,
    ]),
  );
}

function TimeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full appearance-none rounded-lg border border-border bg-bg-elevated px-3 pr-7 text-xs text-text-primary outline-none focus:border-gold/40"
      >
        {TIME_OPTIONS.map((t) => <option key={t}>{t}</option>)}
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

function isLight(hex: string): boolean {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return false;
  const r = parseInt(match[1], 16);
  const g = parseInt(match[2], 16);
  const b = parseInt(match[3], 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const { selectedRestaurant, refreshRestaurants } = useRestaurantScope();
  const [activeTab, setActiveTab] = useState("restaurant");

  // Restaurant info state
  const [restaurantName, setRestaurantName] = useState(selectedRestaurant?.name ?? "");
  const [cuisine, setCuisine] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [currency, setCurrency] = useState(selectedRestaurant?.currency ?? "cad");
  const [savingRestaurant, setSavingRestaurant] = useState(false);

  // Hours state
  const [hours, setHours] = useState<DayHours[]>(defaultHours);
  const [savingHours, setSavingHours] = useState(false);

  // Theme state
  const existingTheme = selectedRestaurant?.settings_json?.theme;
  const [primaryColor, setPrimaryColor] = useState(existingTheme?.primaryColor ?? "#C9A84C");
  const [accentColor, setAccentColor] = useState(existingTheme?.accentColor ?? "#22C55E");
  const [backgroundColor, setBackgroundColor] = useState(existingTheme?.backgroundColor ?? "#0A0A0A");
  const [savingTheme, setSavingTheme] = useState(false);

  // Sync theme + name/currency from scope context (fast fields already in StaffRestaurantRow)
  useEffect(() => {
    setRestaurantName(selectedRestaurant?.name ?? "");
    setCurrency(selectedRestaurant?.currency ?? "cad");
    setPrimaryColor(selectedRestaurant?.settings_json?.theme?.primaryColor ?? "#C9A84C");
    setAccentColor(selectedRestaurant?.settings_json?.theme?.accentColor ?? "#22C55E");
    setBackgroundColor(selectedRestaurant?.settings_json?.theme?.backgroundColor ?? "#0A0A0A");
  }, [selectedRestaurant?.id, selectedRestaurant?.name, selectedRestaurant?.currency, selectedRestaurant?.settings_json]);

  // Fetch extended fields (cuisine_type, address, description, hours_json) — not in StaffRestaurantRow
  useEffect(() => {
    if (!selectedRestaurant?.id || !isSupabaseConfigured()) return;
    const client = getSupabaseBrowserClient();
    void client
      .from("restaurants")
      .select("cuisine_type, address, description, hours_json")
      .eq("id", selectedRestaurant.id)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setCuisine(data.cuisine_type ?? "");
        setAddress(data.address ?? "");
        setDescription(data.description ?? "");
        setHours(hoursJsonToState(data.hours_json as Record<string, { open: string; close: string } | null> | null));
      });
  }, [selectedRestaurant?.id]);

  const saveRestaurantSettings = async () => {
    if (!selectedRestaurant) return;
    if (!isSupabaseConfigured()) {
      toast.error(t("auth.errors.supabaseNotConfigured"));
      return;
    }

    const nextName = restaurantName.trim();
    if (!nextName) return;

    setSavingRestaurant(true);
    const client = getSupabaseBrowserClient();
    const { error } = await client
      .from("restaurants")
      .update({
        name: nextName,
        cuisine_type: cuisine.trim() || null,
        address: address.trim() || null,
        description: description.trim() || null,
        currency,
      })
      .eq("id", selectedRestaurant.id);

    setSavingRestaurant(false);

    if (error) {
      toast.error(t("dashboard.settings.saveFailed"));
      return;
    }

    refreshRestaurants();
    toast.success(t("dashboard.settings.saved"));
  };

  const saveHours = async () => {
    if (!selectedRestaurant) return;
    if (!isSupabaseConfigured()) {
      toast.error(t("auth.errors.supabaseNotConfigured"));
      return;
    }

    setSavingHours(true);
    const client = getSupabaseBrowserClient();
    const { error } = await client
      .from("restaurants")
      .update({ hours_json: stateToHoursJson(hours) })
      .eq("id", selectedRestaurant.id);

    setSavingHours(false);

    if (error) {
      toast.error(t("dashboard.settings.saveFailed"));
      return;
    }

    toast.success(t("dashboard.settings.saved"));
  };

  // Live-preview theme as the user picks colors
  function handlePrimaryChange(color: string) {
    setPrimaryColor(color);
    applyRestaurantTheme({ primaryColor: color, accentColor, backgroundColor });
  }

  function handleAccentChange(color: string) {
    setAccentColor(color);
  }

  function handleBackgroundChange(color: string) {
    setBackgroundColor(color);
    applyRestaurantTheme({ primaryColor, accentColor, backgroundColor: color });
  }

  async function saveTheme() {
    if (!selectedRestaurant) return;
    if (!isSupabaseConfigured()) {
      toast.error(t("auth.errors.supabaseNotConfigured"));
      return;
    }

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

    if (error) {
      toast.error(t("dashboard.settings.saveFailed"));
      return;
    }

    refreshRestaurants();
    toast.success(t("dashboard.settings.saved"));
  }

  function resetToDefault() {
    setPrimaryColor("#C9A84C");
    setAccentColor("#22C55E");
    setBackgroundColor("#0A0A0A");
    applyRestaurantTheme({ primaryColor: "#C9A84C", accentColor: "#22C55E", backgroundColor: "#0A0A0A" });
  }

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <PageHeader title={t("dashboard.settings.title")} />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="restaurant">{t("dashboard.settings.restaurant")}</TabsTrigger>
          <TabsTrigger value="hours">{t("dashboard.settings.hours")}</TabsTrigger>
          <TabsTrigger value="policy">{t("dashboard.settings.policy")}</TabsTrigger>
          <TabsTrigger value="loyalty">{t("dashboard.settings.loyalty")}</TabsTrigger>
          <TabsTrigger value="theme">Theme</TabsTrigger>
          <TabsTrigger value="billing">{t("dashboard.settings.billing")}</TabsTrigger>
        </TabsList>

        <TabsContent value="restaurant" className="mt-6">
          <SectionCard title={t("dashboard.settings.restaurant")}>
            <div className="flex flex-col gap-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label>{t("dashboard.settings.name")}</Label>
                  <Input
                    value={restaurantName}
                    onChange={(e) => setRestaurantName(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>{t("dashboard.settings.cuisine")}</Label>
                  <Input
                    value={cuisine}
                    onChange={(e) => setCuisine(e.target.value)}
                    placeholder="e.g. Italian, Japanese, Canadian"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t("dashboard.settings.address")}</Label>
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="123 Main St, City, Province"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t("dashboard.settings.description")}</Label>
                <Textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Tell guests what makes your restaurant special…"
                />
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label>{t("dashboard.settings.currency")}</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                className="self-end"
                disabled={savingRestaurant || !restaurantName.trim() || !selectedRestaurant}
                onClick={() => void saveRestaurantSettings()}
              >
                {savingRestaurant ? t("routes.loading") : t("common.actions.save")}
              </Button>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="hours" className="mt-6">
          <SectionCard title={t("dashboard.settings.hours")}>
            <div className="flex flex-col gap-1">
              {DAYS.map((day, i) => (
                <div
                  key={day}
                  className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-bg-elevated"
                >
                  {/* Toggle */}
                  <button
                    type="button"
                    onClick={() =>
                      setHours((h) =>
                        h.map((d, idx) => (idx === i ? { ...d, open: !d.open } : d)),
                      )
                    }
                    className={`relative flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${hours[i].open ? "bg-gold" : "bg-border"}`}
                  >
                    <span
                      className="absolute size-3.5 rounded-full bg-white shadow-sm transition-all"
                      style={{ left: hours[i].open ? "18px" : "2px" }}
                    />
                  </button>

                  {/* Day name */}
                  <span
                    className={`w-24 text-sm font-medium ${hours[i].open ? "text-text-primary" : "text-text-muted"}`}
                  >
                    {day}
                  </span>

                  {/* Time selects or closed label */}
                  {hours[i].open ? (
                    <div className="flex flex-1 items-center gap-2">
                      <TimeSelect
                        value={hours[i].from}
                        onChange={(v) =>
                          setHours((h) =>
                            h.map((d, idx) => (idx === i ? { ...d, from: v } : d)),
                          )
                        }
                      />
                      <span className="text-xs text-text-muted">to</span>
                      <TimeSelect
                        value={hours[i].to}
                        onChange={(v) =>
                          setHours((h) =>
                            h.map((d, idx) => (idx === i ? { ...d, to: v } : d)),
                          )
                        }
                      />
                    </div>
                  ) : (
                    <span className="flex-1 text-sm text-text-muted">Closed</span>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <Button
                disabled={savingHours || !selectedRestaurant}
                onClick={() => void saveHours()}
              >
                {savingHours ? t("routes.loading") : t("common.actions.save")}
              </Button>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="policy" className="mt-6">
          <SectionCard title={t("dashboard.settings.policy")}>
            <div className="flex flex-col gap-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label>{t("dashboard.settings.cancellationWindow")}</Label>
                  <Input type="number" defaultValue="24" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>{t("dashboard.settings.noShowFee")}</Label>
                  <Input type="number" defaultValue="0" />
                </div>
              </div>
              <Button className="self-end">{t("common.actions.save")}</Button>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="loyalty" className="mt-6">
          <SectionCard title={t("dashboard.settings.loyalty")}>
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <Label>{t("dashboard.settings.pointsPerDollar")}</Label>
                <Input type="number" defaultValue="1" />
              </div>
              <Button className="self-end">{t("common.actions.save")}</Button>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="theme" className="mt-6">
          <SectionCard title="Restaurant Theme">
            <div className="flex flex-col gap-6">
              <p className="text-sm text-text-secondary">
                Customize the colors for your restaurant. Changes preview live and are applied across the dashboard when your restaurant is selected.
              </p>

              <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
                <ColorPicker
                  label="Primary Color"
                  value={primaryColor}
                  onChange={handlePrimaryChange}
                />
                <ColorPicker
                  label="Accent Color"
                  value={accentColor}
                  onChange={handleAccentChange}
                />
                <ColorPicker
                  label="Background Color"
                  value={backgroundColor}
                  onChange={handleBackgroundChange}
                  presets={BACKGROUND_PRESETS}
                />
              </div>

              {/* Preview */}
              <div>
                <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-text-muted">
                  Preview
                </span>
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-bg-elevated p-4">
                  <div
                    className="flex h-9 items-center rounded-md px-4 text-sm font-medium"
                    style={{ backgroundColor: primaryColor, color: isLight(primaryColor) ? "#0A0A0A" : "#FFFFFF" }}
                  >
                    Primary Button
                  </div>
                  <div
                    className="flex h-9 items-center rounded-md border-2 px-4 text-sm font-medium"
                    style={{ borderColor: primaryColor, color: primaryColor }}
                  >
                    Outline Button
                  </div>
                  <div
                    className="flex h-9 items-center rounded-md px-4 text-sm font-medium"
                    style={{ backgroundColor: accentColor, color: isLight(accentColor) ? "#0A0A0A" : "#FFFFFF" }}
                  >
                    Accent
                  </div>
                  <span className="text-sm font-semibold" style={{ color: primaryColor }}>
                    Highlighted text
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end">
                <Button variant="ghost" onClick={resetToDefault}>
                  Reset to default
                </Button>
                <Button
                  disabled={savingTheme || !selectedRestaurant}
                  onClick={() => void saveTheme()}
                >
                  {savingTheme ? t("routes.loading") : t("common.actions.save")}
                </Button>
              </div>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="billing" className="mt-6">
          <SectionCard title={t("dashboard.settings.billing")}>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated px-4 py-3">
                <span className="text-sm text-text-secondary">{t("dashboard.settings.currentPlan")}</span>
                <span className="text-sm font-medium capitalize text-gold">
                  {selectedRestaurant?.name ? "active" : "\u2014"}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated px-4 py-3">
                <span className="text-sm text-text-secondary">{t("dashboard.settings.stripeStatus")}</span>
                <span className="text-sm font-medium text-text-primary">
                  {"\u2014"}
                </span>
              </div>
            </div>
          </SectionCard>
        </TabsContent>
      </Tabs>
    </AnimatedPage>
  );
}
