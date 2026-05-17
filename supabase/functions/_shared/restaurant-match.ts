// Universal restaurant + free-text matcher used by the Cenaiva orchestrator.
//
// Pure functions only — no Supabase client, no fetch. Compiles for Deno (edge
// fn) and for a Node-emulated Vite build, so the client could import the same
// canonical normalizer if we ever pre-resolve there too.
//
// Purpose: replace ~8 duplicated `stripAccents` copies, 2 duplicated
// SPELLING_VARIANTS maps, 3 incompatible stopword lists, and 4 ad-hoc
// token-set scorers in `cenaiva-orchestrate/index.ts` with one shared engine.
//
// Universal — no per-restaurant rules. Stopwords are linguistic categories
// (articles, venue types, location qualifiers, company suffixes) so any
// restaurant present or future benefits automatically.

// ---------------------------------------------------------------------------
// Stopword sets (linguistic categories — not restaurant-specific)
// ---------------------------------------------------------------------------

export const ARTICLES: ReadonlySet<string> = new Set([
  "the", "a", "an", "le", "la", "el", "al", "du", "de", "der", "los", "las",
]);

export const VENUE_TYPES: ReadonlySet<string> = new Set([
  "restaurant", "restaurants", "bar", "cafe", "café", "lounge", "pub",
  "bistro", "steakhouse", "deli", "bakery", "brewery", "pizzeria",
  "izakaya", "tavern", "kitchen", "eatery", "grill", "house", "club",
  "dining", "co", "company",
]);

export const LOCATION_QUALIFIERS: ReadonlySet<string> = new Set([
  "downtown", "uptown", "plaza", "centre", "center", "mall", "mansion",
  "station", "square", "market", "park", "district",
  "north", "south", "east", "west",
]);

export const COMPANY_SUFFIXES: ReadonlySet<string> = new Set([
  "inc", "ltd", "llc", "co", "corp", "group", "holdings",
]);

// QUERY_FILLER: large filler set used when LLM passes free-text into
// search_restaurants `query` (the model sometimes drops "in", "the", "for"
// there). Migrated from index.ts:10113.
export const QUERY_FILLER: ReadonlySet<string> = new Set([
  "and", "any", "are", "but", "can", "for", "get", "give", "got",
  "have", "her", "him", "his", "how", "its", "let", "like", "look",
  "make", "man", "may", "men", "near", "new", "not", "now", "old",
  "one", "our", "out", "see", "she", "show", "the", "too", "top",
  "use", "was", "way", "who", "you", "with", "find", "want", "need",
  "would", "could", "should", "this", "that", "these",
  "those", "from", "into", "your", "they", "them", "what", "when",
  "where", "which", "while", "will", "some", "than", "their",
  "there", "then", "town", "city", "place", "places", "spot",
  "spots", "good", "best", "great", "nice", "open", "right",
  "restaurant", "restaurants",
  "in", "of", "to", "at", "on", "is", "or", "an", "as", "by",
  "be", "do", "go", "if", "it", "me", "my", "no", "so", "up", "us", "we",
]);

// Voice fillers — only applied on the transcript side of voice flows.
// Never strip from restaurant data.
export const VOICE_FILLERS: ReadonlySet<string> = new Set([
  "uh", "um", "er", "like", "sorry", "you", "know",
  "i", "mean", "basically", "actually",
]);

// British/American spelling + transcription quirks. Used at scoring time to
// produce multiple match attempts per token. Migrated from index.ts:10137.
export const SPELLING_VARIANTS: Readonly<Record<string, readonly string[]>> = {
  harbor: ["harbour"], harbour: ["harbor"],
  center: ["centre"], centre: ["center"],
  theater: ["theatre"], theatre: ["theater"],
  flavor: ["flavour"], flavour: ["flavor"],
  color: ["colour"], colour: ["color"],
  meter: ["metre"], metre: ["meter"],
  liter: ["litre"], litre: ["liter"],
  traveler: ["traveller"], traveller: ["traveler"],
  honor: ["honour"], honour: ["honor"],
  whisky: ["whiskey"], whiskey: ["whisky"],
  gray: ["grey"], grey: ["gray"],
  donut: ["doughnut"], doughnut: ["donut"],
  bbq: ["barbecue", "barbeque"], barbecue: ["bbq", "barbeque"], barbeque: ["bbq", "barbecue"],
};

// Number-word variants. Deepgram sometimes transcribes "Harbour 60" as
// "Harbour Sixty"; we want both to match. Migrated from index.ts:10148.
export const NUMBER_WORDS: Readonly<Record<string, readonly string[]>> = {
  "10": ["ten"], "20": ["twenty"], "30": ["thirty"],
  "40": ["forty"], "50": ["fifty"], "60": ["sixty"],
  "70": ["seventy"], "80": ["eighty"], "90": ["ninety"],
  "100": ["hundred"],
  ten: ["10"], twenty: ["20"], thirty: ["30"], forty: ["40"],
  fifty: ["50"], sixty: ["60"], seventy: ["70"], eighty: ["80"],
  ninety: ["90"], hundred: ["100"],
};

// ---------------------------------------------------------------------------
// Normalization pipeline
// ---------------------------------------------------------------------------

export type NormalizeOptions = {
  /** loose = strip stopword categories (for token-set scoring). strict = no stopword strip (for substring tests). */
  mode?: "strict" | "loose";
  /** Which stopword categories to strip when mode='loose'. Default: all. */
  stopwords?: ReadonlyArray<ReadonlySet<string>>;
  /** Strip voice-filler words (only useful on the user-transcript side). */
  stripVoiceFillers?: boolean;
};

const DEFAULT_LOOSE_STOPWORDS: ReadonlyArray<ReadonlySet<string>> = [
  ARTICLES, VENUE_TYPES, LOCATION_QUALIFIERS, COMPANY_SUFFIXES,
];

/**
 * Universal normalizer. Steps:
 *   1. lowercase
 *   2. NFD diacritic strip (â→a, é→e, ñ→n)
 *   3. & → " and " (forward, not strip — preserves boundary token)
 *   4. strip apostrophes + non-alphanumeric (except spaces)
 *   5. collapse whitespace
 *   6. (loose mode) strip stopword categories token-by-token
 *   7. (voice option) strip VOICE_FILLERS
 *
 * Spelling-variant expansion happens at scoring time, NOT here — we want one
 * canonical normalized string, not a multi-string.
 */
export function normalize(value: string, opts: NormalizeOptions = {}): string {
  if (!value) return "";
  let s = value.toLowerCase();
  // NFD decomposition + combining-mark strip. \p{M} matches Mn/Me/Mc.
  s = s.normalize("NFD").replace(/\p{M}/gu, "");
  // & → " and ". Voice transcripts say "and" literally; preserving as a word
  // avoids collapsing boundaries (e.g., "Jacobs & Co" → "jacobsco").
  s = s.replace(/\s*&\s*/g, " and ");
  // Strip apostrophes + non-alphanumeric. Keep spaces.
  s = s.replace(/['’`]/g, "").replace(/[^a-z0-9\s]/g, " ");
  // Collapse whitespace.
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return s;

  if (opts.mode === "loose" || opts.stripVoiceFillers) {
    const sets = opts.stopwords ?? DEFAULT_LOOSE_STOPWORDS;
    const tokens = s.split(" ");
    const kept: string[] = [];
    for (const tok of tokens) {
      if (opts.stripVoiceFillers && VOICE_FILLERS.has(tok)) continue;
      if (opts.mode === "loose") {
        let isStopword = false;
        for (const set of sets) {
          if (set.has(tok)) { isStopword = true; break; }
        }
        if (isStopword) continue;
      }
      kept.push(tok);
    }
    s = kept.join(" ");
  }

  return s;
}

/**
 * NFD + combining-mark strip + apostrophe/& strip. Mirrors the legacy
 * `stripAccents` helpers at index.ts:5061, 5335, 5462, 5684, 6262, 7378, 8355.
 * Lower-case is the CALLER's job (legacy callers do `.toLowerCase()` first).
 */
export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").replace(/['’.&]/g, "");
}

// ---------------------------------------------------------------------------
// Levenshtein edit distance (unchanged from index.ts:1781)
// ---------------------------------------------------------------------------

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/**
 * Returns [token, ...British/American or number-word alternatives].
 */
export function expandVariants(token: string): string[] {
  const out = new Set<string>([token]);
  for (const v of SPELLING_VARIANTS[token] ?? []) out.add(v);
  for (const v of NUMBER_WORDS[token] ?? []) out.add(v);
  return Array.from(out);
}

// ---------------------------------------------------------------------------
// Multi-method scorer
// ---------------------------------------------------------------------------

export type ScoreMethod =
  | "exact"
  | "wholeQuerySubstring"
  | "allTokensSubstring"
  | "jaccard"
  | "fullLevenshtein"
  | "perTokenLevenshtein"
  | "none";

export type ScoreResult = { score: number; method: ScoreMethod };

/**
 * Score a query against a single candidate. Returns the BEST rung — not
 * additive, so long restaurant names can't drown out the signal. See plan.
 *
 * Per-token Levenshtein uses `allowed = len <= 4 ? 1 : 2` to mirror the
 * legacy scoreNameMatch behavior (handles 1-2 char STT substitutions).
 */
export function scoreMatch(query: string, candidate: string): ScoreResult {
  if (!query || !candidate) return { score: 0, method: "none" };

  const qStrict = normalize(query, { mode: "strict" });
  const cStrict = normalize(candidate, { mode: "strict" });
  if (!qStrict || !cStrict) return { score: 0, method: "none" };

  // Rung 2: exact (strict-normalized)
  if (qStrict === cStrict) return { score: 1.0, method: "exact" };

  // Rung 3: whole-query substring
  if (cStrict.includes(qStrict)) return { score: 0.9, method: "wholeQuerySubstring" };

  // Rung 4: all query tokens are substrings of candidate tokens
  const qStrictTokens = qStrict.split(" ").filter((t) => t.length > 0);
  const cStrictTokens = cStrict.split(" ").filter((t) => t.length > 0);
  if (qStrictTokens.length > 0) {
    const allMatch = qStrictTokens.every((qt) =>
      cStrictTokens.some((ct) => ct.includes(qt) || qt.includes(ct))
    );
    if (allMatch) return { score: 0.85, method: "allTokensSubstring" };
  }

  // QUERY_FILLER is stripped on the QUERY side only — phrases like
  // "let's do Jacob" reduce to ["jacob"] before per-token scoring, so a
  // 1-char edit-distance match against "Jacobs" isn't drowned out by
  // unmatched filler words ("lets", "do"). Restaurant NAMES are never
  // stripped of filler — they're scored as-written.
  const qLoose = normalize(query, {
    mode: "loose",
    stopwords: [ARTICLES, VENUE_TYPES, LOCATION_QUALIFIERS, COMPANY_SUFFIXES, QUERY_FILLER],
  });
  const cLoose = normalize(candidate, { mode: "loose" });
  const qLooseTokens = qLoose.split(" ").filter((t) => t.length >= 2);
  const cLooseTokens = cLoose.split(" ").filter((t) => t.length >= 2);

  let best = 0;
  let bestMethod: ScoreMethod = "none";

  // Rung 5: length-weighted Jaccard with spelling-variant expansion
  if (qLooseTokens.length > 0) {
    let matchedLen = 0;
    let totalLen = 0;
    for (const qt of qLooseTokens) {
      totalLen += qt.length;
      const qtVariants = expandVariants(qt);
      const matched = cLooseTokens.some((ct) => {
        if (qtVariants.includes(ct)) return true;
        // Substring within tokens (e.g. "jacobs" in "jacobs's")
        return qtVariants.some((v) => ct.includes(v) || v.includes(ct));
      });
      if (matched) matchedLen += qt.length;
    }
    const jaccard = totalLen > 0 ? (matchedLen / totalLen) * 0.8 : 0;
    if (jaccard > best) {
      best = jaccard;
      bestMethod = "jaccard";
    }
  }

  // Rung 6: full-string Levenshtein (only when other methods returned weak)
  if (best < 0.5) {
    const dist = levenshtein(qStrict, cStrict);
    const maxLen = Math.max(qStrict.length, cStrict.length);
    if (maxLen > 0) {
      const fullLev = Math.min(0.75, 1 - dist / maxLen);
      if (fullLev > best) {
        best = fullLev;
        bestMethod = "fullLevenshtein";
      }
    }
  }

  // Rung 7: per-token Levenshtein
  if (qLooseTokens.length > 0 && cLooseTokens.length > 0) {
    let perTokenMatchedLen = 0;
    let perTokenTotalLen = 0;
    for (const qt of qLooseTokens) {
      perTokenTotalLen += qt.length;
      const allowed = qt.length <= 4 ? 1 : 2;
      const matched = cLooseTokens.some((ct) => {
        if (Math.abs(ct.length - qt.length) > allowed) return false;
        return levenshtein(qt, ct) <= allowed;
      });
      if (matched) perTokenMatchedLen += qt.length;
    }
    const perToken = perTokenTotalLen > 0
      ? 0.5 * (perTokenMatchedLen / perTokenTotalLen)
      : 0;
    if (perToken > best) {
      best = perToken;
      bestMethod = "perTokenLevenshtein";
    }
  }

  return { score: best, method: bestMethod };
}

// ---------------------------------------------------------------------------
// pickBestMatch — confident / ambiguous / none
// ---------------------------------------------------------------------------

export type MatchCandidate<T> = {
  value: string;
  entity: T;
  /** True if this candidate is currently visible on the user's screen.
   *  Adds a +0.10 boost to its final score (universal context signal). */
  inVisibleSet?: boolean;
};

export type PickedMatch<T> =
  | { kind: "confident"; entity: T; score: number; method: ScoreMethod }
  | { kind: "ambiguous"; entities: T[]; topScore: number }
  | { kind: "none" };

export type PickBestMatchOptions = {
  threshold?: number;       // default 0.75
  ambiguityWindow?: number; // default 0.08
  visibleBoost?: number;    // default 0.10
};

/**
 * Score every candidate, then:
 *   - top >= threshold && top - second > ambiguityWindow → confident
 *   - multiple scores within ambiguityWindow of top → ambiguous
 *   - nothing above threshold → none
 *
 * `inVisibleSet=true` candidates get a +visibleBoost bump (default +0.10).
 * Final score capped at 1.0.
 */
export function pickBestMatch<T>(
  query: string,
  candidates: ReadonlyArray<MatchCandidate<T>>,
  opts: PickBestMatchOptions = {},
): PickedMatch<T> {
  const threshold = opts.threshold ?? 0.75;
  const ambiguityWindow = opts.ambiguityWindow ?? 0.08;
  const visibleBoost = opts.visibleBoost ?? 0.10;
  if (candidates.length === 0) return { kind: "none" };

  const scored = candidates.map((c) => {
    const raw = scoreMatch(query, c.value);
    const boost = c.inVisibleSet ? visibleBoost : 0;
    return {
      entity: c.entity,
      score: Math.min(1.0, raw.score + boost),
      method: raw.method,
    };
  }).sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top || top.score < threshold) return { kind: "none" };

  const within: typeof scored = [top];
  for (let i = 1; i < scored.length; i++) {
    if (top.score - scored[i].score <= ambiguityWindow) within.push(scored[i]);
    else break;
  }

  if (within.length === 1) {
    return {
      kind: "confident",
      entity: top.entity,
      score: top.score,
      method: top.method,
    };
  }
  return {
    kind: "ambiguous",
    entities: within.map((s) => s.entity),
    topScore: top.score,
  };
}
