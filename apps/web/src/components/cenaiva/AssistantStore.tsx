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
  availabilityOpen: false,
};

// ── Local actions (non-JSON-contract) ─────────────────────────────────────────

type LocalAction =
  | { type: "OPEN" }
  | { type: "CLOSE" }
  | { type: "SET_VOICE_STATUS"; status: VoiceStatus }
  | { type: "SET_CONVERSATION_ID"; id: string }
  | { type: "APPLY_RESPONSE"; response: AssistantResponseType }
  | { type: "RESET_BOOKING" }
  | { type: "SET_AVAILABILITY_OPEN"; open: boolean }
  | { type: "PRESELECT_RESTAURANT"; restaurant_id: string; restaurant_name: string };

export type AssistantAction = UIActionType | LocalAction;

// ── Reducer ───────────────────────────────────────────────────────────────────

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
        map: { ...state.map, marker_restaurant_ids: action.restaurant_ids, visible: true },
      };

    case "highlight_restaurant":
      return {
        ...state,
        map: { ...state.map, highlighted_restaurant_id: action.restaurant_id },
      };

    case "show_restaurant_cards":
      return {
        ...state,
        map: { ...state.map, marker_restaurant_ids: action.restaurant_ids, visible: true },
      };

    case "open_restaurant_preview":
      return {
        ...state,
        map: { ...state.map, highlighted_restaurant_id: action.restaurant_id },
      };

    case "set_filters":
      return state; // Filters are applied via APPLY_RESPONSE delta

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
      return {
        ...state,
        booking: {
          ...state.booking,
          status: "confirmed",
          confirmation_code: action.confirmation_code,
        },
        customerAccepted: true,
      };

    case "show_post_booking_questions":
      return { ...state, booking: { ...state.booking, status: "post_booking" } };

    case "show_exit_x":
      return { ...state, showExitX: true };

    case "toast":
      // Handled by component level (sonner toast call)
      return state;

    case "navigate":
      // Navigation handled by component
      return state;

    case "fallback_to_manual":
      return state;

    default:
      return state;
  }
}

export function assistantReducer(
  state: AssistantState,
  action: AssistantAction,
): AssistantState {
  // Handle local actions first
  const localAction = action as LocalAction;

  switch (localAction.type) {
    case "OPEN":
      return { ...state, isOpen: true };

    case "CLOSE":
      // Full reset — next open starts a completely fresh session
      return { ...initialState };

    case "SET_VOICE_STATUS":
      return { ...state, voiceStatus: localAction.status };

    case "SET_CONVERSATION_ID":
      return { ...state, conversationId: localAction.id };

    case "APPLY_RESPONSE": {
      const { response } = localAction;
      let next = { ...state, lastSpokenText: response.spoken_text };

      // Apply conversationId
      if (response.conversation_id) {
        next = { ...next, conversationId: response.conversation_id };
      }

      // Apply booking delta
      if (response.booking) {
        next = { ...next, booking: { ...next.booking, ...response.booking } };
      }

      // Apply map delta
      if (response.map) {
        next = { ...next, map: { ...next.map, ...response.map } };
      }

      // Apply filters delta
      if (response.filters) {
        next = { ...next, filters: { ...next.filters, ...response.filters } };
      }

      // Apply UI actions
      for (const uiAction of response.ui_actions) {
        next = applyUIAction(next, uiAction);
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

  // Otherwise treat as UIAction
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
