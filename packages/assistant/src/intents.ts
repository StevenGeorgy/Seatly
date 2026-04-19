export const INTENTS = [
  "discover_restaurants",
  "book_restaurant",
  "refine_search",
  "select_restaurant",
  "choose_party_size",
  "choose_date",
  "choose_time",
  "confirm_booking",
  "ask_post_booking_details",
  "answer_restaurant_question",
  "fallback_handoff",
] as const;

export type Intent = (typeof INTENTS)[number];

export const STEPS = [
  "greeting",
  "choose_cuisine",
  "choose_location",
  "choose_restaurant",
  "choose_party",
  "choose_date",
  "choose_time",
  "confirm",
  "post_booking",
  "done",
] as const;

export type Step = (typeof STEPS)[number];

export const NEXT_INPUTS = [
  "cuisine",
  "location",
  "restaurant",
  "party_size",
  "date",
  "time",
  "confirmation",
  "post_booking_answer",
  "none",
] as const;

export type NextInput = (typeof NEXT_INPUTS)[number];
