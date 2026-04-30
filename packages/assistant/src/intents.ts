export const INTENTS = [
  "reservation_create",
  "reservation_modify",
  "reservation_cancel",
  "restaurant_search",
  "menu_question",
  "dinner_plan",
  "preorder_food",
  "payment_question",
  "rewards_question",
  "directions",
  "restaurant_contact",
  "general_question",
  "fallback_unknown",
  "discover_restaurants",
  "book_restaurant",
  "refine_search",
  "select_restaurant",
  "choose_party_size",
  "choose_date",
  "choose_time",
  "confirm_booking",
  "offer_preorder",
  "build_cart",
  "collect_tip",
  "choose_payment",
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
  "offer_preorder",
  "build_cart",
  "review_cart",
  "collect_tip",
  "choose_payment",
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
  "preorder_choice",
  "menu_selection",
  "tip_timing",
  "tip_amount",
  "payment_split",
  "post_booking_answer",
  "none",
] as const;

export type NextInput = (typeof NEXT_INPUTS)[number];
