export interface LatLng {
  lat: number;
  lng: number;
}

export interface CartItem {
  menu_item_id: string;
  name: string;
  qty: number;
  unit_price: number; // dollars
  note: string | null;
}

export interface PendingAction {
  type: "modify_reservation" | "cancel_reservation" | "late_note" | "save_preference";
  payload: Record<string, unknown>;
  confirmation_text: string;
}

export interface BookingState {
  restaurant_id: string | null;
  restaurant_name: string | null;
  party_size: number | null;
  date: string | null; // ISO date YYYY-MM-DD
  time: string | null; // ISO datetime or display time
  shift_id: string | null;
  slot_iso: string | null;
  special_request: string | null;
  occasion: string | null;
  status:
    | "idle"
    | "collecting_minimum_fields"
    | "loading_availability"
    | "awaiting_time_selection"
    | "confirming"
    | "confirmed"
    | "post_booking"
    | "offering_preorder"
    | "browsing_menu"
    | "reviewing_cart"
    | "choosing_tip_timing"
    | "choosing_tip_amount"
    | "choosing_payment_split"
    | "collecting_payment"
    | "charging"
    | "paid";
  confirmation_code: string | null;
  reservation_id: string | null;
  // Pre-order / payment fields
  want_preorder: boolean | null;
  cart: CartItem[];
  cart_subtotal: number; // dollars
  tip_choice: "now" | "after" | null;
  tip_amount: number | null; // dollars
  tip_percent: number | null; // 0–100
  payment_split: "single" | "split" | null;
  pending_action: PendingAction | null;
  order_id: string | null;
  payment_status: "idle" | "pending" | "paid" | "failed";
  has_saved_card: boolean;
  // Event / promo auto-attach context — round-trips client ↔ orchestrator
  // so multi-turn confirmations after a "any events at X" search OR a
  // direct "book me for <event-name>" handler can resolve the right
  // event_id / promotion_id when the user finally says "yes confirm".
  offered_events?: Array<{
    id: string;
    name?: string | null;
    date?: string | null;
    start_time?: string | null;
    end_time?: string | null;
  }> | null;
  offered_promotion?: {
    id: string;
    promo_code?: string | null;
    title?: string | null;
  } | null;
  // Multi-turn modify scratch — see BookingDeltaSchema (schema.ts) for the
  // full explanation. Stashed on turn 1 of a modify request when only some
  // fields are present; turn 2 picks them up via isContinuingModify so the
  // standard booking-collection path doesn't intercept the follow-up.
  modify_date?: string | null;
  modify_time?: string | null;
  modify_party?: number | null;
}

export interface MapState {
  visible: boolean;
  center: LatLng | null;
  zoom: number;
  marker_restaurant_ids: string[];
  highlighted_restaurant_id: string | null;
}

export interface FiltersDelta {
  cuisine?: string[];
  city?: string;
  query?: string;
}

export interface BookingDelta {
  restaurant_id?: string | null;
  restaurant_name?: string | null;
  party_size?: number | null;
  date?: string | null;
  time?: string | null;
  shift_id?: string | null;
  slot_iso?: string | null;
  special_request?: string | null;
  occasion?: string | null;
  status?: BookingState["status"];
  confirmation_code?: string | null;
  reservation_id?: string | null;
  want_preorder?: boolean | null;
  cart?: CartItem[];
  cart_subtotal?: number;
  tip_choice?: "now" | "after" | null;
  tip_amount?: number | null;
  tip_percent?: number | null;
  payment_split?: "single" | "split" | null;
  pending_action?: PendingAction | null;
  order_id?: string | null;
  payment_status?: BookingState["payment_status"];
  has_saved_card?: boolean;
  // See BookingState for context — mirror these in the delta type so
  // event/promo attach info round-trips through the request/response cycle.
  offered_events?: Array<{
    id: string;
    name?: string | null;
    date?: string | null;
    start_time?: string | null;
    end_time?: string | null;
  }> | null;
  offered_promotion?: {
    id: string;
    promo_code?: string | null;
    title?: string | null;
  } | null;
  // Multi-turn modify scratch — see BookingState for context.
  modify_date?: string | null;
  modify_time?: string | null;
  modify_party?: number | null;
}

export interface MapDelta {
  visible?: boolean;
  center?: LatLng | null;
  zoom?: number;
  marker_restaurant_ids?: string[];
  highlighted_restaurant_id?: string | null;
}

export type VoiceStatus = "idle" | "listening" | "processing" | "speaking" | "interrupted" | "error";

// ── Cenaiva assistant memory (sent on every orchestrator request) ────────────

export type DiscoverySortMode = "distance" | "rating" | "price_asc" | "price_desc";

export type RecommendationMode = "single" | "list";

export interface AssistantDiscoveryMemory {
  transcript: string;
  recommendation_mode: RecommendationMode | null;
  cuisine: string | null;
  cuisine_group: string | null;
  city: string | null;
  query: string | null;
  sort_by: DiscoverySortMode | null;
  full_restaurant_ids: string[];
  displayed_restaurant_ids: string[];
  exhausted_restaurant_ids: string[];
}

export interface AssistantBookingProcessMemory {
  phase: BookingState["status"];
  restaurant_id: string | null;
  restaurant_name: string | null;
  party_size: number | null;
  date: string | null;
  time: string | null;
  shift_id: string | null;
  slot_iso: string | null;
  reservation_id: string | null;
  confirmation_code: string | null;
  last_prompt: string | null;
}

export interface AssistantMemory {
  discovery: AssistantDiscoveryMemory | null;
  booking_process: AssistantBookingProcessMemory | null;
}
