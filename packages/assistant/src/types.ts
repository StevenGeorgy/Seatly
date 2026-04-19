export interface LatLng {
  lat: number;
  lng: number;
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
    | "post_booking";
  confirmation_code: string | null;
  reservation_id: string | null;
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
}

export interface MapDelta {
  visible?: boolean;
  center?: LatLng | null;
  zoom?: number;
  marker_restaurant_ids?: string[];
  highlighted_restaurant_id?: string | null;
}

export type VoiceStatus = "idle" | "listening" | "processing" | "speaking" | "interrupted" | "error";
