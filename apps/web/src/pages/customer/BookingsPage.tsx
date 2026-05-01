import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { format, formatDistanceToNowStrict } from "date-fns";
import {
  Bell,
  Calendar as CalendarIcon,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
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
import { cn } from "@/lib/utils";

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
};

const DEMO_UPCOMING: BookingCard[] = [
  {
    id: "demo-sakura",
    initials: "SAKURA",
    cuisineLine: "OMAKASE · JAPANESE · YORKVILLE",
    restaurantName: "Sakura Omakase",
    restaurantSlug: "sakura-omakase",
    reservedAt: addDays(new Date(), 2, 18, 30),
    partySize: 4,
    occasion: "Birthday",
    status: "confirmed",
    confirmationCode: "CN-AX42K9",
    address: "126 Cumberland St",
    phone: "+1 (416) 555-0184",
  },
  {
    id: "demo-maison",
    initials: "MAISON",
    cuisineLine: "MODERN FRENCH · KING WEST",
    restaurantName: "Maison Verre",
    restaurantSlug: "maison-verre",
    reservedAt: addDays(new Date(), 11, 19, 45),
    partySize: 2,
    status: "confirmed",
    confirmationCode: "CN-MV88P2",
  },
  {
    id: "demo-aurora",
    initials: "AURORA",
    cuisineLine: "NORDIC · TASTING MENU · DISTILLERY",
    restaurantName: "Aurora",
    restaurantSlug: "aurora",
    reservedAt: addDays(new Date(), 15, 20, 15),
    partySize: 6,
    occasion: "Anniversary",
    status: "pending",
    confirmationCode: "CN-AU14R7",
  },
];

const DEMO_PAST: BookingCard[] = [
  {
    id: "demo-nova",
    initials: "NOVA",
    cuisineLine: "ITALIAN · WOOD-FIRED · FINANCIAL",
    restaurantName: "Nova Ristorante",
    restaurantSlug: "nova-ristorante",
    reservedAt: addDays(new Date(), -22, 19, 30),
    partySize: 6,
    occasion: "Celebration",
    status: "completed",
  },
  {
    id: "demo-jardin",
    initials: "JARDIN",
    cuisineLine: "FRENCH BISTRO · ANNEX",
    restaurantName: "Le Petit Jardin",
    restaurantSlug: "le-petit-jardin",
    reservedAt: addDays(new Date(), -54, 18, 0),
    partySize: 2,
    occasion: "Date night",
    status: "completed",
  },
  {
    id: "demo-casa",
    initials: "CASA",
    cuisineLine: "MEXICAN · MEZCAL · LESLIEVILLE",
    restaurantName: "Casa Tomatillo",
    restaurantSlug: "casa-tomatillo",
    reservedAt: addDays(new Date(), -88, 20, 45),
    partySize: 3,
    status: "completed",
  },
];

const DEMO_CANCELLED: BookingCard[] = [
  {
    id: "demo-blue",
    initials: "HERON",
    cuisineLine: "BRUNCH · COASTAL · LIBERTY VIL",
    restaurantName: "Blue Heron",
    restaurantSlug: "blue-heron",
    reservedAt: addDays(new Date(), -10, 11, 0),
    partySize: 5,
    occasion: "Brunch",
    status: "cancelled",
  },
];

function addDays(base: Date, days: number, hour = 19, minute = 0): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

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
    cuisineLine: name.toUpperCase(),
    restaurantName: name,
    restaurantSlug: r.restaurant?.slug ?? "",
    reservedAt,
    partySize: r.party_size,
    confirmationCode: r.confirmation_code ?? undefined,
    status,
  };
}

function StripePlaceholder({ label }: { label: string }) {
  return (
    <div
      className="relative flex aspect-[16/9] w-full items-center justify-center overflow-hidden"
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, rgba(201,168,76,0.18) 0 14px, rgba(0,0,0,0.55) 14px 28px)",
        backgroundColor: "#1a1a1a",
      }}
    >
      <div className="size-9 rounded-full bg-gold/40 ring-4 ring-black/30" />
      <span className="absolute bottom-3 left-1/2 -translate-x-1/2 font-mono text-[10px] tracking-[0.3em] text-gold/70">
        {label}
      </span>
    </div>
  );
}

function StatusChip({ status }: { status: BookingCard["status"] }) {
  const map: Record<BookingCard["status"], { label: string; cls: string }> = {
    confirmed: { label: "Confirmed", cls: "text-white" },
    pending: { label: "Pending", cls: "text-amber-400" },
    completed: { label: "Completed", cls: "text-text-secondary" },
    cancelled: { label: "Confirmed", cls: "text-text-muted line-through" },
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
}: {
  b: BookingCard;
  variant: "upcoming" | "past" | "cancelled";
  onPrimary: () => void;
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
        <StripePlaceholder label={b.initials} />
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
          <span className="font-semibold text-gold">{format(b.reservedAt, "h:mm a")}</span>
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
              to={`/${b.restaurantSlug}`}
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
          </>
        )}
      </div>
    </motion.div>
  );
}

function NextReservationCard({
  b,
  onCancel,
}: {
  b: BookingCard;
  onCancel: () => void;
}) {
  const [now] = useState(() => Date.now());
  const days = Math.round((b.reservedAt.getTime() - now) / (1000 * 60 * 60 * 24));
  const inLabel =
    days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;

  return (
    <div className="rounded-2xl border border-gold/40 bg-bg-surface/60 p-5 shadow-[0_0_0_1px_rgba(201,168,76,0.05)]">
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
          <span className="text-white">{format(b.reservedAt, "h:mm a")}</span>
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
        <Button
          asChild
          className="h-10 rounded-md font-semibold"
        >
          <a
            href={
              b.address
                ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address + " " + b.restaurantName)}`
                : "#"
            }
            target="_blank"
            rel="noreferrer"
          >
            <MapPin className="size-4" /> Directions
          </a>
        </Button>
        <Button asChild variant="outline" className="h-10 rounded-md font-medium">
          <a href={b.phone ? `tel:${b.phone}` : "#"}>
            <Phone className="size-4" /> Call
          </a>
        </Button>
        <Button variant="outline" className="h-10 rounded-md font-medium">
          <PencilLine className="size-4" /> Modify
        </Button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-rose-500/50 bg-rose-500/10 text-sm font-medium text-rose-400 transition-colors hover:bg-rose-500/20"
        >
          <X className="size-4" /> Cancel
        </button>
      </div>
    </div>
  );
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

function LoyaltyCard({ meals }: { meals: number }) {
  const points = 1240;
  const target = 2000;
  const remaining = target - points;
  const pct = Math.min((points / target) * 100, 100);
  return (
    <div className="rounded-2xl border border-border bg-bg-surface/60 p-5">
      <p className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-gold">
        <Sparkles className="size-3" /> Loyalty status
      </p>
      <p className="mt-4 font-serif text-2xl text-white">Gold tier</p>
      <p className="mt-1 text-xs text-text-muted">
        {meals} meals · {points.toLocaleString()} points
      </p>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-bg-elevated">
        <div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-3 text-xs text-text-muted">
        {remaining.toLocaleString()} points to <span className="text-gold">Platinum</span>
      </p>
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
    canUseCustomerView,
    isCustomerView,
    switchToCustomerView,
    switchToStaffView,
    restaurantRoles,
  } = useUser();
  const { restaurants: staffRestaurants } = useStaffRestaurants(restaurantRoles);
  const { upcoming, past, loading } = useMyReservations();
  const assistant = useAssistant();

  const [tab, setTab] = useState<Tab>("upcoming");
  const [search, setSearch] = useState("");

  const upcomingCards = useMemo(() => {
    if (upcoming.length > 0) return upcoming.map(adapt);
    return DEMO_UPCOMING;
  }, [upcoming]);

  const { pastCompleted, cancelled } = useMemo(() => {
    if (past.length > 0) {
      const adapted = past.map(adapt);
      return {
        pastCompleted: adapted.filter((b) => b.status !== "cancelled"),
        cancelled: adapted.filter((b) => b.status === "cancelled"),
      };
    }
    return { pastCompleted: DEMO_PAST, cancelled: DEMO_CANCELLED };
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
    navigate(`/${b.restaurantSlug}`);
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
        <div className="flex h-16 w-full items-center px-5 lg:px-8">
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
              <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-gold font-mono text-[10px] font-bold text-black">
                3
              </span>
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
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => void signOut()}>
                  <LogOut className="size-4" />
                  {t("dashboard.shell.signOut")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {restaurantRoles.length > 0 &&
              (staffRestaurants.length > 1 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-transparent px-3 text-[0.8rem] font-medium text-foreground transition-colors hover:bg-white/5">
                    <LayoutDashboard className="size-3.5" />
                    Dashboard
                    <ChevronDown className="size-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    {staffRestaurants.map((r) => (
                      <DropdownMenuItem
                        key={r.id}
                        onClick={() => {
                          localStorage.setItem("cenaiva.selectedRestaurantId", r.id);
                          if (isCustomerView) switchToStaffView();
                          void navigate("/dashboard");
                        }}
                      >
                        <LayoutDashboard className="size-4" />
                        {r.name ?? r.slug}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5"
                  onClick={() => {
                    if (isCustomerView) switchToStaffView();
                    void navigate("/dashboard");
                  }}
                >
                  <LayoutDashboard className="size-4" />
                  Dashboard
                </Button>
              ))}

            {canUseCustomerView && !isCustomerView && (
              <Button variant="outline" size="sm" onClick={switchToCustomerView}>
                Diner view
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="w-full px-5 py-10 lg:px-8 lg:py-12">
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
                {loading && upcomingCards === DEMO_UPCOMING && (
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
                onCancel={() => navigate(`/${next.restaurantSlug}`)}
              />
            )}
            <QuickActions
              onFindTable={() => navigate("/discover")}
              onConcierge={() => assistant?.open(undefined, undefined, { autoListen: false })}
              onParty={() => navigate("/account")}
            />
            <LoyaltyCard meals={pastCompleted.length} />
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
