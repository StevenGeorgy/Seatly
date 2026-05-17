import {
  createContext,
  useContext,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import type {
  AssistantMemory,
  AssistantResponseType,
  BookingState,
  CartItem,
  FiltersDelta,
  MapState,
  UIActionType,
  VoiceStatus,
} from "@cenaiva/assistant";

export {
  NO_AUTO_RELISTEN_STATUSES,
  RELISTEN_AFTER_RESPONSE_MS,
} from "./assistantStoreConstants";

// ── State ─────────────────────────────────────────────────────────────────────

export interface AssistantState {
  isOpen: boolean;
  voiceStatus: VoiceStatus;
  booking: BookingState;
  map: MapState;
  filters: FiltersDelta;
  memory: AssistantMemory;
  showExitX: boolean;
  customerAccepted: boolean;
  conversationId: string | null;
  lastSpokenText: string;
  availabilityOpen: boolean;
}

const initialMemory: AssistantMemory = {
  discovery: null,
  booking_process: null,
};

const initialBooking: BookingState = {
  restaurant_id: null,
  restaurant_name: null,
  party_size: null,
  date: null,
  time: null,
  shift_id: null,
  slot_iso: null,
  special_request: null,
  occasion: null,
  status: "idle",
  confirmation_code: null,
  reservation_id: null,
  want_preorder: null,
  cart: [],
  cart_subtotal: 0,
  tip_choice: null,
  tip_amount: null,
  tip_percent: null,
  payment_split: null,
  pending_action: null,
  order_id: null,
  payment_status: "idle",
  has_saved_card: false,
  offered_events: null,
  offered_promotion: null,
  modify_date: null,
  modify_time: null,
  modify_party: null,
};

const initialMap: MapState = {
  visible: false,
  center: null,
  zoom: 13,
  marker_restaurant_ids: [],
  highlighted_restaurant_id: null,
};

export const initialState: AssistantState = {
  isOpen: false,
  voiceStatus: "idle",
  booking: initialBooking,
  map: initialMap,
  filters: {},
  memory: initialMemory,
  showExitX: false,
  customerAccepted: false,
  conversationId: null,
  lastSpokenText: "",
  availabilityOpen: false,
};

// ── Local actions (non-JSON-contract) ─────────────────────────────────────────

type LocalAction =
  | { type: "OPEN" }
  | { type: "CLOSE" }
  | { type: "SET_VOICE_STATUS"; status: VoiceStatus }
  | { type: "SET_LAST_SPOKEN_TEXT"; text: string }
  | { type: "SET_CONVERSATION_ID"; id: string }
  | { type: "APPLY_RESPONSE"; response: AssistantResponseType }
  | { type: "RESET_BOOKING" }
  | { type: "RESET_ASSISTANT_CONTEXT" }
  | { type: "SET_AVAILABILITY_OPEN"; open: boolean }
  | { type: "SET_HAS_SAVED_CARD"; value: boolean }
  | { type: "SET_BOOKING_STATUS"; status: BookingState["status"] }
  | { type: "PRESELECT_RESTAURANT"; restaurant_id: string; restaurant_name: string };

export type AssistantAction = UIActionType | LocalAction;

// ── Reducer ───────────────────────────────────────────────────────────────────

function computeCartSubtotal(cart: CartItem[]): number {
  return Math.round(cart.reduce((sum, item) => sum + item.unit_price * item.qty, 0) * 100) / 100;
}

function mergeAssistantMemory(
  current: AssistantMemory,
  incoming: AssistantResponseType["assistant_memory"],
): AssistantMemory {
  if (!incoming) return current;
  return {
    discovery: incoming.discovery ?? current.discovery,
    booking_process: incoming.booking_process ?? current.booking_process,
  };
}

function bookingProcessMemoryFromState(
  booking: BookingState,
  lastPrompt: string | null,
): NonNullable<AssistantMemory["booking_process"]> {
  return {
    phase: booking.status,
    restaurant_id: booking.restaurant_id,
    restaurant_name: booking.restaurant_name,
    party_size: booking.party_size,
    date: booking.date,
    time: booking.time,
    shift_id: booking.shift_id,
    slot_iso: booking.slot_iso,
    reservation_id: booking.reservation_id,
    confirmation_code: booking.confirmation_code,
    last_prompt: lastPrompt,
  };
}

function beginBookingForRestaurant(
  booking: BookingState,
  restaurantId: string,
  restaurantName?: string,
): BookingState {
  const isSameRestaurant = booking.restaurant_id === restaurantId;
  const shouldPreserveCollectedFields = isSameRestaurant || booking.restaurant_id == null;

  if (shouldPreserveCollectedFields) {
    return {
      ...booking,
      restaurant_id: restaurantId,
      ...(restaurantName != null ? { restaurant_name: restaurantName } : {}),
      status: "collecting_minimum_fields",
    };
  }

  return {
    ...booking,
    restaurant_id: restaurantId,
    ...(restaurantName != null ? { restaurant_name: restaurantName } : {}),
    party_size: null,
    date: null,
    time: null,
    shift_id: null,
    slot_iso: null,
    special_request: null,
    occasion: null,
    status: "collecting_minimum_fields",
    confirmation_code: null,
    reservation_id: null,
    want_preorder: null,
    cart: [],
    cart_subtotal: 0,
    tip_choice: null,
    tip_amount: null,
    tip_percent: null,
    payment_split: null,
    pending_action: null,
    order_id: null,
    payment_status: "idle",
  };
}

function applyUIAction(state: AssistantState, action: UIActionType): AssistantState {
  switch (action.type) {
    case "open_assistant":
      return { ...state, isOpen: true };

    case "close_assistant":
      return { ...state, isOpen: false, voiceStatus: "idle" };

    case "show_map":
      return { ...state, map: { ...state.map, visible: true } };

    case "update_map_center":
      return {
        ...state,
        map: {
          ...state.map,
          visible: true,
          center: { lat: action.lat, lng: action.lng },
          zoom: action.zoom ?? state.map.zoom,
        },
      };

    case "update_map_markers":
      return {
        ...state,
        map: {
          ...state.map,
          // Preserve existing filter when the action omits restaurant_ids —
          // clobbering to [] would silently drop the cuisine filter and show
          // every restaurant again.
          marker_restaurant_ids: Array.isArray(action.restaurant_ids)
            ? action.restaurant_ids
            : state.map.marker_restaurant_ids,
          visible: true,
        },
      };

    case "highlight_restaurant":
      return {
        ...state,
        map: { ...state.map, highlighted_restaurant_id: action.restaurant_id },
      };

    case "show_restaurant_cards":
      return {
        ...state,
        map: {
          ...state.map,
          marker_restaurant_ids: Array.isArray(action.restaurant_ids)
            ? action.restaurant_ids
            : state.map.marker_restaurant_ids,
          visible: true,
        },
      };

    case "open_restaurant_preview":
      return {
        ...state,
        map: { ...state.map, highlighted_restaurant_id: action.restaurant_id },
      };

    case "set_filters":
      return state;

    case "clear_filters":
      return { ...state, filters: {} };

    case "start_booking":
      return {
        ...state,
        booking: beginBookingForRestaurant(state.booking, action.restaurant_id),
        availabilityOpen: false,
        showExitX: false,
        customerAccepted: false,
      };

    case "set_booking_field": {
      const { field, value } = action;
      return {
        ...state,
        booking: { ...state.booking, [field]: value },
      };
    }

    case "load_availability":
      return {
        ...state,
        booking: { ...state.booking, status: "loading_availability" },
        availabilityOpen: true,
      };

    case "select_time_slot":
      return {
        ...state,
        booking: {
          ...state.booking,
          slot_iso: action.slot_iso,
          shift_id: action.shift_id,
          status: "awaiting_time_selection",
        },
      };

    case "confirm_booking":
      return {
        ...state,
        booking: { ...state.booking, status: "confirming" },
      };

    case "show_confirmation":
      // Land in `post_booking` (the orchestrator will set pending_action to
      // session_end_check on the same turn). Voice no longer offers preorder
      // here — preorder is a hand-off to the public restaurant page (see
      // cenaiva-orchestrate Change 6). The BookingSheet renders the
      // confirmation card for `post_booking`; the "Anything else?" follow-up
      // comes from the orchestrator's spoken_text.
      //
      // Fall back to the value already on `state.booking.confirmation_code`
      // when the orchestrator emits a bare `{type:"show_confirmation"}`
      // without the code attribute. Without this guard the action overwrites
      // the code that the bookingPatch just applied (causing the "You're
      // booked!" card to disappear).
      return {
        ...state,
        booking: {
          ...state.booking,
          status: "post_booking",
          confirmation_code:
            action.confirmation_code ?? state.booking.confirmation_code,
        },
        customerAccepted: true,
      };

    case "show_post_booking_questions":
      return { ...state, booking: { ...state.booking, status: "post_booking" } };

    case "show_exit_x":
      return { ...state, showExitX: true };

    case "toast":
      return state;

    case "navigate":
      return state;

    case "fallback_to_manual":
      return state;

    // ── Pre-order actions ───────────────────────────────────────────────────

    case "offer_preorder":
      return { ...state, booking: { ...state.booking, status: "offering_preorder" } };

    case "show_menu":
      return { ...state, booking: { ...state.booking, status: "browsing_menu" } };

    case "add_menu_item": {
      const existing = state.booking.cart.find((c) => c.menu_item_id === action.menu_item_id);
      let newCart: CartItem[];
      if (existing) {
        newCart = state.booking.cart.map((c) =>
          c.menu_item_id === action.menu_item_id
            ? { ...c, qty: c.qty + (action.qty ?? 1) }
            : c
        );
      } else {
        newCart = [
          ...state.booking.cart,
          {
            menu_item_id: action.menu_item_id,
            name: action.name,
            qty: action.qty ?? 1,
            unit_price: action.unit_price,
            note: action.note ?? null,
          },
        ];
      }
      return {
        ...state,
        booking: {
          ...state.booking,
          cart: newCart,
          cart_subtotal: computeCartSubtotal(newCart),
        },
      };
    }

    case "remove_menu_item": {
      const newCart = state.booking.cart.filter((c) => c.menu_item_id !== action.menu_item_id);
      return {
        ...state,
        booking: {
          ...state.booking,
          cart: newCart,
          cart_subtotal: computeCartSubtotal(newCart),
        },
      };
    }

    case "clear_cart":
      return {
        ...state,
        booking: { ...state.booking, cart: [], cart_subtotal: 0 },
      };

    case "set_tip_choice":
      return {
        ...state,
        booking: {
          ...state.booking,
          tip_choice: action.choice,
          status: action.choice === "now" ? "choosing_tip_amount" : "choosing_tip_timing",
        },
      };

    case "set_tip":
      return {
        ...state,
        booking: {
          ...state.booking,
          tip_amount: action.amount ?? null,
          tip_percent: action.percent ?? null,
          status: "choosing_payment_split",
        },
      };

    case "set_payment_split":
      return {
        ...state,
        booking: {
          ...state.booking,
          payment_split: action.choice,
          status: action.choice === "single" ? "charging" : state.booking.status,
        },
      };

    case "navigate_to_checkout":
      return state;

    case "show_payment_success":
      return {
        ...state,
        booking: {
          ...state.booking,
          status: "paid",
          payment_status: "paid",
        },
      };

    default:
      return state;
  }
}

export function assistantReducer(
  state: AssistantState,
  action: AssistantAction,
): AssistantState {
  const localAction = action as LocalAction;

  switch (localAction.type) {
    case "OPEN":
      return { ...state, isOpen: true };

    case "CLOSE":
      return { ...initialState };

    case "SET_VOICE_STATUS":
      return { ...state, voiceStatus: localAction.status };

    case "SET_LAST_SPOKEN_TEXT":
      return { ...state, lastSpokenText: localAction.text };

    case "SET_CONVERSATION_ID":
      return { ...state, conversationId: localAction.id };

    case "SET_HAS_SAVED_CARD":
      return { ...state, booking: { ...state.booking, has_saved_card: localAction.value } };

    case "SET_BOOKING_STATUS":
      return {
        ...state,
        booking: { ...state.booking, status: localAction.status },
      };

    case "APPLY_RESPONSE": {
      const { response } = localAction;
      let next = { ...state, lastSpokenText: response.spoken_text };

      if (response.conversation_id) {
        next = { ...next, conversationId: response.conversation_id };
      }

      if (response.booking) {
        // Drop null/undefined fields from the patch so an LLM regression
        // (e.g. `party_size: null` after we already collected it) can't
        // overwrite previously-set state and force the orchestrator to
        // re-ask the same question on the next turn.
        const bookingPatch = Object.fromEntries(
          Object.entries(response.booking).filter(([, v]) => v != null),
        ) as Partial<typeof next.booking>;
        // When the new patch transitions back to "idle" (a fact-lookup
        // answer about a different restaurant, or a global question), the
        // prior reservation_id / confirmation_code / slot_iso must NOT
        // carry forward — otherwise the UI keeps showing the post_booking
        // success card and never transitions to the question response. The
        // post_booking state is only meaningful when the response itself
        // affirms it (singleReservationKind / list / book).
        // Hard-reset intents — the orchestrator's "different restaurant" /
        // bail-out / flow-reset handlers signal a fresh start. Trigger the
        // full reset regardless of prior status so stale reservation_id /
        // confirmation_code / slot_iso from a just-completed modify/cancel
        // don't leak into the next booking attempt.
        const intent = (response.intent ?? "") as string;
        const isHardResetIntent =
          intent === "discover_restaurants" ||
          intent === "fallback_unknown";
        const transitioningToIdle = bookingPatch.status === "idle" &&
          (isHardResetIntent ||
            state.booking.status === "post_booking" ||
            state.booking.status === "paid" ||
            state.booking.status === "confirmed");
        // R1-A: ONLY do the destructive wipe when the orchestrator
        // signals an EXPLICIT cancellation (intent === "reservation_cancel")
        // OR the user explicitly bailed (fallback_unknown / discover_restaurants
        // for a totally new request). Without this, follow-up turns AFTER a
        // successful booking ("cancel it" / "show me the menu" / "what's the
        // address") wipe reservation_id when the orchestrator's reply happens
        // to drop status to "idle" — leaving the deterministic cancel guard
        // with no reservation_id to act on, forcing infinite "which one?"
        // disambig loops. Preserve reservation_id + confirmation_code +
        // restaurant context unless cancellation is confirmed or the user
        // restarted from scratch.
        const isExplicitCancelOrReset =
          intent === "reservation_cancel" || isHardResetIntent;
        if (transitioningToIdle && isExplicitCancelOrReset) {
          // Full reset: cancel succeeded OR user restarted — wipe everything.
          next = {
            ...next,
            booking: {
              ...initialBooking,
              ...bookingPatch,
              // Preserve restaurant context only if the patch explicitly
              // set it (fact-lookup like "what is X about" sends the restaurant).
              ...(bookingPatch.restaurant_id ? {
                restaurant_id: bookingPatch.restaurant_id,
                restaurant_name: bookingPatch.restaurant_name ?? null,
              } : {}),
            },
            customerAccepted: false,
          };
        } else if (transitioningToIdle) {
          // Soft reset: status went idle but no cancel/reset signal.
          // Preserve the reservation_id + confirmation_code + restaurant
          // context so follow-up "cancel it" / "show me the menu" can find
          // the booking. Drop the slot/shift/party so the next NEW booking
          // doesn't inherit stale fields, but keep the reservation marker.
          next = {
            ...next,
            booking: {
              ...initialBooking,
              ...bookingPatch,
              // Preserve the reservation marker from the just-booked turn.
              reservation_id: next.booking.reservation_id ?? bookingPatch.reservation_id ?? null,
              confirmation_code: next.booking.confirmation_code ?? bookingPatch.confirmation_code ?? null,
              // Preserve restaurant context if the patch sets it OR if we
              // already have it from the booking flow.
              restaurant_id: bookingPatch.restaurant_id ?? next.booking.restaurant_id ?? null,
              restaurant_name: bookingPatch.restaurant_name ?? next.booking.restaurant_name ?? null,
            },
            customerAccepted: false,
          };
        } else {
          next = { ...next, booking: { ...next.booking, ...bookingPatch } };
        }
        // Multi-turn modify scratch — the null-strip above retains stale
        // values. When the orchestrator queues a modify pending_action
        // (modify is finalized + waiting for "yes confirm"), clear the
        // scratch so the next turn isn't treated as a continuation.
        // Same when the response intent transitions back to a non-modify
        // shape (booking finished / hard-reset / etc).
        const newPendingAction = next.booking.pending_action;
        if (
          newPendingAction &&
          newPendingAction.type === "modify_reservation"
        ) {
          next = {
            ...next,
            booking: {
              ...next.booking,
              modify_date: null,
              modify_time: null,
              modify_party: null,
            },
          };
        }
      }

      if (response.map) {
        const mapPatch = { ...response.map };
        if (!Array.isArray(mapPatch.marker_restaurant_ids)) {
          mapPatch.marker_restaurant_ids = next.map.marker_restaurant_ids;
        }
        next = { ...next, map: { ...next.map, ...mapPatch } };
      }

      if (response.filters) {
        next = { ...next, filters: { ...next.filters, ...response.filters } };
      }

      next = {
        ...next,
        memory: mergeAssistantMemory(next.memory, response.assistant_memory),
      };

      for (const uiAction of (response.ui_actions ?? [])) {
        if (!uiAction || typeof (uiAction as { type?: unknown }).type !== "string") continue;
        try {
          next = applyUIAction(next, uiAction);
        } catch {
          // Malformed action — skip rather than crash
        }
      }

      // ── Safety net: a reservation was just created but the orchestrator's
      // post-booking status update didn't reach the booking patch. Force into
      // `post_booking` so the BookingSheet renders the confirmation card.
      // Voice no longer offers preorder — that's a hand-off path on the
      // public page (see cenaiva-orchestrate Change 6).
      const wasNotBooked = !state.booking.reservation_id;
      const isNowBooked = !!next.booking.reservation_id;
      const alreadyPastBooking: BookingState["status"][] = [
        "browsing_menu",
        "reviewing_cart",
        "choosing_tip_timing",
        "choosing_tip_amount",
        "choosing_payment_split",
        "charging",
        "paid",
        "post_booking",
      ];
      if (
        wasNotBooked &&
        isNowBooked &&
        !alreadyPastBooking.includes(next.booking.status)
      ) {
        next = {
          ...next,
          booking: { ...next.booking, status: "post_booking" },
          customerAccepted: true,
        };
      }

      next = {
        ...next,
        memory: {
          ...next.memory,
          booking_process: bookingProcessMemoryFromState(
            next.booking,
            next.lastSpokenText || null,
          ),
        },
      };

      return next;
    }

    case "RESET_BOOKING":
      return {
        ...state,
        booking: initialBooking,
        memory: {
          ...state.memory,
          booking_process: null,
        },
        showExitX: false,
        customerAccepted: false,
        availabilityOpen: false,
      };

    case "RESET_ASSISTANT_CONTEXT":
      return {
        ...state,
        conversationId: null,
        booking: {
          ...initialBooking,
          has_saved_card: state.booking.has_saved_card,
        },
        map: {
          ...initialMap,
          visible: true,
          center: state.map.center,
          zoom: state.map.zoom,
        },
        filters: {},
        memory: initialMemory,
        showExitX: false,
        customerAccepted: false,
        availabilityOpen: false,
      };

    case "SET_AVAILABILITY_OPEN":
      return { ...state, availabilityOpen: localAction.open };

    case "PRESELECT_RESTAURANT":
      return {
        ...state,
        isOpen: true,
        booking: beginBookingForRestaurant(
          state.booking,
          localAction.restaurant_id,
          localAction.restaurant_name,
        ),
        availabilityOpen: false,
        showExitX: false,
        customerAccepted: false,
      };
  }

  return applyUIAction(state, action as UIActionType);
}

// ── Context ───────────────────────────────────────────────────────────────────

interface AssistantContextValue {
  state: AssistantState;
  dispatch: Dispatch<AssistantAction>;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function AssistantStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(assistantReducer, initialState);
  return (
    <AssistantContext.Provider value={{ state, dispatch }}>
      {children}
    </AssistantContext.Provider>
  );
}

export function useAssistantStore(): AssistantContextValue {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error("useAssistantStore must be inside AssistantStoreProvider");
  return ctx;
}
