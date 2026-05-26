// Single source of truth for seating-preference options shared by the
// booking form (RestaurantPublicPage) and the profile edit form
// (AccountPage). Keeping these in lock-step is what makes auto-fill
// from saved profile -> booking dropdown actually work.
export const SEATING_PREFERENCES = [
  "",
  "By the window",
  "Middle of dining room",
  "Booth seating",
  "Lounge seating",
  "Patio",
  "Bar seating",
  "Quiet corner",
] as const;

export type SeatingPreference = (typeof SEATING_PREFERENCES)[number];
