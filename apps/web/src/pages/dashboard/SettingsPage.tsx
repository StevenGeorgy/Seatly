import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { format, parse, isValid } from "date-fns";
import {
  Bell,
  CheckCircle2,
  CreditCard,
  Plus,
  Settings as SettingsIcon,
  Upload,
  X,
  Trash2,
} from "lucide-react";
import { motion } from "framer-motion";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { DashboardTimeWheelPicker } from "@/components/dashboard/DashboardTimeWheelPicker";
import { BusinessTypeSelect } from "@/components/restaurant/BusinessTypeSelect";
import { CuisineSelect } from "@/components/restaurant/CuisineSelect";
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
import type { RestaurantBusinessProfile, RestaurantSettings } from "@/hooks/useStaffRestaurants";
import { cn } from "@/lib/utils";
import {
  RESTAURANT_DIETARY_TAGS,
  normalizeRestaurantDietaryTags,
  type RestaurantDietaryTag,
} from "@/lib/restaurant-dietary-tags";
import { normalizeRestaurantCuisine } from "@/lib/restaurant-cuisines";
import { normalizeRestaurantBusinessType } from "@/lib/restaurant-business-types";
import {
  RESTAURANT_WEEKDAY_NUMBERS,
  RESTAURANT_WEEKDAYS,
  defaultRestaurantHours,
  minutesToPostgresTime,
  parseRestaurantHoursJson,
  parseRestaurantTimeToMinutes,
  restaurantHoursToJson,
  type RestaurantDayHours,
  type RestaurantSpecialDay,
} from "@/lib/restaurant-hours";

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
const RESTAURANT_IMAGE_FORMATS = "JPG, PNG, WebP, GIF, AVIF, HEIC, or HEIF";
const SUPPORTED_RESTAURANT_IMAGE_TYPES: Array<{ mime: string; extensions: string[] }> = [
  { mime: "image/jpeg", extensions: ["jpg", "jpeg"] },
  { mime: "image/png", extensions: ["png"] },
  { mime: "image/webp", extensions: ["webp"] },
  { mime: "image/gif", extensions: ["gif"] },
  { mime: "image/avif", extensions: ["avif"] },
  { mime: "image/heic", extensions: ["heic"] },
  { mime: "image/heif", extensions: ["heif"] },
];
const RESTAURANT_IMAGE_ACCEPT = SUPPORTED_RESTAURANT_IMAGE_TYPES
  .flatMap((type) => [type.mime, ...type.extensions.map((extension) => `.${extension}`)])
  .join(",");

type RestaurantMediaKind = "logo" | "cover";
type RestaurantMediaField = "logo_url" | "cover_photo_url";
type RestaurantInitialState = {
  name: string;
  cuisine: string;
  address: string;
  contactEmail: string;
  phone: string;
  city: string;
  province: string;
  country: string;
  businessType: string;
  legalName: string;
  websiteUrl: string;
  instagramUrl: string;
  facebookUrl: string;
  description: string;
  currency: string;
  acceptsWalkins: boolean;
  dietaryTags: RestaurantDietaryTag[];
  turnTimeMinutes: string;
};

const EMPTY_BUSINESS_PROFILE: Required<RestaurantBusinessProfile> = {
  legalName: "",
  websiteUrl: "",
  instagramUrl: "",
  facebookUrl: "",
};

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

function resolveRestaurantImage(file: File): { mime: string } | null {
  const mime = file.type.toLowerCase();
  const byMime = SUPPORTED_RESTAURANT_IMAGE_TYPES.find((type) => type.mime === mime);
  if (byMime) return { mime: byMime.mime };

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension) return null;

  const byExtension = SUPPORTED_RESTAURANT_IMAGE_TYPES.find((type) => type.extensions.includes(extension));
  return byExtension ? { mime: byExtension.mime } : null;
}

function imageUrlFromInput(value: string): string | null | false {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return parsed.toString();
  } catch {
    return false;
  }
}

function urlFromInput(value: string): string | null | false {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return parsed.toString();
  } catch {
    return false;
  }
}

function validOptionalEmail(value: string): boolean {
  const trimmed = value.trim();
  return !trimmed || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function revokeDraftUrl(url: string | null): void {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}

function dietaryTagsKey(tags: RestaurantDietaryTag[]): string {
  return [...tags].sort().join("|");
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
  const navigate = useNavigate();
  const { selectedRestaurant, refreshRestaurants, restaurants } = useRestaurantScope();
  const [restaurantInfoSection, setRestaurantInfoSection] = useState<RestaurantInfoSectionKey>("restaurant");
  const [settingsSection, setSettingsSection] = useState<SettingsSectionKey>("billing");
  const normalizedPathname = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const isRestaurantInfoRoute = normalizedPathname === "/dashboard/restaurant";
  const section: SectionKey = isRestaurantInfoRoute ? restaurantInfoSection : settingsSection;
  const isStandaloneSection = isRestaurantInfoRoute;
  const pageMeta = isRestaurantInfoRoute ? SECTION_META.restaurant : SECTION_META[section];
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  // Restaurant info state
  const [restaurantName, setRestaurantName] = useState(selectedRestaurant?.name ?? "");
  const [cuisine, setCuisine] = useState("");
  const [address, setAddress] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState(selectedRestaurant?.city ?? "");
  const [province, setProvince] = useState(selectedRestaurant?.province ?? "");
  const [country, setCountry] = useState(selectedRestaurant?.country ?? "");
  const [businessType, setBusinessType] = useState<string>(normalizeRestaurantBusinessType(selectedRestaurant?.business_type));
  const [legalName, setLegalName] = useState(selectedRestaurant?.settings_json?.businessProfile?.legalName ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(selectedRestaurant?.settings_json?.businessProfile?.websiteUrl ?? "");
  const [instagramUrl, setInstagramUrl] = useState(selectedRestaurant?.settings_json?.businessProfile?.instagramUrl ?? "");
  const [facebookUrl, setFacebookUrl] = useState(selectedRestaurant?.settings_json?.businessProfile?.facebookUrl ?? "");
  const [description, setDescription] = useState("");
  const [savedLogoUrl, setSavedLogoUrl] = useState(selectedRestaurant?.logo_url ?? "");
  const [savedCoverPhotoUrl, setSavedCoverPhotoUrl] = useState(selectedRestaurant?.cover_photo_url ?? "");
  const [logoUrlInput, setLogoUrlInput] = useState("");
  const [coverUrlInput, setCoverUrlInput] = useState("");
  const [logoFileDraft, setLogoFileDraft] = useState<File | null>(null);
  const [coverFileDraft, setCoverFileDraft] = useState<File | null>(null);
  const [logoDraftPreviewUrl, setLogoDraftPreviewUrl] = useState<string | null>(null);
  const [coverDraftPreviewUrl, setCoverDraftPreviewUrl] = useState<string | null>(null);
  const [logoMarkedForRemoval, setLogoMarkedForRemoval] = useState(false);
  const [coverMarkedForRemoval, setCoverMarkedForRemoval] = useState(false);
  const [draggingMediaKind, setDraggingMediaKind] = useState<RestaurantMediaKind | null>(null);
  const [currency, setCurrency] = useState(selectedRestaurant?.currency ?? "cad");
  const [acceptsWalkins, setAcceptsWalkins] = useState(selectedRestaurant?.accepts_walkins ?? true);
  const [dietaryTags, setDietaryTags] = useState<RestaurantDietaryTag[]>(() => (
    normalizeRestaurantDietaryTags(selectedRestaurant?.settings_json?.dietaryTags)
  ));
  const [turnTimeMinutes, setTurnTimeMinutes] = useState(
    String(selectedRestaurant?.settings_json?.turnTimeMinutes ?? DEFAULT_TURN_TIME_MINUTES),
  );
  const [savingRestaurant, setSavingRestaurant] = useState(false);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState("");
  const [deletingRestaurant, setDeletingRestaurant] = useState(false);
  const [restaurantInitial, setRestaurantInitial] = useState<RestaurantInitialState | null>(null);
  const restaurantDescriptionAtLimit = description.length >= RESTAURANT_DESCRIPTION_MAX_LENGTH;
  const normalizedTurnTime = normalizeTurnTime(turnTimeMinutes);
  const mediaDirty = Boolean(
    logoFileDraft ||
    coverFileDraft ||
    logoUrlInput.trim() ||
    coverUrlInput.trim() ||
    (logoMarkedForRemoval && savedLogoUrl) ||
    (coverMarkedForRemoval && savedCoverPhotoUrl),
  );
  const logoPreviewSrc = logoMarkedForRemoval ? "" : (logoDraftPreviewUrl ?? logoUrlInput.trim()) || savedLogoUrl;
  const coverPreviewSrc = coverMarkedForRemoval ? "" : (coverDraftPreviewUrl ?? coverUrlInput.trim()) || savedCoverPhotoUrl;

  // Hours
  const [hours, setHours] = useState<RestaurantDayHours[]>(defaultRestaurantHours);
  const [specialDays, setSpecialDays] = useState<RestaurantSpecialDay[]>([]);
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
    setCuisine("");
    setContactEmail(selectedRestaurant?.email ?? "");
    setCity(selectedRestaurant?.city ?? "");
    setProvince(selectedRestaurant?.province ?? "");
    setCountry(selectedRestaurant?.country ?? "");
    setBusinessType(normalizeRestaurantBusinessType(selectedRestaurant?.business_type));
    setLegalName(selectedRestaurant?.settings_json?.businessProfile?.legalName ?? "");
    setWebsiteUrl(selectedRestaurant?.settings_json?.businessProfile?.websiteUrl ?? "");
    setInstagramUrl(selectedRestaurant?.settings_json?.businessProfile?.instagramUrl ?? "");
    setFacebookUrl(selectedRestaurant?.settings_json?.businessProfile?.facebookUrl ?? "");
    setDeleteConfirmationName("");
    setSavedLogoUrl(selectedRestaurant?.logo_url ?? "");
    setSavedCoverPhotoUrl(selectedRestaurant?.cover_photo_url ?? "");
    setLogoUrlInput("");
    setCoverUrlInput("");
    setLogoFileDraft(null);
    setCoverFileDraft(null);
    setLogoDraftPreviewUrl(null);
    setCoverDraftPreviewUrl(null);
    setLogoMarkedForRemoval(false);
    setCoverMarkedForRemoval(false);
    setDraggingMediaKind(null);
    setCurrency(selectedRestaurant?.currency ?? "cad");
    setAcceptsWalkins(selectedRestaurant?.accepts_walkins ?? true);
    setDietaryTags(normalizeRestaurantDietaryTags(selectedRestaurant?.settings_json?.dietaryTags));
    setTurnTimeMinutes(String(selectedRestaurant?.settings_json?.turnTimeMinutes ?? DEFAULT_TURN_TIME_MINUTES));
    setPrimaryColor(selectedRestaurant?.settings_json?.theme?.primaryColor ?? "#C9A84C");
    setAccentColor(selectedRestaurant?.settings_json?.theme?.accentColor ?? "#22C55E");
    setBackgroundColor(selectedRestaurant?.settings_json?.theme?.backgroundColor ?? "#0A0A0A");
  }, [selectedRestaurant?.id, selectedRestaurant?.name, selectedRestaurant?.logo_url, selectedRestaurant?.cover_photo_url, selectedRestaurant?.email, selectedRestaurant?.city, selectedRestaurant?.province, selectedRestaurant?.country, selectedRestaurant?.business_type, selectedRestaurant?.currency, selectedRestaurant?.settings_json, selectedRestaurant?.accepts_walkins]);

  useEffect(() => () => revokeDraftUrl(logoDraftPreviewUrl), [logoDraftPreviewUrl]);
  useEffect(() => () => revokeDraftUrl(coverDraftPreviewUrl), [coverDraftPreviewUrl]);

  useEffect(() => {
    if (!selectedRestaurant?.id || !isSupabaseConfigured()) return;
    const client = getSupabaseBrowserClient();
    void client
      .from("restaurants")
      .select("cuisine_type, address, email, phone, city, province, country, business_type, description, hours_json, plan, accepts_walkins, settings_json")
      .eq("id", selectedRestaurant.id)
      .single()
      .then(({ data }) => {
        if (!data) return;
        const c = normalizeRestaurantCuisine(data.cuisine_type);
        const a = data.address ?? "";
        const e = data.email ?? "";
        const p = (data as { phone?: string | null }).phone ?? "";
        const cityValue = data.city ?? "";
        const provinceValue = data.province ?? "";
        const countryValue = data.country ?? "";
        const businessTypeValue = normalizeRestaurantBusinessType(data.business_type);
        const settings = (data.settings_json ?? {}) as RestaurantSettings;
        const businessProfile = settings.businessProfile ?? EMPTY_BUSINESS_PROFILE;
        const legalNameValue = businessProfile.legalName ?? "";
        const websiteUrlValue = businessProfile.websiteUrl ?? "";
        const instagramUrlValue = businessProfile.instagramUrl ?? "";
        const facebookUrlValue = businessProfile.facebookUrl ?? "";
        const d = (data.description ?? "").slice(0, RESTAURANT_DESCRIPTION_MAX_LENGTH);
        const accepts = data.accepts_walkins ?? true;
        setCuisine(c);
        setAddress(a);
        setContactEmail(e);
        setPhone(p);
        setCity(cityValue);
        setProvince(provinceValue);
        setCountry(countryValue);
        setBusinessType(businessTypeValue);
        setLegalName(legalNameValue);
        setWebsiteUrl(websiteUrlValue);
        setInstagramUrl(instagramUrlValue);
        setFacebookUrl(facebookUrlValue);
        setDescription(d);
        setAcceptsWalkins(accepts);
        setRestaurantInitial({
          name: selectedRestaurant.name ?? "",
          cuisine: c,
          address: a,
          contactEmail: e,
          phone: p,
          city: cityValue,
          province: provinceValue,
          country: countryValue,
          businessType: businessTypeValue,
          legalName: legalNameValue,
          websiteUrl: websiteUrlValue,
          instagramUrl: instagramUrlValue,
          facebookUrl: facebookUrlValue,
          description: d,
          currency: selectedRestaurant.currency ?? "cad",
          acceptsWalkins: accepts,
          dietaryTags: normalizeRestaurantDietaryTags(settings.dietaryTags),
          turnTimeMinutes: String(settings.turnTimeMinutes ?? DEFAULT_TURN_TIME_MINUTES),
        });
        const parsed = parseRestaurantHoursJson(data.hours_json as Record<string, unknown> | null);
        setHours(parsed.regular);
        setSpecialDays(parsed.special);
        setCurrentPlan(data.plan ?? null);
      });
  }, [
    selectedRestaurant?.id,
    selectedRestaurant?.name,
    selectedRestaurant?.currency,
    selectedRestaurant?.accepts_walkins,
  ]);

  const restaurantDirty = useMemo(() => {
    if (!restaurantInitial) return false;
    return (
      restaurantInitial.name !== restaurantName ||
      restaurantInitial.cuisine !== cuisine ||
      restaurantInitial.address !== address ||
      restaurantInitial.contactEmail !== contactEmail ||
      restaurantInitial.phone !== phone ||
      restaurantInitial.city !== city ||
      restaurantInitial.province !== province ||
      restaurantInitial.country !== country ||
      restaurantInitial.businessType !== businessType ||
      restaurantInitial.legalName !== legalName ||
      restaurantInitial.websiteUrl !== websiteUrl ||
      restaurantInitial.instagramUrl !== instagramUrl ||
      restaurantInitial.facebookUrl !== facebookUrl ||
      restaurantInitial.description !== description ||
      restaurantInitial.currency !== currency ||
      restaurantInitial.acceptsWalkins !== acceptsWalkins ||
      dietaryTagsKey(restaurantInitial.dietaryTags) !== dietaryTagsKey(dietaryTags) ||
      restaurantInitial.turnTimeMinutes !== turnTimeMinutes
    );
  }, [restaurantInitial, restaurantName, cuisine, address, contactEmail, phone, city, province, country, businessType, legalName, websiteUrl, instagramUrl, facebookUrl, description, currency, acceptsWalkins, dietaryTags, turnTimeMinutes]);

  const toggleDietaryTag = (tag: RestaurantDietaryTag) => {
    setDietaryTags((current) => (
      current.includes(tag)
        ? current.filter((item) => item !== tag)
        : [...current, tag]
    ));
  };

  const deleteConfirmationMatches = selectedRestaurant?.name
    ? deleteConfirmationName.trim() === selectedRestaurant.name.trim()
    : false;

  const deleteRestaurant = async () => {
    if (!selectedRestaurant || !deleteConfirmationMatches) return;
    if (!isSupabaseConfigured()) { toast.error(t("auth.errors.supabaseNotConfigured")); return; }

    setDeletingRestaurant(true);
    const client = getSupabaseBrowserClient();
    const { error, data } = await client.functions.invoke<{ ok?: boolean; error?: string }>("delete-restaurant", {
      body: {
        restaurant_id: selectedRestaurant.id,
        confirmationName: deleteConfirmationName.trim(),
      },
    });
    setDeletingRestaurant(false);

    if (error || data?.error) {
      toast.error(data?.error ?? error?.message ?? t("dashboard.settings.deleteRestaurantFailed"));
      return;
    }

    toast.success(t("dashboard.settings.deleteRestaurantSuccess"));
    setDeleteConfirmationName("");
    refreshRestaurants();
    const fallbackRestaurant = restaurants.find((restaurant) => restaurant.id !== selectedRestaurant.id);
    void navigate(fallbackRestaurant ? "/dashboard" : "/setup", { replace: true });
  };

  const saveRestaurantSettings = async () => {
    if (!selectedRestaurant) return;
    if (!isSupabaseConfigured()) { toast.error(t("auth.errors.supabaseNotConfigured")); return; }
    const nextName = restaurantName.trim();
    if (!nextName) return;
    if (!validOptionalEmail(contactEmail)) {
      toast.error(t("dashboard.settings.invalidContactEmail"));
      return;
    }
    if (!normalizedTurnTime) {
      toast.error(t("dashboard.settings.invalidTurnTime"));
      return;
    }

    const normalizedLogoUrl = !logoMarkedForRemoval && logoUrlInput.trim() ? imageUrlFromInput(logoUrlInput) : undefined;
    const normalizedCoverUrl = !coverMarkedForRemoval && coverUrlInput.trim() ? imageUrlFromInput(coverUrlInput) : undefined;
    if (normalizedLogoUrl === false || normalizedCoverUrl === false) {
      toast.error(t("dashboard.settings.invalidImageUrl"));
      return;
    }
    const normalizedWebsiteUrl = urlFromInput(websiteUrl);
    const normalizedInstagramUrl = urlFromInput(instagramUrl);
    const normalizedFacebookUrl = urlFromInput(facebookUrl);
    if (normalizedWebsiteUrl === false || normalizedInstagramUrl === false || normalizedFacebookUrl === false) {
      toast.error(t("dashboard.settings.invalidBusinessUrl"));
      return;
    }

    setSavingRestaurant(true);
    const client = getSupabaseBrowserClient();
    const existingSettings = (selectedRestaurant.settings_json ?? {}) as RestaurantSettings;
    const updatedSettings: RestaurantSettings = {
      ...existingSettings,
      dietaryTags,
      turnTimeMinutes: normalizedTurnTime,
      businessProfile: {
        legalName: legalName.trim() || null,
        websiteUrl: normalizedWebsiteUrl,
        instagramUrl: normalizedInstagramUrl,
        facebookUrl: normalizedFacebookUrl,
      },
    };

    const mediaUpdates: Partial<Record<RestaurantMediaField, string | null>> = {};
    if (logoMarkedForRemoval) {
      mediaUpdates.logo_url = null;
    } else if (logoFileDraft) {
      const uploadedLogoUrl = await uploadRestaurantMediaFile("logo", logoFileDraft);
      if (!uploadedLogoUrl) {
        setSavingRestaurant(false);
        return;
      }
      mediaUpdates.logo_url = uploadedLogoUrl;
    } else if (normalizedLogoUrl !== undefined) {
      mediaUpdates.logo_url = normalizedLogoUrl;
    }

    if (coverMarkedForRemoval) {
      mediaUpdates.cover_photo_url = null;
    } else if (coverFileDraft) {
      const uploadedCoverUrl = await uploadRestaurantMediaFile("cover", coverFileDraft);
      if (!uploadedCoverUrl) {
        setSavingRestaurant(false);
        return;
      }
      mediaUpdates.cover_photo_url = uploadedCoverUrl;
    } else if (normalizedCoverUrl !== undefined) {
      mediaUpdates.cover_photo_url = normalizedCoverUrl;
    }

    const { error } = await client
      .from("restaurants")
      .update({
        name: nextName,
        cuisine_type: cuisine || null,
        address: address.trim() || null,
        email: contactEmail.trim() || null,
        phone: phone.trim() || null,
        city: city.trim() || null,
        province: province.trim() || null,
        country: country.trim() || null,
        business_type: businessType || null,
        description: description.trim().slice(0, RESTAURANT_DESCRIPTION_MAX_LENGTH) || null,
        currency,
        accepts_walkins: acceptsWalkins,
        settings_json: updatedSettings,
        ...mediaUpdates,
      })
      .eq("id", selectedRestaurant.id);
    setSavingRestaurant(false);
    if (error) { toast.error(t("dashboard.settings.saveFailed")); return; }

    const nextSavedLogoUrl = mediaUpdates.logo_url !== undefined ? mediaUpdates.logo_url ?? "" : savedLogoUrl;
    const nextSavedCoverPhotoUrl = mediaUpdates.cover_photo_url !== undefined ? mediaUpdates.cover_photo_url ?? "" : savedCoverPhotoUrl;
    const nextLegalName = legalName.trim();
    const nextWebsiteUrl = normalizedWebsiteUrl ?? "";
    const nextInstagramUrl = normalizedInstagramUrl ?? "";
    const nextFacebookUrl = normalizedFacebookUrl ?? "";
    setLegalName(nextLegalName);
    setWebsiteUrl(nextWebsiteUrl);
    setInstagramUrl(nextInstagramUrl);
    setFacebookUrl(nextFacebookUrl);
    setRestaurantInitial({
      name: nextName,
      cuisine,
      address,
      contactEmail,
      phone,
      city,
      province,
      country,
      businessType,
      legalName: nextLegalName,
      websiteUrl: nextWebsiteUrl,
      instagramUrl: nextInstagramUrl,
      facebookUrl: nextFacebookUrl,
      description,
      currency,
      acceptsWalkins,
      dietaryTags,
      turnTimeMinutes,
    });
    setSavedLogoUrl(nextSavedLogoUrl);
    setSavedCoverPhotoUrl(nextSavedCoverPhotoUrl);
    setLogoUrlInput("");
    setCoverUrlInput("");
    setLogoFileDraft(null);
    setCoverFileDraft(null);
    setLogoDraftPreviewUrl(null);
    setCoverDraftPreviewUrl(null);
    setLogoMarkedForRemoval(false);
    setCoverMarkedForRemoval(false);
    refreshRestaurants();
    toast.success(t("dashboard.settings.saved"));
  };

  const uploadRestaurantMediaFile = async (kind: RestaurantMediaKind, file: File): Promise<string | null> => {
    if (!selectedRestaurant) return null;
    const image = resolveRestaurantImage(file);
    if (!image) {
      toast.error(t("dashboard.settings.invalidRestaurantImage", { formats: RESTAURANT_IMAGE_FORMATS }));
      return null;
    }

    const client = getSupabaseBrowserClient();
    const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
    const path = `${selectedRestaurant.id}/restaurant/${kind}/${crypto.randomUUID()}-${safeName}`;
    const { error } = await client.storage
      .from("event-media")
      .upload(path, file, { cacheControl: "3600", contentType: image.mime, upsert: false });

    if (error) {
      toast.error(error.message);
      return null;
    }

    const { data } = client.storage.from("event-media").getPublicUrl(path);
    return data.publicUrl;
  };

  const applyRestaurantMediaDraft = (kind: RestaurantMediaKind, file: File) => {
    const image = resolveRestaurantImage(file);
    if (!image) {
      toast.error(t("dashboard.settings.invalidRestaurantImage", { formats: RESTAURANT_IMAGE_FORMATS }));
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    if (kind === "logo") {
      setLogoFileDraft(file);
      setLogoUrlInput("");
      setLogoDraftPreviewUrl(previewUrl);
      setLogoMarkedForRemoval(false);
    } else {
      setCoverFileDraft(file);
      setCoverUrlInput("");
      setCoverDraftPreviewUrl(previewUrl);
      setCoverMarkedForRemoval(false);
    }
  };

  const handleRestaurantMediaFile = (kind: RestaurantMediaKind, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    applyRestaurantMediaDraft(kind, file);
  };

  const handleRestaurantMediaDragOver = (kind: RestaurantMediaKind, event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (!selectedRestaurant || savingRestaurant) return;
    event.dataTransfer.dropEffect = "copy";
    setDraggingMediaKind(kind);
  };

  const handleRestaurantMediaDragLeave = (event: DragEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setDraggingMediaKind(null);
  };

  const handleRestaurantMediaDrop = (kind: RestaurantMediaKind, event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDraggingMediaKind(null);
    if (!selectedRestaurant || savingRestaurant) return;
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    applyRestaurantMediaDraft(kind, file);
  };

  const handleRestaurantMediaUrl = (kind: RestaurantMediaKind, value: string) => {
    if (kind === "logo") {
      setLogoUrlInput(value);
      setLogoMarkedForRemoval(false);
      if (value.trim()) {
        setLogoFileDraft(null);
        setLogoDraftPreviewUrl(null);
      }
    } else {
      setCoverUrlInput(value);
      setCoverMarkedForRemoval(false);
      if (value.trim()) {
        setCoverFileDraft(null);
        setCoverDraftPreviewUrl(null);
      }
    }
  };

  const removeRestaurantMedia = (kind: RestaurantMediaKind) => {
    if (kind === "logo") {
      setLogoUrlInput("");
      setLogoFileDraft(null);
      setLogoDraftPreviewUrl(null);
      setLogoMarkedForRemoval(Boolean(savedLogoUrl));
    } else {
      setCoverUrlInput("");
      setCoverFileDraft(null);
      setCoverDraftPreviewUrl(null);
      setCoverMarkedForRemoval(Boolean(savedCoverPhotoUrl));
    }
  };

  const discardRestaurant = () => {
    if (!restaurantInitial) return;
    setRestaurantName(restaurantInitial.name);
    setCuisine(restaurantInitial.cuisine);
    setAddress(restaurantInitial.address);
    setContactEmail(restaurantInitial.contactEmail);
    setPhone(restaurantInitial.phone);
    setCity(restaurantInitial.city);
    setProvince(restaurantInitial.province);
    setCountry(restaurantInitial.country);
    setBusinessType(restaurantInitial.businessType);
    setLegalName(restaurantInitial.legalName);
    setWebsiteUrl(restaurantInitial.websiteUrl);
    setInstagramUrl(restaurantInitial.instagramUrl);
    setFacebookUrl(restaurantInitial.facebookUrl);
    setDescription(restaurantInitial.description);
    setCurrency(restaurantInitial.currency);
    setAcceptsWalkins(restaurantInitial.acceptsWalkins);
    setTurnTimeMinutes(restaurantInitial.turnTimeMinutes);
    discardRestaurantMedia();
  };

  const discardRestaurantMedia = () => {
    setLogoUrlInput("");
    setCoverUrlInput("");
    setLogoFileDraft(null);
    setCoverFileDraft(null);
    setLogoDraftPreviewUrl(null);
    setCoverDraftPreviewUrl(null);
    setLogoMarkedForRemoval(false);
    setCoverMarkedForRemoval(false);
    setDraggingMediaKind(null);
  };

  const saveHours = async () => {
    if (!selectedRestaurant) return;
    if (!isSupabaseConfigured()) { toast.error(t("auth.errors.supabaseNotConfigured")); return; }
    setSavingHours(true);
    const client = getSupabaseBrowserClient();
    const hoursJson = restaurantHoursToJson(hours, specialDays);
    const { error } = await client
      .from("restaurants")
      .update({ hours_json: hoursJson })
      .eq("id", selectedRestaurant.id);
    if (error) {
      setSavingHours(false);
      toast.error(t("dashboard.settings.saveFailed"));
      return;
    }

    const { data: existingShifts } = await client
      .from("shifts")
      .select("id, name, days_of_week, slot_duration_minutes, max_covers, turn_time_minutes, min_party_size, max_party_size, advance_booking_days, blackout_dates")
      .eq("restaurant_id", selectedRestaurant.id);
    const templateShift = existingShifts?.[0] as {
      slot_duration_minutes: number | null;
      max_covers: number | null;
      turn_time_minutes: number | null;
      min_party_size: number | null;
      max_party_size: number | null;
      advance_booking_days: number | null;
      blackout_dates: string[] | null;
    } | undefined;
    const openDays = hours
      .map((day, index) => ({ day, index }))
      .filter(({ day }) => day.open);

    const shiftPayload = openDays.flatMap(({ day, index }) => {
      const startMinutes = parseRestaurantTimeToMinutes(day.from);
      const endMinutes = parseRestaurantTimeToMinutes(day.to);
      if (startMinutes == null || endMinutes == null || endMinutes <= startMinutes) return [];
      return [{
        restaurant_id: selectedRestaurant.id,
        name: `${RESTAURANT_WEEKDAYS[index]} service`,
        days_of_week: [RESTAURANT_WEEKDAY_NUMBERS[index]],
        start_time: minutesToPostgresTime(startMinutes),
        end_time: minutesToPostgresTime(endMinutes),
        slot_duration_minutes: templateShift?.slot_duration_minutes ?? 30,
        max_covers: templateShift?.max_covers ?? 100,
        turn_time_minutes: normalizedTurnTime ?? templateShift?.turn_time_minutes ?? DEFAULT_TURN_TIME_MINUTES,
        min_party_size: templateShift?.min_party_size ?? 1,
        max_party_size: templateShift?.max_party_size ?? 20,
        advance_booking_days: templateShift?.advance_booking_days ?? 30,
        blackout_dates: templateShift?.blackout_dates ?? [],
        is_active: true,
      }];
    });

    const { error: deactivateShiftError } = await client
      .from("shifts")
      .update({ is_active: false })
      .eq("restaurant_id", selectedRestaurant.id);
    if (deactivateShiftError) {
      setSavingHours(false);
      toast.error(t("dashboard.settings.saveFailed"));
      return;
    }

    if (shiftPayload.length > 0) {
      const { error: shiftError } = await client.from("shifts").insert(shiftPayload);
      if (shiftError) {
        setSavingHours(false);
        toast.error(t("dashboard.settings.saveFailed"));
        return;
      }
    }

    refreshRestaurants();
    setSavingHours(false);
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
                  <CuisineSelect
                    value={cuisine}
                    onValueChange={setCuisine}
                    placeholder={t("dashboard.settings.cuisineSelectPlaceholder")}
                  />
                </FieldRow>
                <FieldRow label="Address">
                  <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="142 Yorkville Ave, Toronto, ON M5R 1C2" />
                </FieldRow>
                <FieldRow label={t("dashboard.settings.city")}>
                  <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Toronto" />
                </FieldRow>
                <FieldRow label={t("dashboard.settings.province")}>
                  <Input value={province} onChange={(e) => setProvince(e.target.value)} placeholder="ON" />
                </FieldRow>
                <FieldRow label={t("dashboard.settings.country")}>
                  <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Canada" />
                </FieldRow>
                <FieldRow label={t("dashboard.settings.businessType")} hint={t("dashboard.settings.businessTypeHint")}>
                  <BusinessTypeSelect
                    value={businessType}
                    onValueChange={setBusinessType}
                    placeholder={t("dashboard.settings.businessTypeSelectPlaceholder")}
                  />
                </FieldRow>
                <FieldRow label={t("dashboard.settings.legalName")} hint={t("dashboard.settings.legalNameHint")}>
                  <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Cenaiva Restaurant Group Inc." />
                </FieldRow>
                <FieldRow label={t("dashboard.settings.contactEmail")}>
                  <Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="hello@example.com" />
                </FieldRow>
                <FieldRow label={t("dashboard.settings.phone")}>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(416) 555-0142" />
                </FieldRow>
                <FieldRow label={t("dashboard.settings.websiteUrl")}>
                  <Input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://example.com" />
                </FieldRow>
                <FieldRow label={t("dashboard.settings.instagramUrl")}>
                  <Input value={instagramUrl} onChange={(e) => setInstagramUrl(e.target.value)} placeholder="https://instagram.com/example" />
                </FieldRow>
                <FieldRow label={t("dashboard.settings.facebookUrl")}>
                  <Input value={facebookUrl} onChange={(e) => setFacebookUrl(e.target.value)} placeholder="https://facebook.com/example" />
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
                <FieldRow
                  label={t("dashboard.settings.acceptWalkins")}
                  hint={t("dashboard.settings.acceptWalkinsHint")}
                >
                  <div className="flex max-w-xl items-center justify-between gap-4 rounded-2xl border border-border bg-bg-elevated/45 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-text-primary">
                        {acceptsWalkins
                          ? t("dashboard.settings.walkinsAccepted")
                          : t("dashboard.settings.reservationsOnly")}
                      </p>
                      <p className="mt-1 text-xs text-text-muted">
                        {t("dashboard.settings.acceptWalkinsPreviewHint")}
                      </p>
                    </div>
                    <Switch checked={acceptsWalkins} onCheckedChange={setAcceptsWalkins} />
                  </div>
                </FieldRow>
                <FieldRow
                  label={t("dashboard.settings.dietaryTags")}
                  hint={t("dashboard.settings.dietaryTagsHint")}
                >
                  <div className="flex flex-wrap gap-2">
                    {RESTAURANT_DIETARY_TAGS.map((tag) => {
                      const active = dietaryTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => toggleDietaryTag(tag)}
                          className={cn(
                            "rounded-full border px-3 py-2 text-xs font-medium transition-colors",
                            active
                              ? "border-gold bg-gold/15 text-gold"
                              : "border-border bg-bg-elevated text-text-secondary hover:border-gold/30 hover:text-text-primary",
                          )}
                          aria-pressed={active}
                        >
                          {t(`restaurantDietaryTags.${tag}`)}
                        </button>
                      );
                    })}
                  </div>
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
                <FieldRow
                  label={t("dashboard.settings.logoAndCover")}
                  hint={t("dashboard.settings.logoAndCoverHint")}
                >
                  <div className="space-y-4">
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept={RESTAURANT_IMAGE_ACCEPT}
                      className="hidden"
                      onChange={(event) => handleRestaurantMediaFile("logo", event)}
                    />
                    <input
                      ref={coverInputRef}
                      type="file"
                      accept={RESTAURANT_IMAGE_ACCEPT}
                      className="hidden"
                      onChange={(event) => handleRestaurantMediaFile("cover", event)}
                    />

                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
                      <div
                        onDragOver={(event) => handleRestaurantMediaDragOver("logo", event)}
                        onDragLeave={handleRestaurantMediaDragLeave}
                        onDrop={(event) => handleRestaurantMediaDrop("logo", event)}
                        className={cn(
                          "rounded-2xl border border-border/70 bg-bg-elevated/40 p-4 transition-colors",
                          draggingMediaKind === "logo" && "border-gold/60 bg-gold/10",
                        )}
                      >
                        <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-text-muted">
                          {t("dashboard.settings.logo")}
                        </p>
                        <button
                          type="button"
                          disabled={savingRestaurant || !selectedRestaurant}
                          onClick={() => logoInputRef.current?.click()}
                          onDragOver={(event) => handleRestaurantMediaDragOver("logo", event)}
                          onDragLeave={handleRestaurantMediaDragLeave}
                          onDrop={(event) => handleRestaurantMediaDrop("logo", event)}
                          className={cn(
                            "flex min-h-44 w-full flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-border bg-bg-base/70 p-6 text-center transition-colors",
                            "hover:border-info/70 hover:bg-bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/40 disabled:cursor-not-allowed disabled:opacity-70",
                            draggingMediaKind === "logo" && "border-info/70 bg-info/10",
                          )}
                        >
                          <span className="flex size-14 items-center justify-center rounded-2xl text-info">
                            <Upload className="size-10" strokeWidth={1.7} />
                          </span>
                          {logoPreviewSrc ? (
                            <span className="mt-4 flex size-20 items-center justify-center overflow-hidden rounded-2xl border border-gold/30 bg-gold/10 font-serif text-lg text-gold">
                              <img
                                src={logoPreviewSrc}
                                alt={t("dashboard.settings.logoPreviewAlt")}
                                className="size-full object-cover"
                              />
                            </span>
                          ) : (
                            <span className="mt-4 flex size-20 items-center justify-center rounded-2xl border border-gold/30 bg-gold/10 font-serif text-lg text-gold">
                              {(restaurantName || "MV").slice(0, 2).toUpperCase()}
                            </span>
                          )}
                          <span className="mt-4 block text-base font-semibold text-text-primary">
                            {t("dashboard.settings.mediaDropTitle")}
                          </span>
                          <span className="mt-1 block text-sm text-text-muted">
                            {t("dashboard.settings.mediaDropHint")}
                          </span>
                        </button>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={savingRestaurant || !selectedRestaurant}
                            onClick={() => logoInputRef.current?.click()}
                          >
                            {t("dashboard.settings.replaceLogo")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={savingRestaurant || !selectedRestaurant || !logoPreviewSrc}
                            onClick={() => removeRestaurantMedia("logo")}
                          >
                            {t("dashboard.settings.removeLogo")}
                          </Button>
                        </div>
                        <Input
                          value={logoUrlInput}
                          onChange={(event) => handleRestaurantMediaUrl("logo", event.target.value)}
                          placeholder={t("dashboard.settings.logoUrlPlaceholder")}
                          className="mt-3"
                        />
                      </div>

                      <div
                        onDragOver={(event) => handleRestaurantMediaDragOver("cover", event)}
                        onDragLeave={handleRestaurantMediaDragLeave}
                        onDrop={(event) => handleRestaurantMediaDrop("cover", event)}
                        className={cn(
                          "rounded-2xl border border-border/70 bg-bg-elevated/40 p-4 transition-colors",
                          draggingMediaKind === "cover" && "border-info/60 bg-info/10",
                        )}
                      >
                        <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-text-muted">
                          {t("dashboard.settings.coverPhoto")}
                        </p>
                        <button
                          type="button"
                          disabled={savingRestaurant || !selectedRestaurant}
                          onClick={() => coverInputRef.current?.click()}
                          onDragOver={(event) => handleRestaurantMediaDragOver("cover", event)}
                          onDragLeave={handleRestaurantMediaDragLeave}
                          onDrop={(event) => handleRestaurantMediaDrop("cover", event)}
                          className={cn(
                            "flex aspect-video w-full flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-border bg-bg-base/70 p-6 text-center transition-colors",
                            "hover:border-info/70 hover:bg-bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/40 disabled:cursor-not-allowed disabled:opacity-70",
                            draggingMediaKind === "cover" && "border-info/70 bg-info/10",
                          )}
                        >
                          {coverPreviewSrc ? (
                            <img
                              src={coverPreviewSrc}
                              alt={t("dashboard.settings.coverPreviewAlt")}
                              className="size-full object-cover"
                            />
                          ) : (
                            <>
                              <Upload className="size-12 text-info" strokeWidth={1.7} />
                              <span className="mt-5 block text-lg font-semibold text-text-primary">
                                {t("dashboard.settings.mediaDropTitle")}
                              </span>
                              <span className="mt-2 block text-sm text-text-muted">
                                {t("dashboard.settings.mediaDropHint")}
                              </span>
                            </>
                          )}
                        </button>
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                          <Input
                            value={coverUrlInput}
                            onChange={(event) => handleRestaurantMediaUrl("cover", event.target.value)}
                            placeholder={t("dashboard.settings.coverUrlPlaceholder")}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={savingRestaurant || !selectedRestaurant}
                            onClick={() => coverInputRef.current?.click()}
                            className="shrink-0"
                          >
                            {t("dashboard.settings.uploadCover")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={savingRestaurant || !selectedRestaurant || !coverPreviewSrc}
                            onClick={() => removeRestaurantMedia("cover")}
                            className="shrink-0"
                          >
                            {t("dashboard.settings.removeCover")}
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 text-xs text-text-muted sm:flex-row sm:items-center sm:justify-between">
                      <p>{t("dashboard.settings.imageUploadSupport", { formats: RESTAURANT_IMAGE_FORMATS })}</p>
                      {mediaDirty && <p className="text-gold">{t("dashboard.settings.mediaPendingSave")}</p>}
                    </div>
                  </div>
                </FieldRow>
              </Card>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  disabled={(!restaurantDirty && !mediaDirty) || savingRestaurant}
                  onClick={discardRestaurant}
                >
                  Discard
                </Button>
                <Button
                  disabled={(!restaurantDirty && !mediaDirty) || savingRestaurant || !restaurantName.trim() || !selectedRestaurant}
                  onClick={() => void saveRestaurantSettings()}
                >
                  {savingRestaurant ? t("routes.loading") : "Save changes"}
                </Button>
              </div>
              <Card>
                <div className="grid gap-5 px-6 py-6 sm:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] sm:px-7">
                  <div>
                    <p className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-danger">
                      <Trash2 className="size-3.5" />
                      {t("dashboard.settings.dangerZone")}
                    </p>
                    <h3 className="mt-2 font-serif text-xl text-white">
                      {t("dashboard.settings.deleteRestaurant")}
                    </h3>
                    <p className="mt-2 max-w-2xl text-sm text-text-muted">
                      {t("dashboard.settings.deleteRestaurantHint")}
                    </p>
                    <p className="mt-3 text-xs text-danger">
                      {t("dashboard.settings.deleteRestaurantWarning")}
                    </p>
                  </div>
                  <div className="space-y-3 rounded-2xl border border-danger/30 bg-danger/5 p-4">
                    <label className="block text-xs font-medium text-text-secondary" htmlFor="delete-restaurant-confirmation">
                      {t("dashboard.settings.deleteRestaurantConfirmLabel", {
                        name: selectedRestaurant?.name ?? "",
                      })}
                    </label>
                    <Input
                      id="delete-restaurant-confirmation"
                      value={deleteConfirmationName}
                      onChange={(event) => setDeleteConfirmationName(event.target.value)}
                      placeholder={selectedRestaurant?.name ?? ""}
                      disabled={deletingRestaurant || !selectedRestaurant}
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      className="w-full"
                      disabled={!deleteConfirmationMatches || deletingRestaurant || !selectedRestaurant}
                      onClick={() => void deleteRestaurant()}
                    >
                      {deletingRestaurant ? t("routes.loading") : t("dashboard.settings.deleteRestaurantAction")}
                    </Button>
                  </div>
                </div>
              </Card>
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
                  {RESTAURANT_WEEKDAYS.map((day, i) => (
                    <div key={day} className="grid grid-cols-[120px_minmax(0,1fr)_auto] items-center gap-4 border-t border-border/50 px-6 py-4 sm:px-7">
                      <span className={cn("text-sm", hours[i].open ? "text-text-primary" : "text-text-muted")}>{day}</span>
                      {hours[i].open ? (
                        <div className="flex flex-wrap items-center gap-2 text-sm text-text-primary">
                          <DashboardTimeWheelPicker
                            value={hours[i].from}
                            onChange={(v) => setHours((h) => h.map((d, idx) => idx === i ? { ...d, from: v } : d))}
                            valueFormat="12h"
                            ariaLabel={`${day} opening time`}
                            helperLabel="Opening time"
                            doneLabel="Done"
                          />
                          <span className="text-xs text-text-muted">—</span>
                          <DashboardTimeWheelPicker
                            value={hours[i].to}
                            onChange={(v) => setHours((h) => h.map((d, idx) => idx === i ? { ...d, to: v } : d))}
                            valueFormat="12h"
                            ariaLabel={`${day} closing time`}
                            helperLabel="Closing time"
                            doneLabel="Done"
                          />
                        </div>
                      ) : (
                        <span className="text-sm text-text-muted">Closed</span>
                      )}
                      <label className="flex items-center gap-2 text-xs text-text-muted">
                        <span>{hours[i].open ? "Open" : "Closed"}</span>
                        <Switch
                          checked={hours[i].open}
                          onCheckedChange={(open) => setHours((h) => h.map((d, idx) => idx === i ? { ...d, open } : d))}
                        />
                      </label>
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
