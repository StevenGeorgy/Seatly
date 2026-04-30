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
  next_expected_input: z.enum(NEXT_INPUTS),
});

export type AssistantResponseType = z.infer<typeof AssistantResponse>;

// ── Request schema (frontend → edge function) ────────────────

export const OrchestratorRequest = z.object({
  transcript: z.string().optional(),
  screen: z.string().optional(),
  booking_state: BookingDeltaSchema.optional(),
  map_state: MapDeltaSchema.optional(),
  filters: FiltersDeltaSchema.optional(),
  visible_restaurant_ids: z.array(z.string()).optional(),
  selected_restaurant_id: z.string().nullable().optional(),
  user_location: latLng.nullable().optional(),
  timezone: z.string().optional(),
  conversation_id: z.string().optional(),
  has_saved_card: z.boolean().optional(),
  guest_id: z.string().nullable().optional(),
  reservation_id: z.string().nullable().optional(),
});

export type OrchestratorRequestType = z.infer<typeof OrchestratorRequest>;
