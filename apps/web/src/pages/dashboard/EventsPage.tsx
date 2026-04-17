import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PartyPopper, Plus, Calendar, Users, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useEvents, type EventRow } from "@/hooks/useEvents";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils/formatCurrency";

export default function EventsPage() {
  const { t } = useTranslation();
  const { selectedRestaurant, selectedRestaurantId } = useRestaurantScope();
  const currency = selectedRestaurant?.currency ?? "cad";
  const { events, loading, refetch } = useEvents();

  const [modalOpen, setModalOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<EventRow | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [calOpen, setCalOpen] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [eventDate, setEventDate] = useState<Date | undefined>(undefined);
  const [pricePerPerson, setPricePerPerson] = useState("");
  const [capacity, setCapacity] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setName(""); setDescription(""); setEventDate(undefined);
    setPricePerPerson(""); setCapacity(""); setCoverUrl("");
  };

  const openCreate = () => { setEditEvent(null); resetForm(); setModalOpen(true); };
  const openEdit = (ev: EventRow) => {
    setEditEvent(ev);
    setName(ev.name);
    setDescription(ev.description ?? "");
    setEventDate(ev.date ? new Date(ev.date) : undefined);
    setPricePerPerson(ev.price_per_person != null ? String(ev.price_per_person) : "");
    setCapacity(ev.capacity != null ? String(ev.capacity) : "");
    setCoverUrl(ev.cover_image_url ?? "");
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Event name is required."); return; }
    if (!eventDate) { toast.error("Please select a date."); return; }
    if (!selectedRestaurantId || !isSupabaseConfigured()) return;
    setSaving(true);
    const client = getSupabaseBrowserClient();
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      date: format(eventDate, "yyyy-MM-dd"),
      price_per_person: pricePerPerson ? parseFloat(pricePerPerson) : null,
      capacity: capacity ? parseInt(capacity) : null,
      cover_image_url: coverUrl.trim() || null,
      restaurant_id: selectedRestaurantId,
    };
    if (editEvent) {
      const { error } = await client.from("events").update(payload).eq("id", editEvent.id);
      if (error) { toast.error("Could not update event."); setSaving(false); return; }
      toast.success("Event updated.");
    } else {
      const { error } = await client.from("events").insert({ ...payload, tickets_sold: 0, is_recurring: false, is_private: false });
      if (error) { toast.error("Could not create event."); setSaving(false); return; }
      toast.success("Event created.");
    }
    setSaving(false);
    setModalOpen(false);
    resetForm();
    void refetch();
  };

  const handleDelete = async (id: string) => {
    if (!isSupabaseConfigured()) return;
    const client = getSupabaseBrowserClient();
    const { error } = await client.from("events").delete().eq("id", id);
    if (error) { toast.error("Could not delete event."); return; }
    toast.success("Event deleted.");
    setDeleteId(null);
    void refetch();
  };

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <PageHeader
        title={t("dashboard.events.title")}
        actions={
          <Button size="default" className="gap-2" onClick={openCreate}>
            <Plus className="size-4" />
            {t("dashboard.events.createEvent")}
          </Button>
        }
      />

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[260px] rounded-lg" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          icon={<PartyPopper className="size-5" />}
          title={t("dashboard.events.noEvents")}
          description={t("dashboard.events.noEventsDesc")}
          action={
            <Button size="default" className="gap-2" onClick={openCreate}>
              <Plus className="size-4" />
              {t("dashboard.events.createEvent")}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event, i) => {
            const ticketPercent = event.capacity
              ? Math.round((event.tickets_sold / event.capacity) * 100)
              : 0;

            return (
              <motion.div
                key={event.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
                className="group overflow-hidden rounded-lg border border-border bg-bg-surface transition-colors hover:border-gold/30"
              >
                {event.cover_image_url ? (
                  <div className="relative h-32 w-full overflow-hidden bg-bg-elevated">
                    <img
                      src={event.cover_image_url}
                      alt={event.name}
                      className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-bg-base/80 to-transparent" />
                  </div>
                ) : (
                  <div className="flex h-32 items-center justify-center bg-bg-elevated">
                    <PartyPopper className="size-8 text-text-muted" />
                  </div>
                )}
                <div className="flex flex-col gap-3 p-4">
                  <div className="flex items-start gap-2">
                    <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
                      {event.name}
                    </h3>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" className="size-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
                          <MoreVertical className="size-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(event)}>
                          <Pencil className="mr-2 size-3.5" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleteId(event.id)}
                        >
                          <Trash2 className="mr-2 size-3.5" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-text-muted">
                    <span className="flex items-center gap-1">
                      <Calendar className="size-3.5" />
                      {format(new Date(event.date), "MMM d, yyyy")}
                    </span>
                    {event.price_per_person ? (
                      <span>{formatCurrency(event.price_per_person, currency)}/person</span>
                    ) : null}
                  </div>
                  {event.capacity ? (
                    <div className="flex items-center gap-2">
                      <Progress value={ticketPercent} className="h-1.5 flex-1" />
                      <span className="flex items-center gap-1 text-xs text-text-secondary">
                        <Users className="size-3" />
                        {event.tickets_sold}/{event.capacity}
                      </span>
                    </div>
                  ) : null}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={modalOpen} onOpenChange={(o) => { setModalOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editEvent ? "Edit Event" : t("dashboard.events.createEvent")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>Event name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jazz Night" />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Description</Label>
              <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label>Date *</Label>
                <Popover open={calOpen} onOpenChange={setCalOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="justify-start text-left font-normal">
                      {eventDate ? format(eventDate, "MMM d, yyyy") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-0">
                    <CalendarPicker
                      mode="single"
                      selected={eventDate}
                      onSelect={(d) => { setEventDate(d); setCalOpen(false); }}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Capacity</Label>
                <Input type="number" min="0" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Unlimited" />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Price / person ({currency.toUpperCase()})</Label>
                <Input type="number" min="0" step="0.01" value={pricePerPerson} onChange={(e) => setPricePerPerson(e.target.value)} placeholder="0.00" />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Cover image URL</Label>
                <Input value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} placeholder="https://…" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setModalOpen(false); resetForm(); }}>Cancel</Button>
            <Button disabled={saving} onClick={() => void handleSave()}>
              {saving ? "Saving…" : editEvent ? "Save Changes" : "Create Event"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader><DialogTitle>Delete event?</DialogTitle></DialogHeader>
          <p className="text-sm text-text-secondary">This cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteId && void handleDelete(deleteId)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AnimatedPage>
  );
}
