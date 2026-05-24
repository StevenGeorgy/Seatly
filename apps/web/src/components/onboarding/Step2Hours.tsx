import { useMemo, useState } from "react";
import { ChevronDown, Lock } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useErrorToast } from "@/lib/errors";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  DEFAULT_DINNER_HOURS,
  ONBOARDING_DAYS,
  emptyHoursJson,
  timeOptions24h,
  timeTo12h,
  type HoursJson,
  type OnboardingDay,
} from "./wizardTypes";
import { clearDraft, readDraft, useDraftAutosave } from "./draftPersistence";

const DAY_LABEL: Record<OnboardingDay, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

type Step2HoursProps = {
  restaurantId: string;
  initial: HoursJson | null;
  onComplete: (hours: HoursJson) => void;
  onBusyChange: (busy: boolean) => void;
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
        className="h-9 w-full appearance-none rounded-lg border border-border bg-bg-elevated px-3 pr-7 text-sm text-text-primary outline-none focus:border-gold/40"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {timeTo12h(opt)}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
    </div>
  );
}

export function Step2Hours({ restaurantId, initial, onComplete, onBusyChange }: Step2HoursProps) {
  const { errorToast } = useErrorToast();
  const draftKey = `step2.${restaurantId}`;
  const [hours, setHours] = useState<HoursJson>(
    () => readDraft<HoursJson>(draftKey) ?? initial ?? emptyHoursJson(),
  );
  useDraftAutosave<HoursJson>(draftKey, hours);
  const [submitting, setSubmitting] = useState(false);

  const atLeastOneOpen = useMemo(
    () => ONBOARDING_DAYS.some((day) => hours[day] !== null),
    [hours],
  );

  const toggleDay = (day: OnboardingDay) => {
    setHours((prev) => ({
      ...prev,
      [day]: prev[day] === null ? { ...DEFAULT_DINNER_HOURS } : null,
    }));
  };

  const updateDay = (day: OnboardingDay, patch: { open?: string; close?: string }) => {
    setHours((prev) => {
      const current = prev[day];
      if (current === null) return prev;
      return {
        ...prev,
        [day]: { open: patch.open ?? current.open, close: patch.close ?? current.close },
      };
    });
  };

  const onSubmit = async () => {
    if (!atLeastOneOpen) {
      toast.error("Pick at least one day you're open.");
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
      const { error } = await client
        .from("restaurants")
        .update({ hours_json: hours })
        .eq("id", restaurantId);
      if (error) {
        errorToast(error, {
          fallback: "Couldn't save hours. Try again.",
          logTag: "[Step2Hours.saveHours]",
        });
        return;
      }
      // Sync the default shift's days_of_week + service times so Step 4 doesn't
      // show all 7 days pre-selected (which the edge function defaults to when
      // hours_json is null at Step 1 submit time).
      const dbDayIndex: Record<OnboardingDay, number> = {
        sunday: 0,
        monday: 1,
        tuesday: 2,
        wednesday: 3,
        thursday: 4,
        friday: 5,
        saturday: 6,
      };
      const openDays: number[] = [];
      const opens: string[] = [];
      const closes: string[] = [];
      ONBOARDING_DAYS.forEach((day) => {
        const v = hours[day];
        if (v !== null) {
          openDays.push(dbDayIndex[day]);
          opens.push(v.open);
          closes.push(v.close);
        }
      });
      if (openDays.length > 0) {
        openDays.sort((a, b) => a - b);
        opens.sort();
        closes.sort();
        const startTime = opens[0];
        const endTime = closes[closes.length - 1];
        const { error: shiftError } = await client
          .from("shifts")
          .update({ days_of_week: openDays, start_time: startTime, end_time: endTime })
          .eq("restaurant_id", restaurantId)
          .eq("is_active", true);
        if (shiftError) {
          console.error("[Step2Hours] failed to sync shift days_of_week", shiftError);
        }
      }
      clearDraft(draftKey);
      onComplete(hours);
    } finally {
      setSubmitting(false);
      onBusyChange(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Set your hours</h1>
        <p className="mt-1 text-sm text-text-muted">
          Toggle each day on or off. Most spots default to dinner — adjust to match your service.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {ONBOARDING_DAYS.map((day) => {
          const value = hours[day];
          const isOpen = value !== null;
          return (
            <div
              key={day}
              className="flex min-h-[64px] flex-col gap-3 rounded-xl border border-border bg-bg-surface p-4 transition-colors sm:flex-row sm:items-center sm:gap-4 sm:p-3"
            >
              <button
                type="button"
                onClick={() => toggleDay(day)}
                className="flex items-center gap-3 sm:gap-2"
                aria-pressed={isOpen}
              >
                <span
                  className={`relative flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                    isOpen ? "bg-gold" : "bg-border"
                  }`}
                >
                  <span
                    className={`size-4 rounded-full bg-white shadow transition-transform ${
                      isOpen ? "translate-x-[18px]" : "translate-x-[2px]"
                    }`}
                  />
                </span>
                <span
                  className={`w-24 text-left text-sm font-medium ${
                    isOpen ? "text-text-primary" : "text-text-muted"
                  }`}
                >
                  {DAY_LABEL[day]}
                </span>
              </button>

              {isOpen ? (
                <div className="flex flex-1 items-center gap-2">
                  <TimePicker
                    value={value!.open}
                    onChange={(v) => updateDay(day, { open: v })}
                    ariaLabel={`${DAY_LABEL[day]} open time`}
                  />
                  <span className="text-xs text-text-muted">to</span>
                  <TimePicker
                    value={value!.close}
                    onChange={(v) => updateDay(day, { close: v })}
                    ariaLabel={`${DAY_LABEL[day]} close time`}
                  />
                </div>
              ) : (
                <span className="flex-1 text-sm text-text-muted">Closed</span>
              )}
            </div>
          );
        })}
      </div>

      <section className="rounded-xl border border-dashed border-border bg-bg-surface/40 p-4 opacity-60">
        <div className="flex items-center gap-2 text-sm font-semibold text-text-secondary">
          <Lock className="size-4" />
          Closures &amp; exceptions
        </div>
        <p className="mt-1 text-xs text-text-muted">
          Holiday closures and one-off exception dates land in the dashboard after publishing.
        </p>
      </section>

      <div className="flex items-center justify-between">
        <Label className="text-xs text-text-muted">
          {atLeastOneOpen ? "Looks good — at least one day is open." : "Pick at least one open day to continue."}
        </Label>
        <Button id="wizard-step-submit" onClick={onSubmit} disabled={!atLeastOneOpen || submitting} className="px-6">
          {submitting ? "Saving…" : "Continue to floor plan"}
        </Button>
      </div>
    </div>
  );
}
