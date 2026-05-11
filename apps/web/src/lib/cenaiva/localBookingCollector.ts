import type {
  AssistantResponseType,
  BookingState,
  UIActionType,
} from "@cenaiva/assistant";

import { isCenaivaProcessPrompt } from "@/lib/cenaiva/simplePromptIntent";

type AvailabilityMode =
  | "exact"
  | "any_day_at_time"
  | "weekday_any_time"
  | "date_any_time"
  | "first_available";

export type CenaivaAvailabilityRequest = {
  restaurant_id: string;
  restaurant_name?: string | null;
  party_size: number;
  mode: AvailabilityMode;
  purpose?: "booking" | "hours";
  date?: string | null;
  time?: string | null;
  weekday?: number | null;
  timezone?: string | null;
  search_days?: number;
  nearest_count?: number;
  split_at?: string;
};

export type CenaivaAvailabilityOption = {
  shift_id: string;
  shift_name?: string;
  date_time: string;
  display_time: string;
  date: string;
  diff_minutes?: number;
  hours_window?: string | null;
};

export type CenaivaAvailabilityResponse = {
  status: "available" | "unavailable" | "options" | "needs_more_info";
  requested?: {
    date?: string | null;
    time?: string | null;
    weekday?: number | null;
  };
  selected_slot?: CenaivaAvailabilityOption | null;
  alternatives?: CenaivaAvailabilityOption[];
  hours_window?: string | null;
  unavailable_reason?:
    | "closed"
    | "no_shifts"
    | "party_size_out_of_range"
    | "insufficient_capacity"
    | "fully_booked"
    | "no_future_slots"
    | "no_slots"
    | string
    | null;
  message?: string;
};

export type LocalBookingDecision =
  | { kind: "pass" }
  | {
      kind: "local_response";
      response: AssistantResponseType;
      clearPendingOptions?: boolean;
    }
  | {
      kind: "check_availability";
      request: CenaivaAvailabilityRequest;
      filler: string;
      responseBeforeCheck: AssistantResponseType;
    };

type LocalBookingContext = {
  transcript: string;
  booking: BookingState;
  conversationId: string | null;
  selectedRestaurantId?: string | null;
  selectedRestaurantName?: string | null;
  timezone?: string | null;
  pendingOptions?: CenaivaAvailabilityOption[];
  lastAssistantPrompt?: string | null;
};

type AmbiguousBareTime = {
  hour: number;
  minute: number;
  label: string;
};

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  one: 1,
  won: 1,
  two: 2,
  too: 2,
  to: 2,
  couple: 2,
  pair: 2,
  three: 3,
  four: 4,
  for: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  ate: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const TIME_WORDS: Record<string, number> = {
  midnight: 0,
  noon: 12,
  twelve: 12,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
};

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const PREORDER_PAYMENT_OR_POLICY_PATTERN =
  /\b(menu|pre[- ]?order|order food|checkout|pay|payment|card|deposit|refund|fee|tax|tip|directions?|address|phone|contact|hours?|parking|dress code|bring (?:a )?(?:dog|pet)|kids allowed|allow kids|wheelchair|accessible|accessibility|halal|gluten[- ]free|allerg(?:y|ies)|birthday cake|split bills?|no[- ]shows?|cancel reservation|change the booking later|modify reservation)\b/i;

const DISCOVERY_PATTERN =
  /\b(find|show|search|recommend|suggest|pick|choose|closest|nearest|near me|nearby|near|around me|restaurants?|places?|spots?|cuisine|italian|french|european|europeean|europian|japanese|sushi|thai|spanish|greek|mediterranean|steakhouse|egyptian|asian|halal|vegan|burgers?|mocktails?|cocktails?|vegetarian|seafood|steak|healthy|spicy|dessert|downtown|something nice|surprise me|you choose|cheaper|fancier|closer|different restaurant|switch to)\b/i;

const BACKEND_STATUSES = new Set<BookingState["status"]>([
  "confirmed",
  "post_booking",
  "offering_preorder",
  "browsing_menu",
  "reviewing_cart",
  "choosing_tip_timing",
  "choosing_tip_amount",
  "choosing_payment_split",
  "collecting_payment",
  "charging",
  "paid",
]);

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTimeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[-,.!?;]/g, " ")
    .replace(
      /\b(uh+|um+|er+|ah+|hmm+|please|pls|thanks|thank you|actually|maybe|i think|okay|ok|yeah|yep|yes|sure|alright)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function numberTokenToInt(token: string | undefined): number | null {
  if (!token) return null;
  if (/^\d+$/.test(token)) {
    const n = parseInt(token, 10);
    return n >= 1 && n <= 9999 ? n : null;
  }
  return NUMBER_WORDS[token] ?? null;
}

export function parseLocalPartySize(raw: string): number | null {
  const t = normalize(raw);
  if (
    /\b(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:or|to|-)\s*(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/.test(
      t,
    )
  ) {
    return null;
  }
  const adultsKids = t.match(
    /\b(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten)\s+adults?\b[\s\S]{0,30}\b(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:kids?|children)\b/,
  );
  if (adultsKids) {
    const adults = numberTokenToInt(adultsKids[1]);
    const kids = numberTokenToInt(adultsKids[2]);
    if (adults != null && kids != null) return adults + kids;
  }
  const kidsAdults = t.match(
    /\b(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:kids?|children)\b[\s\S]{0,30}\b(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten)\s+adults?\b/,
  );
  if (kidsAdults) {
    const kids = numberTokenToInt(kidsAdults[1]);
    const adults = numberTokenToInt(kidsAdults[2]);
    if (adults != null && kids != null) return adults + kids;
  }
  if (/\b(just me|solo|alone|by myself)\b/.test(t)) return 1;
  if (
    /\b(me plus one|me and (?:my )?(?:wife|husband|partner|boyfriend|girlfriend|date|friend))\b/.test(
      t,
    )
  ) {
    return 2;
  }
  if (/\b(double date)\b/.test(t)) return 4;

  const explicit = t.match(
    /\b(?:party of|table for|for|group of|we are|we're|make it|book for|reservation for)\s+(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a|couple|pair)\b/,
  );
  if (explicit) {
    const n = numberTokenToInt(explicit[1]);
    if (n != null) return n;
  }

  const people = t.match(
    /\b(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:people|guests|guest|adults|pax|persons?|of us)\b/,
  );
  if (people) {
    const n = numberTokenToInt(people[1]);
    if (n != null) return n;
  }

  const bare = t.match(
    /^(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)$/,
  );
  if (bare) return numberTokenToInt(bare[1]);
  return null;
}

function formatISODateInTimeZone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function addDaysToISODate(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

function localDayOfWeek(dateStr: string, timezone: string): number {
  const localDow = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  })
    .format(new Date(`${dateStr}T12:00:00Z`))
    .toLowerCase();
  return WEEKDAYS.indexOf(localDow);
}

export function parseLocalDate(
  raw: string,
  timezone = "America/Toronto",
): string | null {
  const t = normalize(raw);
  const todayIso = formatISODateInTimeZone(new Date(), timezone);
  if (/\b(today|tonight|this evening)\b/.test(t)) return todayIso;
  if (/\btomorrow\b/.test(t)) return addDaysToISODate(todayIso, 1);

  const iso = t.match(/\b(\d{4})\s+(\d{2})\s+(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const monthDay = t.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/,
  );
  if (monthDay) {
    const month = MONTHS[monthDay[1]];
    const day = parseInt(monthDay[2], 10);
    if (month && day >= 1 && day <= 31) {
      const currentYear = parseInt(todayIso.slice(0, 4), 10);
      let candidate = `${currentYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (candidate < todayIso) {
        candidate = `${currentYear + 1}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
      return candidate;
    }
  }

  const todayDow = localDayOfWeek(todayIso, timezone);
  for (let i = 0; i < WEEKDAYS.length; i += 1) {
    const re = new RegExp(`\\b(?:this|next|on)?\\s*${WEEKDAYS[i]}\\b`);
    if (!re.test(t)) continue;
    const diff = (i - todayDow + 7) % 7 || 7;
    return addDaysToISODate(todayIso, diff);
  }

  return null;
}

export function parseLocalWeekday(raw: string): number | null {
  const t = normalize(raw);
  for (let i = 0; i < WEEKDAYS.length; i += 1) {
    if (new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(t)) return i;
  }
  if (/\bnext weekend\b/.test(t)) return 6;
  return null;
}

function ambiguousTime(hour: number, minute: number): AmbiguousBareTime | null {
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 1 || hour > 12 || minute < 0 || minute >= 60) return null;
  const label = minute === 0 ? String(hour) : `${hour}:${String(minute).padStart(2, "0")}`;
  return { hour, minute, label };
}

function hhmmFromPeriod(time: AmbiguousBareTime, period: "am" | "pm"): string {
  let hour = time.hour;
  if (period === "pm" && hour < 12) hour += 12;
  if (period === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

function ambiguousTimePrompt(time: AmbiguousBareTime): string {
  return `Did you mean ${time.label} AM or ${time.label} PM?`;
}

function detectAmbiguousBareTime(
  raw: string,
  opts: { allowBareTime?: boolean } = {},
): AmbiguousBareTime | null {
  const t = normalizeTimeText(raw);
  if (!t) return null;

  if (/\b(am|pm|a m|p m)\b/.test(t)) return null;

  const colon = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (colon) {
    return ambiguousTime(parseInt(colon[1], 10), parseInt(colon[2], 10));
  }

  const word =
    t.match(
      /\b(?:at|around|about|after|before|by|maybe|like|how about|tonight|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+(twelve|one|two|three|four|five|six|seven|eight|nine|ten|eleven)\s*(thirty|fifteen|forty five)?\b(?!\s+(?:people|guests|guest|of us|adults|kids|children))/,
    ) ??
    (opts.allowBareTime
      ? t.match(
          /^(twelve|one|two|three|four|five|six|seven|eight|nine|ten|eleven)\s*(thirty|fifteen|forty five)?$/,
        )
      : null);
  if (word) {
    const hour = TIME_WORDS[word[1]];
    if (hour != null) {
      const modifier = word[2];
      const minute =
        modifier === "thirty"
          ? 30
          : modifier === "fifteen"
            ? 15
            : modifier === "forty five"
              ? 45
              : 0;
      return ambiguousTime(hour, minute);
    }
  }

  const contextualBare = t.match(
    /\b(?:at|around|about|for|after|before|by|tonight|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+(\d{1,2})(?:\s*ish)?\b(?!\s*(?:people|guests|of us))/,
  );
  if (contextualBare) {
    return ambiguousTime(parseInt(contextualBare[1], 10), 0);
  }

  if (opts.allowBareTime) {
    const bare = t.match(/^(\d{1,2})(?:\s*ish)?$/);
    if (bare) return ambiguousTime(parseInt(bare[1], 10), 0);
  }

  return null;
}

function resolvePendingTimeClarification(
  raw: string,
  lastAssistantPrompt?: string | null,
): string | null {
  if (!lastAssistantPrompt) return null;
  const promptMatch = lastAssistantPrompt.match(
    /did you mean\s+(\d{1,2})(?::(\d{2}))?\s+am\s+or\s+\d{1,2}(?::\d{2})?\s+pm/i,
  );
  if (!promptMatch) return null;
  const pending = ambiguousTime(
    parseInt(promptMatch[1], 10),
    promptMatch[2] ? parseInt(promptMatch[2], 10) : 0,
  );
  if (!pending) return null;

  const t = normalizeTimeText(raw);
  if (/\b(am|a m|morning|breakfast)\b/.test(t)) return hhmmFromPeriod(pending, "am");
  if (/\b(pm|p m|afternoon|evening|night|tonight|dinner)\b/.test(t)) {
    return hhmmFromPeriod(pending, "pm");
  }
  return null;
}

function isPartySizeReplyPrompt(lastAssistantPrompt?: string | null): boolean {
  if (!lastAssistantPrompt) return false;
  return /\b(how many guests|how many people|party size|guest count|smaller party size|smaller group|how many seats)\b/i.test(
    lastAssistantPrompt,
  );
}

function hasExplicitPartySizeCue(raw: string): boolean {
  const t = normalize(raw);
  return (
    /\b(?:party of|table for|group of|we are|we're|make it|book for|reservation for)\s+(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a|couple|pair)\b/.test(
      t,
    ) ||
    /\b(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:people|guests|guest|adults|pax|persons?|of us)\b/.test(
      t,
    ) ||
    /\b(just me|solo|alone|by myself|me plus one|double date)\b/.test(t)
  );
}

export function parseLocalTime(
  raw: string,
  opts: { allowBareTime?: boolean } = {},
): string | null {
  const t = normalizeTimeText(raw);

  const ampm = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a m|p m)\b/);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const min = ampm[2] ? parseInt(ampm[2], 10) : 0;
    const period = ampm[3].replace(/\s/g, "");
    if (period === "pm" && h < 12) h += 12;
    if (period === "am" && h === 12) h = 0;
    if (h >= 0 && h <= 23 && min >= 0 && min < 60) {
      return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    }
  }

  const colon = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (colon) {
    const h = parseInt(colon[1], 10);
    const min = parseInt(colon[2], 10);
    if (h >= 0 && h <= 23 && min >= 0 && min < 60 && !ambiguousTime(h, min)) {
      return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    }
  }

  const word =
    t.match(
      /\b(?:at|around|about|after|before|by|maybe|like|how about)\s+(midnight|noon|twelve|one|two|three|four|five|six|seven|eight|nine|ten|eleven)\s*(thirty|fifteen|forty five|am|pm)?\s*(am|pm)?\b(?!\s+(?:people|guests|guest|of us|adults|kids|children))/,
    ) ??
    (opts.allowBareTime
      ? t.match(
          /^(midnight|noon|twelve|one|two|three|four|five|six|seven|eight|nine|ten|eleven)\s*(thirty|fifteen|forty five|am|pm)?\s*(am|pm)?$/,
        )
      : null);
  if (word) {
    const base = TIME_WORDS[word[1]];
    if (base != null) {
      let h = base;
      let min = 0;
      const modifier = word[2];
      let period = word[3] ?? null;
      if (modifier === "thirty") min = 30;
      else if (modifier === "fifteen") min = 15;
      else if (modifier === "forty five") min = 45;
      else if (modifier === "am" || modifier === "pm") period = modifier;
      if (period === "pm" && h < 12) h += 12;
      if (period === "am" && h === 12) h = 0;
      if (!period && (word[1] === "noon" || word[1] === "midnight")) {
        return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
      }
      if (!period) return null;
      return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    }
  }

  const contextualBare = t.match(
    /\b(?:at|around|about|for|after|before|by|tonight|tomorrow|friday|saturday|sunday|monday|tuesday|wednesday|thursday)\s+(\d{1,2})(?:\s*ish)?\b(?!\s*(?:people|guests|of us))/,
  );
  if (contextualBare) {
    const h = parseInt(contextualBare[1], 10);
    if (ambiguousTime(h, 0)) return null;
    if (h >= 0 && h <= 23) return `${String(h).padStart(2, "0")}:00`;
  }

  if (opts.allowBareTime) {
    const bare = t.match(/^(\d{1,2})(?:\s*ish)?$/);
    if (bare) {
      const h = parseInt(bare[1], 10);
      if (ambiguousTime(h, 0)) return null;
      if (h >= 0 && h <= 23) return `${String(h).padStart(2, "0")}:00`;
    }
  }

  return null;
}

function parseSpecialRequest(raw: string): string | null {
  const t = normalize(raw);
  const requests: string[] = [];
  if (/\boutdoor|patio\b/.test(t)) requests.push("outdoor seating if available");
  if (/\bindoor|inside\b/.test(t)) requests.push("indoor seating");
  if (/\bbooth\b/.test(t)) requests.push("booth if available");
  if (/\bquiet|private|calm\b/.test(t)) requests.push("quieter seating if available");
  if (/\bhigh chair\b/.test(t)) requests.push("high chair if available");
  if (/\bwindow\b/.test(t)) requests.push("window table if available");
  return requests.length ? requests.join(", ") : null;
}

function isAffirmative(raw: string): boolean {
  const t = normalize(raw);
  return (
    /^(yes|yeah|yep|yup|sure|ok|okay|alright|sounds good|go ahead|book it|confirm|confirmed|do it|lock it in|please do)$/.test(
      t,
    ) || /\b(yes|confirm|book it|go ahead|lock it in|make the reservation)\b/.test(t)
  );
}

function wantsBackendDiscovery(raw: string, hasRestaurant: boolean): boolean {
  const t = normalize(raw);
  if (!DISCOVERY_PATTERN.test(t)) return false;
  if (!hasRestaurant) return true;
  return /\b(different|switch|instead|closer|cheaper|fancier|another|new restaurant|new place)\b/.test(
    t,
  );
}

function shouldUseBackendProcess(raw: string): boolean {
  return PREORDER_PAYMENT_OR_POLICY_PATTERN.test(raw);
}

function isRestaurantHoursQuestion(raw: string): boolean {
  const t = normalize(raw);
  return (
    /\b(hours?|store hours|business hours|open|opens|opened|closed|close|closes|closing)\b/.test(
      t,
    ) &&
    /\b(when|what|what time|how late|are they|is it|is the restaurant|open|closed|hours?|closes?|closing)\b/.test(
      t,
    )
  );
}

function hasNamedBookingRequest(raw: string): boolean {
  const t = normalize(raw);
  // "Book X..." / "Reserve X..." (where X is not a generic placeholder)
  if (
    /\b(book|reserve)\s+(?!it\b|anything\b|a table\b|table\b|me\b|somewhere\b|something\b|the usual\b|the closest\b|the nearest\b)(?:[a-z0-9']{3,}|[a-z0-9']{1,2}\s+[a-z0-9']{3,})/.test(
      t,
    )
  ) {
    return true;
  }
  // "... at <name>" — e.g. "Get me a table at Mark Testing", "Table for 2 at X",
  // "Anyone available at X tonight", "Book me at X", "I want sushi at X".
  // The name must be at least 3 chars and not a generic word like "home/work".
  if (
    /\bat\s+(?!home\b|work\b|noon\b|midnight\b|night\b|the\s+(?:bar|restaurant|place|spot)\b|\d)(?:[a-z0-9']{3,}|[a-z0-9']{1,2}\s+[a-z0-9']{3,})/.test(
      t,
    )
  ) {
    return true;
  }
  // "I want to book/reserve X", "Need a/the reservation at X", etc.
  if (
    /\b(want|wanna|need|gotta|trying)\s+(?:to\s+)?(?:book|reserve|get|grab|hit|try)\s+(?!it\b|anything\b|a table\b|table\b|me\b|somewhere\b|something\b|the usual\b)(?:[a-z0-9']{3,}|[a-z0-9']{1,2}\s+[a-z0-9']{3,})/.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

function isVagueBookingStart(raw: string): boolean {
  const t = normalize(raw);
  return (
    /^(dinner|lunch|breakfast|brunch|table|reservation|book it|just book it|i need food|food|tonight maybe|for us|whatever works|make it good)$/.test(
      t,
    ) ||
    /\b(just get me a table|book anything available|fastest option|skip the questions)\b/.test(
      t,
    )
  );
}

function choosePendingOption(
  raw: string,
  pendingOptions: CenaivaAvailabilityOption[] | undefined,
): CenaivaAvailabilityOption | null {
  if (!pendingOptions?.length) return null;
  const t = normalize(raw);
  const ordinal = /\b(second|2|two)\b/.test(t)
    ? 1
    : /\b(first|1|one)\b/.test(t)
      ? 0
      : /\b(third|3|three)\b/.test(t)
        ? 2
        : null;
  if (ordinal != null && pendingOptions[ordinal]) return pendingOptions[ordinal];

  const parsedDate = parseLocalDate(raw);
  const parsedTime = parseLocalTime(raw, { allowBareTime: true });
  if (!parsedDate && !parsedTime) return null;
  return (
    pendingOptions.find((option) => {
      const sameDate = !parsedDate || option.date === parsedDate;
      const sameTime =
        !parsedTime || displayTimeToHHMM(option.display_time) === parsedTime;
      return sameDate && sameTime;
    }) ?? null
  );
}

function displayTimeToHHMM(display: string): string | null {
  const m = display.match(/^(\d{1,2}):(\d{2})\s+(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const period = m[3].toUpperCase();
  if (period === "PM" && h < 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function makeResponse(opts: {
  conversationId: string | null;
  spokenText: string;
  intent: AssistantResponseType["intent"];
  step: AssistantResponseType["step"];
  nextExpectedInput: AssistantResponseType["next_expected_input"];
  uiActions?: UIActionType[];
  booking?: AssistantResponseType["booking"];
}): AssistantResponseType {
  return {
    conversation_id: opts.conversationId ?? "",
    spoken_text: opts.spokenText,
    intent: opts.intent,
    step: opts.step,
    next_expected_input: opts.nextExpectedInput,
    ui_actions: opts.uiActions ?? [],
    booking: opts.booking ?? null,
    map: null,
    filters: null,
    assistant_memory: null,
  };
}

function questionForMissing(booking: BookingState): {
  text: string;
  intent: AssistantResponseType["intent"];
  step: AssistantResponseType["step"];
  next: AssistantResponseType["next_expected_input"];
} {
  if (!booking.restaurant_id) {
    return {
      text: "What restaurant or area should I book?",
      intent: "select_restaurant",
      step: "choose_restaurant",
      next: "restaurant",
    };
  }
  if (booking.party_size == null) {
    return {
      text: "How many guests?",
      intent: "choose_party_size",
      step: "choose_party",
      next: "party_size",
    };
  }
  if (!booking.date && !booking.time) {
    return {
      text: "What date and time should I book?",
      intent: "choose_date",
      step: "choose_date",
      next: "date",
    };
  }
  if (!booking.date) {
    return {
      text: "What date should I book?",
      intent: "choose_date",
      step: "choose_date",
      next: "date",
    };
  }
  return {
    text: "What time should I book?",
    intent: "choose_time",
    step: "choose_time",
    next: "time",
  };
}

function buildSetFieldActions(patch: Partial<BookingState>): UIActionType[] {
  const actions: UIActionType[] = [];
  if (patch.party_size != null) {
    actions.push({ type: "set_booking_field", field: "party_size", value: patch.party_size });
  }
  if (patch.date) actions.push({ type: "set_booking_field", field: "date", value: patch.date });
  if (patch.time) actions.push({ type: "set_booking_field", field: "time", value: patch.time });
  if (patch.special_request) {
    actions.push({
      type: "set_booking_field",
      field: "special_request",
      value: patch.special_request,
    });
  }
  return actions;
}

function withPatch(booking: BookingState, patch: Partial<BookingState>): BookingState {
  return { ...booking, ...patch };
}

function buildAvailabilityIntent(
  raw: string,
  date: string | null,
  time: string | null,
  timezone: string,
): Pick<
  CenaivaAvailabilityRequest,
  "mode" | "date" | "time" | "weekday" | "split_at"
> | null {
  const t = normalize(raw);
  const weekday = parseLocalWeekday(raw);
  const wantsAnyDay = /\b(any day|any date|whenever|whatever day|whichever day|any night)\b/.test(
    t,
  );
  const wantsAnyTime = /\b(any time|anytime|whatever time|whenever|earliest available|latest available)\b/.test(
    t,
  );
  const wantsFirstAvailable = /\b(as soon as possible|earliest available|fastest option|first available)\b/.test(
    t,
  );

  if (wantsAnyDay && time) {
    return { mode: "any_day_at_time", date: null, time, weekday: null, split_at: "14:30" };
  }
  if (weekday != null && wantsAnyTime) {
    return { mode: "weekday_any_time", date: null, time: null, weekday, split_at: "14:30" };
  }
  if (date && wantsAnyTime) {
    return { mode: "date_any_time", date, time: null, weekday: null, split_at: "14:30" };
  }
  if (wantsFirstAvailable) {
    return { mode: "first_available", date: null, time: null, weekday: null, split_at: "14:30" };
  }
  if (date && time) {
    return { mode: "exact", date, time, weekday: null, split_at: "14:30" };
  }
  if (!date && weekday != null && wantsAnyTime) {
    return { mode: "weekday_any_time", date: null, time: null, weekday, split_at: "14:30" };
  }
  if (!date && /\bnext weekend\b/.test(t) && wantsAnyTime) {
    return { mode: "weekday_any_time", date: null, time: null, weekday: 6, split_at: "14:30" };
  }

  // Keep timezone in the signature so call sites are explicit about relative dates.
  void timezone;
  return null;
}

function buildSelectionResponse(
  option: CenaivaAvailabilityOption,
  ctx: LocalBookingContext,
): AssistantResponseType {
  const restaurantId = ctx.booking.restaurant_id ?? ctx.selectedRestaurantId ?? null;
  const restaurantName = ctx.booking.restaurant_name ?? ctx.selectedRestaurantName ?? null;
  const hoursSentence = formatHoursSentence(option.hours_window, option.date);
  const spokenText = `Great, ${formatDateForSpeech(option.date)} at ${option.display_time} is available.${hoursSentence ? ` ${hoursSentence}` : ""} Should I book it?`;
  return makeResponse({
    conversationId: ctx.conversationId,
    spokenText,
    intent: "confirm_booking",
    step: "confirm",
    nextExpectedInput: "confirmation",
    uiActions: [
      { type: "set_booking_field", field: "date", value: option.date },
      { type: "set_booking_field", field: "time", value: option.display_time },
      { type: "select_time_slot", slot_iso: option.date_time, shift_id: option.shift_id },
      { type: "confirm_booking" },
    ],
    booking: {
      restaurant_id: restaurantId,
      restaurant_name: restaurantName,
      date: option.date,
      time: option.display_time,
      slot_iso: option.date_time,
      shift_id: option.shift_id,
      status: "confirming",
    },
  });
}

export function planLocalBookingTurn(ctx: LocalBookingContext): LocalBookingDecision {
  const transcript = ctx.transcript.trim();
  if (!transcript) return { kind: "pass" };
  const booking = ctx.booking;
  const restaurantId = booking.restaurant_id ?? ctx.selectedRestaurantId ?? null;
  const restaurantName = booking.restaurant_name ?? ctx.selectedRestaurantName ?? null;
  const hasRestaurant = Boolean(restaurantId);
  const timezone = ctx.timezone || "America/Toronto";

  if (BACKEND_STATUSES.has(booking.status)) return { kind: "pass" };
  if (booking.status === "confirming" && isAffirmative(transcript)) return { kind: "pass" };

  const pendingChoice = choosePendingOption(transcript, ctx.pendingOptions);
  if (pendingChoice) {
    return {
      kind: "local_response",
      response: buildSelectionResponse(pendingChoice, ctx),
      clearPendingOptions: true,
    };
  }

  const patch: Partial<BookingState> = {};
  if (restaurantId) patch.restaurant_id = restaurantId;
  if (restaurantName) patch.restaurant_name = restaurantName;

  const parsedPartySize = parseLocalPartySize(transcript);
  const acceptingPartySizeReply =
    booking.party_size == null ||
    isPartySizeReplyPrompt(ctx.lastAssistantPrompt) ||
    hasExplicitPartySizeCue(transcript);
  const partySize = acceptingPartySizeReply ? parsedPartySize : null;
  if (partySize != null) patch.party_size = partySize;

  const nextPartySize = patch.party_size ?? booking.party_size;
  const parsedDate = parseLocalDate(transcript, timezone);
  const expectingPartySizeReply =
    partySize != null || isPartySizeReplyPrompt(ctx.lastAssistantPrompt);
  const explicitParsedTime = parseLocalTime(transcript, {
    allowBareTime: booking.party_size != null && !expectingPartySizeReply,
  });
  const parsedTime =
    explicitParsedTime ?? resolvePendingTimeClarification(transcript, ctx.lastAssistantPrompt);
  const ambiguousBareTime = parsedTime
    ? null
    : detectAmbiguousBareTime(transcript, {
        allowBareTime: booking.party_size != null && !expectingPartySizeReply,
      });
  if (parsedDate) patch.date = parsedDate;
  if (parsedTime) patch.time = parsedTime;

  const specialRequest = parseSpecialRequest(transcript);
  if (specialRequest) patch.special_request = specialRequest;

  const hasAmbiguousTimeDetail =
    ambiguousBareTime != null && (hasRestaurant || booking.status !== "idle");
  const hasLocalBookingDetail =
    partySize != null ||
    parsedDate != null ||
    parsedTime != null ||
    specialRequest != null ||
    hasAmbiguousTimeDetail;

  if (!isCenaivaProcessPrompt(transcript) && !hasLocalBookingDetail) return { kind: "pass" };
  const wantsHours = isRestaurantHoursQuestion(transcript);
  const explicitlyAsksAvailability = /\b(available|availability|openings?)\b/i.test(transcript);
  if (wantsHours && restaurantId && !parsedTime && !explicitlyAsksAvailability) {
    const hoursDate = parsedDate ?? booking.date ?? formatISODateInTimeZone(new Date(), timezone);
    const responseBeforeCheck = makeResponse({
      conversationId: ctx.conversationId,
      spokenText: "One moment please.",
      intent: "choose_time",
      step: "choose_time",
      nextExpectedInput: "none",
      uiActions: buildSetFieldActions({ ...patch, date: hoursDate }),
      booking: {
        ...patch,
        date: hoursDate,
        status: "loading_availability",
      },
    });

    return {
      kind: "check_availability",
      filler: responseBeforeCheck.spoken_text,
      responseBeforeCheck,
      request: {
        restaurant_id: restaurantId,
        restaurant_name: restaurantName,
        party_size: nextPartySize ?? 1,
        mode: "date_any_time",
        purpose: "hours",
        date: hoursDate,
        time: null,
        weekday: null,
        timezone,
        search_days: 1,
        nearest_count: 2,
        split_at: "14:30",
      },
    };
  }
  if (shouldUseBackendProcess(transcript)) return { kind: "pass" };
  if (!hasRestaurant && hasNamedBookingRequest(transcript)) return { kind: "pass" };
  // When the user names a NEW restaurant ("book me at X") but the booking
  // already has a DIFFERENT restaurant_id (from a prior fact-lookup /
  // promotions / events turn), the local collector would otherwise treat
  // the existing restaurant as confirmed and skip routing to the orchestrator.
  // That meant "book me at nobu" would silently confirm a booking at the
  // previously-fact-looked-up restaurant. Force a pass-through so the
  // orchestrator can check whether the named restaurant exists OR decline
  // with the unknown-restaurant handler.
  if (hasRestaurant && hasNamedBookingRequest(transcript)) return { kind: "pass" };
  if (wantsBackendDiscovery(transcript, hasRestaurant)) return { kind: "pass" };

  const nextBooking = withPatch(booking, patch);

  if (ambiguousBareTime && hasAmbiguousTimeDetail) {
    return {
      kind: "local_response",
      clearPendingOptions: true,
      response: makeResponse({
        conversationId: ctx.conversationId,
        spokenText: ambiguousTimePrompt(ambiguousBareTime),
        intent: "choose_time",
        step: "choose_time",
        nextExpectedInput: "time",
        uiActions: buildSetFieldActions(patch),
        booking: {
          ...patch,
          status: "collecting_minimum_fields",
        },
      }),
    };
  }

  const availabilityIntent = buildAvailabilityIntent(
    transcript,
    nextBooking.date,
    nextBooking.time,
    timezone,
  );

  const hasCollectedAnything =
    Object.keys(patch).some(
      (key) => !["restaurant_id", "restaurant_name"].includes(key),
    ) || isVagueBookingStart(transcript);

  if (!hasCollectedAnything && !availabilityIntent) return { kind: "pass" };

  if (
    !restaurantId ||
    nextPartySize == null ||
    (!availabilityIntent && (!nextBooking.date || !nextBooking.time))
  ) {
    const missing = questionForMissing(nextBooking);
    return {
      kind: "local_response",
      clearPendingOptions: true,
      response: makeResponse({
        conversationId: ctx.conversationId,
        spokenText: missing.text,
        intent: missing.intent,
        step: missing.step,
        nextExpectedInput: missing.next,
        uiActions: buildSetFieldActions(patch),
        booking: {
          ...patch,
          status: "collecting_minimum_fields",
        },
      }),
    };
  }

  const intent =
    availabilityIntent ??
    {
      mode: "exact" as const,
      date: nextBooking.date,
      time: nextBooking.time,
      weekday: null,
      split_at: "14:30",
    };

  const responseBeforeCheck = makeResponse({
    conversationId: ctx.conversationId,
    spokenText: "One moment please.",
    intent: "choose_time",
    step: "choose_time",
    nextExpectedInput: "none",
    uiActions: buildSetFieldActions(patch),
    booking: {
      ...patch,
      status: "loading_availability",
    },
  });

  return {
    kind: "check_availability",
    filler: responseBeforeCheck.spoken_text,
    responseBeforeCheck,
    request: {
      restaurant_id: restaurantId,
      restaurant_name: restaurantName,
      party_size: nextPartySize,
      mode: intent.mode,
      date: intent.date ?? null,
      time: intent.time ?? null,
      weekday: intent.weekday ?? null,
      timezone,
      search_days: 21,
      nearest_count: 2,
      split_at: intent.split_at ?? "14:30",
    },
  };
}

function formatOption(option: CenaivaAvailabilityOption): string {
  return `${formatDateForSpeech(option.date)} at ${option.display_time}`;
}

function formatOptionList(options: CenaivaAvailabilityOption[]): string {
  const labels = options.slice(0, 2).map(formatOption);
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels[0]} or ${labels[1]}`;
}

function isFullCapacityResult(result: CenaivaAvailabilityResponse): boolean {
  return (
    result.unavailable_reason === "fully_booked" ||
    /\b(fully booked|full capacity|at capacity)\b/i.test(result.message ?? "")
  );
}

function isPartySizeOutOfRangeResult(result: CenaivaAvailabilityResponse): boolean {
  return (
    result.unavailable_reason === "party_size_out_of_range" ||
    /\b(party size|guests?|people)\b[\s\S]{0,60}\b(outside|exceeds|too large|capacity|range)\b/i.test(
      result.message ?? "",
    )
  );
}

function isInsufficientCapacityResult(result: CenaivaAvailabilityResponse): boolean {
  return (
    result.unavailable_reason === "insufficient_capacity" ||
    /\b(not enough seats|insufficient capacity|not enough capacity)\b/i.test(
      result.message ?? "",
    )
  );
}

function fullCapacityText(dateStr: string | null | undefined): string {
  return dateStr
    ? `${formatDateForSpeech(dateStr)} is fully booked.`
    : "The restaurant is fully booked.";
}

function partySizeOutOfRangeText(
  restaurantName: string | null | undefined,
  partySize: number,
): string {
  const restaurant = restaurantName || "this restaurant";
  return `${restaurant} cannot book ${partySize} guests. What smaller party size should I check?`;
}

function insufficientCapacityText(
  restaurantName: string | null | undefined,
  partySize: number,
  time: string | null | undefined,
): string {
  const restaurant = restaurantName || "The restaurant";
  const displayTime = time ? ` at ${formatHHMMForSpeech(time)}` : "";
  return `${restaurant} does not have enough seats available${displayTime} for ${partySize} guests.`;
}

function formatHoursSentence(
  hoursWindow: string | null | undefined,
  dateStr: string | null | undefined,
): string {
  const displayHours = formatHoursWindowForSpeech(hoursWindow);
  if (!displayHours) return "";
  return `They're open ${displayHours}${dateStr ? ` on ${formatDateForSpeech(dateStr)}` : ""}.`;
}

function formatHoursWindowForSpeech(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = value.split(/\s+(?:to|-)\s+/i);
  if (parts.length !== 2) return value;
  const formatted = parts.map(formatClockForSpeech);
  return formatted[0] && formatted[1] ? `${formatted[0]} to ${formatted[1]}` : value;
}

function formatClockForSpeech(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const period = match[3]?.toUpperCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59)
    return null;
  if (period) {
    if (hour < 1 || hour > 12) return null;
    if (period === "PM" && hour < 12) hour += 12;
    if (period === "AM" && hour === 12) hour = 0;
  } else if (hour < 0 || hour > 23) {
    return null;
  }
  const displayPeriod = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${displayPeriod}`;
}

function bestHoursInfo(
  result: CenaivaAvailabilityResponse,
  selected: CenaivaAvailabilityOption | null,
  alternatives: CenaivaAvailabilityOption[],
  requestedDate?: string | null,
): { window: string; date: string | null } | null {
  if (selected?.hours_window) return { window: selected.hours_window, date: selected.date };
  if (result.hours_window) return { window: result.hours_window, date: requestedDate ?? null };
  const option = alternatives.find((item) => item.hours_window);
  return option?.hours_window ? { window: option.hours_window, date: option.date } : null;
}

function formatHoursAvailabilityResponse(args: {
  conversationId: string | null;
  request: CenaivaAvailabilityRequest;
  result: CenaivaAvailabilityResponse;
  selected: CenaivaAvailabilityOption | null;
  alternatives: CenaivaAvailabilityOption[];
}): AssistantResponseType {
  const { conversationId, request, result, selected, alternatives } = args;
  const date = request.date ?? selected?.date ?? alternatives[0]?.date ?? null;
  const restaurant = request.restaurant_name || "The restaurant";
  const hours = bestHoursInfo(result, selected, alternatives, date);
  const optionText = alternatives.length
    ? `I see availability around ${formatOptionList(alternatives)}.`
    : selected
      ? `I see ${selected.display_time} available.`
      : result.message
        ? result.message
        : "I do not see bookable times for that date.";
  const displayHours = formatHoursWindowForSpeech(hours?.window);
  const spokenText = displayHours
    ? `${restaurant} is open ${displayHours}${hours?.date ? ` on ${formatDateForSpeech(hours.date)}` : ""}. ${optionText}`
    : `${restaurant} appears closed${date ? ` on ${formatDateForSpeech(date)}` : ""}. ${optionText}`;

  return makeResponse({
    conversationId,
    spokenText,
    intent: "choose_time",
    step: "choose_time",
    nextExpectedInput: "time",
    uiActions: [{ type: "load_availability" }],
    booking: {
      restaurant_id: request.restaurant_id,
      restaurant_name: request.restaurant_name ?? null,
      date: request.date ?? null,
      status: "collecting_minimum_fields",
    },
  });
}

function formatDateForSpeech(dateStr: string): string {
  const [year, month, day] = dateStr.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return dateStr;
  const localNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
  }).format(localNoon);
}

export function buildLocalAvailabilityResponse(args: {
  conversationId: string | null;
  request: CenaivaAvailabilityRequest;
  result: CenaivaAvailabilityResponse;
}): { response: AssistantResponseType; pendingOptions: CenaivaAvailabilityOption[] } {
  const { conversationId, request, result } = args;
  const selected = result.selected_slot ?? null;
  const alternatives = result.alternatives ?? [];
  if (request.purpose === "hours") {
    return {
      pendingOptions: [],
      response: formatHoursAvailabilityResponse({
        conversationId,
        request,
        result,
        selected,
        alternatives,
      }),
    };
  }

  if (result.status === "available" && selected) {
    const ctx: LocalBookingContext = {
      transcript: "",
      booking: {
        restaurant_id: request.restaurant_id,
        restaurant_name: request.restaurant_name ?? null,
        party_size: request.party_size,
        date: selected.date,
        time: selected.display_time,
        shift_id: selected.shift_id,
        slot_iso: selected.date_time,
        special_request: null,
        occasion: null,
        status: "loading_availability",
        confirmation_code: null,
        reservation_id: null,
        want_preorder: null,
        order_id: null,
        payment_status: "idle",
        tip_choice: null,
        tip_amount: null,
        tip_percent: null,
        payment_split: null,
        pending_action: null,
        cart_subtotal: 0,
        cart: [],
        has_saved_card: false,
      },
      conversationId,
    };
    return { response: buildSelectionResponse(selected, ctx), pendingOptions: [] };
  }

  if (alternatives.length) {
    const requestedTime = request.time ? formatHHMMForSpeech(request.time) : null;
    const unavailablePrefix = isFullCapacityResult(result)
      ? `${fullCapacityText(request.date ?? alternatives[0]?.date)} `
      : isInsufficientCapacityResult(result)
        ? `${insufficientCapacityText(request.restaurant_name, request.party_size, request.time)} `
        : isPartySizeOutOfRangeResult(result)
          ? `${partySizeOutOfRangeText(request.restaurant_name, request.party_size)} `
          : request.mode === "exact" && request.date && requestedTime
            ? `${formatDateForSpeech(request.date)} at ${requestedTime} is not available. `
            : "";
    const hours = bestHoursInfo(result, selected, alternatives, request.date);
    const hoursSentence = formatHoursSentence(hours?.window, hours?.date);
    return {
      pendingOptions: alternatives,
      response: makeResponse({
        conversationId,
        spokenText: `${unavailablePrefix}${hoursSentence ? `${hoursSentence} ` : ""}I found ${formatOptionList(alternatives)}. Which should I use?`,
        intent: "choose_time",
        step: "choose_time",
        nextExpectedInput: "time",
        uiActions: [{ type: "load_availability" }],
        booking: {
          restaurant_id: request.restaurant_id,
          restaurant_name: request.restaurant_name ?? null,
          party_size: request.party_size,
          date: request.date ?? null,
          time: request.time ?? null,
          status: "awaiting_time_selection",
        },
      }),
    };
  }

  return {
    pendingOptions: [],
    response: makeResponse({
      conversationId,
      spokenText: (() => {
        const hours = bestHoursInfo(result, selected, alternatives, request.date);
        const hoursSentence = formatHoursSentence(hours?.window, hours?.date);
        const fallback = isFullCapacityResult(result)
          ? fullCapacityText(request.date)
          : isInsufficientCapacityResult(result)
            ? insufficientCapacityText(request.restaurant_name, request.party_size, request.time)
            : isPartySizeOutOfRangeResult(result)
              ? partySizeOutOfRangeText(request.restaurant_name, request.party_size)
              : result.message || "I could not find availability for that.";
        if (isPartySizeOutOfRangeResult(result)) {
          return `${hoursSentence ? `${hoursSentence} ` : ""}${fallback}`;
        }
        return `${hoursSentence ? `${hoursSentence} ` : ""}${fallback} What date and time should I try instead?`;
      })(),
      intent: isPartySizeOutOfRangeResult(result) ? "choose_party_size" : "choose_time",
      step: isPartySizeOutOfRangeResult(result) ? "choose_party" : "choose_time",
      nextExpectedInput: isPartySizeOutOfRangeResult(result) ? "party_size" : "time",
      booking: {
        restaurant_id: request.restaurant_id,
        restaurant_name: request.restaurant_name ?? null,
        party_size: request.party_size,
        status: "collecting_minimum_fields",
      },
    }),
  };
}

function formatHHMMForSpeech(time: string): string {
  const [hourRaw, minuteRaw] = time.split(":");
  const hour = parseInt(hourRaw, 10);
  const minute = parseInt(minuteRaw ?? "0", 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return time;
  const date = new Date(Date.UTC(2026, 0, 1, hour, minute));
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(date);
}
