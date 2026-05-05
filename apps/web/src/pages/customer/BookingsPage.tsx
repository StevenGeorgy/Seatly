import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { format, formatDistanceToNowStrict } from "date-fns";
import { toast } from "sonner";
import {
  Bell,
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
  Tag,
  User,
  Users,
  X,
} from "lucide-react";

import { useUser } from "@/hooks/useUser";
import { useMyReservations, type MyReservationRow } from "@/hooks/useMyReservations";
import { useStaffRestaurants } from "@/hooks/useStaffRestaurants";
import { CustomerNav } from "@/components/customer/CustomerNav";
import { StaffWorkspaceMenuItems } from "@/components/customer/StaffWorkspaceMenuItems";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAssistant } from "@/components/cenaiva/AssistantProvider";
import { useNotifications } from "@/hooks/useNotifications";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { formatCompactTimeLabel } from "@/lib/utils/time";

type Tab = "upcoming" | "past" | "cancelled";

type BookingCard = {
  id: string;
  initials: string;
  cuisineLine: string;
  restaurantName: string;
  restaurantSlug: string;
  reservedAt: Date;
  partySize: number;
  occasion?: string;
  status: "confirmed" | "pending" | "completed" | "cancelled";
  confirmationCode?: string;
  address?: string;
  phone?: string;
  logoUrl?: string | null;
  coverPhotoUrl?: string | null;
};

function adapt(r: MyReservationRow): BookingCard {
  const reservedAt = new Date(r.reserved_at);
  const name = r.restaurant?.name ?? "Restaurant";
  const initials = name.split(/\s+/).slice(0, 1).join(" ").toUpperCase();
  const status: BookingCard["status"] =
    r.status === "cancelled"
      ? "cancelled"
      : reservedAt.getTime() < Date.now()
        ? "completed"
        : r.status === "pending"
          ? "pending"
          : "confirmed";
  return {
    id: r.id,
    initials,
    restaurantName: name,
    restaurantSlug: r.restaurant?.slug ?? "",
    reservedAt,
    partySize: r.party_size,
    confirmationCode: r.confirmation_code ?? undefined,
    cuisineLine: [r.restaurant?.cuisine_type, r.restaurant?.city].filter(Boolean).join(" · ").toUpperCase() || name.toUpperCase(),
    address: r.restaurant?.address ?? undefined,
    phone: r.restaurant?.phone ?? undefined,
    logoUrl: r.restaurant?.logo_url ?? null,
    coverPhotoUrl: r.restaurant?.cover_photo_url ?? null,
    status,
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
  const map: Record<BookingCard["status"], { label: string; cls: string }> = {
    confirmed: { label: "Confirmed", cls: "text-white" },
    pending: { label: "Pending", cls: "text-amber-400" },
    completed: { label: "Completed", cls: "text-text-secondary" },
    cancelled: { label: "Cancelled", cls: "text-text-muted line-through" },
  };
  const item = map[status];
  return <span className={cn("text-sm font-medium", item.cls)}>{item.label}</span>;
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
  cancelling,
}: {
  b: BookingCard;
  variant: "upcoming" | "past" | "cancelled";
  onPrimary: () => void;
  onCancel?: () => void;
  onModify?: () => void;
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
          <span className="text-white">{format(b.reservedAt, "EEE, MMMM d")}</span>
          <span className="text-text-muted">·</span>
          <span className="font-semibold text-gold">{formatCompactTimeLabel(b.reservedAt)}</span>
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
          {format(b.reservedAt, "EEE, MMMM d")} ·{" "}
          <span className="text-white">{formatCompactTimeLabel(b.reservedAt)}</span>
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

function StatTile({
  value,
  label,
  highlight,
}: {
  value: number;
  label: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-[110px] rounded-2xl border bg-bg-surface/40 p-4 text-center",
        highlight ? "border-gold/40 bg-gold/5" : "border-border",
      )}
    >
      <p className={cn("font-serif text-3xl", highlight ? "text-gold" : "text-white")}>
        {value}
      </p>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
        {label}
      </p>
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
  const { unreadCount } = useNotifications();
  const assistant = useAssistant();

  const [tab, setTab] = useState<Tab>("upcoming");
  const [search, setSearch] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const upcomingCards = useMemo(() => {
    return upcoming
      .map(adapt)
      .sort((a, b) => a.reservedAt.getTime() - b.reservedAt.getTime());
  }, [upcoming]);

  const { pastCompleted, cancelled } = useMemo(() => {
    const adapted = past.map(adapt);
    return {
      pastCompleted: adapted.filter((b) => b.status !== "cancelled"),
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
  const pastFiltered = filterBySearch(pastCompleted);
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
        <div className="mx-auto flex h-16 w-full max-w-[1320px] items-center px-5 lg:px-8">
          <Link to="/" className="flex shrink-0 items-center gap-2" aria-label="Cenaiva home">
            <span className="flex size-7 items-center justify-center rounded-md bg-gold/15">
              <span className="block size-2.5 rounded-sm bg-gold" />
            </span>
            <span className="font-serif text-xl font-semibold tracking-tight text-white">
              Cenaiva
            </span>
          </Link>

          <CustomerNav />

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <button
              type="button"
              className="relative inline-flex size-9 items-center justify-center rounded-full border border-border bg-bg-surface/70 text-text-secondary transition-colors hover:border-gold/40 hover:text-white"
              aria-label="Notifications"
            >
              <Bell className="size-4" />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-gold font-mono text-[10px] font-bold text-black">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="rounded-full outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-gold/40"
                  aria-label={t("routes.account.title")}
                >
                  <Avatar>
                    <AvatarImage src={profile?.avatar_url ?? undefined} />
                    <AvatarFallback className="bg-gold/10 text-gold">{initials}</AvatarFallback>
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

      <main className="mx-auto w-full max-w-[1320px] px-5 py-10 lg:px-8 lg:py-12">
        {/* Header row */}
        <div className="flex flex-col gap-8 border-b border-border/40 pb-10 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-gold">
              <span className="inline-block h-px w-3 bg-gold/60" /> Your reservations
            </span>
            <h1 className="mt-4 font-serif text-5xl leading-[1.05] text-white sm:text-6xl">
              Bookings
            </h1>
            <p className="mt-3 max-w-xl text-base text-text-secondary">
              Manage upcoming reservations, revisit past meals, and book again with one
              tap.
            </p>
          </div>
          <div className="flex gap-3">
            <StatTile value={upcomingCards.length} label="Upcoming" highlight />
            <StatTile value={pastCompleted.length} label="Past" />
            <StatTile value={cancelled.length} label="Cancelled" />
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
                { id: "past" as Tab, label: "Past", count: pastCompleted.length },
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
