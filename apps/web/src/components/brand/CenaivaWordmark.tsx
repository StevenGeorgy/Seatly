import { cn } from "@/lib/utils";

type CenaivaWordmarkProps = {
  className?: string;
};

/**
 * Full Cenaiva wordmark (fork “i”). Source: `public/cenaiva-logo.png`.
 * `mix-blend-lighten` lets a black matte in the raster read as transparent on dark UI;
 * prefer a PNG with alpha for light surfaces or if blending looks off.
 * Parent should set an accessible name, e.g. `Link` with `aria-label="Cenaiva home"`.
 */
export function CenaivaWordmark({ className }: CenaivaWordmarkProps) {
  return (
    <img
      src="/cenaiva-logo.png"
      alt=""
      decoding="async"
      className={cn(
        "ml-2 h-16 w-auto max-w-[min(100%,400px)] shrink-0 object-contain object-left mix-blend-lighten md:ml-3 md:h-[4.75rem] md:max-w-[min(100%,440px)]",
        className,
      )}
    />
  );
}
