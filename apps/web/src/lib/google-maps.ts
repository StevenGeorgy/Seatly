const GOOGLE_MAPS_SCRIPT_ID = "google-maps-js";

export type GoogleMapsMarker = {
  setMap: (map: unknown | null) => void;
  addListener: (eventName: string, handler: () => void) => { remove: () => void };
};

export type GoogleMapsNamespace = {
  Map: new (node: HTMLElement, options: Record<string, unknown>) => unknown;
  Marker: new (options: Record<string, unknown>) => GoogleMapsMarker;
  Size: new (width: number, height: number) => unknown;
  Point: new (x: number, y: number) => unknown;
  SymbolPath: { CIRCLE: unknown };
  places?: {
    Autocomplete: new (
      input: HTMLInputElement,
      options: Record<string, unknown>,
    ) => {
      addListener: (eventName: string, handler: () => void) => { remove: () => void };
      getPlace: () => GooglePlace;
    };
  };
};

type GoogleMapsWindow = Window & {
  google?: { maps?: GoogleMapsNamespace };
  __cenaivaGoogleMapsPromise?: Promise<GoogleMapsNamespace>;
};

export function getGoogleMapsApiKey(): string {
  return import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? "";
}

export function hasGoogleMapsApiKey(): boolean {
  return getGoogleMapsApiKey().length > 0;
}

export function loadGoogleMaps(): Promise<GoogleMapsNamespace> {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) {
    return Promise.reject(new Error("Google Maps API key is not configured."));
  }

  const win = window as GoogleMapsWindow;
  if (win.google?.maps) {
    return Promise.resolve(win.google.maps);
  }
  if (win.__cenaivaGoogleMapsPromise) {
    return win.__cenaivaGoogleMapsPromise;
  }

  win.__cenaivaGoogleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(GOOGLE_MAPS_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => {
        if (win.google?.maps) resolve(win.google.maps);
        else reject(new Error("Google Maps did not initialize."));
      });
      existing.addEventListener("error", () => reject(new Error("Failed to load Google Maps.")));
      return;
    }

    const script = document.createElement("script");
    script.id = GOOGLE_MAPS_SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => {
      if (win.google?.maps) resolve(win.google.maps);
      else reject(new Error("Google Maps did not initialize."));
    });
    script.addEventListener("error", () => reject(new Error("Failed to load Google Maps.")));
    document.head.appendChild(script);
  });

  return win.__cenaivaGoogleMapsPromise;
}

export type GoogleAddressParts = {
  address: string;
  city: string;
  province: string;
  country: string;
  postalCode: string;
  placeId: string;
  lat: number | null;
  lng: number | null;
};

type GooglePlace = {
  address_components?: Array<{
    long_name: string;
    short_name: string;
    types?: string[];
  }>;
  formatted_address?: string;
  place_id?: string;
  geometry?: {
    location?: {
      lat?: () => number;
      lng?: () => number;
    };
  };
};

export function parseGooglePlace(place: GooglePlace): GoogleAddressParts {
  const components = new Map<string, string>();
  for (const part of place.address_components ?? []) {
    for (const type of part.types ?? []) {
      components.set(type, part.long_name);
      components.set(`${type}:short`, part.short_name);
    }
  }

  const streetNumber = components.get("street_number") ?? "";
  const route = components.get("route") ?? "";
  const address = [streetNumber, route].filter(Boolean).join(" ") || place.formatted_address || "";

  return {
    address,
    city: components.get("locality") ?? components.get("postal_town") ?? components.get("administrative_area_level_2") ?? "",
    province: components.get("administrative_area_level_1:short") ?? components.get("administrative_area_level_1") ?? "",
    country: components.get("country") ?? "",
    postalCode: components.get("postal_code") ?? "",
    placeId: place.place_id ?? "",
    lat: place.geometry?.location?.lat?.() ?? null,
    lng: place.geometry?.location?.lng?.() ?? null,
  };
}
