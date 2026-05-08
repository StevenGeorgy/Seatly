import { cn } from "@/lib/utils";

type CenaivaIconProps = {
  className?: string;
  /**
   * Decorative when there's a visible wordmark/title nearby (default).
   * Set to a non-empty string when the icon is the only branding shown.
   */
  alt?: string;
};

/**
 * Cenaiva icon mark — the fork glyph from the wordmark, on its own.
 * Source: `public/cenaiva-icon.png` (gold-on-transparent, 500×500). Use
 * for tight surfaces where the full wordmark would overpower: auth pages,
 * favicon-equivalent badges, empty states, splash/loading screens.
 */
export function CenaivaIcon({ className, alt = "" }: CenaivaIconProps) {
  return (
    <img
      src="/cenaiva-icon.png"
      alt={alt}
      decoding="async"
      className={cn("size-10 object-contain", className)}
    />
  );
}
