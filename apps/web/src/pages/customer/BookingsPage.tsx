import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { format, formatDistanceToNowStrict } from "date-fns";
import { toast } from "sonner";
import {
  Calendar as CalendarIcon,
  CalendarDays,
  CalendarPlus,
  ChevronRight,
  LogOut,
  MapPin,
  Phone,
  PencilLine,
  Plus,
  Search,
  Settings,
  Sparkles,
  Star,
  Tag,
  User,
  Users,
  X,
} from "lucide-react";

import { useUser } from "@/hooks/useUser";
import { useMyReservations, type MyReservationRow } from "@/hooks/useMyReservations";
import { useStaffRestaurants } from "@/hooks/useStaffRestaurants";
import { CenaivaWordmark } from "@/components/brand/CenaivaWordmark";
import { CustomerNav } from "@/components/customer/CustomerNav";
import { CustomerBellDropdown } from "@/components/customer/CustomerBellDropdown";
import { StaffWorkspaceMenuItems } from "@/components/customer/StaffWorkspaceMenuItems";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAssistant } from "@/components/cenaiva/AssistantProvider";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  reservationDisplayStatus,
  reservationDisplayStatusKey,
  type ReservationDisplayStatus,
} from "@/lib/reservations/displayStatus";
import { cn } from "@/lib/utils";
import { formatCompactTimeLabelInTz } from "@/lib/utils/time";

type Tab = "upcoming" | "past" | "cancelled";

type BookingCard = {
  id: string;
  initials: string;
  cuisineLine: string;
  restaurantName: string;
  restaurantSlug: string;
  reservedAt: Date;
  timezone: string | null;
  partySize: number;
  occasion?: string;
  status: ReservationDisplayStatus;
  confirmationCode?: string;
  address?: string;
  phone?: string;
  logoUrl?: string | null;
  coverPhotoUrl?: string | null;
  // Event / promotion linkage (2026-05-11). When the booking was made for
  // a specific event or used a promo code, surface those on the card so the
  // customer can see what they actually signed up for.
  eventName?: string | null;
  eventPrice?: number | null;
  promotionTitle?: string | null;
  promotionCode?: string | null;
};

function adapt(r: MyReservationRow): BookingCard {
  const reservedAt = new Date(r.reserved_at);
  const name = r.restaurant?.name ?? "Restaurant";
  const initials = name.split(/\s+/).slice(0, 1).join(" ").toUpperCase();
  const status = reservationDisplayStatus(r);
  return {
    id: r.id,
    initials,
    restaurantName: name,
    restaurantSlug: r.restaurant?.slug ?? "",
    reservedAt,
    timezone: r.restaurant?.timezone ?? null,
    partySize: r.party_size,
    confirmationCode: r.confirmation_code ?? undefined,
    cuisineLine: [r.restaurant?.cuisine_type, r.restaurant?.city].filter(Boolean).join(" · ").toUpperCase() || name.toUpperCase(),
    address: r.restaurant?.address ?? undefined,
    phone: r.restaurant?.phone ?? undefined,
    logoUrl: r.restaurant?.logo_url ?? null,
    coverPhotoUrl: r.restaurant?.cover_photo_url ?? null,
    status,
    eventName: r.event?.name ?? null,
    eventPrice: r.event?.price_per_person ? Number(r.event.price_per_person) : null,
    promotionTitle: r.promotion?.title ?? null,
    promotionCode: r.promotion?.promo_code ?? r.applied_promo_code ?? null,
  };
}

function BookingRestaurantImage({ booking }: { booking: BookingCard }) {
  return (
    <div className="relative flex aspect-[16/9] w-full items-center justify-center overflow-hidden bg-bg-elevated">
      {booking.coverPhotoUrl ? (
        <img
          src={booking.coverPhotoUrl}
          alt={`${booking.restaurantName} cover`}
          className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-gold/15 via-bg-elevated to-bg-base" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/5 via-black/25 to-bg-base/85" />
      <div className="relative flex size-14 items-center justify-center overflow-hidden rounded-2xl border border-gold/30 bg-bg-elevated font-mono text-xs font-semibold text-gold shadow-lg shadow-black/30">
        {booking.logoUrl ? (
          <img src={booking.logoUrl} alt={`${booking.restaurantName} logo`} className="size-full object-cover" />
        ) : (
          booking.initials
        )}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: BookingCard["status"] }) {
  const { t } = useTranslation();
  const map: Record<BookingCard["status"], { cls: string }> = {
    upcoming: { cls: "text-white" },
    current: { cls: "text-gold" },
    past: { cls: "text-text-secondary" },
    cancelled: { cls: "text-text-muted line-through" },
  };
  const item = map[status];
  return <span className={cn("text-sm font-medium", item.cls)}>{t(reservationDisplayStatusKey(status))}</span>;
}

function relativeLabel(d: Date): string {
  const ms = d.getTime() - Date.now();
  const days = Math.round(ms / (1000 * 60 * 60 * 24));
  if (days === 0) return "TODAY";
  if (days === 1) return "TOMORROW";
  if (days > 0) return `IN ${days} DAYS`;
  return formatDistanceToNowStrict(d, { addSuffix: true }).toUpperCase();
}

function BookingCardView({
  b,
  variant,
  onPrimary,
  onCancel,
  onModify,
  onReview,
  cancelling,
}: {
  b: BookingCard;
  variant: "upcoming" | "past" | "cancelled";
  onPrimary: () => void;
  onCancel?: () => void;
  onModify?: () => void;
  /** Past variant only — opens the Leave a Review modal. */
  onReview?: () => void;
  cancelling?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.35 }}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-bg-surface transition-colors hover:border-gold/40"
    >
      <div className="relative">
        <BookingRestaurantImage booking={b} />
        {variant === "upcoming" && (
          <span className="absolute left-3 top-3 rounded-md border border-gold/40 bg-black/60 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-gold backdrop-blur">
            {relativeLabel(b.reservedAt)}
          </span>
        )}
        <span className="absolute right-3 top-3 rounded-md border border-border bg-black/60 px-2 py-1 backdrop-blur">
          <StatusChip status={b.status} />
        </span>
        <div className="absolute inset-x-0 bottom-0 px-5 pb-5 pt-12">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
            {b.cuisineLine}
          </p>
          <p className="mt-1 font-serif text-3xl text-white">{b.restaurantName}</p>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 px-5 pb-5 pt-5">
        <div className="flex items-baseline gap-2 text-base">
          <span className="text-white">{new Intl.DateTimeFormat("en-US", { timeZone: b.timezone ?? undefined, weekday: "short", month: "long", day: "numeric" }).format(b.reservedAt)}</span>
          <span className="text-text-muted">·</span>
          <span className="font-semibold text-gold">{formatCompactTimeLabelInTz(b.reservedAt, b.timezone)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-3.5 text-text-muted" /> {b.partySize} guests
          </span>
          {b.occasion && (
            <>
              <span className="text-text-muted">·</span>
              <span className="inline-flex items-center gap-1.5">
                <Tag className="size-3.5 text-text-muted" /> {b.occasion}
              </span>
            </>
          )}
        </div>
        {(b.eventName || b.promotionTitle || b.promotionCode) && (
          <div className="flex flex-wrap items-center gap-2">
            {b.eventName && (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-purple-500/40 bg-purple-500/10 px-2 py-1 text-[11px] font-medium text-purple-200">
                🎫 {b.eventName}
                {b.eventPrice != null && (
                  <span className="text-purple-300/80">· ${b.eventPrice.toFixed(0)}/person</span>
                )}
              </span>
            )}
            {(b.promotionTitle || b.promotionCode) && (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-200">
                🏷️ {b.promotionTitle ?? b.promotionCode}
                {b.promotionTitle && b.promotionCode && (
                  <span className="text-amber-300/80">· {b.promotionCode}</span>
                )}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 border-t border-border/60">
        {variant === "past" ? (
          <>
            <button
              type="button"
              onClick={onPrimary}
              className="flex items-center justify-center gap-2 bg-gold py-3 text-sm font-semibold text-black hover:opacity-90"
            >
              <CalendarPlus className="size-4" />
              Book again
            </button>
            <Link
              to={`/bookings/${b.id}`}
              className="flex items-center justify-center gap-2 text-sm text-text-secondary hover:text-white"
            >
              Details <ChevronRight className="size-4" />
            </Link>
            {onReview ? (
              <button
                type="button"
                onClick={onReview}
                className="col-span-2 flex items-center justify-center gap-2 border-t border-border/60 py-3 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-elevated hover:text-gold"
              >
                <Star className="size-4 text-gold" />
                Leave a review
              </button>
            ) : null}
          </>
        ) : (
          <>
            <Link
              to={`/${b.restaurantSlug}`}
              className="flex items-center justify-center py-3 text-sm font-medium text-gold hover:underline"
            >
              View restaurant
            </Link>
            <button
              type="button"
              onClick={onPrimary}
              className="flex items-center justify-center gap-2 text-sm text-text-secondary hover:text-white"
            >
              Details <ChevronRight className="size-4" />
            </button>
            {variant === "upcoming" && onCancel && (
              <>
                <button
                  type="button"
                  onClick={onModify}
                  className="flex items-center justify-center gap-2 border-t border-border/60 py-3 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-elevated hover:text-white"
                >
                  <PencilLine className="size-4" />
                  Modify
                </button>
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={cancelling}
                  className="flex items-center justify-center gap-2 border-t border-border/60 py-3 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <X className="size-4" />
                  {cancelling ? "Cancelling..." : "Cancel"}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}

function NextReservationCard({
  b,
  onModify,
  onCancel,
  cancelling,
}: {
  b: BookingCard;
  onModify: () => void;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const [now] = useState(() => Date.now());
  const days = Math.round((b.reservedAt.getTime() - now) / (1000 * 60 * 60 * 24));
  const inLabel =
    days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;

  return (
    <div className="rounded-2xl border border-gold/40 bg-bg-surface/60 p-5 shadow-lg shadow-gold/5">
      <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.2em] text-gold">
        <span className="inline-flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-gold" /> Next reservation
        </span>
        <span className="text-text-muted">{inLabel}</span>
      </div>

      <p className="mt-5 font-serif text-3xl text-white">{b.restaurantName}</p>
      <p className="mt-1 text-sm text-text-secondary">{b.cuisineLine.toLowerCase()}</p>

      <ul className="mt-5 space-y-3 text-sm">
        <li className="flex items-center gap-2 text-text-secondary">
          <CalendarIcon className="size-4 text-gold" />
          {new Intl.DateTimeFormat("en-US", { timeZone: b.timezone ?? undefined, weekday: "short", month: "long", day: "numeric" }).format(b.reservedAt)} ·{" "}
          <span className="text-white">{formatCompactTimeLabelInTz(b.reservedAt, b.timezone)}</span>
        </li>
        <li className="flex items-center gap-2 text-text-secondary">
          <Users className="size-4 text-gold" />
          {b.partySize} guests {b.occasion && <span className="text-text-muted">· {b.occasion}</span>}
        </li>
        {b.address && (
          <li className="flex items-center gap-2 text-text-secondary">
            <MapPin className="size-4 text-gold" />
            {b.address}
          </li>
        )}
        {b.confirmationCode && (
          <li className="flex items-center gap-2 text-text-secondary">
            <Tag className="size-4 text-gold" />
            <span className="font-mono">{b.confirmationCode}</span>
          </li>
        )}
      </ul>

      <div className="mt-5 grid grid-cols-2 gap-3">
        {b.address ? (
          <Button asChild className="h-10 rounded-md font-semibold">
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address + " " + b.restaurantName)}`}
              target="_blank"
              rel="noreferrer"
            >
              <MapPin className="size-4" /> Directions
            </a>
          </Button>
        ) : (
          <Button disabled className="h-10 rounded-md font-semibold">
            <MapPin className="size-4" /> Directions
          </Button>
        )}
        {b.phone ? (
          <Button asChild variant="outline" className="h-10 rounded-md font-medium">
            <a href={`tel:${b.phone}`}>
              <Phone className="size-4" /> Call
            </a>
          </Button>
        ) : (
          <Button disabled variant="outline" className="h-10 rounded-md font-medium">
            <Phone className="size-4" /> Call
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="h-10 rounded-md font-medium"
          onClick={onModify}
        >
          <PencilLine className="size-4" /> Modify
        </Button>
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelling}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-danger/50 bg-danger/10 text-sm font-medium text-danger transition-colors hover:bg-danger/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <X className="size-4" /> {cancelling ? "Cancelling..." : "Cancel"}
        </button>
      </div>
    </div>
  );
}

async function cancelReservation(reservationId: string): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error("Authentication is not available. Configure Supabase first.");
  }

  const client = getSupabaseBrowserClient();
  const { error, data } = await client.functions.invoke<{ ok?: boolean; error?: string }>(
    "cancel-reservation",
    {
      body: { reservation_id: reservationId },
    },
  );

  if (error || data?.error || data?.ok !== true) {
    throw new Error(data?.error ?? error?.message ?? "Could not cancel reservation.");
  }
}

function QuickActions({
  onFindTable,
  onConcierge,
  onParty,
}: {
  onFindTable: () => void;
  onConcierge: () => void;
  onParty: () => void;
}) {
  const items = [
    {
      icon: Search,
      title: "Find a table",
      sub: "Browse availability tonight",
      onClick: onFindTable,
    },
    {
      icon: Sparkles,
      title: "Plan with Concierge",
      sub: "Voice or chat AI booking",
      onClick: onConcierge,
    },
    {
      icon: Users,
      title: "Manage party",
      sub: "Add guests & allergies",
      onClick: onParty,
    },
  ];
  return (
    <div className="rounded-2xl border border-border bg-bg-surface/60 p-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-text-muted">
        Quick actions
      </p>
      <ul className="mt-4 space-y-3">
        {items.map((it) => (
          <li key={it.title}>
            <button
              type="button"
              onClick={it.onClick}
              className="flex w-full items-center gap-3 rounded-xl border border-transparent p-2 text-left transition-colors hover:border-border hover:bg-bg-elevated"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-gold/30 bg-gold/10">
                <it.icon className="size-4 text-gold" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-white">{it.title}</span>
                <span className="block text-xs text-text-muted">{it.sub}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function BookingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    profile,
    signOut,
    restaurantRoles,
  } = useUser();
  const { restaurants: staffRestaurants } = useStaffRestaurants(restaurantRoles);
  const { upcoming, past, loading, refresh } = useMyReservations();
  const assistant = useAssistant();

  const [tab, setTab] = useState<Tab>("upcoming");
  const [search, setSearch] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  // Leave-a-review modal state. Holds the booking card the user clicked
  // "Leave a review" on; null = closed. We pull guest_id + restaurant_id
  // from the reservations table at submit time to satisfy the NOT NULL
  // constraints on restaurant_reviews.
  const [reviewBooking, setReviewBooking] = useState<BookingCard | null>(null);
  const [reviewRating, setReviewRating] = useState<number>(5);
  const [reviewText, setReviewText] = useState<string>("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  const upcomingCards = useMemo(() => {
    return upcoming
      .map(adapt)
      .sort((a, b) => a.reservedAt.getTime() - b.reservedAt.getTime());
  }, [upcoming]);

  const { pastCards, cancelled } = useMemo(() => {
    const adapted = past.map(adapt);
    return {
      pastCards: adapted.filter((b) => b.status !== "cancelled"),
      cancelled: adapted.filter((b) => b.status === "cancelled"),
    };
  }, [past]);

  const filterBySearch = (list: BookingCard[]) => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (b) =>
        b.restaurantName.toLowerCase().includes(q) ||
        b.cuisineLine.toLowerCase().includes(q) ||
        (b.confirmationCode ?? "").toLowerCase().includes(q),
    );
  };

  const upcomingFiltered = filterBySearch(upcomingCards);
  const pastFiltered = filterBySearch(pastCards);
  const cancelledFiltered = filterBySearch(cancelled);

  const next = upcomingCards[0];

  const initials = (profile?.full_name ?? profile?.email ?? "?")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const handleBookAgain = (b: BookingCard) => {
    navigate(`/${b.restaurantSlug}`);
  };

  const handleSubmitReview = async () => {
    if (!reviewBooking) return;
    // restaurant_reviews.user_id FK references user_profiles(id) — NOT
    // auth.users(id) — so we send profile.id, not profile.auth_user_id.
    // The RLS policy `user_id = current_profile_id()` validates this match.
    if (!profile?.id) {
      toast.error("Please sign in to leave a review.");
      return;
    }
    if (reviewRating < 1 || reviewRating > 5) {
      toast.error("Pick a rating from 1 to 5.");
      return;
    }
    setReviewSubmitting(true);
    try {
      const client = getSupabaseBrowserClient();
      // Pull guest_id + restaurant_id straight from the reservation. The
      // restaurant_reviews table requires both NOT NULL — we can't infer
      // guest_id from useMyReservations's projection.
      const { data: rRow, error: rErr } = await client
        .from("reservations")
        .select("guest_id, restaurant_id")
        .eq("id", reviewBooking.id)
        .single<{ guest_id: string; restaurant_id: string }>();
      if (rErr || !rRow) {
        throw new Error(rErr?.message ?? "Reservation not found");
      }
      const { error } = await client.from("restaurant_reviews").insert({
        reservation_id: reviewBooking.id,
        restaurant_id: rRow.restaurant_id,
        guest_id: rRow.guest_id,
        user_id: profile.id,
        rating: reviewRating,
        review_text: reviewText.trim() || null,
      });
      if (error) {
        if (error.code === "23505") {
          toast.error("You've already reviewed this visit.");
        } else {
          toast.error(error.message);
        }
        return;
      }
      toast.success("Thanks — your review is live.");
      setReviewBooking(null);
      setReviewRating(5);
      setReviewText("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not post review.");
    } finally {
      setReviewSubmitting(false);
    }
  };

  const handleDetails = (b: BookingCard) => {
    navigate(`/bookings/${b.id}`);
  };

  const handleModify = (b: BookingCard) => {
    navigate(`/bookings/${b.id}?modify=1`);
  };

  const handleCancel = async (b: BookingCard) => {
    if (cancellingId) return;
    setCancellingId(b.id);
    try {
      await cancelReservation(b.id);
      await refresh();
      setTab("cancelled");
      toast.success("Reservation cancelled.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel reservation.");
    } finally {
      setCancellingId(null);
    }
  };

  const handleAddToCalendar = () => {
    if (!next) return;
    const start = format(next.reservedAt, "yyyyMMdd'T'HHmmss");
    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
      next.restaurantName,
    )}&dates=${start}/${start}&details=${encodeURIComponent(
      `${next.partySize} guests${next.confirmationCode ? " · " + next.confirmationCode : ""}`,
    )}${next.address ? "&location=" + encodeURIComponent(next.address) : ""}`;
    window.open(url, "_blank", "noreferrer");
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/40 bg-background/85 backdrop-blur-xl">
        <div className="flex h-[5.5rem] w-full items-center px-4 sm:px-5">
          <Link to="/" className="flex shrink-0 items-center" aria-label="Cenaiva home">
            <CenaivaWordmark />
          </Link>

          <CustomerNav />

          <div className="ml-auto flex shrink-0 items-center gap-4">
            <CustomerBellDropdown className="size-11 rounded-full border border-border bg-bg-surface/70 hover:border-gold/40" />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="rounded-full outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-gold/40"
                  aria-label={t("routes.account.title")}
                >
                  <Avatar className="size-11">
                    <AvatarImage src={profile?.avatar_url ?? undefined} />
                    <AvatarFallback className="bg-gold/10 text-sm text-gold">{initials}</AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 min-w-56">
                <DropdownMenuLabel className="truncate">
                  {profile?.full_name ?? profile?.email ?? t("routes.account.title")}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void navigate("/account")}>
                  <User className="size-4" />
                  {t("routes.account.title")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void navigate("/setup")}>
                  <Plus className="size-4" />
                  {t("dashboard.shell.setupRestaurant")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void navigate("/account")}>
                  <Settings className="size-4" />
                  Settings
                </DropdownMenuItem>
                <StaffWorkspaceMenuItems
                  restaurants={staffRestaurants}
                  restaurantRoles={restaurantRoles}
                />
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => void signOut()}>
                  <LogOut className="size-4" />
                  {t("dashboard.shell.signOut")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="w-full px-12 py-10 sm:px-16 md:px-20 lg:px-24 xl:px-32 2xl:px-40 lg:py-12">
        {/* Header row */}
        <div className="border-b border-border/40 pb-10">
          <div className="text-center">
            <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-gold">
              <span className="inline-block h-px w-3 bg-gold/60" /> Your reservations
            </span>
            <h1 className="mt-4 font-serif text-5xl leading-[1.05] text-white sm:text-6xl">
              Bookings
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-base text-text-secondary">
              Manage upcoming reservations, revisit past meals, and book again with one
              tap.
            </p>
          </div>
        </div>

        {/* Search + tabs */}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by restaurant, cuisine, or confirmation code…"
              className="h-14 w-full rounded-2xl border border-border bg-bg-surface/70 pl-12 pr-5 text-sm text-white placeholder:text-text-muted focus:border-gold/50 focus:outline-none"
            />
          </div>
          <div className="inline-flex h-14 items-center gap-1 rounded-2xl border border-border bg-bg-surface/70 p-1">
            {(
              [
                { id: "upcoming" as Tab, label: "Upcoming", count: upcomingCards.length },
                { id: "past" as Tab, label: "Past", count: pastCards.length },
                { id: "cancelled" as Tab, label: "Cancelled", count: cancelled.length },
              ]
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "inline-flex h-full items-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors",
                  tab === t.id
                    ? "bg-gold text-black"
                    : "text-text-secondary hover:text-white",
                )}
              >
                {t.label}
                <span
                  className={cn(
                    "inline-flex size-5 items-center justify-center rounded-md font-mono text-xs",
                    tab === t.id
                      ? "bg-black/15"
                      : "bg-bg-elevated text-text-muted",
                  )}
                >
                  {t.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Body grid: list + sidebar */}
        <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_340px]">
          <section>
            {tab === "upcoming" && (
              <>
                <div className="flex items-end justify-between">
                  <h2 className="font-serif text-3xl text-white">
                    Upcoming reservations{" "}
                    <span className="font-mono text-sm text-text-muted">
                      · {upcomingFiltered.length}
                    </span>
                  </h2>
                  <button
                    type="button"
                    onClick={handleAddToCalendar}
                    className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-white"
                  >
                    <CalendarPlus className="size-4 text-gold" />
                    Add to calendar
                  </button>
                </div>
                {loading && (
                  <p className="mt-4 text-xs text-text-muted">Loading reservations…</p>
                )}
                {upcomingFiltered.length === 0 ? (
                  <EmptyState
                    title="No upcoming reservations"
                    sub="Find a table to start the next plan."
                    cta={{ label: "Find a table", to: "/discover" }}
                  />
                ) : (
                  <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                    {upcomingFiltered.map((b) => (
                      <BookingCardView
                        key={b.id}
                        b={b}
                        variant="upcoming"
                        onPrimary={() => handleDetails(b)}
                        onModify={() => handleModify(b)}
                        onCancel={() => void handleCancel(b)}
                        cancelling={cancellingId === b.id}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {tab === "past" && (
              <>
                <h2 className="font-serif text-3xl text-white">
                  Past meals{" "}
                  <span className="font-mono text-sm text-text-muted">
                    · {pastFiltered.length}
                  </span>
                </h2>
                {pastFiltered.length === 0 ? (
                  <EmptyState
                    title="No past meals yet"
                    sub="Once you've dined, your history shows up here."
                  />
                ) : (
                  <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                    {pastFiltered.map((b) => (
                      <BookingCardView
                        key={b.id}
                        b={b}
                        variant="past"
                        onPrimary={() => handleBookAgain(b)}
                        onReview={() => setReviewBooking(b)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {tab === "cancelled" && (
              <>
                <h2 className="font-serif text-3xl text-white">
                  Cancelled{" "}
                  <span className="font-mono text-sm text-text-muted">
                    · {cancelledFiltered.length}
                  </span>
                </h2>
                {cancelledFiltered.length === 0 ? (
                  <EmptyState
                    title="Nothing cancelled"
                    sub="Cancellations show up here."
                  />
                ) : (
                  <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                    {cancelledFiltered.map((b) => (
                      <BookingCardView
                        key={b.id}
                        b={b}
                        variant="cancelled"
                        onPrimary={() => handleDetails(b)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </section>

          {/* Sidebar */}
          <aside className="space-y-5">
            {next && (
              <NextReservationCard
                b={next}
                onModify={() => handleModify(next)}
                onCancel={() => void handleCancel(next)}
                cancelling={cancellingId === next.id}
              />
            )}
            <QuickActions
              onFindTable={() => navigate("/discover")}
              onConcierge={() => assistant?.open(undefined, undefined, { autoListen: false })}
              onParty={() => navigate("/account")}
            />
          </aside>
        </div>
      </main>

      {/* Leave-a-review modal. Triggered from past-card "Leave a review"
          button. Inserts into restaurant_reviews; photos are mobile-only. */}
      <Dialog
        open={reviewBooking !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReviewBooking(null);
            setReviewRating(5);
            setReviewText("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Leave a review</DialogTitle>
            <DialogDescription>
              Share how it went at{" "}
              <span className="text-white">{reviewBooking?.restaurantName}</span>. Adding photos to
              your review is available in the mobile app.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Rating</p>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setReviewRating(value)}
                    aria-label={`${value} star${value === 1 ? "" : "s"}`}
                    className="rounded-md p-1 transition-colors hover:bg-bg-elevated"
                  >
                    <Star
                      className={`size-7 ${
                        value <= reviewRating ? "fill-gold text-gold" : "text-text-muted"
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">
                Tell other diners (optional)
              </p>
              <Textarea
                value={reviewText}
                onChange={(e) => setReviewText(e.target.value)}
                placeholder="What stood out? Service, ambiance, dishes..."
                rows={4}
                maxLength={800}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="ghost"
              onClick={() => setReviewBooking(null)}
              disabled={reviewSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmitReview}
              disabled={reviewSubmitting || reviewRating < 1}
              className="gap-1.5"
            >
              <Star className="size-4" />
              {reviewSubmitting ? "Posting..." : "Post review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({
  title,
  sub,
  cta,
}: {
  title: string;
  sub: string;
  cta?: { label: string; to: string };
}) {
  return (
    <div className="mt-10 flex flex-col items-start gap-3 rounded-2xl border border-border bg-bg-surface/40 p-10">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-gold/10">
        <CalendarDays className="size-6 text-gold" />
      </span>
      <p className="font-serif text-2xl text-white">{title}</p>
      <p className="text-sm text-text-muted">{sub}</p>
      {cta && (
        <Button asChild className="mt-2 h-10 rounded-md font-semibold">
          <Link to={cta.to}>{cta.label}</Link>
        </Button>
      )}
    </div>
  );
}
