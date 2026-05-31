import { CalendarDays, Download, Mail, Pencil, Phone, Ticket, Trash2, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useEventAttendees, type EventTimelineRow } from "@/hooks/useEventAttendees";
import { cn } from "@/lib/utils";
import { formatCompactTimeLabelInTz } from "@/lib/utils/time";

type EventAttendeesDialogProps = {
  event: EventTimelineRow | null;
  open: boolean;
  timezone: string | null;
  onOpenChange: (open: boolean) => void;
  onEdit?: (event: EventTimelineRow) => void;
  onCancel?: (event: EventTimelineRow) => void;
  onExport?: (event: EventTimelineRow) => void;
};

function formatLongDate(date: string, timezone: string | null): string {
  const probe = new Date(`${date}T12:00:00${timezone ? "" : "Z"}`);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone ?? undefined,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(probe);
}

function formatTimeRange(
  startTime: string | null,
  endTime: string | null,
): string {
  if (!startTime && !endTime) return "All day";
  const fmt = (value: string | null) => {
    if (!value) return "";
    const [h, m] = value.split(":");
    const hours = Number(h);
    const minutes = Number(m ?? 0);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
    const suffix = hours >= 12 ? "PM" : "AM";
    const displayHour = hours % 12 || 12;
    return `${displayHour}:${String(minutes).padStart(2, "0")} ${suffix}`;
  };
  if (startTime && endTime) return `${fmt(startTime)} – ${fmt(endTime)}`;
  if (startTime) return `From ${fmt(startTime)}`;
  return `Until ${fmt(endTime)}`;
}

function defaultHandler(label: string): () => void {
  return () => {
    if (typeof window !== "undefined") {
      window.alert(`${label} — coming soon`);
    }
  };
}

export function EventAttendeesDialog({
  event,
  open,
  timezone,
  onOpenChange,
  onEdit,
  onCancel,
  onExport,
}: EventAttendeesDialogProps) {
  const { attendees, loading } = useEventAttendees(event?.id ?? null);

  const totalCovers = attendees.reduce((sum, row) => sum + row.party_size, 0);
  const capacityLabel =
    event?.capacity != null
      ? `${event.tickets_sold} / ${event.capacity} sold`
      : `${event?.tickets_sold ?? 0} sold · Unlimited capacity`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-3xl gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border bg-bg-elevated/40 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-2">
              <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-gold">
                <Ticket className="size-3.5" />
                Event attendees
              </div>
              <DialogTitle className="font-serif text-2xl text-white">
                {event?.name ?? "Event"}
              </DialogTitle>
              {event ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="size-3.5 text-gold" />
                    {formatLongDate(event.date, timezone)}
                  </span>
                  <span className="text-text-muted">·</span>
                  <span>{formatTimeRange(event.start_time, event.end_time)}</span>
                  <span className="text-text-muted">·</span>
                  <Badge variant="secondary" className="bg-gold/15 text-gold">
                    {capacityLabel}
                  </Badge>
                  {event.theme ? (
                    <Badge variant="outline" className="text-text-secondary">
                      {event.theme}
                    </Badge>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 text-xs text-text-muted">
              <Users className="size-3.5" />
              {attendees.length} {attendees.length === 1 ? "reservation" : "reservations"} ·{" "}
              {totalCovers} {totalCovers === 1 ? "cover" : "covers"} confirmed
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                onClick={() => (event ? (onEdit ?? defaultHandler("Edit event"))(event) : null)}
              >
                <Pencil className="size-3.5" />
                Edit event
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                onClick={() => (event ? (onExport ?? defaultHandler("Export list"))(event) : null)}
              >
                <Download className="size-3.5" />
                Export list
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-8 gap-1.5 text-xs"
                onClick={() => (event ? (onCancel ?? defaultHandler("Cancel event"))(event) : null)}
              >
                <Trash2 className="size-3.5" />
                Cancel event
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-auto">
          {loading ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : attendees.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
              <div className="flex size-12 items-center justify-center rounded-full border border-border bg-bg-elevated text-gold">
                <Ticket className="size-5" />
              </div>
              <div>
                <p className="font-serif text-xl text-white">No reservations yet</p>
                <p className="mt-1 max-w-md text-xs text-text-muted">
                  Bookings tagged with this event will appear here as soon as guests reserve.
                </p>
              </div>
            </div>
          ) : (
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-border bg-bg-elevated/20 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                  <th className="px-5 py-3 font-medium">Guest</th>
                  <th className="px-5 py-3 font-medium">Party</th>
                  <th className="px-5 py-3 font-medium">Arrival</th>
                  <th className="px-5 py-3 font-medium">Table</th>
                  <th className="px-5 py-3 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {attendees.map((attendee) => (
                  <tr key={attendee.id} className="text-sm">
                    <td className="px-5 py-4">
                      <p className="font-medium text-white">{attendee.full_name}</p>
                      <div className="mt-1 flex flex-col gap-0.5 text-[11px] text-text-muted">
                        {attendee.phone ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Phone className="size-3" />
                            {attendee.phone}
                          </span>
                        ) : null}
                        {attendee.email ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Mail className="size-3" />
                            {attendee.email}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-text-secondary">
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="size-3.5 text-text-muted" />
                        {attendee.party_size}
                      </span>
                    </td>
                    <td className="px-5 py-4 font-mono text-gold">
                      {formatCompactTimeLabelInTz(new Date(attendee.reserved_at), timezone)}
                    </td>
                    <td className="px-5 py-4 text-text-secondary">{attendee.table_label}</td>
                    <td className="px-5 py-4">
                      <div className="flex flex-col gap-1">
                        {attendee.occasion ? (
                          <Badge
                            variant="outline"
                            className={cn(
                              "w-fit border-gold/30 bg-gold/10 text-gold",
                            )}
                          >
                            {attendee.occasion}
                          </Badge>
                        ) : null}
                        <span className="text-xs text-text-muted">
                          {attendee.special_request || "—"}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
