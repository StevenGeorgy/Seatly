import { cn } from "@/lib/utils";

type CenaivaWordmarkProps = {
  className?: string;
};

/**
 * Full Cenaiva wordmark (fork "i"). Source: `public/cenaiva-logo.png`.
 * The asset is gold-on-transparent so it sits on dark and light surfaces
 * without a blend mode. Parent should set an accessible name (e.g. a
 * surrounding Link with `aria-label="Cenaiva home"`).
 */
export function CenaivaWordmark({ className }: CenaivaWordmarkProps) {
  return (
    <img
      src="/cenaiva-logo.png"
      alt=""
      decoding="async"
      className={cn(
        "ml-2 h-16 w-auto max-w-[min(100%,400px)] shrink-0 object-contain object-left md:ml-3 md:h-[4.75rem] md:max-w-[min(100%,440px)]",
        className,
      )}
    />
  );
}
