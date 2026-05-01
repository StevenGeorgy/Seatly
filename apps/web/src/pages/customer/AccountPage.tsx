import { useMemo, useState } from "react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  CalendarDays,
  CreditCard,
  Gift,
  LogOut,
  MessageCircle,
  Settings,
  ShoppingBag,
  Sparkles,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";

import { PaymentMethodsSection } from "@/components/customer/PaymentMethodsSection";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMyOrders, type MyOrderRow } from "@/hooks/useMyOrders";
import { useMyReservations, type MyReservationRow } from "@/hooks/useMyReservations";
import { useUpdateProfile } from "@/hooks/useUpdateProfile";
import { useUser } from "@/hooks/useUser";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/formatCurrency";

type Section = "bookings" | "orders" | "loyalty" | "concierge" | "payment" | "preferences";
type BookingTab = "upcoming" | "past" | "cancelled";

type BookingPreview = {
  id: string;
  restaurantName: string;
  reservedAt: Date;
  partySize: number;
  status: "confirmed" | "pending" | "completed" | "cancelled";
  confirmationCode: string;
  tag: string;
  slug: string;
};

const profileFormSchema = z.object({
  full_name: z.string().min(1, "Name is required").max(120),
  email: z.string().email("Invalid email address"),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
});
type ProfileFormValues = z.infer<typeof profileFormSchema>;

const ACCOUNT_NAV: { id: Section; label: string; icon: typeof CalendarDays }[] = [
  { id: "bookings", label: "Bookings", icon: CalendarDays },
  { id: "orders", label: "Orders", icon: ShoppingBag },
  { id: "loyalty", label: "Loyalty", icon: Gift },
  { id: "concierge", label: "Concierge", icon: MessageCircle },
  { id: "payment", label: "Payment", icon: CreditCard },
  { id: "preferences", label: "Preferences", icon: Settings },
];

const DEMO_UPCOMING: BookingPreview[] = [
  {
    id: "demo-maison",
    restaurantName: "Maison Verre",
    reservedAt: fixedDate(2026, 3, 27, 19, 15),
    partySize: 2,
    status: "confirmed",
    confirmationCode: "MV-7K2N91",
    tag: "Patio",
    slug: "maison-verre",
  },
  {
    id: "demo-osteria",
    restaurantName: "Osteria Nova",
    reservedAt: fixedDate(2026, 4, 9, 21, 0),
    partySize: 4,
    status: "pending",
    confirmationCode: "ON-3K9X14",
    tag: "Wine bar",
    slug: "osteria-nova",
  },
];

const DEMO_PAST: BookingPreview[] = [
  {
    id: "demo-past",
    restaurantName: "Le Petit Jardin",
    reservedAt: fixedDate(2026, 2, 14, 18, 30),
    partySize: 2,
    status: "completed",
    confirmationCode: "LP-8M4V22",
    tag: "Date night",
    slug: "le-petit-jardin",
  },
];

const DEMO_CANCELLED: BookingPreview[] = [
  {
    id: "demo-cancelled",
    restaurantName: "Blue Heron",
    reservedAt: fixedDate(2026, 1, 22, 12, 0),
    partySize: 5,
    status: "cancelled",
    confirmationCode: "BH-2Q7L10",
    tag: "Brunch",
    slug: "blue-heron",
  },
];

function fixedDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(year, month, day, hour, minute, 0, 0);
}

function stripeLabel(name: string): string {
  return name.split(/\s+/).slice(0, 1).join("").toUpperCase();
}

function adaptReservation(row: MyReservationRow): BookingPreview {
  const reservedAt = new Date(row.reserved_at);
  const isPast = reservedAt.getTime() < Date.now();
  const status =
    row.status === "cancelled"
      ? "cancelled"
      : row.status === "pending"
        ? "pending"
        : isPast
          ? "completed"
          : "confirmed";

  return {
    id: row.id,
    restaurantName: row.restaurant?.name ?? "Restaurant",
    reservedAt,
    partySize: row.party_size,
    status,
    confirmationCode: row.confirmation_code ?? "PENDING",
    tag: row.table?.label ? `Table ${row.table.label}` : "Dining room",
    slug: row.restaurant?.slug ?? "",
  };
}

function StripeThumb({ label }: { label: string }) {
  return (
    <div className="relative flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-bg-elevated lg:size-32">
      <div className="absolute inset-0 opacity-60 [background-image:repeating-linear-gradient(135deg,var(--gold)_0_1px,transparent_1px_14px)]" />
      <div className="absolute inset-0 bg-black/45" />
      <div className="relative size-10 rounded-full bg-gold/30 ring-4 ring-black/25" />
      <span className="absolute bottom-3 left-1/2 -translate-x-1/2 font-mono text-[10px] uppercase tracking-[0.25em] text-gold/70">
        {label}
      </span>
    </div>
  );
}

function BookingStatus({ status }: { status: BookingPreview["status"] }) {
  const styles: Record<BookingPreview["status"], string> = {
    confirmed: "border-success/30 bg-success/10 text-success",
    pending: "border-warning/30 bg-warning/10 text-warning",
    completed: "border-border bg-bg-elevated text-text-secondary",
    cancelled: "border-danger/30 bg-danger/10 text-danger",
  };
  const labels: Record<BookingPreview["status"], string> = {
    confirmed: "Confirmed",
    pending: "Awaiting confirmation",
    completed: "Completed",
    cancelled: "Cancelled",
  };

  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", styles[status])}>
      {labels[status]}
    </span>
  );
}

function BookingRow({ booking }: { booking: BookingPreview }) {
  const dateLine = `${format(booking.reservedAt, "EEEE, MMM d")} · ${format(
    booking.reservedAt,
    "h:mm a",
  )} · ${booking.tag} · ${booking.partySize} guests`;

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex gap-5 border-b border-border/60 p-5 last:border-b-0 sm:p-6 lg:gap-6 lg:p-7"
    >
      <StripeThumb label={stripeLabel(booking.restaurantName)} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <BookingStatus status={booking.status} />
          {booking.status === "confirmed" && (
            <span className="rounded-full border border-gold/25 bg-gold/10 px-2 py-0.5 text-[11px] text-gold">
              Pre-ordered
            </span>
          )}
        </div>
        <h3 className="mt-3 font-serif text-3xl leading-none text-white lg:text-4xl">
          {booking.restaurantName}
        </h3>
        <p className="mt-2 text-sm text-text-secondary">{dateLine}</p>
        <div className="mt-5 flex flex-wrap gap-2.5">
          <Button asChild size="sm" variant="outline" className="h-9 rounded-md px-4 text-xs">
            <Link to={booking.slug ? `/${booking.slug}` : "/discover"}>View details</Link>
          </Button>
          <Button size="sm" variant="outline" className="h-9 rounded-md px-4 text-xs">
            Add to calendar
          </Button>
          <Button size="sm" variant="ghost" className="h-9 rounded-md px-4 text-xs">
            Modify
          </Button>
        </div>
      </div>
      <div className="hidden shrink-0 text-right sm:block">
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">
          Confirmation
        </p>
        <p className="mt-1 font-mono text-xs text-gold">{booking.confirmationCode}</p>
        {booking.status !== "cancelled" && (
          <button type="button" className="mt-8 text-[11px] text-text-muted hover:text-danger">
            Cancel
          </button>
        )}
      </div>
    </motion.article>
  );
}

function OrderRow({ order }: { order: MyOrderRow }) {
  const currency = order.restaurant?.currency ?? "cad";
  const total = order.total_amount == null ? null : formatCurrency(order.total_amount, currency);
  return (
    <article className="rounded-2xl border border-border bg-bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-serif text-xl text-white">{order.restaurant?.name ?? "Restaurant"}</p>
          <p className="mt-1 text-xs text-text-muted">
            {order.created_at ? format(new Date(order.created_at), "MMM d, yyyy") : "Recent order"}
            {order.confirmation_code ? ` · ${order.confirmation_code}` : ""}
          </p>
        </div>
        <div className="text-right">
          {total && <p className="text-sm font-semibold text-gold">{total}</p>}
          <p className="mt-1 text-xs capitalize text-text-muted">{order.status}</p>
        </div>
      </div>
      {order.order_items.length > 0 && (
        <ul className="mt-4 space-y-1 border-t border-border pt-3 text-xs text-text-secondary">
          {order.order_items.map((item) => (
            <li key={item.id} className="flex justify-between gap-4">
              <span>{item.quantity}x {item.name}</span>
              <span>{formatCurrency(item.quantity * item.unit_price, currency)}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-border bg-bg-surface p-8 text-center">
      <p className="font-serif text-2xl text-white">{title}</p>
      <p className="mt-2 text-sm text-text-muted">{body}</p>
    </div>
  );
}

export default function AccountPage() {
  const navigate = useNavigate();
  const { profile, signOut } = useUser();
  const { upcoming, past, loading: reservationsLoading } = useMyReservations();
  const { orders, loading: ordersLoading } = useMyOrders();
  const { updateProfile, saving } = useUpdateProfile();

  const [activeSection, setActiveSection] = useState<Section>("bookings");
  const [bookingTab, setBookingTab] = useState<BookingTab>("upcoming");
  const [dietaryCsv, setDietaryCsv] = useState(
    () => (profile?.dietary_restrictions ?? []).join(", "),
  );
  const [allergiesCsv, setAllergiesCsv] = useState(() => (profile?.allergies ?? []).join(", "));

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      full_name: profile?.full_name ?? "",
      email: profile?.email ?? "",
      phone: profile?.phone ?? "",
    },
  });

  const bookingLists = useMemo(() => {
    const upcomingRows = upcoming.map(adaptReservation);
    const pastRows = past.map(adaptReservation);
    const cancelledRows = pastRows.filter((row) => row.status === "cancelled");
    const completedRows = pastRows.filter((row) => row.status !== "cancelled");

    return {
      upcoming: upcomingRows.length > 0 ? upcomingRows : DEMO_UPCOMING,
      past: completedRows.length > 0 ? completedRows : DEMO_PAST,
      cancelled: cancelledRows.length > 0 ? cancelledRows : DEMO_CANCELLED,
    };
  }, [past, upcoming]);

  const activeBookings = bookingLists[bookingTab];
  const totalMeals = bookingLists.past.length + bookingLists.upcoming.length;
  const loyaltyPoints = 2418 + totalMeals * 95;

  const initials = (profile?.full_name ?? profile?.email ?? "SK")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const displayName = profile?.full_name ?? "Sara Kapoor";
  const memberSince = "Member since 2024";

  const onSubmit = async (values: ProfileFormValues) => {
    const csvToArray = (csv: string) =>
      csv
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

    await updateProfile({
      ...values,
      dietary_restrictions: csvToArray(dietaryCsv),
      allergies: csvToArray(allergiesCsv),
    });
    reset(values);
  };

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/discover");
  };

  const renderMain = () => {
    if (activeSection === "bookings") {
      return (
        <>
          <div>
            <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
              <span className="h-px w-3 bg-gold/60" /> My Account
            </span>
            <h1 className="mt-2 font-serif text-5xl leading-none text-white">Bookings</h1>
            <p className="mt-2 text-sm text-text-secondary">
              Manage upcoming reservations, revisit past meals.
            </p>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {(
              [
                { id: "upcoming" as BookingTab, label: "Upcoming", count: bookingLists.upcoming.length },
                { id: "past" as BookingTab, label: "Past", count: bookingLists.past.length },
                { id: "cancelled" as BookingTab, label: "Cancelled", count: bookingLists.cancelled.length },
              ]
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setBookingTab(tab.id)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  bookingTab === tab.id
                    ? "bg-gold text-black"
                    : "text-text-secondary hover:bg-bg-surface hover:text-white",
                )}
              >
                {tab.label} · {tab.count}
              </button>
            ))}
          </div>

          <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-bg-surface/70">
            {reservationsLoading && upcoming.length === 0 && past.length === 0 ? (
              <div className="p-8 text-sm text-text-muted">Loading reservations...</div>
            ) : (
              activeBookings.map((booking) => <BookingRow key={booking.id} booking={booking} />)
            )}
          </section>
        </>
      );
    }

    if (activeSection === "orders") {
      return (
        <>
          <SectionHeading title="Orders" body="Review preorders, payments, and receipts." />
          <div className="mt-5 space-y-3">
            {ordersLoading ? (
              <EmptyPanel title="Loading orders..." body="Fetching your recent restaurant orders." />
            ) : orders.length > 0 ? (
              orders.map((order) => <OrderRow key={order.id} order={order} />)
            ) : (
              <EmptyPanel title="No orders yet" body="Your preorders and dine-in payments will appear here." />
            )}
          </div>
        </>
      );
    }

    if (activeSection === "loyalty") {
      return (
        <>
          <SectionHeading title="Loyalty" body="Track rewards across Cenaiva partner restaurants." />
          <div className="mt-5 rounded-2xl border border-gold/30 bg-gold/10 p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
              Loyalty balance
            </p>
            <p className="mt-3 font-serif text-5xl text-white">{loyaltyPoints.toLocaleString()}</p>
            <p className="mt-2 text-sm text-text-secondary">
              {Math.max(0, 3500 - loyaltyPoints).toLocaleString()} points to Platinum.
            </p>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-bg-elevated">
              <div
                className="h-full rounded-full bg-gold"
                style={{ width: `${Math.min((loyaltyPoints / 3500) * 100, 100)}%` }}
              />
            </div>
          </div>
        </>
      );
    }

    if (activeSection === "concierge") {
      return (
        <>
          <SectionHeading title="Concierge" body="Your saved dining preferences for Cenaiva." />
          <div className="mt-5 rounded-2xl border border-border bg-bg-surface p-6">
            <p className="inline-flex items-center gap-2 font-serif text-2xl text-white">
              <Sparkles className="size-5 text-gold" /> Remembered preferences
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <PreferenceTile label="Allergies" value={profile?.allergies?.join(", ") || "Nut allergy"} />
              <PreferenceTile
                label="Dietary"
                value={profile?.dietary_restrictions?.join(", ") || "No restrictions"}
              />
              <PreferenceTile label="Seating" value={profile?.seating_preference || "Patio when available"} />
              <PreferenceTile label="Occasion" value="Date nights and anniversaries" />
            </div>
          </div>
        </>
      );
    }

    if (activeSection === "payment") {
      return (
        <>
          <SectionHeading title="Payment" body="Manage saved cards and checkout methods." />
          <div className="mt-5 rounded-2xl border border-border bg-bg-surface p-6">
            <PaymentMethodsSection />
          </div>
        </>
      );
    }

    return (
      <>
        <SectionHeading title="Preferences" body="Update your profile and dining notes." />
        <form
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          className="mt-5 space-y-5 rounded-2xl border border-border bg-bg-surface p-6"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="full_name">Name</Label>
              <Input id="full_name" {...register("full_name")} />
              {errors.full_name && <p className="text-xs text-danger">{errors.full_name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" {...register("email")} />
              {errors.email && <p className="text-xs text-danger">{errors.email.message}</p>}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" type="tel" {...register("phone")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dietary_restrictions">Dietary restrictions</Label>
            <Input
              id="dietary_restrictions"
              value={dietaryCsv}
              onChange={(event) => setDietaryCsv(event.target.value)}
              placeholder="e.g. vegetarian, halal"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="allergies">Allergies</Label>
            <Input
              id="allergies"
              value={allergiesCsv}
              onChange={(event) => setAllergiesCsv(event.target.value)}
              placeholder="e.g. peanuts, shellfish"
            />
          </div>
          <div className="flex gap-3">
            <Button type="submit" disabled={!isDirty || saving}>
              {saving ? "Saving..." : "Save changes"}
            </Button>
            <Button type="button" variant="ghost" disabled={!isDirty || saving} onClick={() => reset()}>
              Cancel
            </Button>
          </div>
        </form>
      </>
    );
  };

  return (
    <div className="min-h-screen bg-bg-base text-text-primary">
      <main className="mx-auto w-full max-w-[1500px] px-5 py-6 sm:px-8 lg:px-12 lg:py-10">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-surface/70 px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:border-gold/40 hover:text-white"
        >
          <ArrowLeft className="size-4 text-gold" />
          Back
        </button>

        <div className="mt-6 grid w-full gap-10 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-10 lg:self-start">
          <div className="rounded-3xl border border-border bg-bg-surface p-5 shadow-2xl shadow-black/20">
            <div className="flex items-center gap-4 p-2">
              <Avatar className="size-14 border border-gold/30">
                <AvatarImage src={profile?.avatar_url ?? undefined} />
                <AvatarFallback className="bg-gold/10 text-gold">{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-white">{displayName}</p>
                <p className="text-xs text-text-muted">{memberSince}</p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-gold/20 bg-gold/10 p-6">
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-gold">
                Loyalty balance
              </p>
              <p className="mt-3 font-serif text-5xl text-gold">{loyaltyPoints.toLocaleString()}</p>
              <p className="mt-1 text-xs text-text-muted">
                +{(totalMeals * 55).toLocaleString()} pts this year
              </p>
            </div>

            <nav className="mt-6 space-y-2" aria-label="Account">
              {ACCOUNT_NAV.map((item) => {
                const Icon = item.icon;
                const active = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveSection(item.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition-colors",
                      active
                        ? "border border-gold/25 bg-gold/15 text-gold"
                        : "text-text-secondary hover:bg-bg-elevated hover:text-white",
                    )}
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => void signOut()}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-text-secondary transition-colors hover:bg-bg-elevated hover:text-white"
              >
                <LogOut className="size-4" />
                Sign out
              </button>
            </nav>
          </div>
        </aside>

        <section className="min-w-0 max-w-5xl">{renderMain()}</section>
        </div>
      </main>
    </div>
  );
}

function SectionHeading({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
        <span className="h-px w-3 bg-gold/60" /> My Account
      </span>
      <h1 className="mt-2 font-serif text-5xl leading-none text-white">{title}</h1>
      <p className="mt-2 text-sm text-text-secondary">{body}</p>
    </div>
  );
}

function PreferenceTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg-elevated p-4">
      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">{label}</p>
      <p className="mt-2 text-sm text-white">{value}</p>
    </div>
  );
}
