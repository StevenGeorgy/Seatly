import { useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { CalendarDays, Eye, FileText, ImageIcon, LayoutGrid, Pencil, Plus, Send, Sparkles, Ticket, Trash2, Upload, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { EventPromotionDetailDialog } from "@/components/customer/EventPromotionDetailCard";
import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import {
  EVENT_MEDIA_ACCEPT,
  EVENT_MEDIA_SUPPORT_MESSAGE,
  resolveEventMedia,
  useEvents,
  type CreateEventPayload,
  type EventMediaUpload,
  type EventRow,
} from "@/hooks/useEvents";
import { eventToDisplay, type EventPromotionDisplay, type RestaurantDisplayInfo } from "@/lib/customer/eventPromotionDisplay";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { cn } from "@/lib/utils";
import { formatCompactTimeLabel } from "@/lib/utils/time";

type EventPhase = "active" | "draft" | "past";
type View = "grid" | "calendar";

const EVENT_THEMES = ["Tasting menu", "Wine event", "Prix fixe", "Chef's table", "Holiday", "Private dining"] as const;
const EVENT_TITLE_MAX_LENGTH = 60;
const EVENT_DESCRIPTION_MAX_LENGTH = 140;

const eventSchema = z.object({
  name: z.string().trim().min(1, "Title is required.").max(EVENT_TITLE_MAX_LENGTH, "Keep the title under 60 characters."),
  description: z.string().trim().max(EVENT_DESCRIPTION_MAX_LENGTH, "Keep the description under 140 characters.").optional(),
  theme: z.string().trim().min(1, "Event type is required."),
  cover_image_url: z.string().trim().url("Enter a valid image URL.").or(z.literal("")),
  date: z.string().min(1, "Start date is required."),
  end_date: z.string().min(1, "End date is required."),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  is_private: z.boolean(),
  capacity_mode: z.enum(["limited", "unlimited"]),
  capacity: z.string().optional(),
  price_per_person: z.string().optional().refine((value) => !value || Number(value) >= 0, "Price must be zero or greater."),
})
  .refine(
    (value) => !value.end_date || value.end_date >= value.date,
    { path: ["end_date"], message: "End date must be after the start date." },
  )
  .refine(
    (value) => value.capacity_mode === "unlimited" || Number(value.capacity) > 0,
    { path: ["capacity"], message: "Enter seats or choose unlimited." },
  );

type EventFormValues = z.infer<typeof eventSchema>;

const DEFAULT_EVENT_FORM: EventFormValues = {
  name: "",
  description: "",
  theme: EVENT_THEMES[0],
  cover_image_url: "",
  date: "",
  end_date: "",
  start_time: "",
  end_time: "",
  is_private: false,
  capacity_mode: "limited",
  capacity: "",
  price_per_person: "",
};

function eventToFormValues(event: EventRow): EventFormValues {
  return {
    name: event.name,
    description: event.description ?? "",
    theme: event.theme ?? EVENT_THEMES[0],
    cover_image_url: event.cover_image_url ?? "",
    date: event.date,
    end_date: event.end_date ?? event.date,
    start_time: event.start_time ?? "",
    end_time: event.end_time ?? "",
    is_private: event.is_private ?? false,
    capacity_mode: event.capacity == null ? "unlimited" : "limited",
    capacity: event.capacity?.toString() ?? "",
    price_per_person: event.price_per_person?.toString() ?? "",
  };
}

const STATUS_BADGE: Record<EventPhase, { label: string; cls: string }> = {
  active: { label: "Posted", cls: "border-success/40 bg-success/10 text-success" },
  draft: { label: "Draft", cls: "border-border bg-bg-elevated text-text-muted" },
  past: { label: "Past", cls: "border-info/40 bg-info/10 text-info" },
};

function formatShortDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "TBD";
  return parsed.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function formatShortTime(value: string | null): string {
  if (!value) return "TBD";
  const [hourPart, minutePart] = value.split(":");
  const date = new Date();
  date.setHours(Number(hourPart), Number(minutePart ?? 0), 0, 0);
  if (Number.isNaN(date.getTime())) return value;
  return formatCompactTimeLabel(date);
}

function parseDateValue(value: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function formatDateValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function todayDateValue(): string {
  return formatDateValue(new Date());
}

function formatPickerDate(value: string): string {
  const parsed = parseDateValue(value);
  if (!parsed) return "Choose date";
  return parsed.toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatPickerTime(value: string): string {
  return value ? formatShortTime(value) : "Choose time";
}

const HOURS = Array.from({ length: 12 }, (_, index) => String(index + 1));
const MINUTES = ["00", "15", "30", "45"];
const PERIODS = ["AM", "PM"] as const;

function toTimeValue(hour: string, minute: string, period: (typeof PERIODS)[number]): string {
  const hourNumber = Number(hour);
  const normalized = period === "AM"
    ? hourNumber % 12
    : hourNumber === 12 ? 12 : hourNumber + 12;
  return `${String(normalized).padStart(2, "0")}:${minute}`;
}

function splitTimeValue(value: string): { hour: string; minute: string; period: (typeof PERIODS)[number] } {
  if (!value) return { hour: "7", minute: "00", period: "PM" };
  const [hourPart, minutePart] = value.split(":");
  const hour24 = Number(hourPart);
  const period: (typeof PERIODS)[number] = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return {
    hour: String(hour12),
    minute: minutePart ?? "00",
    period,
  };
}

function WheelColumn({
  label,
  values,
  value,
  onChange,
}: {
  label: string;
  values: readonly string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<number | null>(null);
  const selectedIndex = Math.max(values.indexOf(value), 0);
  const move = (direction: 1 | -1) => {
    const nextIndex = (selectedIndex + direction + values.length) % values.length;
    onChange(values[nextIndex]);
  };

  useEffect(() => {
    const selectedButton = scrollRef.current?.querySelector<HTMLButtonElement>(
      `[data-wheel-value="${CSS.escape(value)}"]`,
    );
    selectedButton?.scrollIntoView({ block: "center" });
  }, [value]);

  const commitNearestValue = () => {
    const container = scrollRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const centerY = containerRect.top + containerRect.height / 2;
    const options = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-wheel-option]"));
    const nearest = options.reduce<HTMLButtonElement | null>((closest, option) => {
      if (!closest) return option;
      const optionRect = option.getBoundingClientRect();
      const closestRect = closest.getBoundingClientRect();
      const optionDistance = Math.abs(optionRect.top + optionRect.height / 2 - centerY);
      const closestDistance = Math.abs(closestRect.top + closestRect.height / 2 - centerY);
      return optionDistance < closestDistance ? option : closest;
    }, null);

    const nextValue = nearest?.dataset.wheelValue;
    if (nextValue && nextValue !== value) onChange(nextValue);
  };

  return (
    <div
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onWheel={(event) => {
        event.preventDefault();
        if (Math.abs(event.deltaY) < 4) return;
        move(event.deltaY > 0 ? 1 : -1);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") move(1);
        if (event.key === "ArrowUp") move(-1);
      }}
      className="relative h-44 overflow-hidden rounded-3xl border border-border bg-bg-base/80 outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
    >
      <div aria-hidden className="pointer-events-none absolute inset-x-5 top-1/2 z-10 h-9 -translate-y-1/2 border-y border-gold/20" />
      <div
        ref={scrollRef}
        onScroll={() => {
          if (scrollTimerRef.current !== null) window.clearTimeout(scrollTimerRef.current);
          scrollTimerRef.current = window.setTimeout(commitNearestValue, 90);
        }}
        className="h-full overflow-y-auto overscroll-contain py-[72px] pr-1 [scrollbar-color:var(--gold)_transparent] [scrollbar-width:thin]"
      >
        {values.map((item) => {
          const active = item === value;
          return (
            <button
              key={item}
              type="button"
              role="option"
              aria-selected={active}
              data-wheel-option
              data-wheel-value={item}
              onClick={() => onChange(item)}
              className={cn(
                "flex h-9 w-full items-center justify-center text-lg transition-all",
                active ? "scale-110 font-semibold text-gold" : "text-text-muted hover:text-text-secondary",
              )}
            >
              {item}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function eventPhase(event: EventRow): EventPhase {
  if (!event.is_active) return "draft";
  const lastDate = event.end_date ?? event.date;
  return lastDate < new Date().toISOString().slice(0, 10) ? "past" : "active";
}

function eventFillColor(event: EventRow): string {
  if (event.capacity != null && event.tickets_sold >= event.capacity) return "bg-success";
  if (event.tickets_sold === 0) return "bg-text-muted/40";
  return "bg-gold";
}

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

function valuesToPayload(values: EventFormValues, isActive: boolean, media?: EventMediaUpload): CreateEventPayload {
  const imageUrl = media?.type === "image" ? media.url : values.cover_image_url.trim() || null;
  const startDate = values.date || todayDateValue();
  const endDate = values.end_date || startDate;
  const capacity =
    values.capacity_mode === "unlimited" || !values.capacity?.trim()
      ? null
      : Number(values.capacity);

  return {
    name: values.name.trim(),
    description: values.description?.trim() || null,
    theme: values.theme.trim() || null,
    cover_image_url: imageUrl,
    media_url: media?.url ?? null,
    media_type: media?.type ?? null,
    media_name: media?.name ?? null,
    date: startDate,
    end_date: endDate,
    start_time: values.start_time || null,
    end_time: values.end_time || null,
    capacity,
    price_per_person: values.price_per_person ? Number(values.price_per_person) : null,
    is_active: isActive,
    is_private: values.is_private,
  };
}

function valuesToPreview(
  values: EventFormValues,
  restaurantId: string | null,
  restaurant: RestaurantDisplayInfo,
  isActive: boolean,
  media?: EventMediaUpload,
  existingEvent?: EventRow | null,
): EventPromotionDisplay {
  const payload = valuesToPayload(values, isActive, media);
  const existingImageUrl = existingEvent?.media_type === "image"
    ? existingEvent.media_url
    : existingEvent?.cover_image_url;
  const imageUrl = payload.cover_image_url ?? existingImageUrl;
  const previewRow: EventRow = {
    id: "event-preview",
    restaurant_id: restaurantId ?? "preview",
    name: payload.name,
    description: payload.description ?? null,
    date: payload.date,
    end_date: payload.end_date ?? null,
    start_time: payload.start_time ?? null,
    end_time: payload.end_time ?? null,
    price_per_person: payload.price_per_person ?? null,
    capacity: payload.capacity ?? null,
    tickets_sold: 0,
    is_active: isActive,
    is_recurring: false,
    cover_image_url: imageUrl ?? null,
    media_url: media?.url ?? payload.media_url ?? existingEvent?.media_url ?? null,
    media_type: media?.type ?? payload.media_type ?? existingEvent?.media_type ?? null,
    media_name: media?.name ?? payload.media_name ?? existingEvent?.media_name ?? null,
    min_age: null,
    dress_code: null,
    is_private: values.is_private,
    theme: payload.theme ?? null,
    created_at: null,
  };

  return eventToDisplay(previewRow, restaurant);
}

function DatePickerButton({
  value,
  onChange,
  placeholder,
  minDate,
  anchorDate,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  minDate?: Date;
  anchorDate?: Date;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => parseDateValue(value), [value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-12 w-full items-center justify-between rounded-2xl border border-border bg-bg-elevated px-4 text-left text-sm text-text-primary outline-none transition-colors hover:border-gold/30 focus-visible:ring-2 focus-visible:ring-gold/40"
        >
          <span className={value ? "text-text-primary" : "text-text-muted"}>
            {value ? formatPickerDate(value) : placeholder}
          </span>
          <CalendarDays className="size-4 text-text-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto border-border bg-bg-elevated p-2">
        <Calendar
          mode="single"
          showOutsideDays={false}
          selected={selected}
          disabled={minDate ? { before: minDate } : undefined}
          modifiers={anchorDate ? { anchor: anchorDate } : undefined}
          classNames={{
            day: "group/day relative flex-1 p-0 text-center select-none",
            day_button: "relative isolate z-10 flex size-9 min-w-9 items-center justify-center rounded-md border-0 leading-none font-normal text-text-secondary hover:bg-gold/10 hover:text-white disabled:pointer-events-none disabled:opacity-30 data-[selected-single=true]:bg-gold data-[selected-single=true]:font-semibold data-[selected-single=true]:text-black data-[anchor=true]:border data-[anchor=true]:border-gold/60 data-[anchor=true]:text-gold",
            hidden: "invisible pointer-events-none",
            outside: "invisible pointer-events-none",
            disabled: "text-text-muted opacity-25",
            today: "text-white",
          }}
          onSelect={(date) => {
            if (!date) return;
            onChange(formatDateValue(date));
            setOpen(false);
          }}
          className="rounded-md bg-transparent"
        />
        {value && (
          <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => {
            onChange("");
            setOpen(false);
          }}>
            Clear date
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function TimePickerButton({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const parts = splitTimeValue(value);
  const setPart = (next: Partial<typeof parts>) => {
    const merged = { ...parts, ...next };
    onChange(toTimeValue(merged.hour, merged.minute, merged.period));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-12 w-full items-center justify-between rounded-2xl border border-border bg-bg-elevated px-4 text-left text-sm text-text-primary outline-none transition-colors hover:border-gold/30 focus-visible:ring-2 focus-visible:ring-gold/40"
        >
          <span className={value ? "text-text-primary" : "text-text-muted"}>
            {value ? formatPickerTime(value) : placeholder}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Time</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 border-border bg-bg-elevated p-3">
        <div className="mb-3 flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
            Scroll columns
          </p>
          <p className="text-sm font-medium text-white">{value ? formatPickerTime(value) : "7pm"}</p>
        </div>
        <div className="grid grid-cols-[1fr_1fr_0.9fr] gap-2">
          <WheelColumn label="Hour" values={HOURS} value={parts.hour} onChange={(hour) => setPart({ hour })} />
          <WheelColumn label="Minute" values={MINUTES} value={parts.minute} onChange={(minute) => setPart({ minute })} />
          <WheelColumn label="Period" values={PERIODS} value={parts.period} onChange={(period) => setPart({ period: period as (typeof PERIODS)[number] })} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onChange("")}>
            Clear
          </Button>
          <Button type="button" size="sm" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MediaDropzone({
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
        <Label htmlFor="event-photo">Or paste photo URL</Label>
        <div className="relative">
          <ImageIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input
            id="event-photo"
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

function EventFormDialog({
  open,
  onOpenChange,
  saving,
  restaurantId,
  restaurant,
  initialEvent,
  onCreate,
  onPreview,
  uploadEventMedia,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  saving: boolean;
  restaurantId: string | null;
  restaurant: RestaurantDisplayInfo;
  initialEvent: EventRow | null;
  onCreate: (values: EventFormValues, isActive: boolean, media?: EventMediaUpload) => Promise<boolean>;
  onPreview: (item: EventPromotionDisplay) => void;
  uploadEventMedia: (file: File) => Promise<EventMediaUpload | string>;
}) {
  const form = useForm<EventFormValues>({
    resolver: zodResolver(eventSchema),
    defaultValues: DEFAULT_EVENT_FORM,
  });
  const { register, handleSubmit, reset, setError, setValue, watch, trigger, formState: { errors } } = form;
  const themeValue = watch("theme");
  const imageUrlValue = watch("cover_image_url");
  const capacityMode = watch("capacity_mode");
  const dateValue = watch("date");
  const endDateValue = watch("end_date") ?? "";
  const startTimeValue = watch("start_time") ?? "";
  const endTimeValue = watch("end_time") ?? "";
  const isPrivateValue = watch("is_private");
  const titleValue = watch("name") ?? "";
  const descriptionValue = watch("description") ?? "";
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewMedia, setPreviewMedia] = useState<EventMediaUpload | undefined>(undefined);
  const isEditing = initialEvent !== null;

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

  useEffect(() => {
    if (!open) return;
    reset(initialEvent ? eventToFormValues(initialEvent) : DEFAULT_EVENT_FORM);
    setSelectedFile(null);
  }, [initialEvent, open, reset]);

  const preview = async () => {
    const valid = await trigger();
    if (!valid) return;
    onPreview(valuesToPreview(
      form.getValues(),
      restaurantId,
      restaurant,
      initialEvent?.is_active ?? false,
      previewMedia,
      initialEvent,
    ));
  };

  const persist = async (values: EventFormValues, isActive: boolean) => {
    let upload: EventMediaUpload | undefined;
    if (selectedFile) {
      const result = await uploadEventMedia(selectedFile);
      if (typeof result === "string") {
        toast.error(result);
        return;
      }
      upload = result;
    }
    const saved = await onCreate(values, isActive, upload);
    if (saved) {
      setSelectedFile(null);
      reset(DEFAULT_EVENT_FORM);
    }
  };

  const saveDraft = async () => {
    const values = form.getValues();
    if (!values.name.trim()) {
      setError("name", { message: "Title is required to save a draft." });
      toast.error("Add a title to save this draft.");
      return;
    }
    await persist(values, initialEvent?.is_active ?? false);
  };

  const postEvent = () => handleSubmit(async (values) => {
    await persist(values, true);
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-border bg-bg-surface p-0 sm:max-w-4xl">
        <DialogHeader>
          <div className="border-b border-border px-6 py-5">
            <DialogTitle className="font-serif text-3xl text-white">
              {isEditing ? "Edit event" : "Create event"}
            </DialogTitle>
            <p className="mt-1 text-sm text-text-muted">
              {isEditing
                ? "Update the diner-facing card, preview it, then post when ready."
                : "Shape the diner-facing card, then preview it before posting."}
            </p>
          </div>
        </DialogHeader>

        <div className="grid gap-6 px-6 py-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.85fr)] lg:items-start">
            <section className="rounded-2xl border border-border bg-bg-elevated/35 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold">Event details</p>
              <div className="mt-4 grid gap-4">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="event-title">Title</Label>
                    <span className="text-[11px] text-text-muted">
                      {titleValue.length}/{EVENT_TITLE_MAX_LENGTH}
                    </span>
                  </div>
                  <Input
                    id="event-title"
                    maxLength={EVENT_TITLE_MAX_LENGTH}
                    {...register("name")}
                    placeholder="Spring Garden 7-Course Chef's Table"
                  />
                  <p className="text-[11px] text-text-muted">Keep titles short so they fit cleanly on event cards.</p>
                  {errors.name && <p className="text-xs text-danger">{errors.name.message}</p>}
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="event-description">Description</Label>
                  </div>
                  <textarea
                    id="event-description"
                    rows={3}
                    maxLength={EVENT_DESCRIPTION_MAX_LENGTH}
                    {...register("description")}
                    placeholder="Describe what diners can expect."
                    className="min-h-24 resize-none rounded-xl border border-border bg-bg-elevated px-3 py-2 text-sm leading-6 text-text-primary outline-none placeholder:text-text-muted focus:border-gold/40"
                  />
                  <div className="text-[11px] text-text-muted">
                    <p>Keep this to 2-3 short lines so the diner card stays readable.</p>
                    <p
                      className={cn(
                        "mt-1 font-mono text-[10px]",
                        descriptionValue.length >= EVENT_DESCRIPTION_MAX_LENGTH && "text-warning",
                      )}
                    >
                      {descriptionValue.length}/{EVENT_DESCRIPTION_MAX_LENGTH}
                    </p>
                    {descriptionValue.length >= EVENT_DESCRIPTION_MAX_LENGTH && (
                      <p className="mt-1 text-warning">Character limit reached.</p>
                    )}
                  </div>
                  {errors.description && <p className="text-xs text-danger">{errors.description.message}</p>}
                </div>

                <div className="flex max-w-xs flex-col gap-1.5">
                  <Label>Event type</Label>
                  <Select value={themeValue} onValueChange={(value) => setValue("theme", value, { shouldValidate: true })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EVENT_THEMES.map((theme) => (
                        <SelectItem key={theme} value={theme}>{theme}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.theme && <p className="text-xs text-danger">{errors.theme.message}</p>}
                </div>

                <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-bg-surface/70 p-3">
                  <div>
                    <Label htmlFor="event-private">Campaign-only event</Label>
                    <p className="mt-1 text-xs text-text-muted">
                      Keep active for invited guests, but hide it from public Deals and previews.
                    </p>
                  </div>
                  <Switch
                    id="event-private"
                    checked={isPrivateValue}
                    onCheckedChange={(checked) => setValue("is_private", checked, { shouldValidate: true })}
                  />
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-bg-elevated/35 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold">Media</p>
              <p className="mt-1 text-xs text-text-muted">Add a cover image or attach a PDF menu.</p>
              <div className="mt-4">
                <MediaDropzone
                  file={selectedFile}
                  onFile={(file) => {
                    setSelectedFile(file);
                    if (resolveEventMedia(file)?.kind === "image") {
                      setValue("cover_image_url", "", { shouldValidate: true });
                    }
                  }}
                  onClear={() => setSelectedFile(null)}
                  imageUrl={imageUrlValue}
                  onImageUrl={(value) => {
                    setSelectedFile(null);
                    setValue("cover_image_url", value, { shouldValidate: true });
                  }}
                />
                {errors.cover_image_url && <p className="mt-2 text-xs text-danger">{errors.cover_image_url.message}</p>}
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-border bg-bg-elevated/35 p-4">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold">When</p>
                <p className="mt-1 text-xs text-text-muted">Choose dates and optional service times.</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Start date</Label>
              <DatePickerButton
                value={dateValue}
                onChange={(value) => {
                  setValue("date", value, { shouldValidate: true });
                  if (endDateValue && endDateValue < value) {
                    setValue("end_date", value, { shouldValidate: true });
                  }
                }}
                placeholder="Choose start date"
              />
              {errors.date && <p className="text-xs text-danger">{errors.date.message}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>End date</Label>
              <DatePickerButton
                value={endDateValue}
                onChange={(value) => setValue("end_date", value, { shouldValidate: true })}
                placeholder="Choose end date"
                minDate={parseDateValue(dateValue)}
                anchorDate={parseDateValue(dateValue)}
              />
              {errors.end_date && <p className="text-xs text-danger">{errors.end_date.message}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Start time optional</Label>
              <TimePickerButton
                value={startTimeValue}
                onChange={(value) => setValue("start_time", value, { shouldValidate: true })}
                placeholder="Choose start time"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>End time optional</Label>
              <TimePickerButton
                value={endTimeValue}
                onChange={(value) => setValue("end_time", value, { shouldValidate: true })}
                placeholder="Choose end time"
              />
            </div>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-bg-elevated/35 p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold">Capacity & pricing</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="event-seats">Seats</Label>
                <label className="inline-flex items-center gap-2 text-xs text-text-secondary">
                  Unlimited
                  <Switch
                    size="sm"
                    checked={capacityMode === "unlimited"}
                    onCheckedChange={(checked) => {
                      setValue("capacity_mode", checked ? "unlimited" : "limited", { shouldValidate: true });
                      if (checked) setValue("capacity", "", { shouldValidate: true });
                    }}
                  />
                </label>
              </div>
              <Input
                id="event-seats"
                type="number"
                min="1"
                disabled={capacityMode === "unlimited"}
                {...register("capacity")}
                placeholder={capacityMode === "unlimited" ? "Unlimited seats" : "24"}
              />
              {errors.capacity && <p className="text-xs text-danger">{errors.capacity.message}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-price">Per cover optional</Label>
              <Input id="event-price" type="number" min="0" step="0.01" {...register("price_per_person")} placeholder="120" />
              {errors.price_per_person && <p className="text-xs text-danger">{errors.price_per_person.message}</p>}
            </div>
            </div>
          </section>
        </div>

        <DialogFooter className="mx-0 mb-0 rounded-none border-t border-border bg-bg-surface px-6 py-4 sm:justify-between">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" className="gap-2" onClick={() => void preview()}>
              <Eye className="size-4" />
              Preview
            </Button>
            <Button type="button" variant="outline" disabled={saving} onClick={() => void saveDraft()}>
              {saving ? "Saving..." : isEditing ? "Save changes" : "Save draft"}
            </Button>
            <Button type="button" disabled={saving} onClick={() => void postEvent()}>
              {saving ? "Posting..." : "Post event"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EventCardView({
  event,
  restaurant,
  onPreview,
  onEdit,
  onDelete,
  onPost,
  saving,
}: {
  event: EventRow;
  restaurant: RestaurantDisplayInfo;
  onPreview: (item: EventPromotionDisplay) => void;
  onEdit: (event: EventRow) => void;
  onDelete: (event: EventRow) => void;
  onPost: (event: EventRow) => void;
  saving: boolean;
}) {
  const phase = eventPhase(event);
  const badge = STATUS_BADGE[phase];
  const display = eventToDisplay(event, restaurant);
  const fillPct = event.capacity == null || event.capacity === 0
    ? 0
    : Math.min(Math.round((event.tickets_sold / event.capacity) * 100), 100);

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="relative flex min-h-72 flex-col overflow-hidden rounded-2xl border border-border bg-bg-surface p-5 transition-colors hover:border-gold/40"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,var(--gold),transparent_58%)] opacity-10" />
      <div className="relative flex items-start justify-between gap-3">
        <span className={cn("inline-flex rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider", badge.cls)}>
          {badge.label}
        </span>
        <span className="text-right font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
          {event.theme ?? "Event"}
        </span>
      </div>

      <div className="relative mt-auto">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-gold">
          {formatShortDate(event.date)} · {formatShortTime(event.start_time)}
        </p>
        <h3 className="mt-2 line-clamp-2 break-words font-serif text-2xl leading-tight text-white">{event.name}</h3>
        {event.description && (
          <p className="mt-2 line-clamp-2 break-words text-xs text-text-secondary">
            {event.description}
          </p>
        )}
      </div>

      <div className="relative mt-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Seats</p>
            <p className="mt-1 font-serif text-xl text-white">
              {event.capacity == null ? "Unlimited" : (
                <>
                  {event.tickets_sold}
                  <span className="text-text-muted">/{event.capacity}</span>
                </>
              )}
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Per cover</p>
            <p className="mt-1 font-serif text-xl text-white">
              {event.price_per_person == null ? "TBD" : formatCurrency(event.price_per_person, "cad")}
            </p>
          </div>
        </div>
        {event.capacity != null && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-bg-elevated">
            <div className={cn("h-full rounded-full", eventFillColor(event))} style={{ width: `${fillPct}%` }} />
          </div>
        )}
        <div className="mt-4 grid gap-2">
          <Button type="button" variant="outline" className="w-full gap-2" onClick={() => onPreview(display)}>
            <Eye className="size-4" />
            Preview diner card
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="gap-2" onClick={() => onEdit(event)}>
              <Pencil className="size-4" />
              Edit
            </Button>
            <Button type="button" variant="outline" className="gap-2 text-danger hover:text-danger" onClick={() => onDelete(event)}>
              <Trash2 className="size-4" />
              Delete
            </Button>
          </div>
          {phase === "draft" && (
            <Button type="button" className="w-full gap-2" disabled={saving} onClick={() => onPost(event)}>
              <Send className="size-4" />
              {saving ? "Posting..." : "Post event"}
            </Button>
          )}
        </div>
      </div>
    </motion.article>
  );
}

function CalendarView({ events }: { events: EventRow[] }) {
  const [cursor, setCursor] = useState(new Date());

  const grid = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const startOffset = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: Array<{ key: string; date: Date | null; events: EventRow[] }> = [];
    for (let i = 0; i < startOffset; i += 1) {
      cells.push({ key: `pad-${i}`, date: null, events: [] });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(year, month, day);
      const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      cells.push({
        key: `d-${day}`,
        date,
        events: events.filter((event) => event.date === iso),
      });
    }
    while (cells.length % 7 !== 0) cells.push({ key: `tail-${cells.length}`, date: null, events: [] });
    return cells;
  }, [cursor, events]);

  const monthLabel = cursor.toLocaleDateString("en-CA", { month: "long", year: "numeric" });
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <section className="rounded-2xl border border-border bg-bg-surface p-5 lg:p-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="font-serif text-2xl text-white">{monthLabel}</h2>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>Prev</Button>
          <Button variant="outline" size="sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>Next</Button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {dow.map((d) => (
          <div key={d} className="text-center font-mono text-[10px] uppercase tracking-wider text-text-muted">
            {d}
          </div>
        ))}
        {grid.map((cell) => (
          <div
            key={cell.key}
            className={cn(
              "min-h-24 rounded-lg border p-2",
              cell.date ? "border-border/60 bg-bg-elevated/30" : "border-transparent bg-transparent",
            )}
          >
            {cell.date && (
              <>
                <div className="font-mono text-[11px] text-text-muted">{cell.date.getDate()}</div>
                <div className="mt-1 flex flex-col gap-1">
                  {cell.events.map((event) => {
                    const badge = STATUS_BADGE[eventPhase(event)];
                    return (
                      <div
                        key={event.id}
                        className={cn("truncate rounded border px-1.5 py-0.5 text-[10px]", badge.cls)}
                        title={`${event.name} · ${formatShortTime(event.start_time)}`}
                      >
                        {event.name}
                    </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function EventsPage() {
  const { selectedRestaurantId, selectedRestaurant } = useRestaurantScope();
  const { events, loading, saving, createEvent, updateEvent, deleteEvent, uploadEventMedia } = useEvents();
  const [view, setView] = useState<View>("grid");
  const [phase, setPhase] = useState<EventPhase>("active");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EventRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EventRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [previewItem, setPreviewItem] = useState<EventPromotionDisplay | null>(null);

  const restaurantFallback = useMemo(
    () => buildRestaurantFallback(selectedRestaurant),
    [selectedRestaurant],
  );

  const counts = useMemo(() => ({
    active: events.filter((event) => eventPhase(event) === "active").length,
    draft: events.filter((event) => eventPhase(event) === "draft").length,
    past: events.filter((event) => eventPhase(event) === "past").length,
  }), [events]);

  const visibleEvents = useMemo(
    () => events.filter((event) => eventPhase(event) === phase),
    [events, phase],
  );

  const stats = useMemo(() => {
    const upcoming = events.filter((event) => eventPhase(event) === "active");
    const seatsSold = upcoming.reduce((sum, event) => sum + event.tickets_sold, 0);
    const capacity = upcoming.reduce((sum, event) => sum + (event.capacity ?? 0), 0);
    const revenue = upcoming.reduce((sum, event) => sum + event.tickets_sold * (event.price_per_person ?? 0), 0);
    const sellThrough = capacity === 0 ? 0 : Math.round((seatsSold / capacity) * 100);
    return [
      { label: "Upcoming events", value: String(upcoming.length), caption: "posted" },
      { label: "Drafts", value: String(counts.draft), caption: "not visible yet" },
      { label: "Event revenue", value: formatCurrency(revenue, "cad"), caption: "booked" },
      { label: "Sell-through", value: `${sellThrough}%`, caption: "active capacity" },
    ];
  }, [counts.draft, events]);

  const handleSaveEvent = async (values: EventFormValues, isActive: boolean, media?: EventMediaUpload): Promise<boolean> => {
    const payload = valuesToPayload(values, isActive, media);
    if (editTarget && !media) {
      payload.media_url = editTarget.media_url;
      payload.media_type = editTarget.media_type;
      payload.media_name = editTarget.media_name;
      payload.cover_image_url = payload.cover_image_url ?? editTarget.cover_image_url;
    }
    const err = editTarget
      ? await updateEvent(editTarget.id, payload)
      : await createEvent(payload);
    if (err === null) {
      toast.success(editTarget ? (isActive ? "Event posted" : "Event updated") : (isActive ? "Event posted" : "Event saved as draft"));
      setCreateOpen(false);
      setEditTarget(null);
      setPhase(isActive ? "active" : "draft");
      return true;
    } else {
      toast.error(err || "Could not save event. Try again.");
      return false;
    }
  };

  const openCreate = () => {
    setEditTarget(null);
    setCreateOpen(true);
  };

  const openEdit = (event: EventRow) => {
    setEditTarget(event);
    setCreateOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const ok = await deleteEvent(deleteTarget.id);
    setDeleting(false);
    if (ok) {
      toast.success("Event deleted");
      setDeleteTarget(null);
    } else {
      toast.error("Could not delete event.");
    }
  };

  const handlePost = async (event: EventRow) => {
    const err = await updateEvent(event.id, {
      is_active: true,
      end_date: event.end_date ?? event.date,
    });
    if (err === null) {
      toast.success("Event posted");
    setPhase("active");
    } else {
      toast.error(err || "Could not post event.");
    }
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
          <h1 className="mt-2 font-serif text-3xl text-white sm:text-4xl">Events &amp; private dining</h1>
          <p className="mt-1 text-sm italic text-text-muted">
            Build event cards once, preview them, then publish exactly what diners will see.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="default" className="gap-2" onClick={() => setView((v) => (v === "grid" ? "calendar" : "grid"))}>
            {view === "grid" ? <CalendarDays className="size-4" /> : <LayoutGrid className="size-4" />}
            {view === "grid" ? "Calendar view" : "Grid view"}
          </Button>
          <Button size="default" className="gap-2" onClick={openCreate}>
            <Plus className="size-4" />
            Create event
          </Button>
        </div>
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
        {(["active", "draft", "past"] as const).map((key) => (
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
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-72 rounded-2xl" />
          ))}
        </section>
      ) : view === "calendar" ? (
        <CalendarView events={visibleEvents} />
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleEvents.map((event) => (
            <EventCardView
              key={event.id}
              event={event}
              restaurant={restaurantFallback}
              onPreview={setPreviewItem}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
              onPost={(target) => void handlePost(target)}
              saving={saving}
            />
          ))}
          {visibleEvents.length === 0 && (
            <div className="col-span-full flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-bg-surface/40 p-10 text-center lg:min-h-[520px]">
              <Ticket className="mx-auto size-8 text-text-muted" />
              <p className="mt-3 text-sm text-text-muted">No {phase} events.</p>
              {events.length === 0 && (
                <Button size="default" className="mt-4 gap-2" onClick={openCreate}>
                  <Plus className="size-4" />
                  Create event
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      <EventFormDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setEditTarget(null);
        }}
        saving={saving}
        restaurantId={selectedRestaurantId}
        restaurant={restaurantFallback}
        initialEvent={editTarget}
        onCreate={handleSaveEvent}
        onPreview={setPreviewItem}
        uploadEventMedia={uploadEventMedia}
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
              <DialogTitle className="font-serif text-2xl text-white">Delete this event?</DialogTitle>
              <DialogDescription className="mt-2 leading-6 text-text-secondary">
                This will permanently remove
                {" "}
                <span className="font-medium text-white">{deleteTarget?.name ?? "this event"}</span>
                {" "}
                from your dashboard and diner-facing surfaces. This action cannot be undone.
              </DialogDescription>
            </div>
          </DialogHeader>
          <DialogFooter className="mx-0 mb-0 rounded-none border-t border-border bg-bg-surface px-6 py-4 sm:justify-between">
            <Button type="button" variant="ghost" disabled={deleting} onClick={() => setDeleteTarget(null)}>
              Keep event
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={deleting}
              className="gap-2 border-danger/40 bg-danger/10 text-danger hover:border-danger/60 hover:text-danger"
              onClick={() => void handleDelete()}
            >
              <Trash2 className="size-4" />
              {deleting ? "Deleting..." : "Delete event"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AnimatedPage>
  );
}
