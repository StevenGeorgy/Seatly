import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate } from "k6/metrics";

const SUPABASE_URL = __ENV.SUPABASE_URL || __ENV.VITE_SUPABASE_URL;
const SUPABASE_KEY = __ENV.SUPABASE_PUBLISHABLE_KEY || __ENV.SUPABASE_ANON_KEY || __ENV.VITE_SUPABASE_ANON_KEY;
const RESTAURANT_IDS = (__ENV.TEST_RESTAURANT_IDS || [
  "82277919-f810-48df-8898-84895a72c280",
  "428964af-02b8-45ca-8973-3617b91bd718",
].join(","))
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const PARTY_SIZES = (__ENV.TEST_PARTY_SIZES || "2,4,8")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);
const DATE_OFFSET_DAYS = Number(__ENV.TEST_DATE_OFFSET_DAYS || 1);
const BASE_VUS = Number(__ENV.K6_VUS || 1);
const DURATION = __ENV.K6_DURATION || "30s";
const SLEEP_SECONDS = Number(__ENV.K6_SLEEP_SECONDS || 1);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY/VITE_SUPABASE_ANON_KEY");
}
if (RESTAURANT_IDS.length === 0) {
  throw new Error("Missing TEST_RESTAURANT_IDS");
}

export const availability_errors = new Counter("availability_errors");
export const availability_ok = new Rate("availability_ok");

export const options = {
  vus: BASE_VUS,
  duration: DURATION,
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<1000"],
    availability_ok: ["rate>0.98"],
  },
};

function dateString(offsetDays) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function pick(values) {
  return values[Math.floor(Math.random() * values.length)];
}

export default function () {
  const restaurantId = pick(RESTAURANT_IDS);
  const partySize = pick(PARTY_SIZES);
  const body = JSON.stringify({
    p_restaurant_id: restaurantId,
    p_date: dateString(DATE_OFFSET_DAYS),
    p_party_size: partySize,
  });

  const response = http.post(`${SUPABASE_URL}/rest/v1/rpc/get_available_slots_cached`, body, {
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
    },
    tags: {
      endpoint: "get_available_slots_cached",
      party_size: String(partySize),
    },
  });

  const ok = check(response, {
    "status is 200": (res) => res.status === 200,
    "body has slots field": (res) => {
      try {
        const parsed = res.json();
        return parsed && typeof parsed === "object" && Array.isArray(parsed.slots);
      } catch {
        return false;
      }
    },
  });

  availability_ok.add(ok);
  if (!ok) availability_errors.add(1);
  sleep(SLEEP_SECONDS);
}
