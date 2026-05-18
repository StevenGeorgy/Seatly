import { z } from "zod";
import { INTENTS, STEPS, NEXT_INPUTS } from "./intents.js";

// ── UI Actions ───────────────────────────────────────────────

const latLng = z.object({ lat: z.number(), lng: z.number() });

export const UIAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("open_assistant") }),
  z.object({ type: z.literal("close_assistant") }),
  z.object({ type: z.literal("show_map") }),
  z.object({
    type: z.literal("update_map_center"),
    lat: z.number(),
    lng: z.number(),
    zoom: z.number().optional(),
  }),
  z.object({
    type: z.literal("update_map_markers"),
    restaurant_ids: z.array(z.string()),
  }),
  z.object({
    type: z.literal("highlight_restaurant"),
    restaurant_id: z.string(),
  }),
  z.object({
    type: z.literal("show_restaurant_cards"),
    restaurant_ids: z.array(z.string()),
  }),
  z.object({
    type: z.literal("open_restaurant_preview"),
    restaurant_id: z.string(),
  }),
  z.object({ type: z.literal("set_filters") }),
  z.object({ type: z.literal("clear_filters") }),
  z.object({
    type: z.literal("start_booking"),
    restaurant_id: z.string(),
  }),
  z.object({
    type: z.literal("set_booking_field"),
    field: z.enum(["party_size", "date", "time", "special_request", "occasion"]),
    value: z.union([z.string(), z.number()]),
  }),
  z.object({ type: z.literal("load_availability") }),
  z.object({
    type: z.literal("select_time_slot"),
    slot_iso: z.string(),
    shift_id: z.string(),
  }),
  z.object({ type: z.literal("confirm_booking") }),
  z.object({
    type: z.literal("show_confirmation"),
    confirmation_code: z.string(),
  }),
  z.object({ type: z.literal("show_post_booking_questions") }),
  z.object({ type: z.literal("show_exit_x") }),
  z.object({
    type: z.literal("toast"),
    message: z.string(),
    tone: z.enum(["info", "success", "error"]),
  }),
  z.object({
    type: z.literal("navigate"),
    path: z.string(),
  }),
  z.object({ type: z.literal("fallback_to_manual") }),
  // Phase 1 (2026-05-17): direction-change reset. Server emits when user
  // says "forget that" / "never mind" / "scratch that" / "start over".
  // Client clears the in-flight booking and resets the BookingSheet visual.
  z.object({ type: z.literal("soft_reset") }),
  // ── Pre-order actions ────────────────────────────────────
  z.object({ type: z.literal("offer_preorder") }),
  z.object({
    type: z.literal("show_menu"),
    restaurant_id: z.string(),
  }),
  z.object({
    type: z.literal("add_menu_item"),
    menu_item_id: z.string(),
    name: z.string(),
    unit_price: z.number(),
    qty: z.number().optional(),
    note: z.string().optional(),
  }),
  z.object({
    type: z.literal("remove_menu_item"),
    menu_item_id: z.string(),
  }),
  z.object({ type: z.literal("clear_cart") }),
  z.object({
    type: z.literal("set_tip_choice"),
    choice: z.enum(["now", "after"]),
  }),
  z.object({
    type: z.literal("set_tip"),
    amount: z.number().optional(),
    percent: z.number().optional(),
  }),
  z.object({
    type: z.literal("set_payment_split"),
    choice: z.enum(["single", "split"]),
  }),
  z.object({
    type: z.literal("navigate_to_checkout"),
    order_id: z.string(),
    path: z.string(),
  }),
  z.object({
    type: z.literal("show_payment_success"),
    amount_charged: z.number(),
  }),
]);

export type UIActionType = z.infer<typeof UIAction>;

// ── Delta schemas ────────────────────────────────────────────

const BOOKING_STATUS = z.enum([
  "idle",
  "collecting_minimum_fields",
  "loading_availability",
  "awaiting_time_selection",
  "confirming",
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

const PendingActionSchema = z.object({
  type: z.enum(["modify_reservation", "cancel_reservation", "late_note", "save_preference"]),
  payload: z.record(z.string(), z.unknown()),
  confirmation_text: z.string(),
}).nullable();

export const BookingDeltaSchema = z.object({
  restaurant_id: z.string().nullable().optional(),
  restaurant_name: z.string().nullable().optional(),
  party_size: z.number().nullable().optional(),
  date: z.string().nullable().optional(),
  time: z.string().nullable().optional(),
  shift_id: z.string().nullable().optional(),
  slot_iso: z.string().nullable().optional(),
  special_request: z.string().nullable().optional(),
  occasion: z.string().nullable().optional(),
  status: BOOKING_STATUS.optional(),
  confirmation_code: z.string().nullable().optional(),
  reservation_id: z.string().nullable().optional(),
  order_id: z.string().nullable().optional(),
  payment_status: z.enum(["idle", "pending", "paid", "failed"]).optional(),
  tip_amount: z.number().nullable().optional(),
  tip_percent: z.number().nullable().optional(),
  tip_choice: z.enum(["now", "after"]).nullable().optional(),
  payment_split: z.enum(["single", "split"]).nullable().optional(),
  pending_action: PendingActionSchema.optional(),
  cart_subtotal: z.number().optional(),
  cart: z.array(z.object({
    menu_item_id: z.string(),
    name: z.string(),
    qty: z.number(),
    unit_price: z.number(),
    note: z.string().nullable().optional(),
  })).optional(),
  // Event/promo auto-attach context. Set by the orchestrator's event-
  // search or direct book-by-event handlers; read by the booking flow's
  // resolveEventAttachment so the user's "yes confirm" wires up the right
  // event_id / promotion_id. Must round-trip client → orchestrator on
  // every turn so multi-turn confirmations work.
  offered_events: z.array(z.object({
    id: z.string(),
    name: z.string().nullable().optional(),
    date: z.string().nullable().optional(),
    start_time: z.string().nullable().optional(),
    end_time: z.string().nullable().optional(),
  })).nullable().optional(),
  offered_promotion: z.object({
    id: z.string(),
    promo_code: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
  }).nullable().optional(),
  // Multi-turn modify scratch — when the user says "change my reservation to
  // 8pm" on turn 1, the orchestrator stashes whatever fields it parsed
  // (date / time / party) into these slots and asks for the missing piece(s).
  // Turn 2 ("thursday at 8pm") then resolves the full new slot. These MUST
  // round-trip client ↔ orchestrator on every turn or the modify continuation
  // detector (isContinuingModify) misses the prior turn's data and the standard
  // booking-collection flow hijacks the turn instead. 2026-05-13 fix.
  modify_date: z.string().nullable().optional(),
  modify_time: z.string().nullable().optional(),
  modify_party: z.number().nullable().optional(),
});

export const MapDeltaSchema = z.object({
  visible: z.boolean().optional(),
  center: latLng.nullable().optional(),
  zoom: z.number().optional(),
  marker_restaurant_ids: z.array(z.string()).optional(),
  highlighted_restaurant_id: z.string().nullable().optional(),
});

export const FiltersDeltaSchema = z.object({
  cuisine: z.array(z.string()).optional(),
  city: z.string().optional(),
  query: z.string().optional(),
});

// ── Assistant memory (mirrors AssistantMemory in types.ts) ────────────

export const RECOMMENDATION_MODE = z.enum(["single", "list"]);

export const DISCOVERY_SORT_MODE = z.enum(["distance", "rating", "price_asc", "price_desc"]);

export const AssistantDiscoveryMemorySchema = z.object({
  transcript: z.string(),
  recommendation_mode: RECOMMENDATION_MODE.nullable(),
  cuisine: z.string().nullable(),
  cuisine_group: z.string().nullable(),
  city: z.string().nullable(),
  query: z.string().nullable(),
  sort_by: DISCOVERY_SORT_MODE.nullable(),
  full_restaurant_ids: z.array(z.string()),
  displayed_restaurant_ids: z.array(z.string()),
  exhausted_restaurant_ids: z.array(z.string()),
  // Phase 1 (2026-05-17): direction-change "don't want X" memory. Optional so
  // OLD-shape responses from before Phase 1 deploy still validate.
  excluded: z.object({
    cuisines: z.array(z.string()),
    restaurant_ids: z.array(z.string()),
    vibes: z.array(z.string()),
  }).nullable().optional(),
  // Phase 3 (2026-05-17): pronoun resolution. Top 3 from last search.
  last_offered_restaurant_ids: z.array(z.string()).optional(),
});

export const AssistantBookingProcessMemorySchema = z.object({
  phase: BOOKING_STATUS,
  restaurant_id: z.string().nullable(),
  restaurant_name: z.string().nullable(),
  party_size: z.number().nullable(),
  date: z.string().nullable(),
  time: z.string().nullable(),
  shift_id: z.string().nullable(),
  slot_iso: z.string().nullable(),
  reservation_id: z.string().nullable(),
  confirmation_code: z.string().nullable(),
  last_prompt: z.string().nullable(),
});

export const AssistantMemorySchema = z.object({
  discovery: AssistantDiscoveryMemorySchema.nullable(),
  booking_process: AssistantBookingProcessMemorySchema.nullable(),
  // Phase 4 (2026-05-17): inline dietary declarations for this session.
  session_dietary: z.array(z.string()).optional(),
  // Phase 5 (2026-05-17): joke + frustration counters that persist across turns.
  conversation_state: z.object({
    joke_count: z.number().int().nonnegative().optional(),
    frustration_count: z.number().int().nonnegative().optional(),
  }).optional(),
});

// ── Main response schema ─────────────────────────────────────

export const AssistantResponse = z.object({
  conversation_id: z.string(),
  spoken_text: z.string().max(200),
  intent: z.enum(INTENTS),
  step: z.enum(STEPS),
  ui_actions: z.array(UIAction),
  booking: BookingDeltaSchema.nullable(),
  map: MapDeltaSchema.nullable(),
  filters: FiltersDeltaSchema.nullable(),
  assistant_memory: AssistantMemorySchema.nullable().optional(),
  next_expected_input: z.enum(NEXT_INPUTS),
});

export type AssistantResponseType = z.infer<typeof AssistantResponse>;

// ── Request schema (frontend → edge function) ────────────────

export const OrchestratorRequest = z.object({
  transcript: z.string().optional(),
  // Deepgram returns up to 3 candidate transcripts per utterance. The
  // orchestrator scores each against the restaurant/city ground truth and
  // picks the best fit. Index 0 may or may not equal `transcript` (it
  // usually does) — the orchestrator treats them as a ranked list.
  transcript_alternatives: z.array(z.string()).optional(),
  screen: z.string().optional(),
  booking_state: BookingDeltaSchema.optional(),
  map_state: MapDeltaSchema.optional(),
  filters: FiltersDeltaSchema.optional(),
  visible_restaurant_ids: z.array(z.string()).optional(),
  selected_restaurant_id: z.string().nullable().optional(),
  recommendation_mode: RECOMMENDATION_MODE.nullable().optional(),
  assistant_memory: AssistantMemorySchema.nullable().optional(),
  user_location: latLng.nullable().optional(),
  timezone: z.string().optional(),
  conversation_id: z.string().optional(),
  has_saved_card: z.boolean().optional(),
  guest_id: z.string().nullable().optional(),
  reservation_id: z.string().nullable().optional(),
});

export type OrchestratorRequestType = z.infer<typeof OrchestratorRequest>;
