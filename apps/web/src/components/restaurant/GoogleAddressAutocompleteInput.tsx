import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  getGoogleMapsLoadError,
  hasGoogleMapsApiKey,
  loadGoogleMaps,
  parseGooglePlace,
  type GoogleAddressParts,
} from "@/lib/google-maps";

type GoogleAddressAutocompleteInputProps = {
  value: string;
  onChange: (value: string) => void;
  onAddressSelected: (parts: GoogleAddressParts) => void;
  placeholder?: string;
  className?: string;
};

type Status = "loading" | "ready" | "error";

export function GoogleAddressAutocompleteInput({
  value,
  onChange,
  onAddressSelected,
  placeholder,
  className,
}: GoogleAddressAutocompleteInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const onChangeRef = useRef(onChange);
  const onAddressSelectedRef = useRef(onAddressSelected);
  const [status, setStatus] = useState<Status>(() =>
    hasGoogleMapsApiKey() ? "loading" : "error",
  );

  useEffect(() => {
    onChangeRef.current = onChange;
    onAddressSelectedRef.current = onAddressSelected;
  });

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    const onLoadError = () => {
      if (!cancelled) setStatus("error");
    };
    window.addEventListener("cenaiva:google-maps-error", onLoadError);

    if (getGoogleMapsLoadError()) {
      setStatus("error");
    }

    void loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !inputRef.current || !maps?.places?.Autocomplete) {
          if (!cancelled) setStatus("error");
          return;
        }
        const autocomplete = new maps.places.Autocomplete(inputRef.current, {
          fields: ["address_components", "formatted_address", "geometry", "place_id"],
          types: ["address"],
        });
        const listener = autocomplete.addListener("place_changed", () => {
          const place = autocomplete.getPlace();
          const parts = parseGooglePlace(place);
          if (parts.address) onChangeRef.current(parts.address);
          onAddressSelectedRef.current(parts);
        });
        cleanup = () => listener.remove();
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
      cleanup?.();
      window.removeEventListener("cenaiva:google-maps-error", onLoadError);
    };
  }, []);

  return (
    <div className="flex flex-col gap-1.5">
      <Input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {status === "loading" ? (
        <p className="text-xs text-text-muted">Loading address suggestions…</p>
      ) : null}
      {status === "error" ? (
        <p className="text-xs text-warning">
          Address autocomplete unavailable — type manually and we'll save it as
          entered. (City / Province / Country fields below need filling too.)
        </p>
      ) : null}
    </div>
  );
}
