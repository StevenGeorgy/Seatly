import { useEffect, useRef, useState, useMemo } from "react";
import { Tag, Plus, Pencil, Trash2, X, CheckCircle2, CalendarDays, Eye, Sparkles, Search, Upload, ImageIcon, FileText } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { format, isValid, parse, startOfToday } from "date-fns";

import { EventPromotionDetailDialog } from "@/components/customer/EventPromotionDetailCard";
import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMenuItems, type MenuItemRow } from "@/hooks/useMenuItems";
import {
  usePromotions,
  getPromotionLabel,
  getPromoTypeBadgeClasses,
  type PromotionRow,
  type CreatePromotionPayload,
  type PromoType,
  type BadgeColor,
  type RecurrenceFrequency,
} from "@/hooks/usePromotions";
import {
  EVENT_MEDIA_ACCEPT,
  EVENT_MEDIA_SUPPORT_MESSAGE,
  resolveEventMedia,
  type EventMediaUpload,
} from "@/hooks/useEvents";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import {
  promotionToDisplay,
  type EventPromotionDisplay,
  type RestaurantDisplayInfo,
} from "@/lib/customer/eventPromotionDisplay";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/formatCurrency";

type FormState = {
  title: string;
  description: string;
  promo_type: PromoType;
  discount_value: string;
  discount_unit: "percent" | "dollar";
  applies_to: "all" | "dine_in";
  min_order_amount: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  promo_code: string;
  max_uses: string;
  badge_color: BadgeColor;
  bogo_item_ids: string[];
  free_item_id: string;
  free_item_name: string;
  eligible_item_ids: string[];
  buy_quantity: string;
  get_quantity: string;
  cover_image_url: string;
  media_url: string;
  media_type: "image" | "pdf" | null;
  media_name: string;
  is_recurring: boolean;
  recurrence_frequency: RecurrenceFrequency;
  recurrence_interval: string;
  recurrence_days: number[];
  recurrence_end_at: string;
};

type PromoPhase = ReturnType<typeof promoStatus> | "recurring";
type PromotionSaveAction = "draft" | "schedule" | "post";

const PROMOTION_TITLE_MAX_LENGTH = 60;
const PROMOTION_DESCRIPTION_MAX_LENGTH = 140;
const WEEKDAY_OPTIONS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
] as const;

const DEFAULT_FORM: FormState = {
  title: "",
  description: "",
  promo_type: "percentage",
  discount_value: "",
  discount_unit: "percent",
  applies_to: "all",
  min_order_amount: "",
  starts_at: new Date().toISOString().slice(0, 10),
  ends_at: "",
  is_active: true,
  promo_code: "",
  max_uses: "",
  badge_color: "amber",
  bogo_item_ids: [],
  free_item_id: "",
  free_item_name: "",
  eligible_item_ids: [],
  buy_quantity: "1",
  get_quantity: "1",
  cover_image_url: "",
  media_url: "",
  media_type: null,
  media_name: "",
  is_recurring: false,
  recurrence_frequency: "weekly",
  recurrence_interval: "1",
  recurrence_days: [],
  recurrence_end_at: "",
};

function promoStatus(p: PromotionRow): "active" | "expired" | "scheduled" | "paused" | "draft" {
  if (!p.is_active) return p.current_uses > 0 ? "paused" : "draft";
  const now = new Date();
  if (new Date(p.starts_at) > now) return "scheduled";
  if (p.ends_at && new Date(p.ends_at) < now) return "expired";
  return "active";
}

const PROMO_STATUS_BADGE: Record<PromoPhase, { label: string; cls: string }> = {
  active: { label: "Active", cls: "border-success/40 bg-success/10 text-success" },
  scheduled: { label: "Scheduled", cls: "border-info/40 bg-info/10 text-info" },
  paused: { label: "Paused", cls: "border-border bg-bg-elevated text-text-muted" },
  draft: { label: "Draft", cls: "border-gold/40 bg-gold/10 text-gold" },
  expired: { label: "Expired", cls: "border-danger/40 bg-danger/10 text-danger" },
  recurring: { label: "Recurring", cls: "border-gold/40 bg-gold/10 text-gold" },
};

function buildRestaurantFallback(restaurant: ReturnType<typeof useRestaurantScope>["selectedRestaurant"]): RestaurantDisplayInfo {
  return {
    name: restaurant?.name ?? "Your restaurant",
    slug: restaurant?.slug ?? null,
    cuisine_type: "Restaurant",
    avg_rating: null,
    cover_photo_url: null,
    city: "Toronto",
    price_range: null,
  };
}

function formToPromotionPreview(
  form: FormState,
  restaurantId: string | null,
  descriptionOverride?: string,
  media?: EventMediaUpload,
): PromotionRow {
  const coverImageUrl = media?.type === "image"
    ? media.url
    : form.cover_image_url.trim() || null;

  return {
    id: "promotion-preview",
    restaurant_id: restaurantId ?? "preview",
    title: form.title.trim() || "New promotion",
    description: descriptionOverride || form.description.trim() || null,
    promo_type: form.promo_type,
    discount_value: form.discount_value ? Number(form.discount_value) : null,
    discount_unit: form.discount_value ? form.discount_unit : null,
    applies_to: form.applies_to,
    min_order_amount: form.min_order_amount ? Number(form.min_order_amount) : null,
    starts_at: new Date(form.starts_at || new Date()).toISOString(),
    ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
    is_active: form.is_active,
    promo_code: form.promo_code.trim() || null,
    max_uses: form.max_uses ? Number(form.max_uses) : null,
    current_uses: 0,
    badge_color: form.badge_color,
    bogo_item_ids: form.bogo_item_ids,
    free_item_id: form.free_item_id || null,
    free_item_name: form.free_item_name || null,
    eligible_item_ids: form.eligible_item_ids,
    buy_quantity: Number(form.buy_quantity) || 1,
    get_quantity: Number(form.get_quantity) || 1,
    cover_image_url: coverImageUrl,
    media_url: (media?.url ?? form.media_url) || null,
    media_type: media?.type ?? form.media_type,
    media_name: (media?.name ?? form.media_name) || null,
    is_recurring: form.is_recurring,
    recurrence_frequency: form.is_recurring ? form.recurrence_frequency : null,
    recurrence_interval: form.is_recurring ? Number(form.recurrence_interval) || 1 : 1,
    recurrence_days: form.is_recurring && form.recurrence_frequency === "weekly" ? form.recurrence_days : [],
    recurrence_end_at: form.is_recurring && form.recurrence_end_at ? new Date(form.recurrence_end_at).toISOString() : null,
    created_at: new Date().toISOString(),
  };
}

function getSelectedMenuItems(items: MenuItemRow[], ids: string[]): MenuItemRow[] {
  const selected = new Set(ids);
  return items.filter((item) => selected.has(item.id));
}

function formatItemScope(items: MenuItemRow[], selectedIds: string[]): string {
  const selected = getSelectedMenuItems(items, selectedIds);
  if (selected.length === 0) return "";
  if (selected.length === items.length) return "everything";
  if (selected.length === 1) return selected[0]?.name ?? "the selected item";
  if (selected.length === 2) return `${selected[0]?.name ?? "Item"} and ${selected[1]?.name ?? "item"}`;
  return `${selected[0]?.name ?? "Item"}, ${selected[1]?.name ?? "item"}, and ${selected.length - 2} more`;
}

function formatDiscountCopy(form: FormState): string {
  const amount = Number(form.discount_value);
  if (form.promo_type === "fixed") {
    return `${formatCurrency(Number.isFinite(amount) ? amount : 0, "cad")} off`;
  }
  return `${Number.isFinite(amount) ? amount : 0}% off`;
}

function formatRecurrenceSummary(
  isRecurring: boolean,
  frequency: RecurrenceFrequency | null,
  interval: number,
  days: number[],
  endAt: string | null,
): string | null {
  if (!isRecurring || !frequency) return null;

  const safeInterval = Math.max(interval || 1, 1);
  const plural = safeInterval === 1 ? "" : "s";
  let summary = "";

  if (frequency === "weekly") {
    const dayLabels = days
      .slice()
      .sort((a, b) => a - b)
      .map((day) => WEEKDAY_OPTIONS.find((option) => option.value === day)?.label)
      .filter(Boolean)
      .join(", ");
    summary = safeInterval === 1
      ? `Repeats every ${dayLabels || "week"}`
      : `Repeats every ${safeInterval} weeks${dayLabels ? ` on ${dayLabels}` : ""}`;
  } else {
    summary = safeInterval === 1
      ? `Repeats every ${frequency === "daily" ? "day" : "month"}`
      : `Repeats every ${safeInterval} ${frequency === "daily" ? "day" : "month"}${plural}`;
  }

  if (!endAt) return summary;
  const parsed = parse(endAt.slice(0, 10), "yyyy-MM-dd", new Date());
  const endLabel = isValid(parsed) ? format(parsed, "MMM d, yyyy") : endAt.slice(0, 10);
  return `${summary} until ${endLabel}`;
}

function getPromotionItemRequirementError(form: FormState): string | null {
  if (form.promo_type === "bogo" && form.bogo_item_ids.length === 0) {
    return "Select at least one item for the BOGO offer.";
  }
  if ((form.promo_type === "percentage" || form.promo_type === "fixed") && form.eligible_item_ids.length === 0) {
    return "Select at least one item this discount applies to. Use Select all if it applies to everything.";
  }
  if (form.promo_type === "free_item" && form.eligible_item_ids.length === 0) {
    return "Select at least one item customers must order.";
  }
  if (form.promo_type === "free_item" && !form.free_item_id) {
    return "Select the free item customers get.";
  }
  if (form.is_recurring && form.recurrence_frequency === "weekly" && form.recurrence_days.length === 0) {
    return "Select at least one day for weekly repeats.";
  }
  return null;
}

function buildPromotionPreviewDescription(form: FormState, items: MenuItemRow[]): string {
  const scope = formatItemScope(items, form.promo_type === "bogo" ? form.bogo_item_ids : form.eligible_item_ids);
  const customDescription = form.description.trim();
  let generated = "";

  if (form.promo_type === "percentage" || form.promo_type === "fixed") {
    generated = `${scope === "everything" ? "Everything" : scope} is ${formatDiscountCopy(form)}.`;
  } else if (form.promo_type === "bogo") {
    generated = `Buy ${Number(form.buy_quantity) || 1} ${scope === "everything" ? "of anything" : `of ${scope}`}, get ${Number(form.get_quantity) || 1} free.`;
  } else if (form.promo_type === "free_item") {
    generated = `Order ${scope === "everything" ? "anything" : scope} and get ${form.free_item_name || "a free item"} free.`;
  }

  return customDescription ? `${generated}\n\n${customDescription}` : generated;
}

function DatePickerButton({
  value,
  onChange,
  placeholder,
  disableBefore,
  anchorDate,
}: {
  value: string;
  onChange: (iso: string) => void;
  placeholder: string;
  disableBefore?: Date;
  anchorDate?: Date;
}) {
  const [open, setOpen] = useState(false);

  const selected = useMemo(() => {
    if (!value) return undefined;
    const d = parse(value, "yyyy-MM-dd", new Date());
    return isValid(d) ? d : undefined;
  }, [value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative flex h-10 w-full cursor-pointer items-center rounded-lg border border-border bg-bg-elevated pl-9 pr-3 text-left outline-none transition-colors hover:border-gold/30 focus-visible:ring-2 focus-visible:ring-gold/40"
        >
          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
          <span className={`truncate text-xs leading-none ${value ? "text-text-primary" : "text-text-muted"}`}>
            {selected
              ? format(selected, "EEE, MMM d, yyyy")
              : placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto border-border bg-bg-elevated p-2 text-text-primary shadow-2xl">
        <Calendar
          mode="single"
          required={false}
          showOutsideDays={false}
          selected={selected}
          modifiers={anchorDate ? { anchor: anchorDate } : undefined}
          onSelect={(d) => {
            onChange(d ? format(d, "yyyy-MM-dd") : "");
            if (d) setOpen(false);
          }}
          disabled={disableBefore ? { before: disableBefore } : undefined}
          classNames={{
            day: "group/day relative flex-1 p-0 text-center select-none",
            day_button: "relative isolate z-10 flex size-9 min-w-9 items-center justify-center rounded-md border-0 leading-none font-normal text-text-secondary hover:bg-gold/10 hover:text-white disabled:pointer-events-none disabled:opacity-30 data-[selected-single=true]:bg-gold data-[selected-single=true]:font-semibold data-[selected-single=true]:text-black data-[anchor=true]:border data-[anchor=true]:border-gold/60 data-[anchor=true]:text-gold",
            hidden: "invisible pointer-events-none",
            outside: "invisible pointer-events-none",
            disabled: "text-text-muted opacity-25",
            today: "text-white",
          }}
          className="rounded-md border-0 bg-transparent"
        />
        {value && (
          <div className="border-t border-border pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-text-secondary hover:bg-bg-surface hover:text-text-primary"
              onClick={() => { onChange(""); setOpen(false); }}
            >
              Clear date
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function PromotionCardView({
  promotion,
  onPreview,
  onEdit,
  onDelete,
  onSchedule,
  onPost,
  saving,
}: {
  promotion: PromotionRow;
  onPreview: (promotion: PromotionRow) => void;
  onEdit: (promotion: PromotionRow) => void;
  onDelete: (promotion: PromotionRow) => void;
  onSchedule: (promotion: PromotionRow) => void;
  onPost: (promotion: PromotionRow) => void;
  saving: boolean;
}) {
  const status = promoStatus(promotion);
  const statusBadge = PROMO_STATUS_BADGE[status];
  const label = getPromotionLabel(promotion);
  const badgeClasses = getPromoTypeBadgeClasses(promotion.badge_color);
  const imageUrl = promotion.media_type === "image" ? promotion.media_url : promotion.cover_image_url;
  const usesLabel = promotion.max_uses
    ? `${promotion.current_uses}/${promotion.max_uses}`
    : String(promotion.current_uses);
  const endsLabel = promotion.ends_at
    ? new Date(promotion.ends_at).toLocaleDateString("en-CA", { month: "short", day: "numeric" })
    : "No expiry";
  const recurrenceLabel = formatRecurrenceSummary(
    promotion.is_recurring,
    promotion.recurrence_frequency,
    promotion.recurrence_interval,
    promotion.recurrence_days,
    promotion.recurrence_end_at,
  );
  const showScheduleAction = status === "draft" || status === "paused";
  const showPostAction = status === "draft" || status === "paused" || status === "scheduled";

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="relative flex min-h-72 flex-col overflow-hidden rounded-2xl border border-border bg-bg-surface p-5 transition-colors hover:border-gold/40"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,var(--gold),transparent_58%)] opacity-10" />
      {imageUrl && (
        <div className="relative -mx-5 -mt-5 mb-6 h-36 overflow-hidden border-b border-border bg-bg-elevated">
          <img src={imageUrl} alt="" className="size-full object-cover" />
        </div>
      )}
      <div className="relative flex items-start justify-between gap-3">
        <span className={cn("inline-flex rounded-full border px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider", statusBadge.cls)}>
          {statusBadge.label}
        </span>
        <span className={cn("rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-wide", badgeClasses)}>
          {label}
        </span>
      </div>

      <div className="relative mt-7">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-gold">
          {promotion.promo_code ? promotion.promo_code : promotion.applies_to.replace("_", " ")}
        </p>
        <h3 className="mt-4 line-clamp-2 break-words font-serif text-3xl leading-tight text-white">{promotion.title}</h3>
        {promotion.description && (
          <p className="mt-4 line-clamp-2 break-words text-sm leading-6 text-text-secondary">
            {promotion.description}
          </p>
        )}
        {promotion.promo_type === "free_item" && (
          <p className="mt-4 text-sm leading-6 text-text-secondary">
            {promotion.eligible_item_ids.length > 0 ? "Requires selected item order" : "Any qualifying order"}
            {promotion.free_item_name ? ` unlocks ${promotion.free_item_name}` : " unlocks a free item"}.
          </p>
        )}
        {recurrenceLabel && (
          <p className="mt-4 rounded-xl border border-gold/25 bg-gold/10 px-3 py-2 text-xs leading-5 text-gold">
            {recurrenceLabel}
          </p>
        )}
      </div>

      <div className="relative mt-7">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Redemptions</p>
            <p className="mt-1 font-serif text-xl text-white">{usesLabel}</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Ends</p>
            <p className="mt-1 font-serif text-xl text-white">{endsLabel}</p>
          </div>
        </div>
        {promotion.max_uses != null && (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-bg-elevated">
            <div
              className="h-full rounded-full bg-gold"
              style={{ width: `${Math.min(Math.round((promotion.current_uses / promotion.max_uses) * 100), 100)}%` }}
            />
          </div>
        )}
        {(showScheduleAction || showPostAction) && (
          <div className="mt-5 rounded-2xl border border-border bg-bg-elevated/30 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Publishing</p>
              <p className="text-[11px] text-text-muted">
                {status === "scheduled" ? "Ready to go live early" : "Choose when diners see this"}
              </p>
            </div>
            <div className={cn("grid gap-2", showScheduleAction && showPostAction ? "sm:grid-cols-2" : "")}>
              {showScheduleAction && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 gap-2"
                  disabled={saving}
                  onClick={() => onSchedule(promotion)}
                >
                  <CalendarDays className="size-4" />
                  Schedule
                </Button>
              )}
              {showPostAction && (
                <Button
                  type="button"
                  className="h-11 gap-2"
                  disabled={saving}
                  onClick={() => onPost(promotion)}
                >
                  <CheckCircle2 className="size-4" />
                  Post now
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="mt-4 grid gap-2">
          <Button type="button" variant="outline" className="w-full gap-2" onClick={() => onPreview(promotion)}>
            <Eye className="size-4" />
            Preview diner card
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="gap-2" onClick={() => onEdit(promotion)}>
              <Pencil className="size-4" />
              Edit
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-2 text-danger hover:text-danger"
              onClick={() => onDelete(promotion)}
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
          </div>
        </div>
      </div>
    </motion.article>
  );
}

function PromotionMediaDropzone({
  file,
  onFile,
  onClear,
  imageUrl,
  onImageUrl,
}: {
  file: File | null;
  onFile: (file: File) => void;
  onClear: () => void;
  imageUrl: string;
  onImageUrl: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isPdf = file ? resolveEventMedia(file)?.kind === "pdf" : false;

  const handleFiles = (files: FileList | null) => {
    const next = files?.[0];
    if (!next) return;
    if (!resolveEventMedia(next)) {
      toast.error(EVENT_MEDIA_SUPPORT_MESSAGE);
      return;
    }
    onFile(next);
  };

  return (
    <div className="grid gap-3">
      <input
        ref={inputRef}
        type="file"
        accept={EVENT_MEDIA_ACCEPT}
        className="sr-only"
        onChange={(event) => handleFiles(event.target.files)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          handleFiles(event.dataTransfer.files);
        }}
        className="flex min-h-28 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-bg-surface/50 px-4 py-4 text-center transition-colors hover:border-gold/40"
      >
        {file ? (
          <>
            {isPdf ? <FileText className="size-8 text-gold" /> : <ImageIcon className="size-8 text-gold" />}
            <span className="mt-3 text-sm font-medium text-white">{file.name}</span>
            <span className="mt-1 text-xs text-text-muted">Click to replace, or drag another file here.</span>
          </>
        ) : (
          <>
            <Upload className="size-8 text-gold" />
            <span className="mt-3 text-sm font-medium text-white">Drag image or PDF here</span>
            <span className="mt-1 text-xs text-text-muted">Supports screenshots, AVIF, HEIC, WebP, GIF, and PDF.</span>
          </>
        )}
      </button>

      {file && (
        <Button type="button" variant="ghost" size="sm" className="mt-2 gap-2 text-text-muted" onClick={onClear}>
          <X className="size-3.5" />
          Remove upload
        </Button>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="promotion-photo">Or paste photo URL</Label>
        <div className="relative">
          <ImageIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input
            id="promotion-photo"
            value={imageUrl}
            onChange={(event) => onImageUrl(event.target.value)}
            className="pl-9"
            placeholder="https://..."
          />
        </div>
      </div>
    </div>
  );
}

function PromoFormDrawer({
  open,
  onClose,
  onSave,
  onPreview,
  saving,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (form: FormState, file: File | null | undefined, action: PromotionSaveAction) => Promise<void>;
  onPreview: (form: FormState, descriptionOverride?: string, media?: EventMediaUpload) => void;
  saving: boolean;
  initial: FormState;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [qualifyingItemSearch, setQualifyingItemSearch] = useState("");
  const [freeItemSearch, setFreeItemSearch] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewMedia, setPreviewMedia] = useState<EventMediaUpload | undefined>(undefined);
  const { items: menuItems, loading: menuLoading } = useMenuItems();

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  const showDiscountValue = form.promo_type === "percentage" || form.promo_type === "fixed";

  const startsAtDate = useMemo(() => {
    if (!form.starts_at) return startOfToday();
    const d = parse(form.starts_at, "yyyy-MM-dd", new Date());
    return isValid(d) ? d : startOfToday();
  }, [form.starts_at]);

  // Only show real DB items (mock fallback IDs like "mi-1" are not valid UUIDs)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const realMenuItems = useMemo(
    () => menuItems.filter((m) => UUID_RE.test(m.id) && m.is_active),
    [menuItems],
  );

  const toggleBogoItem = (id: string) => {
    set("bogo_item_ids",
      form.bogo_item_ids.includes(id)
        ? form.bogo_item_ids.filter((x) => x !== id)
        : [...form.bogo_item_ids, id]
    );
  };

  const toggleEligibleItem = (id: string) => {
    set("eligible_item_ids",
      form.eligible_item_ids.includes(id)
        ? form.eligible_item_ids.filter((x) => x !== id)
        : [...form.eligible_item_ids, id]
    );
  };

  const toggleRecurrenceDay = (day: number) => {
    set("recurrence_days",
      form.recurrence_days.includes(day)
        ? form.recurrence_days.filter((value) => value !== day)
        : [...form.recurrence_days, day].sort((a, b) => a - b)
    );
  };

  const allSelected = realMenuItems.length > 0 && form.bogo_item_ids.length === realMenuItems.length;
  const allEligibleSelected = realMenuItems.length > 0 && form.eligible_item_ids.length === realMenuItems.length;
  const filteredQualifyingItems = useMemo(() => {
    const query = qualifyingItemSearch.trim().toLowerCase();
    if (!query) return realMenuItems;
    return realMenuItems.filter((item) => item.name.toLowerCase().includes(query));
  }, [qualifyingItemSearch, realMenuItems]);
  const hasQualifyingSearch = qualifyingItemSearch.trim().length > 0;
  const allFilteredQualifyingSelected =
    filteredQualifyingItems.length > 0 &&
    filteredQualifyingItems.every((item) => form.eligible_item_ids.includes(item.id));
  const filteredFreeItems = useMemo(() => {
    const query = freeItemSearch.trim().toLowerCase();
    if (!query) return realMenuItems;
    return realMenuItems.filter((item) => item.name.toLowerCase().includes(query));
  }, [freeItemSearch, realMenuItems]);
  const itemRequirementError = getPromotionItemRequirementError(form);

  useEffect(() => {
    if (!open) return;
    setForm(initial);
    setSelectedFile(null);
  }, [initial, open]);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewMedia(undefined);
      return;
    }

    const objectUrl = URL.createObjectURL(selectedFile);
    const media = resolveEventMedia(selectedFile);
    setPreviewMedia({
      url: objectUrl,
      type: media?.kind ?? "image",
      name: selectedFile.name,
    });
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile]);

  const toggleAllQualifyingItems = () => {
    if (!hasQualifyingSearch) {
      set("eligible_item_ids", allEligibleSelected ? [] : realMenuItems.map((m) => m.id));
      return;
    }

    const filteredIds = filteredQualifyingItems.map((item) => item.id);
    if (allFilteredQualifyingSelected) {
      set("eligible_item_ids", form.eligible_item_ids.filter((id) => !filteredIds.includes(id)));
      return;
    }

    set("eligible_item_ids", [...new Set([...form.eligible_item_ids, ...filteredIds])]);
  };

  const handlePreview = () => {
    if (itemRequirementError) {
      toast.error(itemRequirementError);
      return;
    }

    onPreview(form, buildPromotionPreviewDescription(form, realMenuItems), previewMedia);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-bg-surface shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold text-text-primary">
                {initial.title ? "Edit Promotion" : "New Promotion"}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="flex size-7 items-center justify-center rounded-lg text-text-muted hover:text-text-primary transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Form */}
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
              {/* Title */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="promo-title">Title *</Label>
                  <span className="text-[11px] text-text-muted">
                    {form.title.length}/{PROMOTION_TITLE_MAX_LENGTH}
                  </span>
                </div>
                <Input
                  id="promo-title"
                  maxLength={PROMOTION_TITLE_MAX_LENGTH}
                  placeholder="e.g. BOGO Pasta, 20% Off Weekend"
                  value={form.title}
                  onChange={(e) => set("title", e.target.value.slice(0, PROMOTION_TITLE_MAX_LENGTH))}
                />
                <p className="text-[11px] text-text-muted">
                  Keep titles short so they fit cleanly on cards.
                </p>
              </div>

              {/* Description */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="promo-desc">Description</Label>
                  <span className="text-[11px] text-text-muted">
                    {form.description.length}/{PROMOTION_DESCRIPTION_MAX_LENGTH}
                  </span>
                </div>
                <textarea
                  id="promo-desc"
                  rows={3}
                  maxLength={PROMOTION_DESCRIPTION_MAX_LENGTH}
                  placeholder="e.g. Valid on all pasta dishes, dine-in only"
                  value={form.description}
                  onChange={(e) => set("description", e.target.value.slice(0, PROMOTION_DESCRIPTION_MAX_LENGTH))}
                  className="min-h-24 w-full resize-none rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm leading-6 text-text-primary placeholder:text-text-muted outline-none focus:border-gold/40"
                />
                <p className="text-[11px] text-text-muted">
                  Keep this to 2-3 short lines so the diner card stays readable.
                </p>
              </div>

              <section className="rounded-2xl border border-border bg-bg-elevated/35 p-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold">Media</p>
                <p className="mt-1 text-xs text-text-muted">Add a promotion image or attach a PDF.</p>
                <div className="mt-4">
                  <PromotionMediaDropzone
                    file={selectedFile}
                    onFile={(file) => {
                      setSelectedFile(file);
                      if (resolveEventMedia(file)?.kind === "image") {
                        set("cover_image_url", "");
                      }
                    }}
                    onClear={() => setSelectedFile(null)}
                    imageUrl={form.cover_image_url}
                    onImageUrl={(value) => {
                      setSelectedFile(null);
                      set("cover_image_url", value);
                      set("media_url", "");
                      set("media_type", null);
                      set("media_name", "");
                    }}
                  />
                </div>
              </section>

              {/* Type */}
              <div className="flex flex-col gap-1.5">
                <Label>Deal Type *</Label>
                <Select value={form.promo_type} onValueChange={(v) => {
                  set("promo_type", v as PromoType);
                  set("bogo_item_ids", []);
                  set("free_item_id", "");
                  set("free_item_name", "");
                  set("eligible_item_ids", []);
                  set("buy_quantity", "1");
                  set("get_quantity", "1");
                }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bogo">BOGO — Buy One Get One</SelectItem>
                    <SelectItem value="percentage">Percentage Off</SelectItem>
                    <SelectItem value="fixed">Fixed Amount Off</SelectItem>
                    <SelectItem value="free_item">Free Item / Surprise Offer</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* BOGO — item checklist */}
              {form.promo_type === "bogo" && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label>Applies to which items?</Label>
                    {realMenuItems.length > 0 && (
                      <button
                        type="button"
                        onClick={() => set("bogo_item_ids", allSelected ? [] : realMenuItems.map((m) => m.id))}
                        className="text-[11px] text-gold hover:underline"
                      >
                        {allSelected ? "Deselect all" : "Select all"}
                      </button>
                    )}
                  </div>
                  {menuLoading ? (
                    <div className="flex flex-col gap-1.5">
                      {[1, 2, 3].map((i) => <Skeleton key={i} className="h-9 rounded-md" />)}
                    </div>
                  ) : realMenuItems.length === 0 ? (
                    <p className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-xs text-text-muted">
                      No menu items found. Add items in Menu first to enable item selection.
                    </p>
                  ) : (
                    <div className="max-h-52 overflow-y-auto rounded-md border border-border bg-bg-elevated">
                      {realMenuItems.map((m) => {
                        const checked = form.bogo_item_ids.includes(m.id);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => toggleBogoItem(m.id)}
                            className={`flex w-full items-center gap-3 border-b border-border/50 px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-bg-surface ${checked ? "bg-gold/5" : ""}`}
                          >
                            <div className={`flex size-4 shrink-0 items-center justify-center rounded border ${checked ? "border-gold bg-gold" : "border-border bg-transparent"}`}>
                              {checked && <CheckCircle2 className="size-3 text-bg-base" />}
                            </div>
                            <span className="min-w-0 flex-1 truncate text-xs text-text-primary">{m.name}</span>
                            <span className="shrink-0 text-xs text-text-muted">${m.price.toFixed(2)}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {form.bogo_item_ids.length === 0 && realMenuItems.length > 0 && (
                    <p className="text-[11px] text-text-muted">Select at least one item, or use Select all for everything.</p>
                  )}
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="bogo-buy">Buy Quantity</Label>
                      <Input
                        id="bogo-buy"
                        type="number"
                        min={1}
                        placeholder="1"
                        value={form.buy_quantity}
                        onChange={(e) => set("buy_quantity", e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="bogo-get">Get Free</Label>
                      <Input
                        id="bogo-get"
                        type="number"
                        min={1}
                        placeholder="1"
                        value={form.get_quantity}
                        onChange={(e) => set("get_quantity", e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Percentage / Fixed — item scope checklist */}
              {(form.promo_type === "percentage" || form.promo_type === "fixed") && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label>Applies to which items?</Label>
                    {realMenuItems.length > 0 && (
                      <button
                        type="button"
                        onClick={() => set("eligible_item_ids", allEligibleSelected ? [] : realMenuItems.map((m) => m.id))}
                        className="text-[11px] text-gold hover:underline"
                      >
                        {allEligibleSelected ? "Deselect all" : "Select all"}
                      </button>
                    )}
                  </div>
                  {menuLoading ? (
                    <div className="flex flex-col gap-1.5">
                      {[1, 2, 3].map((i) => <Skeleton key={i} className="h-9 rounded-md" />)}
                    </div>
                  ) : realMenuItems.length === 0 ? (
                    <p className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-xs text-text-muted">
                      No menu items found. Add items in Menu first to enable item selection.
                    </p>
                  ) : (
                    <div className="max-h-52 overflow-y-auto rounded-md border border-border bg-bg-elevated">
                      {realMenuItems.map((m) => {
                        const checked = form.eligible_item_ids.includes(m.id);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => toggleEligibleItem(m.id)}
                            className={`flex w-full items-center gap-3 border-b border-border/50 px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-bg-surface ${checked ? "bg-gold/5" : ""}`}
                          >
                            <div className={`flex size-4 shrink-0 items-center justify-center rounded border ${checked ? "border-gold bg-gold" : "border-border bg-transparent"}`}>
                              {checked && <CheckCircle2 className="size-3 text-bg-base" />}
                            </div>
                            <span className="min-w-0 flex-1 truncate text-xs text-text-primary">{m.name}</span>
                            <span className="shrink-0 text-xs text-text-muted">${m.price.toFixed(2)}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {form.eligible_item_ids.length === 0 && realMenuItems.length > 0 && (
                    <p className="text-[11px] text-text-muted">Select at least one item, or use Select all if the discount applies to everything.</p>
                  )}
                </div>
              )}

              {/* Free Item — qualifying item checklist + free item select */}
              {form.promo_type === "free_item" && (
                <div className="grid gap-4 rounded-2xl border border-border bg-bg-elevated/35 p-3">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <Label>Customer must order</Label>
                      {realMenuItems.length > 0 && (
                        <button
                          type="button"
                          onClick={toggleAllQualifyingItems}
                          className="text-[11px] text-gold hover:underline"
                        >
                          {hasQualifyingSearch
                            ? allFilteredQualifyingSelected ? "Deselect shown" : "Select shown"
                            : allEligibleSelected ? "Deselect all" : "Select all"}
                        </button>
                      )}
                    </div>
                    {realMenuItems.length > 0 && (
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
                        <Input
                          value={qualifyingItemSearch}
                          onChange={(event) => setQualifyingItemSearch(event.target.value)}
                          placeholder="Search menu items..."
                          className="h-9 pl-9 text-xs"
                        />
                      </div>
                    )}
                    {menuLoading ? (
                      <div className="flex flex-col gap-1.5">
                        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-9 rounded-md" />)}
                      </div>
                    ) : realMenuItems.length === 0 ? (
                      <p className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-xs text-text-muted">
                        No menu items found. Add items in Menu first.
                      </p>
                    ) : (
                      <div className="max-h-44 overflow-y-auto rounded-md border border-border bg-bg-elevated">
                        {filteredQualifyingItems.length === 0 ? (
                          <p className="px-3 py-4 text-center text-xs text-text-muted">
                            No menu items match your search.
                          </p>
                        ) : filteredQualifyingItems.map((m) => {
                          const checked = form.eligible_item_ids.includes(m.id);
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => toggleEligibleItem(m.id)}
                              className={`flex w-full items-center gap-3 border-b border-border/50 px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-bg-surface ${checked ? "bg-gold/5" : ""}`}
                            >
                              <div className={`flex size-4 shrink-0 items-center justify-center rounded border ${checked ? "border-gold bg-gold" : "border-border bg-transparent"}`}>
                                {checked && <CheckCircle2 className="size-3 text-bg-base" />}
                              </div>
                              <span className="min-w-0 flex-1 truncate text-xs text-text-primary">{m.name}</span>
                              <span className="shrink-0 text-xs text-text-muted">${m.price.toFixed(2)}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {form.eligible_item_ids.length === 0 && realMenuItems.length > 0 && (
                      <p className="text-[11px] text-text-muted">Select what customers must order, or use Select all for any item.</p>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <Label>Free item customer gets</Label>
                      {form.free_item_id && (
                        <button
                          type="button"
                          onClick={() => {
                            set("free_item_id", "");
                            set("free_item_name", "");
                          }}
                          className="text-[11px] text-gold hover:underline"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    {realMenuItems.length > 0 && (
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
                        <Input
                          value={freeItemSearch}
                          onChange={(event) => setFreeItemSearch(event.target.value)}
                          placeholder="Search free item..."
                          className="h-9 pl-9 text-xs"
                        />
                      </div>
                    )}
                    {menuLoading ? (
                      <div className="flex flex-col gap-1.5">
                        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-9 rounded-md" />)}
                      </div>
                    ) : realMenuItems.length === 0 ? (
                      <p className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-xs text-text-muted">
                        No menu items found. Add items in Menu first.
                      </p>
                    ) : (
                      <div className="max-h-44 overflow-y-auto rounded-md border border-border bg-bg-elevated">
                        {filteredFreeItems.length === 0 ? (
                          <p className="px-3 py-4 text-center text-xs text-text-muted">
                            No menu items match your search.
                          </p>
                        ) : filteredFreeItems.map((m) => {
                          const checked = form.free_item_id === m.id;
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => {
                                set("free_item_id", m.id);
                                set("free_item_name", m.name);
                              }}
                              className={`flex w-full items-center gap-3 border-b border-border/50 px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-bg-surface ${checked ? "bg-gold/5" : ""}`}
                            >
                              <div className={`flex size-4 shrink-0 items-center justify-center rounded border ${checked ? "border-gold bg-gold" : "border-border bg-transparent"}`}>
                                {checked && <CheckCircle2 className="size-3 text-bg-base" />}
                              </div>
                              <span className="min-w-0 flex-1 truncate text-xs text-text-primary">{m.name}</span>
                              <span className="shrink-0 text-xs text-text-muted">${m.price.toFixed(2)}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {!form.free_item_id && realMenuItems.length > 0 && (
                      <p className="text-[11px] text-text-muted">Select the item diners receive for free.</p>
                    )}
                  </div>
                </div>
              )}

              {/* Discount value (percentage / fixed only) */}
              {showDiscountValue && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="promo-val">
                    {form.promo_type === "percentage" ? "Discount %" : "Discount Amount"}
                  </Label>
                  <Input
                    id="promo-val"
                    type="number"
                    min={0}
                    placeholder={form.promo_type === "percentage" ? "20" : "5.00"}
                    value={form.discount_value}
                    onChange={(e) => set("discount_value", e.target.value)}
                  />
                  {form.promo_type === "fixed" && (
                    <p className="text-[11px] text-text-muted">Fixed discounts are applied in dollars.</p>
                  )}
                </div>
              )}

              {/* Applies to */}
              <div className="flex flex-col gap-1.5">
                <Label>Applies To</Label>
                <Select value={form.applies_to} onValueChange={(v) => set("applies_to", v as FormState["applies_to"])}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All bookings</SelectItem>
                    <SelectItem value="dine_in">Dine-In only</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Dates — calendar pickers */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Starts</Label>
                  <DatePickerButton
                    value={form.starts_at}
                    onChange={(v) => {
                      set("starts_at", v);
                      if (form.ends_at && v && form.ends_at < v) {
                        set("ends_at", v);
                      }
                    }}
                    placeholder="Start date"
                    disableBefore={startOfToday()}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Ends</Label>
                  <DatePickerButton
                    value={form.ends_at}
                    onChange={(v) => set("ends_at", v)}
                    placeholder="No expiry"
                    disableBefore={startsAtDate}
                    anchorDate={startsAtDate}
                  />
                </div>
              </div>

              <section className="grid gap-3 rounded-2xl border border-border bg-bg-elevated/35 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold">Recurring</p>
                    <p className="mt-1 text-xs text-text-muted">Repeat this promotion automatically.</p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs text-text-secondary">
                    Repeats
                    <input
                      type="checkbox"
                      checked={form.is_recurring}
                      onChange={(event) => set("is_recurring", event.target.checked)}
                      className="size-4 rounded border-border accent-gold"
                    />
                  </label>
                </div>

                {form.is_recurring && (
                  <div className="grid gap-3">
                    <div className="grid grid-cols-[0.8fr_1.2fr] gap-3">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="recurrence-interval">Every</Label>
                        <Input
                          id="recurrence-interval"
                          type="number"
                          min={1}
                          value={form.recurrence_interval}
                          onChange={(event) => set("recurrence_interval", event.target.value)}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>Frequency</Label>
                        <Select
                          value={form.recurrence_frequency}
                          onValueChange={(value) => {
                            const next = value as RecurrenceFrequency;
                            set("recurrence_frequency", next);
                            if (next !== "weekly") set("recurrence_days", []);
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="daily">Day(s)</SelectItem>
                            <SelectItem value="weekly">Week(s)</SelectItem>
                            <SelectItem value="monthly">Month(s)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {form.recurrence_frequency === "weekly" && (
                      <div className="flex flex-col gap-1.5">
                        <Label>Repeat on</Label>
                        <div className="grid grid-cols-7 gap-1.5">
                          {WEEKDAY_OPTIONS.map((day) => {
                            const checked = form.recurrence_days.includes(day.value);
                            return (
                              <button
                                key={day.value}
                                type="button"
                                onClick={() => toggleRecurrenceDay(day.value)}
                                className={cn(
                                  "rounded-lg border px-2 py-2 text-[11px] font-medium transition-colors",
                                  checked
                                    ? "border-gold bg-gold/15 text-gold"
                                    : "border-border bg-bg-elevated text-text-muted hover:text-text-secondary",
                                )}
                              >
                                {day.label}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-[11px] text-text-muted">Choose at least one day for weekly repeats.</p>
                      </div>
                    )}

                    <div className="flex flex-col gap-1.5">
                      <Label>Stops repeating optional</Label>
                      <DatePickerButton
                        value={form.recurrence_end_at}
                        onChange={(value) => set("recurrence_end_at", value)}
                        placeholder="No repeat end"
                        disableBefore={startsAtDate}
                        anchorDate={startsAtDate}
                      />
                    </div>

                    <p className="rounded-lg border border-border bg-bg-surface/40 px-3 py-2 text-[11px] leading-relaxed text-text-muted">
                      {formatRecurrenceSummary(
                        form.is_recurring,
                        form.recurrence_frequency,
                        Number(form.recurrence_interval) || 1,
                        form.recurrence_days,
                        form.recurrence_end_at || null,
                      )}
                    </p>
                  </div>
                )}
              </section>

              {/* Optional fields */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="promo-code">Promo Code optional</Label>
                  <Input
                    id="promo-code"
                    placeholder="e.g. SAVE20"
                    value={form.promo_code}
                    onChange={(e) => set("promo_code", e.target.value.toUpperCase())}
                  />
                  <p className="text-[11px] leading-relaxed text-text-muted">
                    {form.applies_to === "dine_in"
                      ? "Usually not needed for dine-in. Use only if diners or staff need a reference code."
                      : "Use this for campaign tracking, online ordering, or staff lookup."}
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="promo-max">Max Uses</Label>
                  <Input
                    id="promo-max"
                    type="number"
                    min={1}
                    placeholder="Unlimited"
                    value={form.max_uses}
                    onChange={(e) => set("max_uses", e.target.value)}
                  />
                </div>
              </div>

              {/* Min order amount */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="promo-min">Minimum Order Amount</Label>
                <Input
                  id="promo-min"
                  type="number"
                  min={0}
                  placeholder="No minimum"
                  value={form.min_order_amount}
                  onChange={(e) => set("min_order_amount", e.target.value)}
                />
              </div>

              <div className="rounded-xl border border-border bg-bg-elevated/35 px-3 py-2 text-xs leading-relaxed text-text-muted">
                Save draft keeps this hidden. Schedule uses the start date. Post now makes it visible immediately.
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-border px-5 py-4">
              <div className="grid gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  disabled={!form.title.trim()}
                  onClick={handlePreview}
                >
                  <Eye className="size-4" />
                  Preview
                </Button>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    disabled={saving || !form.title.trim()}
                    onClick={() => void onSave(form, selectedFile, "draft")}
                  >
                    {saving ? "Saving..." : "Save draft"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    disabled={saving || !form.title.trim()}
                    onClick={() => void onSave(form, selectedFile, "schedule")}
                  >
                    <CalendarDays className="size-4" />
                    Schedule
                  </Button>
                  <Button
                    type="button"
                    className="gap-2"
                    disabled={saving || !form.title.trim()}
                    onClick={() => void onSave(form, selectedFile, "post")}
                  >
                    <CheckCircle2 className="size-4" />
                    Post now
                  </Button>
                </div>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export default function PromotionsPage() {
  const { selectedRestaurantId, selectedRestaurant } = useRestaurantScope();
  const { promotions, loading, saving, createPromotion, updatePromotion, deletePromotion, uploadPromotionMedia } = usePromotions();
  const [phase, setPhase] = useState<PromoPhase>("active");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PromotionRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PromotionRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [previewItem, setPreviewItem] = useState<EventPromotionDisplay | null>(null);

  const restaurantFallback = useMemo(
    () => buildRestaurantFallback(selectedRestaurant),
    [selectedRestaurant],
  );

  const initialForm: FormState = useMemo(() => editTarget
    ? {
        title: editTarget.title,
        description: editTarget.description ?? "",
        promo_type: editTarget.promo_type,
        discount_value: editTarget.discount_value?.toString() ?? "",
        discount_unit: editTarget.discount_unit ?? "percent",
        applies_to: editTarget.applies_to,
        min_order_amount: editTarget.min_order_amount?.toString() ?? "",
        starts_at: editTarget.starts_at.slice(0, 10),
        ends_at: editTarget.ends_at?.slice(0, 10) ?? "",
        is_active: editTarget.is_active,
        promo_code: editTarget.promo_code ?? "",
        max_uses: editTarget.max_uses?.toString() ?? "",
        badge_color: editTarget.badge_color,
        bogo_item_ids: editTarget.bogo_item_ids ?? [],
        free_item_id: editTarget.free_item_id ?? "",
        free_item_name: editTarget.free_item_name ?? "",
        eligible_item_ids: editTarget.eligible_item_ids ?? [],
        buy_quantity: String(editTarget.buy_quantity ?? 1),
        get_quantity: String(editTarget.get_quantity ?? 1),
        cover_image_url: editTarget.cover_image_url ?? "",
        media_url: editTarget.media_url ?? "",
        media_type: editTarget.media_type ?? null,
        media_name: editTarget.media_name ?? "",
        is_recurring: editTarget.is_recurring,
        recurrence_frequency: editTarget.recurrence_frequency ?? "weekly",
        recurrence_interval: String(editTarget.recurrence_interval ?? 1),
        recurrence_days: editTarget.recurrence_days ?? [],
        recurrence_end_at: editTarget.recurrence_end_at?.slice(0, 10) ?? "",
      }
    : DEFAULT_FORM, [editTarget]);

  const openCreate = () => { setEditTarget(null); setDrawerOpen(true); };
  const openEdit = (p: PromotionRow) => { setEditTarget(p); setDrawerOpen(true); };

  const counts = useMemo(() => ({
    draft: promotions.filter((promotion) => promoStatus(promotion) === "draft").length,
    active: promotions.filter((promotion) => promoStatus(promotion) === "active").length,
    scheduled: promotions.filter((promotion) => promoStatus(promotion) === "scheduled").length,
    paused: promotions.filter((promotion) => promoStatus(promotion) === "paused").length,
    expired: promotions.filter((promotion) => promoStatus(promotion) === "expired").length,
    recurring: promotions.filter((promotion) => promotion.is_recurring).length,
  }), [promotions]);

  const visiblePromotions = useMemo(
    () => promotions.filter((promotion) => phase === "recurring" ? promotion.is_recurring : promoStatus(promotion) === phase),
    [phase, promotions],
  );

  const stats = useMemo(() => {
    return [
      { label: "Live", value: String(counts.active), caption: "visible now" },
      { label: "Scheduled", value: String(counts.scheduled), caption: "starts later" },
      { label: "Recurring", value: String(counts.recurring), caption: "repeats automatically" },
      { label: "Drafts", value: String(counts.draft), caption: "hidden from diners" },
    ];
  }, [counts]);

  const handleSave = async (form: FormState, file: File | null | undefined, action: PromotionSaveAction) => {
    const itemError = getPromotionItemRequirementError(form);
    if (itemError) {
      toast.error(itemError);
      return;
    }

    const today = format(new Date(), "yyyy-MM-dd");
    if (action === "schedule" && (!form.starts_at || form.starts_at <= today)) {
      toast.error("Choose a future start date to schedule this promotion.");
      return;
    }

    let upload: EventMediaUpload | undefined;
    if (file) {
      const result = await uploadPromotionMedia(file);
      if (typeof result === "string") {
        toast.error(result);
        return;
      }
      upload = result;
    }

    const startsDate = action === "post"
      ? new Date()
      : form.starts_at ? new Date(form.starts_at) : new Date();
    const endsDate = form.ends_at ? new Date(form.ends_at) : null;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const coverImageUrl = upload?.type === "image"
      ? upload.url
      : form.cover_image_url.trim() || null;
    const recurrenceFrequency = form.is_recurring ? form.recurrence_frequency : null;
    const recurrenceDays = form.is_recurring && form.recurrence_frequency === "weekly"
      ? form.recurrence_days
      : [];

    const payload: CreatePromotionPayload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      promo_type: form.promo_type,
      discount_value: form.discount_value ? Number(form.discount_value) : null,
      discount_unit: form.discount_value
        ? form.promo_type === "fixed" ? "dollar" : form.discount_unit
        : null,
      applies_to: form.applies_to,
      min_order_amount: form.min_order_amount ? Number(form.min_order_amount) : null,
      starts_at: startsDate.toISOString(),
      ends_at: endsDate ? endsDate.toISOString() : null,
      is_active: action !== "draft",
      promo_code: form.promo_code.trim() || null,
      max_uses: form.max_uses ? Number(form.max_uses) : null,
      badge_color: form.badge_color,
      bogo_item_ids: form.promo_type === "bogo"
        ? form.bogo_item_ids.filter((id) => UUID_RE.test(id))
        : [],
      free_item_id: form.promo_type === "free_item" && form.free_item_id && UUID_RE.test(form.free_item_id)
        ? form.free_item_id
        : null,
      free_item_name: form.promo_type === "free_item" && form.free_item_name ? form.free_item_name : null,
      eligible_item_ids: (form.promo_type === "percentage" || form.promo_type === "fixed" || form.promo_type === "free_item")
        ? form.eligible_item_ids.filter((id) => UUID_RE.test(id))
        : [],
      buy_quantity: form.promo_type === "bogo" ? (Number(form.buy_quantity) || 1) : 1,
      get_quantity: form.promo_type === "bogo" ? (Number(form.get_quantity) || 1) : 1,
      cover_image_url: coverImageUrl,
      media_url: (upload?.url ?? form.media_url) || null,
      media_type: upload?.type ?? form.media_type,
      media_name: (upload?.name ?? form.media_name) || null,
      is_recurring: form.is_recurring,
      recurrence_frequency: recurrenceFrequency,
      recurrence_interval: form.is_recurring ? Number(form.recurrence_interval) || 1 : 1,
      recurrence_days: recurrenceDays,
      recurrence_end_at: form.is_recurring && form.recurrence_end_at ? new Date(form.recurrence_end_at).toISOString() : null,
    };

    const err = editTarget
      ? await updatePromotion(editTarget.id, payload)
      : await createPromotion(payload);

    if (err === null) {
      const successMessage = action === "draft"
        ? "Promotion saved as draft"
        : action === "schedule"
          ? "Promotion scheduled"
          : "Promotion posted";
      toast.success(successMessage);
      setDrawerOpen(false);
      setEditTarget(null);
    } else {
      toast.error(err || "Could not save promotion. Try again.");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const ok = await deletePromotion(deleteTarget.id);
    setDeleting(false);
    if (ok) {
      toast.success("Promotion deleted");
      setDeleteTarget(null);
    } else {
      toast.error("Could not delete promotion.");
    }
  };

  const handleSchedulePromotion = async (promotion: PromotionRow) => {
    const now = new Date();
    const startsAt = new Date(promotion.starts_at);
    if (startsAt <= now) {
      toast.error("Edit the start date to a future date before scheduling.");
      return;
    }

    const err = await updatePromotion(promotion.id, { is_active: true });
    if (err === null) {
      toast.success("Promotion scheduled");
      setPhase("scheduled");
    } else {
      toast.error(err || "Could not schedule promotion.");
    }
  };

  const handlePostPromotion = async (promotion: PromotionRow) => {
    if (promotion.ends_at && new Date(promotion.ends_at) <= new Date()) {
      toast.error("Edit the end date before posting this promotion.");
      return;
    }

    const err = await updatePromotion(promotion.id, {
      is_active: true,
      starts_at: new Date().toISOString(),
    });
    if (err === null) {
      toast.success("Promotion posted");
      setPhase("active");
    } else {
      toast.error(err || "Could not post promotion.");
    }
  };

  const previewPromotion = (promotion: PromotionRow) => {
    setPreviewItem(promotionToDisplay(promotion, restaurantFallback));
  };

  const previewForm = (form: FormState, descriptionOverride?: string, media?: EventMediaUpload) => {
    setPreviewItem(promotionToDisplay(formToPromotionPreview(form, selectedRestaurantId, descriptionOverride, media), restaurantFallback));
  };

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
            <Sparkles className="size-3.5" />
            Programs
          </p>
          <h1 className="mt-2 font-serif text-3xl text-white sm:text-4xl">Promotions</h1>
          <p className="mt-1 text-sm italic text-text-muted">
            Create diner-facing offers, preview them, and control when they are visible.
          </p>
        </div>
        <Button size="default" className="shrink-0 gap-2" onClick={openCreate}>
          <Plus className="size-4" />
          New promotion
        </Button>
      </motion.header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <article key={stat.label} className="rounded-2xl border border-border bg-bg-surface p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">{stat.label}</p>
            <p className="mt-3 font-serif text-4xl text-white">{stat.value}</p>
            <p className="mt-2 text-xs text-text-muted">{stat.caption}</p>
          </article>
        ))}
      </section>

      <div className="flex items-center gap-1 self-start rounded-lg border border-border bg-bg-elevated/40 p-1">
        {(["active", "scheduled", "paused", "expired", "recurring", "draft"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setPhase(key)}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
              phase === key ? "bg-gold/15 text-gold" : "text-text-muted hover:text-text-secondary",
            )}
          >
            {key}
            <span className={cn("font-mono text-[10px]", phase === key ? "text-gold/80" : "text-text-muted")}>
              {counts[key]}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-72 rounded-2xl" />
          ))}
        </section>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visiblePromotions.map((promotion) => (
            <PromotionCardView
              key={promotion.id}
              promotion={promotion}
              onPreview={previewPromotion}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
              onSchedule={handleSchedulePromotion}
              onPost={handlePostPromotion}
              saving={saving}
            />
          ))}
          {visiblePromotions.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-border bg-bg-surface/40 p-10 text-center">
              <Tag className="mx-auto size-8 text-text-muted" />
              <p className="mt-3 text-sm text-text-muted">No {phase} promotions.</p>
              {promotions.length === 0 && (
                <Button size="default" className="mt-4 gap-2" onClick={openCreate}>
                  <Plus className="size-4" />
                  New promotion
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      <PromoFormDrawer
        key={editTarget?.id ?? "new"}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setEditTarget(null); }}
        onSave={handleSave}
        onPreview={previewForm}
        saving={saving}
        initial={initialForm}
      />
      <EventPromotionDetailDialog
        item={previewItem}
        open={previewItem !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewItem(null);
        }}
        preview
      />
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => {
        if (!open) setDeleteTarget(null);
      }}>
        <DialogContent className="border-border bg-bg-surface p-0 text-text-primary sm:max-w-lg">
          <DialogHeader>
            <div className="border-b border-border px-6 py-5">
              <div className="mb-4 flex size-12 items-center justify-center rounded-full border border-danger/30 bg-danger/10">
                <Trash2 className="size-5 text-danger" />
              </div>
              <DialogTitle className="font-serif text-2xl text-white">Delete this promotion?</DialogTitle>
              <DialogDescription className="mt-2 leading-6 text-text-secondary">
                This will permanently remove
                {" "}
                <span className="font-medium text-white">{deleteTarget?.title ?? "this promotion"}</span>
                {" "}
                from your dashboard and diner-facing surfaces. This action cannot be undone.
              </DialogDescription>
            </div>
          </DialogHeader>
          <DialogFooter className="mx-0 mb-0 rounded-none border-t border-border bg-bg-surface px-6 py-4 sm:justify-between">
            <Button type="button" variant="ghost" disabled={deleting} onClick={() => setDeleteTarget(null)}>
              Keep promotion
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={deleting}
              className="gap-2 border-danger/40 bg-danger/10 text-danger hover:border-danger/60 hover:text-danger"
              onClick={() => void handleDelete()}
            >
              <Trash2 className="size-4" />
              {deleting ? "Deleting..." : "Delete promotion"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AnimatedPage>
  );
}
