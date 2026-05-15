import type { RestaurantDietaryTag } from "@/lib/restaurant-dietary-tags";

export const WIZARD_TOTAL_STEPS = 8;

export const ONBOARDING_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type OnboardingDay = (typeof ONBOARDING_DAYS)[number];

export type DayHoursValue = { open: string; close: string } | null;

export type HoursJson = Record<OnboardingDay, DayHoursValue>;

export type WizardTableShape = "round" | "square" | "rectangle" | "booth";

export type WizardTable = {
  id: string;
  label: string;
  capacity: number;
  shape: WizardTableShape;
};

export type WizardBasics = {
  restaurantName: string;
  address: string;
  city: string;
  province: string;
  country: string;
  postalCode: string;
  lat: number | null;
  lng: number | null;
  businessType: string;
  cuisineType: string;
  phone: string;
  description: string;
  acceptsWalkins: boolean;
  dietaryTags: RestaurantDietaryTag[];
};

export type WizardShift = {
  name: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  turnTimeMinutes: number;
  slotDurationMinutes: number;
  maxCovers: number | null;
  advanceBookingDays: number;
};

export const DEFAULT_DINNER_HOURS: { open: string; close: string } = {
  open: "17:00",
  close: "22:00",
};

export function emptyHoursJson(): HoursJson {
  return {
    monday: null,
    tuesday: null,
    wednesday: null,
    thursday: null,
    friday: null,
    saturday: null,
    sunday: null,
  };
}

export const STARTER_TABLES: WizardTable[] = [
  { id: "t1", label: "T1", capacity: 2, shape: "round" },
  { id: "t2", label: "T2", capacity: 2, shape: "round" },
  { id: "t3", label: "T3", capacity: 4, shape: "square" },
  { id: "t4", label: "T4", capacity: 4, shape: "square" },
  { id: "t5", label: "T5", capacity: 6, shape: "rectangle" },
];

export function defaultShift(): WizardShift {
  return {
    name: "Dinner",
    daysOfWeek: [1, 2, 3, 4, 5, 6, 0],
    startTime: "17:00",
    endTime: "22:00",
    turnTimeMinutes: 90,
    slotDurationMinutes: 30,
    maxCovers: null,
    advanceBookingDays: 3650,
  };
}

// Sunday=0 to match Postgres `extract(dow from ...)` (used by shifts.days_of_week).
const DAY_TO_DOW: Record<OnboardingDay, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export function daysOfWeekFromHours(hours: HoursJson): number[] {
  return ONBOARDING_DAYS
    .filter((day) => hours[day] !== null)
    .map((day) => DAY_TO_DOW[day])
    .sort((a, b) => a - b);
}

export function earliestOpen(hours: HoursJson): string | null {
  const opens = ONBOARDING_DAYS
    .map((day) => hours[day]?.open)
    .filter((v): v is string => Boolean(v))
    .sort();
  return opens[0] ?? null;
}

export function latestClose(hours: HoursJson): string | null {
  const closes = ONBOARDING_DAYS
    .map((day) => hours[day]?.close)
    .filter((v): v is string => Boolean(v))
    .sort();
  return closes[closes.length - 1] ?? null;
}

export function timeTo12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number.parseInt(hStr ?? "0", 10);
  const m = Number.parseInt(mStr ?? "0", 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

const TIME_OPTIONS_24H: string[] = (() => {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return out;
})();

export function timeOptions24h(): string[] {
  return TIME_OPTIONS_24H;
}
