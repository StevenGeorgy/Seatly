import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Mic, ThumbsDown, ThumbsUp, X } from "lucide-react";

import {
  CENAIVA_MAP_STYLES,
  hasGoogleMapsApiKey,
  loadGoogleMaps,
} from "@/lib/google-maps";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

// Map area centered between Toronto and Guelph at a zoom that shows all
// real Cenaiva restaurants in the GTA at once. Pins are decorative — the
// pin coords come from the actual restaurants table.
const HEY_CENAIVA_MAP_CENTER = { lat: 43.6, lng: -79.7 };
const HEY_CENAIVA_MAP_ZOOM = 9;

function heyCenaivaPinSvg(dollars: 1 | 2 | 3): string {
  const text = "$".repeat(dollars);
  const fontSize = 14;
  const padX = 10;
  const height = 28;
  const charWidth = fontSize * 0.65;
  const width = Math.round(text.length * charWidth + padX * 2);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}'><defs><filter id='hcp' x='-50%' y='-50%' width='200%' height='200%'><feDropShadow dx='0' dy='2' stdDeviation='2' flood-color='#000000' flood-opacity='0.55'/></filter></defs><rect x='1' y='1' width='${width - 2}' height='${height - 2}' rx='${height / 2}' ry='${height / 2}' fill='#0A0A0A' stroke='rgba(201,168,76,0.65)' stroke-width='1.5' filter='url(#hcp)'/><text x='50%' y='50%' dominant-baseline='central' text-anchor='middle' font-family='ui-monospace, SFMono-Regular, Menlo, monospace' font-weight='700' font-size='${fontSize}' fill='#C9A84C'>${text}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function heyCenaivaClusterSvg(): string {
  const size = 48;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'><defs><filter id='hcc' x='-50%' y='-50%' width='200%' height='200%'><feDropShadow dx='0' dy='2' stdDeviation='2.5' flood-color='#000000' flood-opacity='0.55'/></filter></defs><circle cx='${size / 2}' cy='${size / 2}' r='${size / 2 - 2}' fill='rgba(201,168,76,0.16)' stroke='rgba(245,230,200,0.35)' stroke-width='1.5'/><circle cx='${size / 2}' cy='${size / 2}' r='${size / 2 - 7}' fill='#C9A84C' stroke='#0A0A0A' stroke-width='2' filter='url(#hcc)'/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Marketing-only mock of the live Cenaiva voice shell. Renders the same
 * Google Map (CENAIVA_MAP_STYLES) + decorative pins + chrome that a logged-in
 * diner sees on /discover?concierge=1. Used on both the HomePage Hey Cenaiva
 * section and the dedicated /hey-cenaiva page so prospects see one identical
 * preview wherever they land.
 */
export function HeyCenaivaVoiceMock() {
  const mapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasGoogleMapsApiKey() || !mapRef.current) return;
    let cancelled = false;
    void loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !mapRef.current) return;
        const map: unknown = new maps.Map(mapRef.current, {
          center: HEY_CENAIVA_MAP_CENTER,
          zoom: HEY_CENAIVA_MAP_ZOOM,
          minZoom: HEY_CENAIVA_MAP_ZOOM,
          maxZoom: HEY_CENAIVA_MAP_ZOOM,
          disableDefaultUI: true,
          zoomControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
          streetViewControl: false,
          clickableIcons: false,
          gestureHandling: "none",
          keyboardShortcuts: false,
          backgroundColor: "#0A0A0A",
          styles: CENAIVA_MAP_STYLES,
        });

        // Decorative markers — exact restaurant coords from the DB.
        const pins = [
          { lat: 43.50595, lng: -80.19107, icon: heyCenaivaPinSvg(3), width: 38, height: 28 },
          { lat: 43.5183, lng: -79.8829, icon: heyCenaivaPinSvg(2), width: 30, height: 28 },
        ];
        for (const pin of pins) {
          new maps.Marker({
            position: { lat: pin.lat, lng: pin.lng },
            map,
            icon: {
              url: pin.icon,
              scaledSize: new maps.Size(pin.width, pin.height),
              anchor: new maps.Point(pin.width / 2, pin.height / 2),
            },
          });
        }
        new maps.Marker({
          position: { lat: 43.6532, lng: -79.3832 },
          map,
          icon: {
            url: heyCenaivaClusterSvg(),
            scaledSize: new maps.Size(48, 48),
            anchor: new maps.Point(24, 24),
          },
          label: {
            text: "6",
            color: "#0a0907",
            fontWeight: "700",
            fontSize: "13px",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          },
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, ease }}
      className="relative flex h-full min-h-[28rem] flex-col overflow-hidden rounded-2xl border border-border bg-[#0A0A0A] shadow-2xl shadow-black/40"
    >
      {/* Top bar — close button + action icons (matches voice shell chrome) */}
      <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between p-3">
        <span className="flex size-9 items-center justify-center rounded-full border border-gold/40 bg-gold/15">
          <X className="size-4 text-gold" />
        </span>
        <div className="flex items-center gap-1.5">
          <span className="flex size-9 items-center justify-center rounded-full border border-border bg-black/50">
            <ThumbsUp className="size-4 text-text-secondary" />
          </span>
          <span className="flex size-9 items-center justify-center rounded-full border border-border bg-black/50">
            <ThumbsDown className="size-4 text-text-secondary" />
          </span>
          <span className="flex size-9 items-center justify-center rounded-full border border-gold/40 bg-gold/15">
            <Mic className="size-4 text-gold" />
          </span>
        </div>
      </div>

      {/* Map area — real Google Map of GTA + Guelph with decorative pins */}
      <div className="relative flex-1 overflow-hidden bg-[#0A0A0A]">
        <div ref={mapRef} className="absolute inset-0" />
        <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/75 px-5 py-2 text-sm font-medium text-white shadow-lg shadow-black/40 backdrop-blur-sm">
          Hey, I am Cenaiva. How can I help you?
        </div>
      </div>

      {/* Bottom mic prompt bar */}
      <div className="flex items-center gap-4 border-t border-border bg-[#0A0A0A] px-6 py-5">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-gold/15">
          <Mic className="size-6 text-gold" />
        </span>
        <p className="flex-1 text-lg text-text-muted">
          Tap the mic or say{" "}
          <span className="font-medium text-text-secondary">"Hey Cenaiva"</span>
        </p>
      </div>
    </motion.div>
  );
}
