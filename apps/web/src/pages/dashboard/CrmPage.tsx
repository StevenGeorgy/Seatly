import { useEffect, useMemo, useState, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, CheckCircle2, Heart, Loader2, Mail, Search, UserRound } from "lucide-react";
import { motion } from "framer-motion";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { useCrmCampaigns, type CampaignSourceType, type SendCampaignResult } from "@/hooks/useCrmCampaigns";
import { useEvents, type EventRow } from "@/hooks/useEvents";
import { useGuests, type GuestRow } from "@/hooks/useGuests";
import { usePromotions, type PromotionRow } from "@/hooks/usePromotions";
import {
  CAMPAIGN_SEGMENTS,
  VIP_VISIT_THRESHOLD,
  segmentForGuest,
  type CampaignSegment,
  type CrmSegment,
} from "@/lib/crm/segments";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { cn } from "@/lib/utils";

type TabKey = "all" | CrmSegment;
type TranslationFn = ReturnType<typeof useTranslation>["t"];

type CrmGuestRow = {
  source: GuestRow;
  initials: string;
  name: string;
  contact: string;
  segment: CrmSegment;
  segmentLabel: string;
  visits: number;
  lastVisit: string;
  lifetime: number;
  avgTicket: number;
  points: number;
  notes: string[];
};

type CampaignOption = {
  key: string;
  type: CampaignSourceType;
  id: string;
  title: string;
  subtitle: string;
  status: "active" | "draft";
};

const campaignSchema = z.object({
  targetSegments: z.array(z.enum(["vip", "loyalty", "returning"])).min(1),
  sourceKey: z.string().min(1),
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(3).max(500),
});

type CampaignFormValues = z.infer<typeof campaignSchema>;

const SEGMENT_CLASSES: Record<CrmSegment, string> = {
  blocked: "border-danger/40 bg-danger/10 text-danger",
  vip: "border-gold/40 bg-gold/10 text-gold",
  loyalty: "border-info/40 bg-info/10 text-info",
  returning: "border-success/40 bg-success/10 text-success",
  new: "border-border bg-bg-elevated text-text-muted",
};

const AVATAR_CLASSES: Record<CrmSegment, string> = {
  blocked: "border-danger/40 bg-danger/10 text-danger",
  vip: "border-gold/40 bg-gold/10 text-gold",
  loyalty: "border-info/40 bg-info/10 text-info",
  returning: "border-success/40 bg-success/10 text-success",
  new: "border-gold/40 bg-gold/10 text-gold",
};

function segmentLabel(segment: CrmSegment, t: TranslationFn): string {
  return t(`dashboard.crm.segment.${segment}`);
}

function initialsForGuest(name: string): string {
  const parts = name
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function daysAgoLabel(value: string | null, t: TranslationFn): string {
  if (!value) return t("dashboard.crm.never");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("dashboard.crm.never");
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
  if (days === 0) return t("dashboard.crm.today");
  if (days === 1) return t("dashboard.crm.yesterday");
  return t("dashboard.crm.daysAgo", { count: days });
}

function notesForGuest(guest: GuestRow, t: TranslationFn): string[] {
  return [
    ...(guest.tags ?? []),
    ...(guest.allergies ?? []).map((allergy) => t("dashboard.crm.allergyTag", { allergy })),
    ...(guest.dietary_restrictions ?? []),
    guest.seating_preference ? t("dashboard.crm.seatingTag", { preference: guest.seating_preference }) : null,
  ].filter((note): note is string => Boolean(note));
}

function formatCampaignDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function campaignVisibilityLabel(isPrivate: boolean | null | undefined, t: TranslationFn): string {
  return isPrivate ? t("dashboard.crm.campaignOnlyLabel") : t("dashboard.crm.campaignPublicLabel");
}

function eventSubtitle(event: EventRow, t: TranslationFn): string {
  return [
    event.is_active ? t("dashboard.crm.campaignActiveLabel") : t("dashboard.crm.campaignDraftLabel"),
    campaignVisibilityLabel(event.is_private, t),
    formatCampaignDate(event.date),
    event.theme,
  ].filter(Boolean).join(" · ");
}

function promotionSubtitle(promotion: PromotionRow, t: TranslationFn): string {
  const endDate = formatCampaignDate(promotion.ends_at);
  const timing = endDate
    ? t("dashboard.crm.campaignEndsAt", { date: endDate })
    : promotion.is_recurring
    ? t("dashboard.crm.campaignRecurringPromotion")
    : t("dashboard.crm.campaignActivePromotion");
  return [
    promotion.is_active ? t("dashboard.crm.campaignActiveLabel") : t("dashboard.crm.campaignDraftLabel"),
    campaignVisibilityLabel(promotion.is_private, t),
    timing,
  ].filter(Boolean).join(" · ");
}

function isCampaignEventAvailable(event: EventRow): boolean {
  if (!event.is_active) return true;
  const today = new Date().toISOString().slice(0, 10);
  return (event.end_date ?? event.date) >= today;
}

function isCampaignPromotionAvailable(promotion: PromotionRow): boolean {
  if (!promotion.is_active) return true;
  const now = new Date();
  if (promotion.is_recurring) {
    return !promotion.recurrence_end_at || new Date(promotion.recurrence_end_at) > now;
  }
  return !promotion.ends_at || new Date(promotion.ends_at) > now;
}

function campaignOptions(events: EventRow[], promotions: PromotionRow[], t: TranslationFn): CampaignOption[] {
  return [
    ...events
      .filter(isCampaignEventAvailable)
      .map((event) => ({
        key: `event:${event.id}`,
        type: "event" as const,
        id: event.id,
        title: event.name,
        subtitle: eventSubtitle(event, t),
        status: event.is_active ? "active" as const : "draft" as const,
      })),
    ...promotions
      .filter(isCampaignPromotionAvailable)
      .map((promotion) => ({
        key: `promotion:${promotion.id}`,
        type: "promotion" as const,
        id: promotion.id,
        title: promotion.title,
        subtitle: promotionSubtitle(promotion, t),
        status: promotion.is_active ? "active" as const : "draft" as const,
      })),
  ];
}

function adaptGuest(guest: GuestRow, t: TranslationFn): CrmGuestRow {
  const name = guest.full_name || guest.email || guest.phone || t("dashboard.crm.unnamedGuest");
  const visits = guest.total_visits ?? 0;
  const totalSpend = Number(guest.total_spend ?? 0);
  const averageSpend = Number(guest.average_spend_per_visit ?? (visits > 0 ? totalSpend / visits : 0));
  const segment = segmentForGuest(guest);

  return {
    source: guest,
    initials: initialsForGuest(name),
    name,
    contact: guest.email || guest.phone || t("dashboard.crm.noContact"),
    segment,
    segmentLabel: segmentLabel(segment, t),
    visits,
    lastVisit: daysAgoLabel(guest.last_visit_at, t),
    lifetime: totalSpend,
    avgTicket: averageSpend,
    points: guest.loyalty_points_balance ?? 0,
    notes: notesForGuest(guest, t),
  };
}

export default function CrmPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>("all");
  const [query, setQuery] = useState("");
  const [selectedGuest, setSelectedGuest] = useState<GuestRow | null>(null);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [campaignResult, setCampaignResult] = useState<SendCampaignResult | null>(null);
  const [campaignActivationError, setCampaignActivationError] = useState(false);
  const [activatingCampaignSource, setActivatingCampaignSource] = useState(false);
  const { selectedRestaurant, selectedRestaurantId } = useRestaurantScope();
  const currency = selectedRestaurant?.currency ?? "cad";
  const { guests, loading, error } = useGuests();
  const { events, loading: eventsLoading, updateEvent } = useEvents();
  const { promotions, loading: promotionsLoading, updatePromotion } = usePromotions();
  const { sending, error: campaignError, sendCampaign } = useCrmCampaigns();

  const form = useForm<CampaignFormValues>({
    resolver: zodResolver(campaignSchema),
    defaultValues: {
      targetSegments: ["vip"],
      sourceKey: "",
      title: "",
      body: "",
    },
  });

  const rows = useMemo(() => guests.map((guest) => adaptGuest(guest, t)), [guests, t]);
  const options = useMemo(() => campaignOptions(events, promotions, t), [events, promotions, t]);
  const selectedSourceKey = useWatch({ control: form.control, name: "sourceKey" });
  const selectedSource = useMemo(
    () => options.find((option) => option.key === selectedSourceKey) ?? null,
    [options, selectedSourceKey],
  );

  const counts = useMemo(() => ({
    all: rows.length,
    blocked: rows.filter((row) => row.segment === "blocked").length,
    vip: rows.filter((row) => row.segment === "vip").length,
    loyalty: rows.filter((row) => row.segment === "loyalty").length,
    returning: rows.filter((row) => row.segment === "returning").length,
    new: rows.filter((row) => row.segment === "new").length,
  }), [rows]);

  const totalSpend = useMemo(() => rows.reduce((sum, row) => sum + row.lifetime, 0), [rows]);
  const repeatGuests = counts.vip + counts.loyalty + counts.returning;
  const repeatRate = rows.length > 0 ? Math.round((repeatGuests / rows.length) * 100) : 0;

  const stats = [
    { label: t("dashboard.crm.guestsInBook"), value: String(rows.length), caption: t("dashboard.crm.totalProfiles") },
    { label: t("dashboard.crm.activeVips"), value: String(counts.vip), caption: t("dashboard.crm.vipThreshold", { count: VIP_VISIT_THRESHOLD }) },
    { label: t("dashboard.crm.totalLtv"), value: formatCurrency(totalSpend, currency), caption: t("dashboard.crm.allTimeSpend") },
    { label: t("dashboard.crm.repeatRate"), value: `${repeatRate}%`, caption: t("dashboard.crm.repeatRateCaption") },
  ];

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (tab !== "all" && row.segment !== tab) return false;
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.contact.toLowerCase().includes(q) ||
        row.notes.join(" ").toLowerCase().includes(q)
      );
    });
  }, [query, rows, tab]);

  const selected = selectedGuest ? adaptGuest(selectedGuest, t) : null;
  const campaignLoading = eventsLoading || promotionsLoading;
  const reachableGuests = rows.filter((row) => (
    CAMPAIGN_SEGMENTS.includes(row.segment as CampaignSegment) &&
    row.source.user_profile_id
  )).length;

  useEffect(() => {
    if (!campaignOpen) return;
    if (!selectedSource && options[0]) {
      form.setValue("sourceKey", options[0].key, { shouldValidate: true });
    }
  }, [campaignOpen, form, options, selectedSource]);

  useEffect(() => {
    if (!campaignOpen || !selectedSource) return;
    const currentTitle = form.getValues("title");
    const currentBody = form.getValues("body");
    if (!currentTitle.trim()) {
      form.setValue("title", t("dashboard.crm.campaignDefaultTitle", { title: selectedSource.title }), {
        shouldValidate: true,
      });
    }
    if (!currentBody.trim()) {
      form.setValue(
        "body",
        t("dashboard.crm.campaignDefaultBody", {
          restaurant: selectedRestaurant?.name ?? t("dashboard.crm.campaignRestaurantFallback"),
          title: selectedSource.title,
        }),
        { shouldValidate: true },
      );
    }
  }, [campaignOpen, form, selectedRestaurant?.name, selectedSource, t]);

  const handleSendCampaign = form.handleSubmit(async (values) => {
    if (!selectedRestaurantId) return;
    setCampaignResult(null);
    setCampaignActivationError(false);
    const source = options.find((option) => option.key === values.sourceKey);
    if (!source) {
      form.setError("sourceKey", { message: t("dashboard.crm.campaignSourceRequired") });
      return;
    }

    if (source.status === "draft") {
      const activateDraft = source.type === "event"
        ? updateEvent(source.id, { is_active: true, is_private: true })
        : updatePromotion(source.id, { is_active: true, is_private: true });
      setActivatingCampaignSource(true);
      const activationError = await activateDraft;
      setActivatingCampaignSource(false);
      if (activationError) {
        setCampaignActivationError(true);
        return;
      }
    }

    const result = await sendCampaign({
      restaurantId: selectedRestaurantId,
      sourceType: source.type,
      sourceId: source.id,
      targetSegments: values.targetSegments,
      title: values.title.trim(),
      body: values.body.trim(),
    });

    if (result) {
      setCampaignResult(result);
    }
  });

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
            <Heart className="size-3.5" />
            {t("dashboard.crm.eyebrow")}
          </p>
          <h1 className="mt-2 font-serif text-3xl text-white sm:text-4xl">{t("dashboard.crm.heading")}</h1>
          <p className="mt-1 text-sm italic text-text-muted">
            {t("dashboard.crm.subtitle")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="default"
            className="gap-2"
            disabled={loading || !selectedRestaurantId}
            onClick={() => {
              setCampaignResult(null);
              setCampaignOpen(true);
            }}
          >
            <Mail className="size-4" />
            {t("dashboard.crm.sendCampaign")}
          </Button>
        </div>
      </motion.header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <article key={stat.label} className="rounded-2xl border border-border bg-bg-surface p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
              {stat.label}
            </p>
            <p className="mt-3 font-serif text-4xl text-white">{stat.value}</p>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-text-muted">
              <span>{stat.caption}</span>
            </p>
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-border bg-bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-elevated/40 p-1">
            {(["all", "vip", "loyalty", "returning", "new", "blocked"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                  tab === key ? "bg-gold/15 text-gold" : "text-text-muted hover:text-text-secondary",
                )}
              >
                {key === "all" ? t("dashboard.crm.segment.all") : segmentLabel(key, t)}
                <span className={cn("font-mono text-[10px]", tab === key ? "text-gold/80" : "text-text-muted")}>
                  {counts[key]}
                </span>
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("dashboard.crm.searchPlaceholder")}
              className="h-9 w-full rounded-md border border-border bg-bg-elevated/50 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-gold/40 focus:outline-none"
            />
          </div>
        </div>

        {loading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 7 }).map((_, index) => (
              <Skeleton key={index} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <div className="flex items-center gap-3 p-5 text-sm text-danger">
            <AlertTriangle className="size-4" />
            {t("dashboard.crm.loadFailed")}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="flex size-12 items-center justify-center rounded-full border border-border bg-bg-elevated text-gold">
              <UserRound className="size-5" />
            </div>
            <div>
              <h2 className="font-serif text-2xl text-white">{t("dashboard.crm.noGuests")}</h2>
              <p className="mt-2 max-w-md text-sm text-text-muted">{t("dashboard.crm.noGuestsDesc")}</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left">
            <thead>
              <tr className="border-b border-border/60 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                <th className="px-5 py-3 font-medium">{t("dashboard.crm.guest")}</th>
                <th className="px-5 py-3 font-medium">{t("dashboard.crm.segmentLabel")}</th>
                <th className="px-5 py-3 font-medium">{t("dashboard.crm.visits")}</th>
                <th className="px-5 py-3 font-medium">{t("dashboard.crm.lastVisit")}</th>
                <th className="px-5 py-3 font-medium">{t("dashboard.crm.totalSpend")}</th>
                <th className="px-5 py-3 font-medium">{t("dashboard.crm.avgTicket")}</th>
                <th className="px-5 py-3 font-medium">{t("dashboard.crm.loyaltyPoints")}</th>
                <th className="px-5 py-3 font-medium">{t("dashboard.crm.notes")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {visible.map((row) => (
                <tr
                  key={row.source.id}
                  className="cursor-pointer text-sm transition-colors hover:bg-bg-elevated/30"
                  onClick={() => setSelectedGuest(row.source)}
                >
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-semibold",
                          AVATAR_CLASSES[row.segment],
                        )}
                      >
                        {row.initials}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-text-primary">{row.name}</p>
                        <p className="truncate text-xs text-text-muted">{row.contact}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider",
                        SEGMENT_CLASSES[row.segment],
                      )}
                    >
                      {row.segmentLabel}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-text-secondary">{row.visits}</td>
                  <td className="px-5 py-4 text-text-secondary">{row.lastVisit}</td>
                  <td className="px-5 py-4 text-text-primary">{formatCurrency(row.lifetime, currency)}</td>
                  <td className="px-5 py-4 text-text-secondary">{formatCurrency(row.avgTicket, currency)}</td>
                  <td className="px-5 py-4 text-text-secondary">{row.points}</td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap gap-1.5">
                      {(row.notes.length > 0 ? row.notes.slice(0, 3) : [t("dashboard.crm.noNotes")]).map((note) => (
                        <span
                          key={note}
                          className="rounded-md border border-border bg-bg-elevated/60 px-2 py-0.5 text-[11px] text-text-secondary"
                        >
                          {note}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>

      <Dialog open={campaignOpen} onOpenChange={setCampaignOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto bg-bg-surface text-text-primary sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl text-white">
              {t("dashboard.crm.campaignDialogTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("dashboard.crm.campaignDialogDesc")}
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-5" onSubmit={(event) => void handleSendCampaign(event)}>
            <section className="rounded-2xl border border-border bg-bg-elevated/40 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-serif text-xl text-white">{t("dashboard.crm.campaignAudience")}</h3>
                  <p className="mt-1 text-sm text-text-muted">
                    {t("dashboard.crm.campaignAudienceHint", { count: reachableGuests })}
                  </p>
                </div>
                <span className="rounded-full border border-gold/30 bg-gold/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-gold">
                  {t("dashboard.crm.campaignInApp")}
                </span>
              </div>

              <Controller
                control={form.control}
                name="targetSegments"
                render={({ field }) => (
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    {CAMPAIGN_SEGMENTS.map((segment) => {
                      const checked = field.value.includes(segment);
                      return (
                        <label
                          key={segment}
                          className={cn(
                            "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                            checked
                              ? "border-gold/40 bg-gold/10 text-text-primary"
                              : "border-border bg-bg-surface/70 text-text-secondary hover:border-gold/30",
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(next) => {
                              const value = next === true
                                ? [...field.value, segment]
                                : field.value.filter((item) => item !== segment);
                              field.onChange(value);
                            }}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="block text-sm font-medium">{segmentLabel(segment, t)}</span>
                            <span className="mt-1 block text-xs text-text-muted">
                              {t(`dashboard.crm.campaignSegmentHint.${segment}`)}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              />
              {form.formState.errors.targetSegments?.message ? (
                <p className="mt-2 text-xs text-danger">{t("dashboard.crm.campaignAudienceRequired")}</p>
              ) : null}
            </section>

            <section className="space-y-3 rounded-2xl border border-border bg-bg-elevated/40 p-4">
              <div>
                <h3 className="font-serif text-xl text-white">{t("dashboard.crm.campaignOffer")}</h3>
                <p className="mt-1 text-sm text-text-muted">{t("dashboard.crm.campaignOfferHint")}</p>
              </div>
              <p className="rounded-xl border border-gold/20 bg-gold/10 px-3 py-2 text-xs text-gold">
                {t("dashboard.crm.campaignDraftHint")}
              </p>
              <Controller
                control={form.control}
                name="sourceKey"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={campaignLoading || options.length === 0}>
                    <SelectTrigger className="w-full bg-bg-surface/80">
                      <SelectValue placeholder={t("dashboard.crm.campaignSelectOffer")} />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((option) => (
                        <SelectItem key={option.key} value={option.key}>
                          <span className="flex flex-col items-start">
                            <span className="flex items-center gap-2">
                              <span>{option.title}</span>
                              {option.status === "draft" ? (
                                <span className="rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-gold">
                                  {t("dashboard.crm.campaignDraftLabel")}
                                </span>
                              ) : null}
                            </span>
                            <span className="text-xs text-text-muted">{option.subtitle}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {options.length === 0 && !campaignLoading ? (
                <div className="rounded-xl border border-border bg-bg-surface/80 p-3">
                  <p className="text-xs text-warning">{t("dashboard.crm.campaignNoOffers")}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void navigate("/dashboard/events")}
                    >
                      {t("dashboard.crm.campaignCreateDraftEvent")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void navigate("/dashboard/promotions")}
                    >
                      {t("dashboard.crm.campaignCreateDraftPromotion")}
                    </Button>
                  </div>
                </div>
              ) : null}
              {form.formState.errors.sourceKey?.message ? (
                <p className="text-xs text-danger">{t("dashboard.crm.campaignSourceRequired")}</p>
              ) : null}
            </section>

            <section className="space-y-3 rounded-2xl border border-border bg-bg-elevated/40 p-4">
              <div>
                <h3 className="font-serif text-xl text-white">{t("dashboard.crm.campaignMessage")}</h3>
                <p className="mt-1 text-sm text-text-muted">{t("dashboard.crm.campaignMessageHint")}</p>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.16em] text-text-muted" htmlFor="campaign-title">
                  {t("dashboard.crm.campaignTitleLabel")}
                </label>
                <Input id="campaign-title" {...form.register("title")} />
                {form.formState.errors.title?.message ? (
                  <p className="text-xs text-danger">{t("dashboard.crm.campaignTitleRequired")}</p>
                ) : null}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.16em] text-text-muted" htmlFor="campaign-body">
                  {t("dashboard.crm.campaignBodyLabel")}
                </label>
                <Textarea id="campaign-body" rows={4} {...form.register("body")} />
                {form.formState.errors.body?.message ? (
                  <p className="text-xs text-danger">{t("dashboard.crm.campaignBodyRequired")}</p>
                ) : null}
              </div>
            </section>

            {campaignActivationError ? (
              <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{t("dashboard.crm.campaignDraftActivateFailed")}</span>
              </div>
            ) : null}

            {campaignError ? (
              <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{t("dashboard.crm.campaignSendFailed")}</span>
              </div>
            ) : null}

            {campaignResult ? (
              <div className="flex items-start gap-2 rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                <span>
                  {t("dashboard.crm.campaignSentSummary", {
                    sent: campaignResult.sentCount,
                    skipped: campaignResult.skippedCount,
                  })}
                </span>
              </div>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCampaignOpen(false)} disabled={sending || activatingCampaignSource}>
                {t("dashboard.crm.campaignCancel")}
              </Button>
              <Button type="submit" disabled={sending || activatingCampaignSource || campaignLoading || options.length === 0 || !selectedRestaurantId}>
                {sending || activatingCampaignSource ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                {t("dashboard.crm.campaignSend")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Sheet open={selectedGuest !== null} onOpenChange={(open) => { if (!open) setSelectedGuest(null); }}>
        <SheetContent className="w-full overflow-y-auto bg-bg-surface sm:max-w-xl">
          {selected && selectedGuest ? (
            <>
              <SheetHeader className="border-b border-border px-6 py-5">
                <SheetTitle className="font-serif text-2xl text-white">{selected.name}</SheetTitle>
                <SheetDescription>{selected.contact}</SheetDescription>
              </SheetHeader>
              <div className="space-y-5 px-6 pb-6">
                <section className="grid grid-cols-2 gap-3">
                  <ProfileMetric label={t("dashboard.crm.segmentLabel")} value={selected.segmentLabel} />
                  <ProfileMetric label={t("dashboard.crm.visits")} value={String(selected.visits)} />
                  <ProfileMetric label={t("dashboard.crm.totalSpend")} value={formatCurrency(selected.lifetime, currency)} />
                  <ProfileMetric label={t("dashboard.crm.loyaltyPoints")} value={String(selected.points)} />
                </section>

                <ProfileSection title={t("dashboard.crm.preferences")}>
                  <DetailLine label={t("dashboard.crm.seatingPreference")} value={selectedGuest.seating_preference} />
                  <DetailLine label={t("dashboard.crm.noisePreference")} value={selectedGuest.noise_preference} />
                  <DetailList label={t("dashboard.crm.dietaryRestrictions")} values={selectedGuest.dietary_restrictions} />
                  <DetailList label={t("dashboard.crm.allergies")} values={selectedGuest.allergies} />
                </ProfileSection>

                <ProfileSection title={t("dashboard.crm.favorites")}>
                  <DetailList label={t("dashboard.crm.favoriteDishes")} values={selectedGuest.favourite_dishes} />
                  <DetailList label={t("dashboard.crm.favoriteDrinks")} values={selectedGuest.favourite_drinks} />
                </ProfileSection>

                <ProfileSection title={t("dashboard.crm.notes")}>
                  <p className="rounded-xl border border-border bg-bg-elevated/50 p-3 text-sm text-text-secondary">
                    {selectedGuest.internal_notes || t("dashboard.crm.noInternalNotes")}
                  </p>
                </ProfileSection>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </AnimatedPage>
  );
}

function ProfileMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg-elevated/50 p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">{label}</p>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function ProfileSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="font-serif text-xl text-white">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function DetailLine({ label, value }: { label: string; value?: string | null }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border/70 bg-bg-elevated/30 px-3 py-2 text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="text-right text-text-primary">{value || t("dashboard.crm.notSet")}</span>
    </div>
  );
}

function DetailList({ label, values }: { label: string; values?: string[] | null }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-border/70 bg-bg-elevated/30 px-3 py-2 text-sm">
      <p className="text-text-muted">{label}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(values && values.length > 0 ? values : [t("dashboard.crm.notSet")]).map((value) => (
          <span key={value} className="rounded-md border border-border bg-bg-surface px-2 py-0.5 text-xs text-text-secondary">
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}
