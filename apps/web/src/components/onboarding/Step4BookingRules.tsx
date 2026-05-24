import { useEffect, useMemo, useState } from "react";
import { Pizza, Salad, Beef } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useErrorToast } from "@/lib/errors";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

import {
  daysOfWeekFromHours,
  defaultShift,
  earliestOpen,
  latestClose,
  type HoursJson,
  type WizardShift,
} from "./wizardTypes";

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
  turn_time_minutes: number | null;
};

export function Step4BookingRules({
  restaurantId,
  hours,
  initial,
  onComplete,
  onBusyChange,
}: Step4BookingRulesProps) {
  const derived = useMemo<WizardShift>(() => {
    const base = initial ?? defaultShift();
    if (!hours) return base;
    const days = daysOfWeekFromHours(hours);
    return {
      ...base,
      daysOfWeek: days.length > 0 ? days : base.daysOfWeek,
      startTime: earliestOpen(hours) ?? base.startTime,
      endTime: latestClose(hours) ?? base.endTime,
    };
  }, [hours, initial]);

  const { errorToast } = useErrorToast();
  const [turnTimeMinutes, setTurnTimeMinutes] = useState<number>(derived.turnTimeMinutes);
  const [shiftId, setShiftId] = useState<string | null>(null);
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
        .select("id, turn_time_minutes")
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true)
        .order("name", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        const row = data as ExistingShiftRow;
        setShiftId(row.id);
        if (row.turn_time_minutes) setTurnTimeMinutes(row.turn_time_minutes);
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, restaurantId]);

  const onSubmit = async () => {
    if (!isSupabaseConfigured()) {
      toast.error("Supabase is not configured.");
      return;
    }
    const nextShift: WizardShift = { ...derived, turnTimeMinutes };
    if (nextShift.daysOfWeek.length === 0) {
      toast.error("Set your open hours first so we know which days you take bookings.");
      return;
    }
    setSubmitting(true);
    onBusyChange(true);
    try {
      const client = getSupabaseBrowserClient();
      const payload = {
        name: nextShift.name,
        days_of_week: nextShift.daysOfWeek,
        start_time: nextShift.startTime,
        end_time: nextShift.endTime,
        turn_time_minutes: nextShift.turnTimeMinutes,
        slot_duration_minutes: nextShift.slotDurationMinutes,
        max_covers: nextShift.maxCovers,
        advance_booking_days: nextShift.advanceBookingDays,
        is_active: true,
      };

      if (shiftId) {
        const { error } = await client.from("shifts").update(payload).eq("id", shiftId);
        if (error) {
          errorToast(error, {
            fallback: "Couldn't update shift. Try again.",
            logTag: "[Step4BookingRules.updateShift]",
          });
          return;
        }
      } else {
        const { error } = await client
          .from("shifts")
          .insert({ ...payload, restaurant_id: restaurantId });
        if (error) {
          errorToast(error, {
            fallback: "Couldn't create shift. Try again.",
            logTag: "[Step4BookingRules.insertShift]",
          });
          return;
        }
      }
      onComplete(nextShift);
    } finally {
      setSubmitting(false);
      onBusyChange(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">How long do guests stay?</h1>
        <p className="mt-1 text-sm text-text-muted">
          Pick a typical turn time. We use this to figure out how many bookings fit per table during
          your open hours. You can fine-tune lunch vs. dinner shifts later in Settings.
        </p>
      </div>

      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-bg-surface p-5">
        <div className="flex flex-col gap-2">
          <Label>Turn time</Label>
          <div className="grid grid-cols-3 gap-2">
            {TURN_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const active = turnTimeMinutes === opt.minutes;
              return (
                <button
                  key={opt.minutes}
                  type="button"
                  onClick={() => setTurnTimeMinutes(opt.minutes)}
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

      <div className="flex items-center justify-end">
        <Button id="wizard-step-submit" onClick={onSubmit} disabled={submitting} className="px-6">
          {submitting ? "Saving…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}
