const DINING_SCOPE_PATTERN =
  /\b(restaurant|restaurants|reservation|reserve|book|booking|table|seat|seating|dine|dining|dinner|lunch|breakfast|brunch|eat|eating|food|hungry|hangry|menu|dish|dishes|cuisine|preorder|pre-order|order|takeout|directions|rewards|bar|bars|cafe|cafes|caf|coffee|coffee shop|coffee shops|brewery|breweries|brewpub|brewpubs|bistro|bistros|pub|pubs|deli|delis|bakery|bakeries|lounge|lounges|izakaya|izakayas|sushi|pizza|pasta|steak|seafood|vegetarian|taco|tacos|burger|burgers|vegan|halal|kosher|date spot|romantic|near me|nearby|closest|nearest|open|patio|booth|outdoor|indoor|indoors|quiet|private|downtown|dessert|mocktails?|cocktails?)\b/i;

const ACTIONABLE_DINING_REQUEST_PATTERN =
  /\b(find|show|search|recommend|suggest|pick|choose|book|reserve|get|give me|look for|looking for|pull up|open|want|need|craving|feel like|closest|nearest|available|availability|menu|directions|what|which|any|is there|are there|is it|do you have|got any|got a)\b[\s\S]{0,80}\b(restaurant|restaurants|place|places|spot|spots|table|reservation|food|cuisine|dinner|lunch|breakfast|brunch|menu|dish|dishes|near me|nearby|italian|french|european|europeean|europian|japanese|sushi|thai|spanish|greek|mediterranean|steakhouse|egyptian|asian|halal|vegan|cafe|cafes|coffee shop|coffee shops|bar|bars|brewery|breweries|brewpub|brewpubs|bistro|bistros|pub|pubs|deli|delis|bakery|bakeries|lounge|lounges|izakaya|izakayas)\b/i;

// Common Canadian cities the user might mention. If the transcript has a city
// name, it's almost certainly a restaurant-discovery turn ("anywhere in
// Guelph", "is X in Toronto", "show me Hamilton") and must route to the
// orchestrator, not the small-prompt off-topic classifier.
const CITY_LOOKUP_PATTERN =
  /\b(toronto|montreal|vancouver|calgary|edmonton|ottawa|hamilton|mississauga|brampton|kitchener|waterloo|guelph|kingston|windsor|halifax|winnipeg|saskatoon|regina|burnaby|surrey|richmond|quebec city|markham|oakville|burlington|niagara|north york|scarborough|etobicoke|laval|gatineau|sherbrooke|saint john|moncton|fredericton|charlottetown|kelowna|victoria|abbotsford|nanaimo|red deer|lethbridge)\b/i;

// "Is X in Y" / "is X open" / "is X a cafe" / "where is X" / "what city
// is X in" / "does X serve halal" — questions about a specific restaurant
// by name. The orchestrator can resolve these via search; the small-prompt
// classifier shouldn't claim them as off-topic.
const SPECIFIC_PLACE_LOOKUP_PATTERN =
  /\bis\s+\w+(?:\s+\w+){0,3}\s+(?:a|an|the|in|on|at|near|open|closed|booked|busy|expensive|cheap|good|bad|nice|popular|halal|vegan|kosher)\b/i;
const SPECIFIC_PLACE_FACT_PATTERN =
  /\bwhere(?:'?s|\s+(?:is|are|can\s+(?:i|we)\s+find))\b|\bwhat\s+(?:city|state|area|neighborhood|address|cuisine|food|hours|time|price)\b|\bhow\s+(?:much|expensive|busy|popular|far|late|early|long|good)\b|\bdoes\s+\w+(?:\s+\w+){0,3}\s+(?:have|serve|allow|take|do|offer)\b|\btell\s+me\s+about\b/i;

const RESTAURANT_POLICY_PATTERN =
  /\b(bring (?:a )?(?:dog|pet)|allow kids|kids allowed|parking|vegan|wheelchair|accessible|accessibility|outdoor seating|sit at the bar|birthday cake|split bills?|dress code|halal|gluten[- ]free|booth|allerg(?:y|ies)|high chairs?|loud inside|bring balloons?|no[- ]shows?|deposit|change the booking later|request outdoor|request a booth)\b/i;

const BOOKING_ADJACENT_PATTERN =
  /\b(somewhere|something nice|usual|you know what i mean|make it good|whatever works|surprise me|you choose|for us|few people|vibes?|main character|lighting|outfit|bread|fries|mocktails?|cocktails?|healthy|spicy|dessert|burgers?|pasta|seafood|vegetarian|steak|family|parents|proposal|anniversary|birthday|date|work dinner|team|party|private|quiet|calm|romantic|cheap|budget|budget friendly|fancy|downtown|takeout|tonight|tomorrow|friday|saturday|sunday|next weekend|after work|before the movie|sunset|in an hour|late|early|earlier|later|indoors?|closest|near me)\b/i;

const BOOKING_PROCESS_DETAIL_PATTERN =
  /\b(reservations?|bookings?|booked|confirm|confirmed|confirmation|details|cancel|change|edit|move|table|guests?|people|party size|slot|availability|available|openings?|upcoming|past|cancelled|menu|pre[- ]?order|prepay|order|checkout|pay|payment|card|deposit|refund|fee|tax|tip|directions?|address|phone|contact|hours?|parking|dress code|outdoor|indoor|booth|bar seating|birthday cake|high chair|no show|no-show|show up|are we good|show them this|need id|arrive early|hold the table|confirmation number|booking summary|where is it|remind me)\b/i;

const CUISINE_OR_FOOD_PATTERN =
  /\b(italian|french|european|europeean|europian|japanese|sushi|thai|spanish|greek|mediterranean|steakhouse|egyptian|asian|burgers?|mocktails?|cocktails?|vegetarian|seafood|steak|healthy|spicy|dessert)\b/i;

const DATE_OR_PARTY_PATTERN =
  /\b(tomorrow|tonight|friday|saturday|sunday|monday|tuesday|wednesday|thursday|next weekend|as soon as possible|after work|after 9|between 6 and 7|sunset|in an hour|earliest available|latest available|may \d{1,2}|\d{1,2}\s*(?:am|pm)?|8ish|table for|for \d+|just me|me plus one|double date|big group|whoever shows up|adults?|kids?|people|guest|guests)\b/i;

const PURE_IMPATIENCE_PATTERN =
  /\b(hurry up|why is this taking so long|stop asking questions|can you be faster|be faster|do it now|you'?re moving slow|moving slow|don'?t want a whole conversation|why do you need all that info|less talking more booking|less talking, more booking)\b/i;

const CLEAR_SMALL_PROMPT_PATTERN =
  /\b(am i gay|am i straight|am i bi|am i bisexual|do you think i'?m|are you single|do you love me|i love you|you'?re cute|you are cute|you'?re hot|you are hot|your voice is cute|fish|get thirsty|raccoon|dinosaur|pasta could talk|ghosts?|cereal soup|meaning of life|aliens?|horse sized|duck sized|chairs? have feelings|villain entrance|fog machine|spy mission|homework|write me a rap|order me a car|call my ex|hack|bypass|fake phone|fake number|lie and say|threaten|cancel someone else|change someone else|pretend i'?m the owner|make them give me free food|fully booked|under someone else'?s name|without giving my details|guarantee the best table|book 10 restaurants|book ten restaurants)\b/i;

const RESET_BOOKING_CONTEXT_PATTERN =
  /\b(start over|start fresh|reset|restart|new search|forget that|cancel that|clear (?:that|it)|different restaurant|different place|different spot|change restaurant|switch to)\b/i;

const NEW_RESTAURANT_SEARCH_PATTERN =
  /\b(find|show|search|recommend|suggest|pick|choose|look for|looking for|want|need|craving|feel like|closest|nearest|nearby|near me|closer|cheaper|fancier|is there|are there|got any|got a)\b[\s\S]{0,90}\b(restaurant|restaurants|place|places|spot|spots|food|cuisine|italian|french|european|europeean|europian|japanese|sushi|thai|spanish|greek|mediterranean|steakhouse|egyptian|asian|halal|vegan|burgers?|mocktails?|cocktails?|vegetarian|seafood|steak|healthy|spicy|dessert|nearby|near me|cafe|cafes|coffee shop|coffee shops|bar|bars|brewery|breweries|bistro|bistros|pub|pubs|deli|delis|bakery|bakeries|lounge|lounges)\b/i;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isCenaivaProcessPrompt(transcript: string): boolean {
  const normalized = normalize(transcript);
  if (!normalized) return false;
  if (CLEAR_SMALL_PROMPT_PATTERN.test(normalized)) return false;
  if (PURE_IMPATIENCE_PATTERN.test(normalized)) return false;
  return (
    ACTIONABLE_DINING_REQUEST_PATTERN.test(normalized) ||
    DINING_SCOPE_PATTERN.test(normalized) ||
    RESTAURANT_POLICY_PATTERN.test(normalized) ||
    BOOKING_ADJACENT_PATTERN.test(normalized) ||
    BOOKING_PROCESS_DETAIL_PATTERN.test(normalized) ||
    CUISINE_OR_FOOD_PATTERN.test(normalized) ||
    DATE_OR_PARTY_PATTERN.test(normalized) ||
    // Any city name is a clear discovery signal: route to orchestrator so it
    // can call search_restaurants with that city.
    CITY_LOOKUP_PATTERN.test(normalized) ||
    // "is X in Y", "is X open", etc. — specific-restaurant lookups by name.
    SPECIFIC_PLACE_LOOKUP_PATTERN.test(normalized) ||
    // "where is X", "what city/cuisine/hours", "does X have/serve" — restaurant fact lookups.
    SPECIFIC_PLACE_FACT_PATTERN.test(normalized) ||
    /\b(can you handle it|not too late|for a few people|for us|i don'?t know yet|changed my mind|start over|cancel that|different restaurant|switch to|closer|earlier|later|make it cheaper|make it fancier)\b/i.test(
      normalized,
    )
  );
}

export function getCenaivaImmediateFiller(transcript: string): string | null {
  const normalized = normalize(transcript);
  if (CLEAR_SMALL_PROMPT_PATTERN.test(normalized)) return null;
  if (!normalized || !isCenaivaProcessPrompt(normalized)) return null;
  if (PURE_IMPATIENCE_PATTERN.test(normalized)) return null;
  if (
    /^(table for|for\s+\d+|for\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b)/i.test(
      normalized,
    )
  ) {
    return null;
  }
  return "One moment please.";
}

export function shouldResetCenaivaBookingContext(transcript: string): boolean {
  const normalized = normalize(transcript);
  if (!normalized) return false;
  if (CLEAR_SMALL_PROMPT_PATTERN.test(normalized)) return false;
  return (
    RESET_BOOKING_CONTEXT_PATTERN.test(normalized) ||
    NEW_RESTAURANT_SEARCH_PATTERN.test(normalized)
  );
}
