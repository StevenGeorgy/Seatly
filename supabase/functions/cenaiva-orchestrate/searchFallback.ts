// @ts-nocheck
import { haversineKm } from "../_shared/geo.ts";

export type SearchFallbackRestaurant = {
  id: string;
  name?: string;
  cuisine_type?: string | null;
  business_type?: string | null;
  city?: string | null;
  address?: string | null;
  description?: string | null;
  lat?: number | null;
  lng?: number | null;
  price_range?: number | null;
  avg_rating?: number | null;
  distance_km?: number;
};

type UserLocation = {
  lat: number;
  lng: number;
};

export type ZeroResultFallbackOptions<Row extends SearchFallbackRestaurant> = {
  rows: Row[];
  transcript?: string | null;
  query?: string | null;
  requestedCity?: string | null;
  userCity?: string | null;
  userLocation?: UserLocation | null;
  cuisineTerms?: string[];
  priceRangeMin?: number | null;
  priceRangeMax?: number | null;
  limit?: number;
};

const COMMON_QUERY_TERMS = new Set([
  "a",
  "an",
  "and",
  "are",
  "around",
  "best",
  "book",
  "can",
  "cenaiva",
  "find",
  "for",
  "give",
  "good",
  "in",
  "like",
  "looking",
  "me",
  "near",
  "nearby",
  "of",
  "place",
  "places",
  "please",
  "recommend",
  "restaurant",
  "restaurants",
  "show",
  "some",
  "spot",
  "spots",
  "suggest",
  "the",
  "to",
  "want",
  "where",
  "with",
]);

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(
    /\s+/g,
    " ",
  ).trim();
}

function normalizeCity(value: string | null | undefined): string {
  return normalizeText(value);
}

function cityMatches(
  rowCity: string | null | undefined,
  requestedCity: string,
): boolean {
  const city = normalizeCity(rowCity);
  return !!city &&
    (city === requestedCity || city.includes(requestedCity) ||
      requestedCity.includes(city));
}

// haversineKm and the geo helpers it depends on now live in _shared/geo.ts.

function rowDistanceKm(
  row: SearchFallbackRestaurant,
  userLocation: UserLocation | null | undefined,
): number | null {
  if (
    !userLocation || typeof row.lat !== "number" || typeof row.lng !== "number"
  ) {
    return null;
  }
  return haversineKm(userLocation.lat, userLocation.lng, row.lat, row.lng);
}

function rowSearchText(row: SearchFallbackRestaurant): string {
  return normalizeText(
    [
      row.name,
      row.cuisine_type,
      row.business_type,
      row.description,
      row.address,
      row.city,
    ].filter(Boolean).join(" "),
  );
}

function extractQueryTerms(value: string | null | undefined): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((term) => term.length > 2 && !COMMON_QUERY_TERMS.has(term));
}

function matchesAnyTerm(searchText: string, terms: string[]): boolean {
  return terms.some((term) => term && searchText.includes(term));
}

function isPriceInRange(
  price: number | null | undefined,
  min: number | null | undefined,
  max: number | null | undefined,
): boolean {
  const normalizedPrice = typeof price === "number" ? Math.round(price) : 2;
  if (typeof min === "number" && normalizedPrice < min) return false;
  if (typeof max === "number" && normalizedPrice > max) return false;
  return true;
}

export function chooseZeroResultFallbackRows<
  Row extends SearchFallbackRestaurant,
>(
  opts: ZeroResultFallbackOptions<Row>,
): Row[] {
  const limit = Math.max(1, opts.limit ?? 1);
  const requestedCity = normalizeCity(opts.requestedCity);
  const userCity = normalizeCity(opts.userCity);
  const userLocation = opts.userLocation;
  const cuisineTerms = (opts.cuisineTerms ?? []).map(normalizeText).filter(
    Boolean,
  );
  const queryTerms = extractQueryTerms(
    [opts.query ?? "", opts.transcript ?? ""].join(" "),
  );
  let candidates = opts.rows.filter((row) =>
    typeof row.id === "string" && row.id.trim().length > 0
  );

  if (requestedCity) {
    const sameCity = candidates.filter((row) =>
      cityMatches(row.city, requestedCity)
    );
    // Soft city fallback: if the user named a city but no candidates match,
    // drop the city filter and rank everything by distance + signal so the
    // orchestrator can still recommend something instead of going silent.
    // The orchestrator's spoken text (`I don't see X in {city} — I'd recommend
    // Y instead`) handles framing this honestly to the user.
    if (sameCity.length) {
      candidates = sameCity;
    } else if (userLocation) {
      const nearby = candidates.filter((row) =>
        (rowDistanceKm(row, userLocation) ?? Infinity) <= 50
      );
      if (nearby.length) candidates = nearby;
    }
  } else if (userCity) {
    const sameCity = candidates.filter((row) =>
      cityMatches(row.city, userCity)
    );
    if (sameCity.length) candidates = sameCity;
  } else if (userLocation) {
    const nearby = candidates.filter((row) =>
      (rowDistanceKm(row, userLocation) ?? Infinity) <= 50
    );
    if (nearby.length) candidates = nearby;
  }

  return candidates
    .map((row) => {
      const searchText = rowSearchText(row);
      const cuisineScore = matchesAnyTerm(searchText, cuisineTerms) ? 40 : 0;
      const queryScore = queryTerms.reduce(
        (score, term) => score + (searchText.includes(term) ? 3 : 0),
        0,
      );
      const ratingScore = (row.avg_rating ?? 0) * 4;
      const priceScore =
        isPriceInRange(row.price_range, opts.priceRangeMin, opts.priceRangeMax)
          ? 10
          : 0;
      const distancePenalty =
        Math.min(rowDistanceKm(row, userLocation) ?? 0, 100) / 5;

      return {
        row,
        score: cuisineScore + queryScore + ratingScore + priceScore -
          distancePenalty,
      };
    })
    .sort((a, b) =>
      b.score - a.score || (b.row.avg_rating ?? 0) - (a.row.avg_rating ?? 0)
    )
    .slice(0, limit)
    .map((entry) => entry.row);
}

function displayLabel(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  if (/[A-Z]/.test(trimmed)) return trimmed;
  return trimmed.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function buildZeroResultFallbackSpokenText(opts: {
  cuisine?: string | null;
  city?: string | null;
  fallbackName: string;
}): string {
  const cuisine = displayLabel(opts.cuisine);
  const city = displayLabel(opts.city);
  const fallbackName = opts.fallbackName.trim() || "this spot";
  if (cuisine && city) {
    return `I don't see ${cuisine} restaurants in ${city} matching that. I'd recommend ${fallbackName} instead.`;
  }
  if (cuisine) {
    return `I don't see ${cuisine} restaurants matching that. I'd recommend ${fallbackName} instead.`;
  }
  if (city) {
    return `I don't see restaurants in ${city} matching that. I'd recommend ${fallbackName} instead.`;
  }
  return `I don't see restaurants matching that. I'd recommend ${fallbackName} instead.`;
}

export function buildNoZeroResultFallbackSpokenText(opts: {
  cuisine?: string | null;
  city?: string | null;
}): string {
  const cuisine = displayLabel(opts.cuisine);
  const city = displayLabel(opts.city);
  if (cuisine && city) {
    return `I don't see ${cuisine} restaurants in ${city} matching that. Try a different cuisine or area.`;
  }
  if (cuisine) {
    return `I don't see ${cuisine} restaurants matching that. Try a different cuisine or area.`;
  }
  if (city) {
    return `I don't see restaurants in ${city} matching that. Try a different cuisine or area.`;
  }
  return "I don't see restaurants matching that. Try a different cuisine or area.";
}
