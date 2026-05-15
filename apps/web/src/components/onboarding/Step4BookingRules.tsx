import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Pizza, Salad, Beef } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

import {
  daysOfWeekFromHours,
  defaultShift,
  earliestOpen,
  latestClose,
  timeOptions24h,
  timeTo12h,
  type HoursJson,
  type WizardShift,
} from "./wizardTypes";

const DOW_LABEL: { value: number; label: string }[] = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

const TURN_OPTIONS: { label: string; minutes: number; icon: typeof Pizza }[] = [
  { label: "Quick", minutes: 60, icon: Pizza },
  { label: "Standard", minutes: 90, icon: Salad },
  { label: "Leisurely", minutes: 120, icon: Beef },
];

type Step4BookingRulesProps = {
  restaurantId: string;
  hours: HoursJson | null;
  initial: WizardShift | null;
  onComplete: (shift: WizardShift) => void;
  onBusyChange: (busy: boolean) => void;
};

type ExistingShiftRow = {
  id: string;
  name: string | null;
  days_of_week: number[] | null;
  start_time: string | null;
  end_time: string | null;
  turn_time_minutes: number | null;
  slot_duration_minutes: number | null;
  max_covers: number | null;
  advance_booking_days: number | null;
};

function TimePicker({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  const options = timeOptions24h();
  return (
    <div className="relative flex-1">
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full appearance-none rounded-lg border border-border bg-bg-elevated px-3 pr-7 text-sm text-text-primary outline-none focus:border-gold/40"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {timeTo12h(opt)}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
    </div>
  );
}

function trimSeconds(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{2}:\d{2}$/.test(value)) return value;
  if (/^\d{2}:\d{2}:\d{2}/.test(value)) return value.slice(0, 5);
  return null;
}

export function Step4BookingRules({
  restaurantId,
  hours,
  initial,
  onComplete,
  onBusyChange,
}: Step4BookingRulesProps) {
  const seed = useMemo<WizardShift>(() => {
    if (initial) return initial;
    const base = defaultShift();
    if (hours) {
      const days = daysOfWeekFromHours(hours);
      const start = earliestOpen(hours);
      const end = latestClose(hours);
      return {
        ...base,
        daysOfWeek: days.length > 0 ? days : base.daysOfWeek,
        startTime: start ?? base.startTime,
        endTime: end ?? base.endTime,
      };
    }
    return base;
  }, [hours, initial]);

  const [shift, setShift] = useState<WizardShift>(seed);
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (hydrated) return;
    let cancelled = false;
    void (async () => {
      if (!isSupabaseConfigured()) {
        setHydrated(true);
        return;
      }
      const client = getSupabaseBrowserClient();
      const { data } = await client
        .from("shifts")
        .select("id, name, days_of_week, start_time, end_time, turn_time_minutes, slot_duration_minutes, max_covers, advance_booking_days")
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true)
        .order("name", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        const row = data as ExistingShiftRow;
        setShiftId(row.id);
        setShift((prev) => ({
          name: row.name ?? prev.name,
          daysOfWeek: row.days_of_week ?? prev.daysOfWeek,
          startTime: trimSeconds(row.start_time) ?? prev.startTime,
          endTime: trimSeconds(row.end_time) ?? prev.endTime,
          turnTimeMinutes: row.turn_time_minutes ?? prev.turnTimeMinutes,
          slotDurationMinutes: row.slot_duration_minutes ?? prev.slotDurationMinutes,
          maxCovers: row.max_covers ?? prev.maxCovers,
          advanceBookingDays: row.advance_booking_days ?? prev.advanceBookingDays,
        }));
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, restaurantId]);

  const toggleDay = (dow: number) => {
    setShift((prev) => {
      const has = prev.daysOfWeek.includes(dow);
      const next = has ? prev.daysOfWeek.filter((d) => d !== dow) : [...prev.daysOfWeek, dow];
      return { ...prev, daysOfWeek: next.sort((a, b) => a - b) };
    });
  };

  const onSubmit = async () => {
    if (shift.daysOfWeek.length === 0) {
      toast.error("Pick at least one service day.");
      return;
    }
    if (!shift.name.trim()) {
      toast.error("Give your shift a name.");
      return;
    }
    if (!isSupabaseConfigured()) {
      toast.error("Supabase is not configured.");
      return;
    }
    setSubmitting(true);
    onBusyChange(true);
    try {
      const client = getSupabaseBrowserClient();
      const payload = {
        name: shift.name.trim(),
        days_of_week: shift.daysOfWeek,
        start_time: shift.startTime,
        end_time: shift.endTime,
        turn_time_minutes: shift.turnTimeMinutes,
        slot_duration_minutes: shift.slotDurationMinutes,
        max_covers: shift.maxCovers,
        advance_booking_days: shift.advanceBookingDays,
        is_active: true,
      };

      if (shiftId) {
        const { error } = await client.from("shifts").update(payload).eq("id", shiftId);
        if (error) {
          toast.error(error.message);
          return;
        }
      } else {
        const { error } = await client
          .from("shifts")
          .insert({ ...payload, restaurant_id: restaurantId });
        if (error) {
          toast.error(error.message);
          return;
        }
      }
      onComplete(shift);
    } finally {
      setSubmitting(false);
      onBusyChange(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Booking rules</h1>
        <p className="mt-1 text-sm text-text-muted">
          Set when guests can book and how long each table stays seated.
        </p>
      </div>

      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-bg-surface p-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="shift-name">Shift name</Label>
          <Input
            id="shift-name"
            value={shift.name}
            onChange={(e) => setShift((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Dinner"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label>Days of week</Label>
          <div className="flex flex-wrap gap-2">
            {DOW_LABEL.map((d) => {
              const active = shift.daysOfWeek.includes(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDay(d.value)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "border-gold bg-gold/10 text-gold"
                      : "border-border bg-bg-elevated text-text-secondary hover:border-gold/30"
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label>Service start</Label>
            <TimePicker
              value={shift.startTime}
              onChange={(v) => setShift((prev) => ({ ...prev, startTime: v }))}
              ariaLabel="Service start"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Service end</Label>
            <TimePicker
              value={shift.endTime}
              onChange={(v) => setShift((prev) => ({ ...prev, endTime: v }))}
              ariaLabel="Service end"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Turn time</Label>
          <div className="grid grid-cols-3 gap-2">
            {TURN_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const active = shift.turnTimeMinutes === opt.minutes;
              return (
                <button
                  key={opt.minutes}
                  type="button"
                  onClick={() => setShift((prev) => ({ ...prev, turnTimeMinutes: opt.minutes }))}
                  className={`flex flex-col items-center gap-1 rounded-xl border p-3 text-center transition-colors ${
                    active
                      ? "border-gold bg-gold/10 text-gold"
                      : "border-border bg-bg-elevated text-text-secondary hover:border-gold/30"
                  }`}
                >
                  <Icon className="size-5" />
                  <span className="text-sm font-semibold">{opt.label}</span>
                  <span className="text-[10px] uppercase tracking-wider text-text-muted">
                    {opt.minutes} min
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-bg-surface">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex w-full items-center justify-between px-5 py-3 text-sm font-semibold text-text-primary"
          aria-expanded={advancedOpen}
        >
          Advanced settings
          <ChevronDown className={`size-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
        </button>
        {advancedOpen ? (
          <div className="grid gap-3 border-t border-border px-5 py-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="slot-duration">Slot interval (min)</Label>
              <Input
                id="slot-duration"
                type="number"
                min={5}
                max={120}
                value={shift.slotDurationMinutes}
                onChange={(e) =>
                  setShift((prev) => ({
                    ...prev,
                    slotDurationMinutes: Math.max(5, Math.min(120, Number.parseInt(e.target.value, 10) || 30)),
                  }))
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="max-covers">Max covers (blank = unlimited)</Label>
              <Input
                id="max-covers"
                type="number"
                min={1}
                value={shift.maxCovers ?? ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  setShift((prev) => ({
                    ...prev,
                    maxCovers: raw === "" ? null : Math.max(1, Number.parseInt(raw, 10) || 1),
                  }));
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="advance-days">Advance booking (days)</Label>
              <Input
                id="advance-days"
                type="number"
                min={1}
                max={3650}
                value={shift.advanceBookingDays}
                onChange={(e) =>
                  setShift((prev) => ({
                    ...prev,
                    advanceBookingDays: Math.max(1, Math.min(3650, Number.parseInt(e.target.value, 10) || 30)),
                  }))
                }
              />
            </div>
          </div>
        ) : null}
      </section>

      <div className="flex items-center justify-end">
        <Button onClick={onSubmit} disabled={submitting} className="px-6">
          {submitting ? "Saving…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}
