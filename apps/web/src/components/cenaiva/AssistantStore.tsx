import {
  createContext,
  useContext,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import type {
  AssistantResponseType,
  BookingState,
  CartItem,
  FiltersDelta,
  MapState,
  UIActionType,
  VoiceStatus,
} from "@cenaiva/assistant";

// ── State ─────────────────────────────────────────────────────────────────────

export interface AssistantState {
  isOpen: boolean;
  voiceStatus: VoiceStatus;
  booking: BookingState;
  map: MapState;
  filters: FiltersDelta;
  showExitX: boolean;
  customerAccepted: boolean;
  conversationId: string | null;
  lastSpokenText: string;
  /**
   * Live partial transcript from the STT provider while the user is speaking.
   * Cleared when a final transcript arrives or the turn is processed. Populated
   * only on providers that stream partials (Vapi today; Deepgram partials are
   * available but not wired through on the legacy path).
   */
  interimTranscript: string;
  availabilityOpen: boolean;
}

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
  order_id: null,
  payment_status: "idle",
  has_saved_card: false,
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
  showExitX: false,
  customerAccepted: false,
  conversationId: null,
  lastSpokenText: "",
  interimTranscript: "",
  availabilityOpen: false,
};

// ── Local actions (non-JSON-contract) ─────────────────────────────────────────

type LocalAction =
  | { type: "OPEN" }
  | { type: "CLOSE" }
  | { type: "SET_VOICE_STATUS"; status: VoiceStatus }
  | { type: "SET_LAST_SPOKEN_TEXT"; text: string }
  | { type: "SET_INTERIM_TRANSCRIPT"; text: string }
  | { type: "SET_CONVERSATION_ID"; id: string }
  | { type: "APPLY_RESPONSE"; response: AssistantResponseType }
  | { type: "RESET_BOOKING" }
  | { type: "SET_AVAILABILITY_OPEN"; open: boolean }
  | { type: "SET_HAS_SAVED_CARD"; value: boolean }
  | { type: "PRESELECT_RESTAURANT"; restaurant_id: string; restaurant_name: string };

export type AssistantAction = UIActionType | LocalAction;

// ── Reducer ───────────────────────────────────────────────────────────────────

function computeCartSubtotal(cart: CartItem[]): number {
  return Math.round(cart.reduce((sum, item) => sum + item.unit_price * item.qty, 0) * 100) / 100;
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
        booking: {
          ...state.booking,
          restaurant_id: action.restaurant_id,
          status: "collecting_minimum_fields",
        },
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
      // Land directly in `offering_preorder` so the BookingSheet renders the
      // "Would you like to pre-order from the menu?" prompt next to the
      // confirmation card. Previously the LLM was expected to emit
      // `offer_preorder` in the same response, which was unreliable — this
      // makes the preorder question deterministic after every booking.
      return {
        ...state,
        booking: {
          ...state.booking,
          status: "offering_preorder",
          confirmation_code: action.confirmation_code,
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
      // Final spoken text arrives with the assistant's reply; the user's
      // live partial is no longer relevant, so clear it in the same tick to
      // avoid a brief flash of stale transcript under the new bubble.
      return { ...state, lastSpokenText: localAction.text, interimTranscript: "" };

    case "SET_INTERIM_TRANSCRIPT":
      return { ...state, interimTranscript: localAction.text };

    case "SET_CONVERSATION_ID":
      return { ...state, conversationId: localAction.id };

    case "SET_HAS_SAVED_CARD":
      return { ...state, booking: { ...state.booking, has_saved_card: localAction.value } };

    case "APPLY_RESPONSE": {
      const { response } = localAction;
      let next = { ...state, lastSpokenText: response.spoken_text };

      if (response.conversation_id) {
        next = { ...next, conversationId: response.conversation_id };
      }

      if (response.booking) {
        next = { ...next, booking: { ...next.booking, ...response.booking } };
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

      for (const uiAction of (response.ui_actions ?? [])) {
        if (!uiAction || typeof (uiAction as { type?: unknown }).type !== "string") continue;
        try {
          next = applyUIAction(next, uiAction);
        } catch {
          // Malformed action — skip rather than crash
        }
      }

      // ── Safety net: a reservation was just created but the LLM didn't emit
      // show_confirmation (or emitted something that skipped straight past the
      // preorder offer). Force the booking into `offering_preorder` so the
      // Y/N preorder prompt always appears after a successful booking.
      const wasNotBooked = !state.booking.reservation_id;
      const isNowBooked = !!next.booking.reservation_id;
      const alreadyPastPreorder: BookingState["status"][] = [
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
        !alreadyPastPreorder.includes(next.booking.status) &&
        next.booking.status !== "offering_preorder"
      ) {
        next = {
          ...next,
          booking: { ...next.booking, status: "offering_preorder" },
          customerAccepted: true,
        };
      }

      return next;
    }

    case "RESET_BOOKING":
      return {
        ...state,
        booking: initialBooking,
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
        booking: {
          ...state.booking,
          restaurant_id: localAction.restaurant_id,
          restaurant_name: localAction.restaurant_name,
          status: "collecting_minimum_fields",
        },
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
