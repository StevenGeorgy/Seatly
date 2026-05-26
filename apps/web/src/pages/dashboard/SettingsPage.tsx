import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { format, parse, isValid, startOfDay } from "date-fns";
import type { DateRange } from "react-day-picker";
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  CalendarDays,
  CreditCard,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  Upload,
  X,
  Trash2,
} from "lucide-react";
import { motion } from "framer-motion";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { DashboardTimeWheelPicker } from "@/components/dashboard/DashboardTimeWheelPicker";
import { DepositPolicyEditor } from "@/components/dashboard/DepositPolicyEditor";
import { BusinessTypeSelect } from "@/components/restaurant/BusinessTypeSelect";
import { CuisineSelect } from "@/components/restaurant/CuisineSelect";
import { GoogleAddressAutocompleteInput } from "@/components/restaurant/GoogleAddressAutocompleteInput";
import { Button } from "@/components/ui/button";
import { ColorPicker, BACKGROUND_PRESETS } from "@/components/ui/color-picker";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { useUser } from "@/hooks/useUser";
import type { NotificationPreferences } from "@/types/auth";
import { useRestaurantSeatTotal } from "@/hooks/useRestaurantSeatTotal";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { assertImageSizeOk } from "@/lib/images/assertImageSize";
import { showErrorToast, toUserFacingError } from "@/lib/errors";
import { applyRestaurantTheme } from "@/lib/theme";
import { stripePromise } from "@/lib/stripe";
import { ChangeSubscriptionCard } from "@/components/billing/ChangeSubscriptionCard";
import { CardOnFileBadge } from "@/components/billing/CardOnFileBadge";
// Referral program disabled — see referral_program task. ReferralCodeCard
// kept in components/ for future re-enablement.
// import { ReferralCodeCard } from "@/components/dashboard/ReferralCodeCard";
import { NextBillCard } from "@/components/billing/NextBillCard";
import { PayoutsSection } from "@/components/billing/PayoutsSection";
import { BillingDetailsForm } from "@/components/billing/BillingDetailsForm";
import { SubscriptionLifecycleControls } from "@/components/billing/SubscriptionLifecycleControls";
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
  lat: number | null;
  lng: number | null;
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

type SectionKey = "restaurant" | "hours" | "billing" | "notifications" | "theme" | "danger";
type RestaurantInfoSectionKey = Extract<SectionKey, "restaurant" | "hours" | "theme">;
type SettingsSectionKey = Extract<SectionKey, "billing" | "notifications" | "danger">;

const RESTAURANT_INFO_NAV: { key: RestaurantInfoSectionKey; label: string }[] = [
  { key: "restaurant", label: "Restaurant info" },
  { key: "hours", label: "Hours & calendar" },
  { key: "theme", label: "Theme" },
];

const SETTINGS_NAV: { key: SettingsSectionKey; label: string; icon: typeof CreditCard }[] = [
  { key: "billing", label: "Billing", icon: CreditCard },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "danger", label: "Danger zone", icon: Trash2 },
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
  danger: {
    eyebrow: "Configuration",
    title: "Danger zone",
    subtitle: "Permanent actions that affect this entire restaurant.",
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

function createSpecialDay(): RestaurantSpecialDay {
  return {
    id: crypto.randomUUID(),
    date: "",
    dateMode: "single",
    startDate: "",
    endDate: "",
    label: "",
    description: "",
    closed: true,
    from: "12:00 PM",
    to: "10:00 PM",
  };
}

function parseSpecialDate(value: string): Date | undefined {
  if (!value) return undefined;
  const parsed = parse(value, "yyyy-MM-dd", new Date());
  return isValid(parsed) ? parsed : undefined;
}

function formatSpecialDateLabel(value: string): string {
  const parsed = parseSpecialDate(value);
  if (!parsed) return "";
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function specialDayStart(sd: RestaurantSpecialDay): string {
  return sd.startDate || sd.date;
}

function specialDayEnd(sd: RestaurantSpecialDay): string {
  return sd.endDate || specialDayStart(sd);
}

function specialDayUsesRange(sd: RestaurantSpecialDay): boolean {
  const start = specialDayStart(sd);
  const end = specialDayEnd(sd);
  return sd.dateMode === "range" || Boolean(start && end && end !== start);
}

function formatSpecialDayRange(sd: RestaurantSpecialDay): string {
  const start = specialDayStart(sd);
  const end = specialDayEnd(sd);
  if (!start) return "No date selected";
  if (!end || end === start) return formatSpecialDateLabel(start);
  return `${formatSpecialDateLabel(start)} to ${formatSpecialDateLabel(end)}`;
}

function specialDayDateRange(sd: RestaurantSpecialDay): DateRange | undefined {
  const from = parseSpecialDate(specialDayStart(sd));
  if (!from) return undefined;
  const to = specialDayUsesRange(sd) ? parseSpecialDate(specialDayEnd(sd)) : undefined;
  return to && to > from ? { from, to } : { from };
}

function SpecialDateRangeField({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: RestaurantSpecialDay;
  onChange: (next: RestaurantSpecialDay) => void;
  placeholder: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pendingStart, setPendingStart] = useState<Date | null>(null);
  const today = startOfDay(new Date());
  const todayIso = format(today, "yyyy-MM-dd");
  const pendingStartIso = pendingStart ? format(pendingStart, "yyyy-MM-dd") : null;
  const selected = pendingStart ? { from: pendingStart } : specialDayDateRange(value);

  const selectRange = (range: DateRange | undefined) => {
    if (!range?.from) return;
    const from = startOfDay(range.from);
    const to = range.to ? startOfDay(range.to) : undefined;
    const startDate = format(from, "yyyy-MM-dd");

    if (to && to > from) {
      onChange({
        ...value,
        date: startDate,
        dateMode: "range",
        startDate,
        endDate: format(to, "yyyy-MM-dd"),
        closed: true,
      });
      setPendingStart(null);
      setOpen(false);
      return;
    }

    onChange({
      ...value,
      date: startDate,
      dateMode: "single",
      startDate,
      endDate: startDate,
    });
    setPendingStart(from);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setPendingStart(null);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative flex h-10 w-full cursor-pointer items-center rounded-lg border border-border bg-bg-elevated pl-9 pr-3 text-left outline-none transition-colors hover:border-gold/30 focus-visible:ring-2 focus-visible:ring-gold/40",
            className,
          )}
        >
          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
          <span className={cn("truncate text-xs leading-none", specialDayStart(value) ? "text-text-primary" : "text-text-muted")}>
            {specialDayStart(value) ? formatSpecialDayRange(value) : placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="z-[60] w-auto border-border bg-bg-elevated p-2 text-text-primary shadow-2xl">
        <Calendar
          mode="range"
          required={false}
          showOutsideDays={false}
          selected={selected}
          onSelect={selectRange}
          disabled={(date) => {
            const iso = format(date, "yyyy-MM-dd");
            if (iso < todayIso) return true;
            return pendingStartIso ? iso <= pendingStartIso : false;
          }}
          classNames={{
            day: "group/day relative flex-1 p-0 text-center select-none",
            day_button: "relative isolate z-10 flex size-9 min-w-9 items-center justify-center rounded-md border-0 leading-none font-normal text-text-secondary hover:bg-gold/10 hover:text-white disabled:pointer-events-none disabled:opacity-30 data-[range-start=true]:bg-gold data-[range-start=true]:font-semibold data-[range-start=true]:text-black data-[range-middle=true]:bg-gold/15 data-[range-middle=true]:text-white data-[range-end=true]:bg-gold data-[range-end=true]:font-semibold data-[range-end=true]:text-black data-[selected-single=true]:bg-gold data-[selected-single=true]:font-semibold data-[selected-single=true]:text-black",
            range_start: "rounded-l-md bg-gold/15",
            range_middle: "rounded-none bg-gold/15",
            range_end: "rounded-r-md bg-gold/15",
            hidden: "invisible pointer-events-none",
            outside: "invisible pointer-events-none",
            disabled: "text-text-muted opacity-25",
            today: "text-white",
          }}
          className="rounded-md border-0 bg-transparent"
        />
      </PopoverContent>
    </Popover>
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

// Cenaiva plan is a single tier: $199.99 CAD/month with a 90-day free trial.
// In addition, $1 per confirmed reservation (billed via Stripe invoice items
// on the restaurant's subscription). Diners pay our 5.5% platform fee plus
// Stripe processing on top of every deposit and pre-order at checkout, so
// the restaurant's Connect account receives 100% of the deposit/order base —
// nothing is deducted from what the diner promised to pay.
const PLAN_PRICE_CENTS = 19999;
const PLAN_CURRENCY = "CAD";
const PLAN_USAGE_FEES = [
  "$1 per confirmed reservation",
  "5.5% diner-paid platform fee on pre-orders (you keep 100% of base)",
  "5.5% diner-paid platform fee on deposits (you keep 100% of base)",
];

type BillingSummary = {
  subscription_status: string | null;
  trial_ends_at: string | null;
  stripe_customer_id: string | null;
  stripe_charges_enabled: boolean | null;
  currency: string;
};

type StripeInvoice = {
  id: string;
  number: string | null;
  status: string | null;
  amount_due_cents: number;
  amount_paid_cents: number;
  currency: string;
  created_iso: string;
  period_end_iso: string | null;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
};

type BillingPortalFlow = "default" | "payment_method_update" | "subscription_cancel";

function formatInvoiceAmount(cents: number, currency: string): string {
  const value = cents / 100;
  try {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: currency.toUpperCase(),
      currencyDisplay: "narrowSymbol",
    }).format(value);
  } catch {
    return `${currency.toUpperCase()} $${value.toFixed(2)}`;
  }
}

function formatInvoiceDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return null;
  const diffMs = target - Date.now();
  return Math.ceil(diffMs / 86_400_000);
}

const SUBSCRIPTION_STATUS_LABEL: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  trialing: { label: "Free trial", tone: "ok" },
  active: { label: "Active", tone: "ok" },
  past_due: { label: "Past due", tone: "warn" },
  unpaid: { label: "Unpaid", tone: "bad" },
  incomplete: { label: "Setup incomplete", tone: "warn" },
  incomplete_expired: { label: "Setup expired", tone: "bad" },
  canceled: { label: "Cancelled", tone: "muted" },
  paused: { label: "Paused", tone: "warn" },
};

async function invokeBillingEdgeFunction<TResult>(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: TResult } | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase is not configured." };
  }
  const client = getSupabaseBrowserClient();
  const { data: sessionData } = await client.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { ok: false, error: "You need to be signed in." };
  const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: getSupabaseAnonKey(),
    },
    body: JSON.stringify(body),
  });
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const errMsg =
      parsed && typeof parsed === "object" && parsed !== null && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `Request failed (${res.status})`;
    return { ok: false, error: errMsg };
  }
  return { ok: true, data: parsed as TResult };
}

// Two locked rows backed by real send paths in
// `_shared/owner-notifications.ts` (`notifyOwnerNewReservation` /
// `notifyOwnerCancellation`). Each `id` maps 1:1 to the JSON key on
// `user_profiles.notification_preferences_json` that gates the send.
// Default-on means a fresh owner sees both toggles checked AND the
// edge fn treats a missing key as opted-in — adding new toggles
// later won't silently disable them for existing rows.
type NotificationToggleId = keyof NotificationPreferences;
const NOTIFICATION_GROUPS: Array<{
  title: string;
  rows: Array<{ id: NotificationToggleId; label: string; desc: string }>;
}> = [
  {
    title: "Reservations",
    rows: [
      { id: "new_reservation_email", label: "New reservation", desc: "Email when a diner books a table." },
      { id: "cancellation_email", label: "Cancellations", desc: "Email when a diner cancels their booking." },
    ],
  },
];

// ─── Page ────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { t } = useTranslation();
  const { pathname, hash } = useLocation();
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
  const [addressLat, setAddressLat] = useState<number | null>(null);
  const [addressLng, setAddressLng] = useState<number | null>(null);
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
  const restaurantSeatTotal = useRestaurantSeatTotal(selectedRestaurant?.id ?? null);
  const [savingRestaurant, setSavingRestaurant] = useState(false);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState("");
  const [deletingRestaurant, setDeletingRestaurant] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
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
  const [specialDetailsId, setSpecialDetailsId] = useState<string | null>(null);
  const [savingHours, setSavingHours] = useState(false);

  // Billing — driven by real Stripe subscription state, not the legacy
  // `restaurants.plan` text column.
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [invoices, setInvoices] = useState<StripeInvoice[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [invoicesStripeError, setInvoicesStripeError] = useState<string | null>(null);
  // Bumped to force a re-fetch of the Stripe invoice list. Used by the
  // "Could not reach Stripe right now — [Retry]" banner.
  const [invoicesRefreshKey, setInvoicesRefreshKey] = useState(0);
  const [portalLoading, setPortalLoading] = useState<BillingPortalFlow | null>(null);
  // In-page "Change card" panel (replaces the Stripe billing-portal redirect
  // for payment-method updates). Falls back to the portal redirect if
  // VITE_STRIPE_PUBLISHABLE_KEY is missing.
  const [showChangeCard, setShowChangeCard] = useState(false);
  // Bumped after a successful card-swap so the CardOnFileBadge refetches.
  const [cardRefreshKey, setCardRefreshKey] = useState(0);

  // Hash-anchor opener: when the user lands on /dashboard/settings#change-card
  // (e.g. from the past-due "Update card →" link on the BillingStatusPill),
  // auto-open the change-card panel and scroll it into view.
  useEffect(() => {
    if (hash !== "#change-card") return;
    setSettingsSection("billing");
    setShowChangeCard(true);
    // Wait one frame so the panel mounts before scrolling.
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById("change-card");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(raf);
  }, [hash]);

  // Theme
  const existingTheme = selectedRestaurant?.settings_json?.theme;
  const [primaryColor, setPrimaryColor] = useState(existingTheme?.primaryColor ?? "#C9A84C");
  const [accentColor, setAccentColor] = useState(existingTheme?.accentColor ?? "#22C55E");
  const [backgroundColor, setBackgroundColor] = useState(existingTheme?.backgroundColor ?? "#0A0A0A");
  const [savingTheme, setSavingTheme] = useState(false);

  // Notifications local state. Source-of-truth lives on
  // `user_profiles.notification_preferences_json` for the signed-in
  // owner. Missing keys are treated as "on" so a brand-new owner
  // sees both toggles checked. On toggle change we optimistically
  // update local state and persist via Supabase; the silent
  // refreshUser() (from auth-context) refreshes the profile without
  // unmounting the page.
  const { profile, refreshUser } = useUser();
  const profileId = profile?.id ?? null;
  const [notifPrefs, setNotifPrefs] = useState<Record<NotificationToggleId, boolean>>({
    new_reservation_email: true,
    cancellation_email: true,
  });
  const [savingPref, setSavingPref] = useState<NotificationToggleId | null>(null);

  useEffect(() => {
    const saved = profile?.notification_preferences_json ?? null;
    setNotifPrefs({
      new_reservation_email: saved?.new_reservation_email !== false,
      cancellation_email: saved?.cancellation_email !== false,
    });
  }, [profile?.notification_preferences_json]);

  const setNotificationPref = async (id: NotificationToggleId, value: boolean) => {
    // Optimistic UI — flip the switch immediately; revert on error.
    const previous = notifPrefs[id];
    setNotifPrefs((p) => ({ ...p, [id]: value }));
    if (!profileId || !isSupabaseConfigured()) return;
    setSavingPref(id);
    try {
      const client = getSupabaseBrowserClient();
      const merged: NotificationPreferences = {
        ...(profile?.notification_preferences_json ?? {}),
        [id]: value,
      };
      const { error } = await client
        .from("user_profiles")
        .update({ notification_preferences_json: merged })
        .eq("id", profileId);
      if (error) {
        setNotifPrefs((p) => ({ ...p, [id]: previous }));
        toast.error("Couldn't save that preference. Try again.");
        return;
      }
      // Silent refresh — auth-context's refreshUser() updates the
      // profile without flipping `loading=true` (which would unmount
      // this page). The toggle UI is already up-to-date from the
      // optimistic flip; this just keeps profile in sync for the
      // rest of the app.
      void refreshUser();
    } finally {
      setSavingPref(null);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset editable form fields when switching restaurants
    setRestaurantName(selectedRestaurant?.name ?? "");
    setCuisine("");
    setContactEmail(selectedRestaurant?.email ?? "");
    setCity(selectedRestaurant?.city ?? "");
    setProvince(selectedRestaurant?.province ?? "");
    setCountry(selectedRestaurant?.country ?? "");
    setAddressLat(selectedRestaurant?.lat ?? null);
    setAddressLng(selectedRestaurant?.lng ?? null);
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
  }, [selectedRestaurant?.id, selectedRestaurant?.name, selectedRestaurant?.logo_url, selectedRestaurant?.cover_photo_url, selectedRestaurant?.email, selectedRestaurant?.city, selectedRestaurant?.province, selectedRestaurant?.country, selectedRestaurant?.lat, selectedRestaurant?.lng, selectedRestaurant?.business_type, selectedRestaurant?.currency, selectedRestaurant?.settings_json, selectedRestaurant?.accepts_walkins]);

  useEffect(() => () => revokeDraftUrl(logoDraftPreviewUrl), [logoDraftPreviewUrl]);
  useEffect(() => () => revokeDraftUrl(coverDraftPreviewUrl), [coverDraftPreviewUrl]);

  useEffect(() => {
    if (!selectedRestaurant?.id || !isSupabaseConfigured()) return;
    const client = getSupabaseBrowserClient();
    void client
      .from("restaurants")
        .select("cuisine_type, address, email, phone, city, province, country, lat, lng, business_type, description, hours_json, accepts_walkins, settings_json")
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
        const latValue = typeof data.lat === "number" ? data.lat : null;
        const lngValue = typeof data.lng === "number" ? data.lng : null;
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
        setAddressLat(latValue);
        setAddressLng(lngValue);
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
          lat: latValue,
          lng: lngValue,
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
      });
  }, [
    selectedRestaurant?.id,
    selectedRestaurant?.name,
    selectedRestaurant?.currency,
    selectedRestaurant?.accepts_walkins,
  ]);

  // Billing summary + invoice list. The summary comes from `restaurants`
  // (kept in sync by the stripe-webhook on every account/subscription event);
  // invoices come from a live Stripe call so we don't have to mirror them in
  // our own DB.
  useEffect(() => {
    const restaurantId = selectedRestaurant?.id ?? null;
    if (!restaurantId || !isSupabaseConfigured()) {
      setBillingSummary(null);
      setInvoices([]);
      return;
    }
    let cancelled = false;
    setBillingLoading(true);
    const client = getSupabaseBrowserClient();
    void (async () => {
      try {
        const { data } = await client
          .from("restaurants")
          .select(
            "subscription_status, trial_ends_at, stripe_customer_id, stripe_charges_enabled, currency",
          )
          .eq("id", restaurantId)
          .single();
        if (cancelled) return;
        if (data) {
          const row = data as {
            subscription_status: string | null;
            trial_ends_at: string | null;
            stripe_customer_id: string | null;
            stripe_charges_enabled: boolean | null;
            currency: string | null;
          };
          setBillingSummary({
            subscription_status: row.subscription_status,
            trial_ends_at: row.trial_ends_at,
            stripe_customer_id: row.stripe_customer_id,
            stripe_charges_enabled: row.stripe_charges_enabled,
            currency: row.currency ?? "cad",
          });
        }
        setInvoicesLoading(true);
        setInvoicesStripeError(null);
        const result = await invokeBillingEdgeFunction<{
          invoices: StripeInvoice[];
          has_more: boolean;
          stripe_error?: string;
        }>("list-stripe-invoices", { restaurant_id: restaurantId, limit: 12 });
        if (cancelled) return;
        if (result.ok) {
          setInvoices(result.data.invoices);
          setInvoicesStripeError(result.data.stripe_error ?? null);
        } else {
          setInvoices([]);
          // Bubble the edge-fn error string up so the user sees something
          // actionable ("Retry") rather than silent emptiness.
          setInvoicesStripeError(result.error);
        }
      } finally {
        if (!cancelled) {
          setBillingLoading(false);
          setInvoicesLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedRestaurant?.id, invoicesRefreshKey]);

  const openBillingPortal = async (flow: BillingPortalFlow): Promise<void> => {
    if (!selectedRestaurant?.id) return;
    if (portalLoading) return;
    setPortalLoading(flow);
    try {
      const result = await invokeBillingEdgeFunction<{ url: string }>(
        "create-billing-portal-session",
        {
          restaurant_id: selectedRestaurant.id,
          flow,
          return_url: `${window.location.origin}/dashboard/settings`,
        },
      );
      if (!result.ok) {
        toast.error(result.error || "Couldn't open the billing portal. Try again in a moment.");
        return;
      }
      window.location.href = result.data.url;
    } finally {
      setPortalLoading(null);
    }
  };

  const subscriptionLabel = billingSummary?.subscription_status
    ? SUBSCRIPTION_STATUS_LABEL[billingSummary.subscription_status] ?? {
        label: billingSummary.subscription_status,
        tone: "muted" as const,
      }
    : { label: "Not set up", tone: "muted" as const };
  const trialDaysLeft = daysUntil(billingSummary?.trial_ends_at ?? null);
  const hasSubscription = Boolean(billingSummary?.stripe_customer_id);

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
      restaurantInitial.lat !== addressLat ||
      restaurantInitial.lng !== addressLng ||
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
  }, [restaurantInitial, restaurantName, cuisine, address, contactEmail, phone, city, province, country, addressLat, addressLng, businessType, legalName, websiteUrl, instagramUrl, facebookUrl, description, currency, acceptsWalkins, dietaryTags, turnTimeMinutes]);

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
      const friendly = error ? toUserFacingError(error) : null;
      toast.error(data?.error ?? friendly?.message ?? t("dashboard.settings.deleteRestaurantFailed"));
      return;
    }

    toast.success(t("dashboard.settings.deleteRestaurantSuccess"));
    setDeleteConfirmationName("");
    setDeleteDialogOpen(false);
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
        lat: addressLat,
        lng: addressLng,
        business_type: businessType || null,
        description: description.trim().slice(0, RESTAURANT_DESCRIPTION_MAX_LENGTH) || null,
        currency,
        accepts_walkins: acceptsWalkins,
        settings_json: updatedSettings,
        ...mediaUpdates,
      })
      .eq("id", selectedRestaurant.id);
    if (!error && normalizedTurnTime != null) {
      // Sync turn time to every active shift so booking RPCs that read
      // shift.turn_time_minutes directly stay aligned with the dashboard.
      // Without this, settings_json.turnTimeMinutes would drift from
      // shifts.turn_time_minutes (caught at Georgy Inc lunch on 2026-05-10).
      await client
        .from("shifts")
        .update({ turn_time_minutes: normalizedTurnTime })
        .eq("restaurant_id", selectedRestaurant.id)
        .eq("is_active", true);
    }
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
      lat: addressLat,
      lng: addressLng,
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
    if (!assertImageSizeOk(file)) return null;

    const client = getSupabaseBrowserClient();
    const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
    const path = `${selectedRestaurant.id}/restaurant/${kind}/${crypto.randomUUID()}-${safeName}`;
    const { error } = await client.storage
      .from("event-media")
      .upload(path, file, { cacheControl: "3600", contentType: image.mime, upsert: false });

    if (error) {
      showErrorToast(error, {
        fallback: "Couldn't upload that image. Try a smaller file or a different format.",
        logTag: "[SettingsPage.uploadRestaurantMediaFile]",
      });
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
    setAddressLat(restaurantInitial.lat);
    setAddressLng(restaurantInitial.lng);
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

  const [draftSpecialDay, setDraftSpecialDay] = useState<RestaurantSpecialDay | null>(null);

  const activeSpecialDay = draftSpecialDay
    ?? (specialDetailsId
      ? specialDays.find((day) => day.id === specialDetailsId) ?? null
      : null);

  const addSpecialDay = () => {
    setDraftSpecialDay(createSpecialDay());
    setSpecialDetailsId(null);
  };

  const updateSpecialDay = (id: string, patch: Partial<RestaurantSpecialDay>) => {
    if (draftSpecialDay?.id === id) {
      setDraftSpecialDay({ ...draftSpecialDay, ...patch });
      return;
    }
    setSpecialDays((days) => days.map((day) => (day.id === id ? { ...day, ...patch } : day)));
  };

  const replaceSpecialDay = (id: string, nextDay: RestaurantSpecialDay) => {
    if (draftSpecialDay?.id === id) {
      setDraftSpecialDay(nextDay);
    } else {
      setSpecialDays((days) => days.map((day) => (day.id === id ? nextDay : day)));
    }
  };

  const closeSpecialDayDialog = () => {
    setDraftSpecialDay(null);
    setSpecialDetailsId(null);
  };

  const commitSpecialDayDialog = () => {
    if (draftSpecialDay) {
      const start = specialDayStart(draftSpecialDay);
      const end = specialDayEnd(draftSpecialDay);
      if (!start || !end || (draftSpecialDay.dateMode === "range" ? end <= start : end < start)) {
        toast.error("Choose a valid start and end date for this closure or holiday.");
        return;
      }
      setSpecialDays((days) => [...days, draftSpecialDay]);
    }
    closeSpecialDayDialog();
  };

  const saveHours = async () => {
    if (!selectedRestaurant) return;
    if (!isSupabaseConfigured()) { toast.error(t("auth.errors.supabaseNotConfigured")); return; }
    const invalidSpecialDay = specialDays.find((day) => {
      const start = specialDayStart(day);
      const end = specialDayEnd(day);
      return !start || !end || (day.dateMode === "range" ? end <= start : end < start);
    });
    if (invalidSpecialDay) {
      setSpecialDetailsId(invalidSpecialDay.id);
      toast.error("Choose a valid start and end date for each closure or holiday.");
      return;
    }
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
        max_covers: templateShift?.max_covers ?? null,
        turn_time_minutes: normalizedTurnTime ?? templateShift?.turn_time_minutes ?? DEFAULT_TURN_TIME_MINUTES,
        min_party_size: templateShift?.min_party_size ?? 1,
        max_party_size: templateShift?.max_party_size ?? 20,
        advance_booking_days: templateShift?.advance_booking_days ?? 3650,
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
              <SectionHeading title="Restaurant identity" subtitle="How Cenaiva and your guests see you." />
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
                  <div className="flex flex-col gap-2">
                    <GoogleAddressAutocompleteInput
                      value={address}
                      onChange={(value) => {
                        setAddress(value);
                        setCity("");
                        setProvince("");
                        setCountry("");
                        setAddressLat(null);
                        setAddressLng(null);
                      }}
                      onAddressSelected={(parts) => {
                        setAddress(parts.address || address);
                        setCity(parts.city ?? "");
                        setProvince(parts.province ?? "");
                        setCountry(parts.country ?? "");
                        setAddressLat(parts.lat);
                        setAddressLng(parts.lng);
                      }}
                      placeholder="142 Yorkville Ave, Toronto, ON M5R 1C2"
                    />
                    {(city || province || country) ? (
                      <div className="flex flex-wrap gap-1.5">
                        {[city, province, country].filter(Boolean).map((part) => (
                          <span
                            key={part}
                            className="inline-flex items-center rounded-full border border-border bg-bg-elevated px-2.5 py-0.5 font-mono text-[11px] text-text-secondary"
                          >
                            {part}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="font-mono text-[11px] text-text-muted">
                        Pick from suggestions to auto-fill city, province, and country.
                      </p>
                    )}
                  </div>
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
                  <PhoneInput value={phone} onChange={setPhone} />
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
                  label="Seat capacity"
                  hint="Sum of every active table's capacity. The booking flow caps party size at the smaller of this number and any per-shift max-covers limit. To allow whole-restaurant bookings, raise per-shift max-covers to match this number."
                >
                  <div className="flex max-w-sm flex-col gap-2">
                    <div className="rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-white">
                      {restaurantSeatTotal == null
                        ? "Loading…"
                        : `${restaurantSeatTotal.toLocaleString()} seat${restaurantSeatTotal === 1 ? "" : "s"}`}
                    </div>
                    {restaurantSeatTotal === 0 ? (
                      <p className="text-xs text-warning">
                        No active tables yet. Add tables on the Floor Plan page so customers can book.
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
              <DepositPolicyEditor
                restaurantId={selectedRestaurant?.id ?? null}
                initialTiers={selectedRestaurant?.deposit_tiers ?? null}
                ceilingHint={restaurantSeatTotal}
                onSaved={() => refreshRestaurants()}
              />
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
                    onClick={addSpecialDay}
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
                  {specialDays.map((sd) => {
                    const usesRange = specialDayUsesRange(sd);
                    const closedForDisplay = usesRange || sd.closed;
                    return (
                      <div
                        key={sd.id}
                        className="relative flex flex-col gap-3 rounded-lg bg-bg-elevated/40 px-4 py-3 sm:flex-row sm:items-start"
                      >
                        <span className={cn("absolute inset-y-2 left-0 w-[3px] rounded-r", closedForDisplay ? "bg-danger" : "bg-warning")} />
                        <div className="min-w-0 flex-1 pl-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <SpecialDateRangeField
                              value={sd}
                              onChange={(nextDay) => replaceSpecialDay(sd.id, nextDay)}
                              placeholder="Select dates"
                              className="w-full sm:w-[260px]"
                            />
                            <span className={cn(
                              "rounded-full px-2 py-1 text-[11px] font-medium",
                              closedForDisplay ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning",
                            )}>
                              {closedForDisplay ? "Closed" : "Custom hours"}
                            </span>
                          </div>
                          <div className="mt-2 min-w-0">
                            <p className="truncate text-sm font-medium text-text-primary">
                              {sd.label.trim() || (closedForDisplay ? "Closure or holiday" : "Hours exception")}
                            </p>
                            <p className="mt-0.5 text-xs text-text-muted">{formatSpecialDayRange(sd)}</p>
                            {sd.description.trim() && (
                              <p className="mt-1 line-clamp-2 text-xs text-text-muted">{sd.description.trim()}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 sm:pl-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1.5 text-xs"
                            onClick={() => setSpecialDetailsId(sd.id)}
                          >
                            <Pencil className="size-3.5" />
                            Details
                          </Button>
                          <button
                            type="button"
                            onClick={() => {
                              setSpecialDays((days) => days.filter((day) => day.id !== sd.id));
                              if (specialDetailsId === sd.id) setSpecialDetailsId(null);
                            }}
                            className="text-text-muted transition-colors hover:text-danger"
                            aria-label="Remove closure"
                          >
                            <X className="size-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>

              <Dialog open={Boolean(activeSpecialDay)} onOpenChange={(open) => { if (!open) closeSpecialDayDialog(); }}>
                <DialogContent
                  className="max-w-xl border-gold/30 bg-bg-surface p-0 text-text-primary"
                  showCloseButton={false}
                  onPointerDownOutside={(event) => {
                    const target = event.target as Element | null;
                    if (target?.closest('[data-slot="popover-content"], [data-radix-popper-content-wrapper]')) {
                      event.preventDefault();
                    }
                  }}
                  onInteractOutside={(event) => {
                    const target = event.target as Element | null;
                    if (target?.closest('[data-slot="popover-content"], [data-radix-popper-content-wrapper]')) {
                      event.preventDefault();
                    }
                  }}
                >
                  <DialogHeader className="border-b border-border px-6 py-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold">Calendar exception</p>
                        <DialogTitle className="mt-2 font-serif text-2xl font-normal text-white">
                          Name and description
                        </DialogTitle>
                      </div>
                      <button type="button" className="text-text-muted hover:text-white" onClick={closeSpecialDayDialog}>
                        <X className="size-5" />
                      </button>
                    </div>
                  </DialogHeader>
                  {activeSpecialDay && (() => {
                    const usesRange = specialDayUsesRange(activeSpecialDay);
                    return (
                      <div className="space-y-5 px-6 py-5">
                        <div>
                          <p className="text-xs font-medium text-text-secondary">Dates</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <SpecialDateRangeField
                              value={activeSpecialDay}
                              onChange={(nextDay) => replaceSpecialDay(activeSpecialDay.id, nextDay)}
                              placeholder="Select dates"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-text-secondary" htmlFor="special-day-name">
                            Name
                          </label>
                          <Input
                            id="special-day-name"
                            value={activeSpecialDay.label}
                            onChange={(event) => updateSpecialDay(activeSpecialDay.id, { label: event.target.value })}
                            placeholder="Renovations, Christmas, private buyout"
                            className="mt-2"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-text-secondary" htmlFor="special-day-description">
                            Description
                          </label>
                          <Textarea
                            id="special-day-description"
                            value={activeSpecialDay.description}
                            onChange={(event) => updateSpecialDay(activeSpecialDay.id, { description: event.target.value })}
                            placeholder="Optional internal note"
                            className="mt-2 min-h-24"
                          />
                        </div>
                        {usesRange ? (
                          <div className="rounded-lg border border-danger/25 bg-danger/10 px-4 py-3">
                            <p className="text-sm font-medium text-danger">Closed for full date range</p>
                            <p className="mt-0.5 text-xs text-text-muted">{formatSpecialDayRange(activeSpecialDay)}</p>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-bg-elevated/40 px-4 py-3">
                              <div>
                                <p className="text-sm font-medium text-text-primary">Closed all day</p>
                                <p className="mt-0.5 text-xs text-text-muted">{formatSpecialDayRange(activeSpecialDay)}</p>
                              </div>
                              <Switch
                                checked={activeSpecialDay.closed}
                                onCheckedChange={(closed) => updateSpecialDay(activeSpecialDay.id, { closed })}
                              />
                            </div>
                            {!activeSpecialDay.closed && (
                              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg-elevated/40 px-4 py-3">
                                <span className="text-xs font-medium text-text-secondary">Custom hours</span>
                                <DashboardTimeWheelPicker
                                  value={activeSpecialDay.from}
                                  onChange={(from) => updateSpecialDay(activeSpecialDay.id, { from })}
                                  valueFormat="12h"
                                  ariaLabel="Exception opening time"
                                  helperLabel="Opening time"
                                  doneLabel="Done"
                                />
                                <span className="text-xs text-text-muted">to</span>
                                <DashboardTimeWheelPicker
                                  value={activeSpecialDay.to}
                                  onChange={(to) => updateSpecialDay(activeSpecialDay.id, { to })}
                                  valueFormat="12h"
                                  ariaLabel="Exception closing time"
                                  helperLabel="Closing time"
                                  doneLabel="Done"
                                />
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })()}
                  <DialogFooter className="border-t border-border bg-bg-surface px-6 py-4">
                    <Button type="button" onClick={commitSpecialDayDialog}>Done</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <div className="flex justify-end">
                <Button disabled={savingHours || !selectedRestaurant} onClick={() => void saveHours()}>
                  {savingHours ? t("routes.loading") : "Save changes"}
                </Button>
              </div>
            </div>
          )}

          {section === "danger" && (
            <div className="flex flex-col gap-6">
              <SectionHeading
                title="Danger zone"
                subtitle="Permanent actions that affect this entire restaurant."
              />
              <Card>
                <div className="grid gap-5 px-6 py-6 sm:grid-cols-[minmax(0,1fr)_minmax(220px,300px)] sm:px-7">
                  <div>
                    <p className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-danger">
                      <Trash2 className="size-3.5" />
                      {t("dashboard.settings.dangerZone")}
                    </p>
                    <h3 className="mt-2 font-serif text-xl text-white">
                      {t("dashboard.settings.deleteRestaurant")}
                    </h3>
                    <p className="mt-2 max-w-2xl text-sm text-text-muted">
                      Soft-deletes this restaurant and starts a 30-day grace period
                      during which you can restore it from this page.
                    </p>
                  </div>
                  <div className="flex items-start justify-end">
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={!selectedRestaurant}
                      onClick={() => {
                        setDeleteConfirmationName("");
                        setDeleteDialogOpen(true);
                      }}
                    >
                      {t("dashboard.settings.deleteRestaurantAction")}
                    </Button>
                  </div>
                </div>
              </Card>

              <Dialog
                open={deleteDialogOpen}
                onOpenChange={(open) => {
                  if (deletingRestaurant) return;
                  setDeleteDialogOpen(open);
                  if (!open) setDeleteConfirmationName("");
                }}
              >
                <DialogContent className="max-w-lg gap-0 overflow-hidden border-border bg-bg-base p-0">
                  <DialogHeader className="px-6 pt-6">
                    <DialogTitle className="flex items-center gap-2 font-serif text-xl text-white">
                      <Trash2 className="size-5 text-danger" />
                      Delete {selectedRestaurant?.name ?? "this restaurant"}?
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 px-6 py-5 text-sm text-text-secondary">
                    <p>
                      Your subscription will continue through your current billing
                      period — you'll be billed once more for the time you've already
                      used, but never again after that.
                    </p>
                    <p>
                      Your restaurant will be{" "}
                      <span className="font-semibold text-white">
                        hidden from diners immediately
                      </span>
                      . Existing reservations stay valid — diners can still cancel
                      them.
                    </p>
                    <p>
                      You have{" "}
                      <span className="font-semibold text-white">
                        30 days to restore
                      </span>{" "}
                      this restaurant before all data is anonymized.
                    </p>
                    <div className="space-y-2 rounded-2xl border border-danger/30 bg-danger/5 p-4">
                      <label
                        className="block text-xs font-medium text-text-secondary"
                        htmlFor="delete-restaurant-confirmation"
                      >
                        {t("dashboard.settings.deleteRestaurantConfirmLabel", {
                          name: selectedRestaurant?.name ?? "",
                        })}
                      </label>
                      <Input
                        id="delete-restaurant-confirmation"
                        value={deleteConfirmationName}
                        onChange={(event) =>
                          setDeleteConfirmationName(event.target.value)
                        }
                        placeholder={selectedRestaurant?.name ?? ""}
                        disabled={deletingRestaurant || !selectedRestaurant}
                      />
                    </div>
                  </div>
                  <DialogFooter className="border-t border-border bg-bg-surface px-6 py-4">
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={deletingRestaurant}
                      onClick={() => {
                        setDeleteDialogOpen(false);
                        setDeleteConfirmationName("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={
                        !deleteConfirmationMatches
                        || deletingRestaurant
                        || !selectedRestaurant
                      }
                      onClick={() => void deleteRestaurant()}
                    >
                      {deletingRestaurant
                        ? t("routes.loading")
                        : t("dashboard.settings.deleteRestaurantAction")}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}

          {section === "billing" && (
            <div className="flex flex-col gap-6">
              <SectionHeading title="Billing" subtitle="Your Cenaiva subscription and invoices." />
              {!hasSubscription && !billingLoading && (
                <Card>
                  <div className="flex items-start gap-4 px-6 py-5 sm:px-7">
                    <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary">
                        Subscription not started yet
                      </p>
                      <p className="mt-1 text-xs text-text-muted">
                        Finish payment setup in the restaurant onboarding to activate billing. Your
                        first 90 days are free — your card won't be charged until the trial ends.
                      </p>
                      <Button
                        size="sm"
                        className="mt-3"
                        onClick={() => navigate("/setup")}
                      >
                        Open setup
                      </Button>
                    </div>
                  </div>
                </Card>
              )}

              <Card>
                <div className="flex flex-col gap-6 px-6 py-7 sm:flex-row sm:items-start sm:justify-between sm:px-7">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold">Current plan</p>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em]",
                          subscriptionLabel.tone === "ok"
                            && "border border-success/30 bg-success/10 text-success",
                          subscriptionLabel.tone === "warn"
                            && "border border-amber-400/30 bg-amber-400/10 text-amber-300",
                          subscriptionLabel.tone === "bad"
                            && "border border-destructive/30 bg-destructive/10 text-destructive",
                          subscriptionLabel.tone === "muted"
                            && "border border-border bg-bg-base text-text-muted",
                        )}
                      >
                        {subscriptionLabel.label}
                      </span>
                    </div>
                    <h3 className="mt-2 font-serif text-3xl text-white">Cenaiva · Standard</h3>
                    <p className="mt-1 text-sm text-text-muted">
                      Everything you need to run your restaurant on Cenaiva.
                    </p>
                    <p className="mt-6">
                      <span className="font-serif text-4xl text-white">
                        {formatInvoiceAmount(PLAN_PRICE_CENTS, PLAN_CURRENCY)}
                      </span>
                      <span className="ml-2 text-sm text-text-muted">/month, billed monthly</span>
                    </p>
                    {billingSummary?.subscription_status === "trialing"
                      && typeof trialDaysLeft === "number"
                      && trialDaysLeft > 0 && (
                        <p className="mt-2 text-xs text-success">
                          Free trial: {trialDaysLeft} {trialDaysLeft === 1 ? "day" : "days"} left
                          {billingSummary.trial_ends_at && (
                            <>
                              {" "}· first invoice {formatInvoiceDate(billingSummary.trial_ends_at)}
                            </>
                          )}
                        </p>
                      )}
                    {billingSummary?.subscription_status === "past_due" && (
                      <p className="mt-2 text-xs text-amber-300">
                        We couldn't charge your card on the last invoice. Update your payment method
                        below to keep your restaurant published.
                      </p>
                    )}
                    {billingSummary?.subscription_status === "canceled" && (
                      <p className="mt-2 text-xs text-text-muted">
                        Your subscription is cancelled. Your restaurant has been unpublished.
                      </p>
                    )}
                  </div>
                  <div className="text-sm text-text-secondary">
                    <div className="rounded-lg border border-border/60 bg-bg-base/60 px-3 py-2.5">
                      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">
                        Usage fees (on top)
                      </p>
                      <ul className="mt-1 space-y-0.5 text-xs text-text-muted">
                        {PLAN_USAGE_FEES.map((fee) => (
                          <li key={fee}>· {fee}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
                {/* Card-on-file badge — shows the brand + last4 of the
                    PaymentMethod backing the active subscription so owners
                    can verify which card is on file before swapping. */}
                {selectedRestaurant?.id && hasSubscription ? (
                  <div className="border-t border-border/50 px-6 py-3 sm:px-7">
                    <CardOnFileBadge
                      restaurantId={selectedRestaurant.id}
                      refreshKey={cardRefreshKey}
                    />
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 border-t border-border/50 px-6 py-4 sm:px-7">
                  {/* Change card — in-page Stripe Elements form when configured,
                      falls back to the billing-portal redirect otherwise. */}
                  {stripePromise ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!hasSubscription || showChangeCard}
                      onClick={() => setShowChangeCard(true)}
                    >
                      <CreditCard className="mr-1.5 size-3.5" />
                      Change card
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!hasSubscription || portalLoading !== null}
                      onClick={() => void openBillingPortal("payment_method_update")}
                    >
                      {portalLoading === "payment_method_update" ? (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      ) : (
                        <CreditCard className="mr-1.5 size-3.5" />
                      )}
                      Change card
                    </Button>
                  )}
                  {selectedRestaurant ? (
                    <SubscriptionLifecycleControls
                      restaurant={selectedRestaurant}
                      onStateChanged={refreshRestaurants}
                    />
                  ) : null}
                </div>
                {showChangeCard && stripePromise && selectedRestaurant?.id ? (
                  <div id="change-card" className="border-t border-border/50 px-6 py-5 sm:px-7">
                    <ChangeSubscriptionCard
                      restaurantId={selectedRestaurant.id}
                      stripePromiseRef={stripePromise}
                      onSuccess={() => {
                        setShowChangeCard(false);
                        setCardRefreshKey((k) => k + 1);
                        toast.success("Card updated. The new card will be used for your next charge.");
                        refreshRestaurants();
                      }}
                      onCancel={() => setShowChangeCard(false)}
                    />
                  </div>
                ) : null}
              </Card>

              {selectedRestaurant?.id ? (
                <div className="space-y-3 px-6 sm:px-7">
                  <NextBillCard restaurantId={selectedRestaurant.id} />
                  <BillingDetailsForm
                    restaurant={selectedRestaurant}
                    onSaved={refreshRestaurants}
                  />
                </div>
              ) : null}

              <Card>
                <div className="flex items-center justify-between px-6 py-5 sm:px-7">
                  <h3 className="font-serif text-xl text-white">Invoice history</h3>
                  {hasSubscription && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={portalLoading !== null}
                      onClick={() => void openBillingPortal("default")}
                    >
                      View all in Stripe
                    </Button>
                  )}
                </div>
                <div className="divide-y divide-border/50">
                  {invoicesStripeError && !invoicesLoading ? (
                    <div className="flex items-center justify-between gap-3 bg-warning/5 px-6 py-3 text-xs sm:px-7">
                      <span className="flex items-center gap-2 text-warning">
                        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                        Could not reach Stripe right now. Showing cached data.
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() => setInvoicesRefreshKey((k) => k + 1)}
                      >
                        <RefreshCw className="size-3" />
                        Retry
                      </Button>
                    </div>
                  ) : null}
                  {invoicesLoading && (
                    <div className="flex items-center gap-2 px-6 py-5 text-sm text-text-muted sm:px-7">
                      <Loader2 className="size-4 animate-spin" /> Loading invoices…
                    </div>
                  )}
                  {!invoicesLoading && invoices.length === 0 && (
                    <div className="px-6 py-6 text-sm text-text-muted sm:px-7">
                      {hasSubscription
                        ? "No invoices yet. Your first invoice will appear here once your free trial ends."
                        : "No invoices yet — start your subscription to see billing history."}
                    </div>
                  )}
                  {!invoicesLoading
                    && invoices.map((inv) => {
                      const isPaid = inv.status === "paid";
                      const isOpen = inv.status === "open";
                      const isFailed = inv.status === "uncollectible" || inv.status === "void";
                      return (
                        <div
                          key={inv.id}
                          className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-4 px-6 py-4 text-sm sm:px-7"
                        >
                          <span className="font-mono text-text-muted">
                            {formatInvoiceDate(inv.created_iso)}
                          </span>
                          <span className="font-mono text-text-muted">
                            {inv.number ?? inv.id.slice(-8).toUpperCase()}
                          </span>
                          <span className="text-text-primary">
                            {formatInvoiceAmount(
                              isPaid ? inv.amount_paid_cents : inv.amount_due_cents,
                              inv.currency,
                            )}
                          </span>
                          <div className="flex items-center gap-3 justify-self-end">
                            <span
                              className={cn(
                                "text-xs",
                                isPaid && "text-success",
                                isOpen && "text-amber-300",
                                isFailed && "text-destructive",
                                !isPaid && !isOpen && !isFailed && "text-text-muted",
                              )}
                            >
                              {(inv.status ?? "unknown")
                                .replace(/_/g, " ")
                                .replace(/\b\w/g, (c) => c.toUpperCase())}
                            </span>
                            {inv.invoice_pdf ? (
                              <a
                                href={inv.invoice_pdf}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-xs text-text-muted transition-colors hover:text-gold"
                              >
                                PDF
                              </a>
                            ) : (
                              <span className="font-mono text-xs text-text-muted/40">PDF</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </Card>

              {selectedRestaurant?.id ? (
                <div className="px-6 sm:px-7">
                  <PayoutsSection restaurantId={selectedRestaurant.id} />
                </div>
              ) : null}
            </div>
          )}

          {section === "notifications" && (
            <div className="flex flex-col gap-6">
              <SectionHeading title="Notifications" subtitle="Choose which emails you want sent to your inbox." />
              {NOTIFICATION_GROUPS.map((group) => (
                <Card key={group.title}>
                  <div className="px-6 py-5 sm:px-7">
                    <h3 className="font-serif text-xl text-white">{group.title}</h3>
                  </div>
                  {group.rows.map((row) => {
                    const value = notifPrefs[row.id];
                    return (
                      <div key={row.id} className="grid grid-cols-[1fr_auto] items-center gap-4 border-t border-border/50 px-6 py-4 sm:px-7">
                        <div>
                          <p className="text-sm text-text-primary">{row.label}</p>
                          <p className="text-xs text-text-muted">{row.desc}</p>
                        </div>
                        <label className="flex items-center gap-2 text-xs text-text-muted">
                          Email
                          <Switch
                            checked={value}
                            disabled={savingPref === row.id || !profileId}
                            onCheckedChange={(v) => void setNotificationPref(row.id, v)}
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
