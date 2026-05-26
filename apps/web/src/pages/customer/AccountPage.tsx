import { useMemo, useState } from "react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  CalendarDays,
  CreditCard,
  LogOut,
  MessageCircle,
  Settings,
  ShoppingBag,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";

import { AvatarUploadCard } from "@/components/customer/AvatarUploadCard";
import { ChangePasswordSection } from "@/components/customer/ChangePasswordSection";
import { PaymentMethodsSection } from "@/components/customer/PaymentMethodsSection";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useErrorToast } from "@/lib/errors";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMyOrders, type MyOrderRow } from "@/hooks/useMyOrders";
import { useMyReservations, type MyReservationRow } from "@/hooks/useMyReservations";
import { useMyReviewsAndSnaps, type MyReviewSnapEntry } from "@/hooks/useMyReviewsAndSnaps";
import { useUpdateProfile } from "@/hooks/useUpdateProfile";
import { useUser } from "@/hooks/useUser";
import {
  reservationDisplayStatus,
  reservationDisplayStatusKey,
  type ReservationDisplayStatus,
} from "@/lib/reservations/displayStatus";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/formatCurrency";

type Section = "bookings" | "orders" | "reviews" | "concierge" | "payment" | "preferences";
type BookingTab = "upcoming" | "past" | "cancelled";

type BookingPreview = {
  id: string;
  restaurantName: string;
  reservedAt: Date;
  partySize: number;
  status: ReservationDisplayStatus;
  confirmationCode: string;
  tag: string;
  slug: string;
  logoUrl: string | null;
  coverPhotoUrl: string | null;
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
  { id: "reviews", label: "Reviews", icon: Star },
  { id: "concierge", label: "Concierge", icon: MessageCircle },
  { id: "payment", label: "Payment", icon: CreditCard },
  { id: "preferences", label: "Preferences", icon: Settings },
];

function adaptReservation(row: MyReservationRow): BookingPreview {
  const reservedAt = new Date(row.reserved_at);
  const status = reservationDisplayStatus(row);

  return {
    id: row.id,
    restaurantName: row.restaurant?.name ?? "Restaurant",
    reservedAt,
    partySize: row.party_size,
    status,
    confirmationCode: row.confirmation_code ?? "PENDING",
    tag: row.table?.label ? `Table ${row.table.label}` : "Reservation",
    slug: row.restaurant?.slug ?? "",
    logoUrl: row.restaurant?.logo_url ?? null,
    coverPhotoUrl: row.restaurant?.cover_photo_url ?? null,
  };
}

function BookingThumb({ booking }: { booking: BookingPreview }) {
  return (
    <div className="relative flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-bg-elevated lg:size-32">
      {booking.coverPhotoUrl ? (
        <img src={booking.coverPhotoUrl} alt={`${booking.restaurantName} cover`} className="absolute inset-0 size-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-gold/15 via-bg-elevated to-bg-base" />
      )}
      <div className="absolute inset-0 bg-black/35" />
      <div className="relative flex size-12 items-center justify-center overflow-hidden rounded-xl border border-gold/30 bg-bg-elevated font-mono text-[10px] font-semibold text-gold">
        {booking.logoUrl ? (
          <img src={booking.logoUrl} alt={`${booking.restaurantName} logo`} className="size-full object-cover" />
        ) : (
          booking.restaurantName.split(/\s+/).filter(Boolean).slice(0, 1).join("").toUpperCase()
        )}
      </div>
    </div>
  );
}

function BookingStatus({ status }: { status: BookingPreview["status"] }) {
  const { t } = useTranslation();
  const styles: Record<BookingPreview["status"], string> = {
    upcoming: "border-success/30 bg-success/10 text-success",
    current: "border-gold/30 bg-gold/10 text-gold",
    past: "border-border bg-bg-elevated text-text-secondary",
    cancelled: "border-danger/30 bg-danger/10 text-danger",
  };

  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", styles[status])}>
      {t(reservationDisplayStatusKey(status))}
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
      <BookingThumb booking={booking} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <BookingStatus status={booking.status} />
          {booking.status === "upcoming" && (
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

function ReviewEntryRow({
  entry,
  onDelete,
}: {
  entry: MyReviewSnapEntry;
  onDelete: () => void;
}) {
  const dateLabel = format(new Date(entry.createdAt), "MMM d, yyyy");
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-4 rounded-2xl border border-border bg-bg-surface p-4"
    >
      {entry.photo ? (
        <Link
          to={entry.restaurantSlug ? `/${entry.restaurantSlug}` : "#"}
          className="block size-20 shrink-0 overflow-hidden rounded-xl bg-bg-elevated"
        >
          <img
            src={entry.photo.image_url}
            alt={entry.photo.caption ?? `Photo at ${entry.restaurantName}`}
            loading="lazy"
            className="size-full object-cover"
          />
        </Link>
      ) : (
        <div className="flex size-20 shrink-0 items-center justify-center rounded-xl bg-bg-elevated">
          <Star className="size-6 text-gold" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <Link
            to={entry.restaurantSlug ? `/${entry.restaurantSlug}` : "#"}
            className="truncate font-serif text-lg text-white hover:text-gold"
          >
            {entry.restaurantName}
          </Link>
          <span className="shrink-0 text-[11px] text-text-muted">{dateLabel}</span>
        </div>
        {entry.review ? (
          <div className="mt-1 flex items-center gap-0.5 text-gold">
            {[1, 2, 3, 4, 5].map((value) => (
              <Star
                key={value}
                className={`size-3.5 ${value <= entry.review!.rating ? "fill-gold text-gold" : "text-text-muted"}`}
              />
            ))}
          </div>
        ) : (
          <p className="mt-1 text-xs text-text-muted">Photo only · no rating</p>
        )}
        {entry.review?.review_text ? (
          <p className="mt-2 line-clamp-2 text-sm leading-5 text-text-secondary">
            {entry.review.review_text}
          </p>
        ) : entry.photo?.caption ? (
          <p className="mt-2 line-clamp-2 text-sm leading-5 text-text-secondary">
            {entry.photo.caption}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete review and photo"
        className="shrink-0 rounded-md border border-border bg-bg-elevated p-2 text-text-muted transition-colors hover:border-warning/40 hover:text-warning"
      >
        <Trash2 className="size-4" />
      </button>
    </motion.article>
  );
}

export default function AccountPage() {
  const navigate = useNavigate();
  const { profile, signOut } = useUser();
  const { errorToast } = useErrorToast();
  const { upcoming, past, loading: reservationsLoading } = useMyReservations();
  const { orders, loading: ordersLoading } = useMyOrders();
  const { entries: reviewEntries, loading: reviewEntriesLoading, remove: removeReviewEntry } =
    useMyReviewsAndSnaps();
  const { updateProfile, saving } = useUpdateProfile();

  // Delete-confirmation state for My Reviews. We keep the candidate in
  // component state so the confirm dialog can read its preview while the
  // delete promise is in flight.
  const [reviewToDelete, setReviewToDelete] = useState<MyReviewSnapEntry | null>(null);
  const [reviewDeleting, setReviewDeleting] = useState(false);

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
    const pastBookingRows = pastRows.filter((row) => row.status !== "cancelled");

    return {
      upcoming: upcomingRows,
      past: pastBookingRows,
      cancelled: cancelledRows,
    };
  }, [past, upcoming]);

  const activeBookings = bookingLists[bookingTab];

  const initials = (profile?.full_name ?? profile?.email ?? "SK")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const displayName = profile?.full_name ?? profile?.email ?? "Guest";
  const memberSince = profile?.created_at
    ? `Member since ${format(new Date(profile.created_at), "yyyy")}`
    : "Member";

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
            ) : activeBookings.length > 0 ? (
              activeBookings.map((booking) => <BookingRow key={booking.id} booking={booking} />)
            ) : (
              <div className="p-8">
                <EmptyPanel
                  title="No reservations yet"
                  body="Your real Cenaiva reservations will appear here once you book."
                />
              </div>
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

    if (activeSection === "reviews") {
      return (
        <>
          <SectionHeading
            title="My reviews"
            body="Your reviews and photos from past visits. Photos can only be taken from the Cenaiva mobile app — you can still delete them here."
          />
          <div className="mt-5 space-y-3">
            {reviewEntriesLoading ? (
              <EmptyPanel title="Loading…" body="Pulling your reviews and snaps." />
            ) : reviewEntries.length === 0 ? (
              <EmptyPanel
                title="No reviews yet"
                body="Your reviews and photos from past visits will appear here. Leave a review from the Bookings page after you dine."
              />
            ) : (
              reviewEntries.map((entry) => (
                <ReviewEntryRow
                  key={entry.key}
                  entry={entry}
                  onDelete={() => setReviewToDelete(entry)}
                />
              ))
            )}
          </div>

          {/* All-or-nothing delete confirm. Mirrors mobile's deleteMyReview
              behavior — removes review row + photo row + storage object in
              one shot (HAB_REVIEW_SNAP_TRANSFER §8). */}
          <Dialog
            open={reviewToDelete !== null}
            onOpenChange={(open) => { if (!open) setReviewToDelete(null); }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Delete this review?</DialogTitle>
                <DialogDescription>
                  This removes your rating, written review, and photo for{" "}
                  <span className="text-white">{reviewToDelete?.restaurantName}</span>. It can't be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="ghost"
                  onClick={() => setReviewToDelete(null)}
                  disabled={reviewDeleting}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  className="gap-1.5"
                  disabled={reviewDeleting}
                  onClick={async () => {
                    if (!reviewToDelete) return;
                    setReviewDeleting(true);
                    try {
                      await removeReviewEntry(reviewToDelete);
                      toast.success("Review deleted.");
                      setReviewToDelete(null);
                    } catch (e) {
                      errorToast(e, {
                        fallback: "Couldn't delete that review. Try again.",
                        logTag: "[AccountPage.deleteReview]",
                      });
                    } finally {
                      setReviewDeleting(false);
                    }
                  }}
                >
                  <Trash2 className="size-4" />
                  {reviewDeleting ? "Deleting…" : "Delete"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
              <PreferenceTile label="Allergies" value={profile?.allergies?.join(", ") || "No allergies saved"} />
              <PreferenceTile
                label="Dietary"
                value={profile?.dietary_restrictions?.join(", ") || "No restrictions"}
              />
              <PreferenceTile label="Seating" value={profile?.seating_preference || "No seating preference saved"} />
              <PreferenceTile label="Language" value={profile?.preferred_language || "No language preference saved"} />
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
        <div className="mt-5">
          <AvatarUploadCard />
        </div>
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

        <ChangePasswordSection />

        <Link
          to="/account/voice"
          className="mt-5 flex items-center justify-between rounded-2xl border border-border bg-bg-surface p-5 transition-colors hover:border-gold/40"
        >
          <div>
            <p className="font-serif text-lg text-white">Cenaiva voice settings</p>
            <p className="mt-1 text-xs text-text-secondary">
              Pick the voice Cenaiva uses when she speaks back.
            </p>
          </div>
          <span className="text-xl text-gold" aria-hidden>
            →
          </span>
        </Link>

        <Link
          to="/account/connected-accounts"
          className="mt-3 flex items-center justify-between rounded-2xl border border-border bg-bg-surface p-5 transition-colors hover:border-gold/40"
        >
          <div>
            <p className="font-serif text-lg text-white">Connected accounts</p>
            <p className="mt-1 text-xs text-text-secondary">
              Sign in with Apple, Google, or your phone — all linked to one account.
            </p>
          </div>
          <span className="text-xl text-gold" aria-hidden>
            →
          </span>
        </Link>

        <Link
          to="/account/privacy"
          className="mt-3 flex items-center justify-between rounded-2xl border border-border bg-bg-surface p-5 transition-colors hover:border-gold/40"
        >
          <div>
            <p className="font-serif text-lg text-white">Privacy</p>
            <p className="mt-1 text-xs text-text-secondary">
              Control analytics tracking and marketing communications.
            </p>
          </div>
          <span className="text-xl text-gold" aria-hidden>
            →
          </span>
        </Link>

        <Link
          to="/account/my-data"
          className="mt-3 flex items-center justify-between rounded-2xl border border-border bg-bg-surface p-5 transition-colors hover:border-gold/40"
        >
          <div>
            <p className="font-serif text-lg text-white">My data</p>
            <p className="mt-1 text-xs text-text-secondary">
              Download your data, see what restaurants see, or request a correction.
            </p>
          </div>
          <span className="text-xl text-gold" aria-hidden>
            →
          </span>
        </Link>

        <Link
          to="/account/sign-in-history"
          className="mt-3 flex items-center justify-between rounded-2xl border border-border bg-bg-surface p-5 transition-colors hover:border-gold/40"
        >
          <div>
            <p className="font-serif text-lg text-white">Sign-in history</p>
            <p className="mt-1 text-xs text-text-secondary">
              Review recent sign-ins and sign out of every device.
            </p>
          </div>
          <span className="text-xl text-gold" aria-hidden>
            →
          </span>
        </Link>

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
