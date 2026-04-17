import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { CalendarDays, Plus, Search, X, CalendarIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { SectionCard } from "@/components/dashboard/SectionCard";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useReservations, type ReservationFilters } from "@/hooks/useReservations";

const STATUS_TABS = ["all", "pending", "confirmed", "seated", "completed", "cancelled"] as const;

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of [0, 30]) {
    const ampm = h < 12 ? "AM" : "PM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    TIME_OPTIONS.push(`${h12}:${m === 0 ? "00" : "30"} ${ampm}`);
  }
}

function parseTime(timeStr: string): { hours: number; minutes: number } {
  const match = /^(\d+):(\d+)\s+(AM|PM)$/i.exec(timeStr);
  if (!match) return { hours: 12, minutes: 0 };
  let h = parseInt(match[1]);
  const min = parseInt(match[2]);
  const period = match[3].toUpperCase();
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return { hours: h, minutes: min };
}

export default function ReservationsPage() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const filters = useMemo((): ReservationFilters => ({
    status: statusFilter === "all" ? undefined : statusFilter,
    search: search || undefined,
  }), [statusFilter, search]);

  const { reservations, loading, updateStatus, createReservation } = useReservations(filters);

  // New Reservation form state
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [partySize, setPartySize] = useState("2");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedTime, setSelectedTime] = useState("7:00 PM");
  const [specialRequest, setSpecialRequest] = useState("");
  const [calOpen, setCalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setGuestName(""); setGuestEmail(""); setGuestPhone(""); setPartySize("2");
    setSelectedDate(undefined); setSelectedTime("7:00 PM"); setSpecialRequest("");
  };

  const handleCreate = async () => {
    if (!guestName.trim()) { toast.error("Guest name is required."); return; }
    if (!selectedDate) { toast.error("Please select a date."); return; }
    const { hours, minutes } = parseTime(selectedTime);
    const dt = new Date(selectedDate);
    dt.setHours(hours, minutes, 0, 0);

    setSaving(true);
    try {
      await createReservation({
        guest_name: guestName.trim(),
        guest_email: guestEmail.trim(),
        guest_phone: guestPhone.trim(),
        party_size: Math.max(1, parseInt(partySize) || 1),
        reserved_at: dt.toISOString(),
        special_request: specialRequest.trim(),
      });
      toast.success("Reservation created.");
      setDrawerOpen(false);
      resetForm();
    } catch (err) {
      toast.error("Failed: " + (err instanceof Error ? err.message : "unknown error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <PageHeader
        title={t("dashboard.reservations.title")}
        actions={
          <Button size="default" className="gap-2" onClick={() => setDrawerOpen(true)}>
            <Plus className="size-4" />
            {t("dashboard.reservations.newReservation")}
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList>
            {STATUS_TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab} className="capitalize">
                {t(`dashboard.reservations.${tab === "all" ? "all" : tab}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input
            placeholder={t("dashboard.reservations.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Reservation List */}
      <SectionCard noPadding>
        {loading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : reservations.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="size-5" />}
            title={t("dashboard.reservations.noReservations")}
            description={t("dashboard.reservations.noReservationsDesc")}
          />
        ) : (
          <div className="divide-y divide-border">
            <AnimatePresence mode="popLayout">
              {reservations.map((r, i) => {
                const guestName = r.guests?.full_name ?? r.guest_full_name ?? "\u2014";
                const time = format(new Date(r.reserved_at), "MMM d, h:mm a");

                return (
                  <motion.div
                    key={r.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.2, delay: i * 0.02 }}
                    className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-bg-elevated/50"
                  >
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gold/10 font-mono text-xs font-semibold text-gold">
                      {r.party_size}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium text-text-primary">
                        {guestName}
                      </span>
                      <span className="text-xs text-text-muted">
                        {time}
                        {r.special_request ? ` · ${r.special_request}` : ""}
                      </span>
                    </div>
                    {r.confirmation_code ? (
                      <span className="hidden font-mono text-xs text-text-muted sm:block">
                        {r.confirmation_code}
                      </span>
                    ) : null}
                    <StatusBadge status={r.status} />
                    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      {r.status === "confirmed" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void updateStatus(r.id, "seated").then(() => toast.success("Checked in."))}
                        >
                          {t("dashboard.reservations.checkIn")}
                        </Button>
                      ) : null}
                      {r.status === "pending" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void updateStatus(r.id, "confirmed").then(() => toast.success("Confirmed."))}
                        >
                          {t("common.actions.confirm")}
                        </Button>
                      ) : null}
                      {r.status !== "cancelled" && r.status !== "completed" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => void updateStatus(r.id, "cancelled").then(() => toast.success("Cancelled."))}
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </SectionCard>

      {/* New Reservation Dialog */}
      <Dialog open={drawerOpen} onOpenChange={(o) => { setDrawerOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("dashboard.reservations.newReservation")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label>Guest name *</Label>
                <Input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Jane Smith" />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Party size</Label>
                <Input type="number" min="1" max="99" value={partySize} onChange={(e) => setPartySize(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Email</Label>
                <Input type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} placeholder="jane@example.com" />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Phone</Label>
                <Input type="tel" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder="+1 555 000 0000" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label>Date *</Label>
                <Popover open={calOpen} onOpenChange={setCalOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="justify-start gap-2 text-left font-normal">
                      <CalendarIcon className="size-4 shrink-0 text-text-muted" />
                      {selectedDate ? format(selectedDate, "MMM d, yyyy") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(d) => { setSelectedDate(d); setCalOpen(false); }}
                      disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Time</Label>
                <div className="relative">
                  <select
                    value={selectedTime}
                    onChange={(e) => setSelectedTime(e.target.value)}
                    className="h-9 w-full appearance-none rounded-lg border border-border bg-bg-elevated px-3 pr-7 text-xs text-text-primary outline-none focus:border-gold/40"
                  >
                    {TIME_OPTIONS.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Special request</Label>
              <Input value={specialRequest} onChange={(e) => setSpecialRequest(e.target.value)} placeholder="Dietary requirements, occasion…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDrawerOpen(false); resetForm(); }}>
              Cancel
            </Button>
            <Button disabled={saving} onClick={() => void handleCreate()}>
              {saving ? "Saving…" : "Create Reservation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AnimatedPage>
  );
}
