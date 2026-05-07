import { useEffect, useRef } from "react";

import { Input } from "@/components/ui/input";
import { loadGoogleMaps, parseGooglePlace, type GoogleAddressParts } from "@/lib/google-maps";

type GoogleAddressAutocompleteInputProps = {
  value: string;
  onChange: (value: string) => void;
  onAddressSelected: (parts: GoogleAddressParts) => void;
  placeholder?: string;
  className?: string;
};

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

  useEffect(() => {
    onChangeRef.current = onChange;
    onAddressSelectedRef.current = onAddressSelected;
  });

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    void loadGoogleMaps().then((maps) => {
      if (cancelled || !inputRef.current || !maps?.places?.Autocomplete) return;
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
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return (
    <Input
      ref={inputRef}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={className}
      autoComplete="off"
    />
  );
}
