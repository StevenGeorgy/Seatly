import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import {
  CalendarDays,
  ShoppingBag,
  Gift,
  User,
  ArrowLeft,
  CreditCard,
  MapPin,
  Clock,
  Users,
  ChevronDown,
} from "lucide-react";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { useUser } from "@/hooks/useUser";
import { PaymentMethodsSection } from "@/components/customer/PaymentMethodsSection";
import { useMyReservations } from "@/hooks/useMyReservations";
import { useMyOrders, type MyOrderRow } from "@/hooks/useMyOrders";
import { useUpdateProfile } from "@/hooks/useUpdateProfile";

// Form schema — dietary/allergy arrays handled via controlled CSV state
const profileFormSchema = z.object({
  full_name: z.string().min(1, "Name is required").max(120),
  email: z.string().email("Invalid email address"),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
});
type ProfileFormValues = z.infer<typeof profileFormSchema>;

// ─── Status pill ─────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: string }) {
  const colours: Record<string, string> = {
    confirmed: "bg-emerald-500/15 text-emerald-400",
    pending: "bg-amber-500/15 text-amber-400",
    cancelled: "bg-red-500/15 text-red-400",
    completed: "bg-blue-500/15 text-blue-400",
    paid: "bg-emerald-500/15 text-emerald-400",
    preparing: "bg-amber-500/15 text-amber-400",
    ready: "bg-sky-500/15 text-sky-400",
    no_show: "bg-red-500/15 text-red-400",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${colours[status] ?? "bg-border text-text-muted"}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

// ─── Order card with expandable items ────────────────────────────────────────
function OrderCard({ order }: { order: MyOrderRow }) {
  const total = order.total_amount ? `$${(order.total_amount / 100).toFixed(2)}` : null;
  const date = order.created_at ? format(new Date(order.created_at), "MMM d, yyyy") : null;

  return (
    <details className="group rounded-xl border border-border bg-bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">
              {order.restaurant?.name ?? "Restaurant"}
            </span>
            {order.order_type && (
              <span className="rounded-full bg-gold/10 px-2 py-0.5 text-xs text-gold capitalize">
                {order.order_type.replace("_", " ")}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
            {date && <span><Clock className="inline size-3 mr-0.5" />{date}</span>}
            {order.confirmation_code && <span>#{order.confirmation_code}</span>}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {total && <span className="text-sm font-semibold">{total}</span>}
          <StatusPill status={order.status} />
          {order.order_items.length > 0 && (
            <ChevronDown className="size-4 text-text-muted transition-transform group-open:rotate-180" />
          )}
        </div>
      </summary>
      {order.order_items.length > 0 && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          <ul className="space-y-1">
            {order.order_items.map((item) => (
              <li key={item.id} className="flex justify-between text-sm text-text-secondary">
                <span>{item.quantity}× {item.name}</span>
                <span>${((item.unit_price * item.quantity) / 100).toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AccountPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { profile, signOut, canUseCustomerView, isCustomerView, switchToStaffView } = useUser();
  const { upcoming, past, loading: resLoading } = useMyReservations();
  const { orders, loading: ordLoading } = useMyOrders();
  const { updateProfile, saving } = useUpdateProfile();

  // CSV state for array fields (simpler than Controller for plain inputs)
  const [dietaryCsv, setDietaryCsv] = useState(
    () => (profile?.dietary_restrictions ?? []).join(", "),
  );
  const [allergiesCsv, setAllergiesCsv] = useState(
    () => (profile?.allergies ?? []).join(", "),
  );

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

  const onSubmit = async (values: ProfileFormValues) => {
    const csvToArray = (csv: string) =>
      csv.split(",").map((s) => s.trim()).filter(Boolean);
    await updateProfile({
      ...values,
      dietary_restrictions: csvToArray(dietaryCsv),
      allergies: csvToArray(allergiesCsv),
    });
    reset(values);
  };

  const initials = (profile?.full_name ?? profile?.email ?? "?")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="min-h-screen bg-bg-base text-text-primary">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3 sm:px-6">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/discover">
              <ArrowLeft className="size-5" />
            </Link>
          </Button>
          <h1 className="flex-1 text-base font-semibold">{t("routes.account.title")}</h1>
          {canUseCustomerView && isCustomerView && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                switchToStaffView();
                void navigate("/dashboard");
              }}
            >
              {t("dashboard.shell.switchToStaffView")}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            {t("dashboard.shell.signOut")}
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        {/* Profile card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="flex items-center gap-4 rounded-xl border border-border bg-bg-surface p-5"
        >
          <Avatar className="size-14 border-2 border-gold/30">
            <AvatarImage src={profile?.avatar_url ?? undefined} />
            <AvatarFallback className="bg-gold/10 text-lg font-bold text-gold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">
              {profile?.full_name ?? profile?.email ?? "\u2014"}
            </p>
            <p className="truncate text-sm text-text-muted">{profile?.email}</p>
          </div>
        </motion.div>

        {/* Tabs */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.1 }}
          className="mt-6"
        >
          <Tabs defaultValue="bookings">
            <TabsList>
              <TabsTrigger value="bookings" className="gap-1.5">
                <CalendarDays className="size-3.5" />
                Bookings
              </TabsTrigger>
              <TabsTrigger value="orders" className="gap-1.5">
                <ShoppingBag className="size-3.5" />
                Orders
              </TabsTrigger>
              <TabsTrigger value="loyalty" className="gap-1.5">
                <Gift className="size-3.5" />
                Loyalty
              </TabsTrigger>
              <TabsTrigger value="payment" className="gap-1.5">
                <CreditCard className="size-3.5" />
                Payment
              </TabsTrigger>
              <TabsTrigger value="profile" className="gap-1.5">
                <User className="size-3.5" />
                Profile
              </TabsTrigger>
            </TabsList>

            {/* ─── Bookings ─────────────────────────────────────────────── */}
            <TabsContent value="bookings" className="mt-6 space-y-6">
              {resLoading ? (
                <div className="py-8 text-center text-sm text-text-muted">Loading…</div>
              ) : upcoming.length === 0 && past.length === 0 ? (
                <EmptyState
                  icon={<CalendarDays className="size-5" />}
                  title="No bookings yet"
                  description="Your upcoming and past reservations will appear here."
                />
              ) : (
                <>
                  {upcoming.length > 0 && (
                    <section>
                      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Upcoming
                      </h3>
                      <ul className="space-y-3">
                        {upcoming.map((r) => (
                          <li
                            key={r.id}
                            className="rounded-xl border border-border bg-bg-surface p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                  {r.restaurant?.name ?? "Restaurant"}
                                </p>
                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                                  <span>
                                    <CalendarDays className="inline size-3 mr-0.5" />
                                    {format(new Date(r.reserved_at), "MMM d, yyyy · h:mm a")}
                                  </span>
                                  <span>
                                    <Users className="inline size-3 mr-0.5" />
                                    {r.party_size} guests
                                  </span>
                                  {r.table?.label && (
                                    <span>
                                      <MapPin className="inline size-3 mr-0.5" />
                                      Table {r.table.label}
                                    </span>
                                  )}
                                </div>
                                {r.confirmation_code && (
                                  <p className="mt-1 text-xs text-text-muted">
                                    #{r.confirmation_code}
                                  </p>
                                )}
                              </div>
                              <StatusPill status={r.status} />
                            </div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {past.length > 0 && (
                    <section>
                      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Past
                      </h3>
                      <ul className="space-y-3">
                        {past.map((r) => (
                          <li
                            key={r.id}
                            className="rounded-xl border border-border bg-bg-surface p-4 opacity-75"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                  {r.restaurant?.name ?? "Restaurant"}
                                </p>
                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                                  <span>
                                    <CalendarDays className="inline size-3 mr-0.5" />
                                    {format(new Date(r.reserved_at), "MMM d, yyyy · h:mm a")}
                                  </span>
                                  <span>
                                    <Users className="inline size-3 mr-0.5" />
                                    {r.party_size} guests
                                  </span>
                                </div>
                                {r.confirmation_code && (
                                  <p className="mt-1 text-xs text-text-muted">
                                    #{r.confirmation_code}
                                  </p>
                                )}
                              </div>
                              <StatusPill status={r.status} />
                            </div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </>
              )}
            </TabsContent>

            {/* ─── Orders ───────────────────────────────────────────────── */}
            <TabsContent value="orders" className="mt-6">
              {ordLoading ? (
                <div className="py-8 text-center text-sm text-text-muted">Loading…</div>
              ) : orders.length === 0 ? (
                <EmptyState
                  icon={<ShoppingBag className="size-5" />}
                  title="No orders yet"
                  description="Your order history will appear here."
                />
              ) : (
                <div className="space-y-3">
                  {orders.map((o) => (
                    <OrderCard key={o.id} order={o} />
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ─── Loyalty ──────────────────────────────────────────────── */}
            <TabsContent value="loyalty" className="mt-6">
              <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-bg-surface p-8">
                <div className="flex size-16 items-center justify-center rounded-2xl bg-gold/10">
                  <Gift className="size-7 text-gold" />
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-gold">0</p>
                  <p className="mt-1 text-sm text-text-muted">Points Balance</p>
                </div>
              </div>
            </TabsContent>

            {/* ─── Payment ──────────────────────────────────────────────── */}
            <TabsContent value="payment" className="mt-6">
              <div className="rounded-xl border border-border bg-bg-surface p-6">
                <PaymentMethodsSection />
              </div>
            </TabsContent>

            {/* ─── Profile ──────────────────────────────────────────────── */}
            <TabsContent value="profile" className="mt-6">
              <div className="rounded-xl border border-border bg-bg-surface p-6">
                <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-5">
                  <div className="space-y-1.5">
                    <Label htmlFor="full_name">Name</Label>
                    <Input id="full_name" {...register("full_name")} />
                    {errors.full_name && (
                      <p className="text-xs text-red-400">{errors.full_name.message}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" {...register("email")} />
                    {errors.email ? (
                      <p className="text-xs text-red-400">{errors.email.message}</p>
                    ) : (
                      <p className="text-xs text-text-muted">
                        Changing your email will send a verification link.
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="phone">Phone</Label>
                    <Input id="phone" type="tel" {...register("phone")} />
                    {errors.phone && (
                      <p className="text-xs text-red-400">{errors.phone.message}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="dietary_restrictions">Dietary restrictions</Label>
                    <Input
                      id="dietary_restrictions"
                      placeholder="e.g. vegetarian, halal"
                      value={dietaryCsv}
                      onChange={(e) => setDietaryCsv(e.target.value)}
                    />
                    <p className="text-xs text-text-muted">Comma-separated. Used by Cenaiva when booking.</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="allergies">Allergies</Label>
                    <Input
                      id="allergies"
                      placeholder="e.g. peanuts, shellfish"
                      value={allergiesCsv}
                      onChange={(e) => setAllergiesCsv(e.target.value)}
                    />
                    <p className="text-xs text-text-muted">Comma-separated. Flagged prominently to restaurant staff.</p>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Button type="submit" disabled={!isDirty || saving}>
                      {saving ? "Saving…" : "Save changes"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => reset()}
                      disabled={!isDirty || saving}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </div>
            </TabsContent>
          </Tabs>
        </motion.div>
      </div>
    </div>
  );
}
