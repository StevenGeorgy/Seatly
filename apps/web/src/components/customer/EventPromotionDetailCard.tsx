import { CalendarDays, Clock, FileText, Info, MapPin, Star, Tag, Ticket, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { EventPromotionDisplay } from "@/lib/customer/eventPromotionDisplay";
import { cn } from "@/lib/utils";

function EventPromotionArt({ item, className }: { item: EventPromotionDisplay; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden bg-bg-base", className)}>
      {item.imageUrl ? (
        <img src={item.imageUrl} alt={item.title} className="size-full object-cover" />
      ) : (
        <>
          <div
            aria-hidden
            className="absolute inset-0 bg-[repeating-linear-gradient(135deg,var(--gold)_0_1px,transparent_1px_16px)] opacity-20"
          />
          <div aria-hidden className="absolute left-1/2 top-1/2 size-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold/35 ring-8 ring-gold/10" />
          <span className="absolute bottom-5 left-1/2 -translate-x-1/2 font-mono text-[10px] uppercase tracking-[0.35em] text-gold/70">
            {item.imageLabel}
          </span>
        </>
      )}
      <div className="absolute left-4 top-4 flex flex-wrap gap-2">
        <span className="rounded-md border border-gold/40 bg-bg-base/70 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-gold backdrop-blur">
          {item.badgeLabel}
        </span>
        <span className="rounded-md border border-gold/40 bg-bg-base/70 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-gold backdrop-blur">
          {item.availabilityLabel}
        </span>
      </div>
      {item.mediaType === "pdf" && (
        <div className="absolute bottom-4 right-4 inline-flex items-center gap-2 rounded-md border border-border bg-bg-base/75 px-3 py-2 text-xs text-white backdrop-blur">
          <FileText className="size-4 text-gold" />
          PDF attached
        </div>
      )}
    </div>
  );
}

export function EventPromotionDetailCard({
  item,
  onReserve,
  onRestaurantOpen,
  className,
  preview = false,
}: {
  item: EventPromotionDisplay;
  onReserve?: (item: EventPromotionDisplay) => void;
  onRestaurantOpen?: (item: EventPromotionDisplay) => void;
  className?: string;
  preview?: boolean;
}) {
  const canOpenRestaurant = Boolean(onRestaurantOpen);

  return (
    <article className={cn("overflow-hidden rounded-2xl border border-border bg-bg-surface text-text-primary shadow-2xl shadow-black/30", className)}>
      <EventPromotionArt item={item} className="h-56 sm:h-64" />
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-secondary">
            <span>{item.cuisineLabel}</span>
            <span>{item.priceRangeLabel}</span>
            <span className="inline-flex items-center gap-1">
              <Star className="size-3.5 fill-gold text-gold" />
              {item.ratingLabel}
            </span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5 text-text-muted" />
              {item.cityLabel}
            </span>
          </div>

          <h2 className="mt-3 line-clamp-2 break-words font-serif text-3xl leading-tight text-white sm:text-4xl">
            {item.title}
          </h2>
          {item.description && (
            <p className="mt-3 line-clamp-3 max-w-2xl whitespace-pre-line break-words text-sm leading-6 text-text-secondary">
              {item.description}
            </p>
          )}

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-bg-elevated/60 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Date</p>
              <p className="mt-2 inline-flex items-center gap-2 text-sm text-white">
                <CalendarDays className="size-4 text-gold" />
                {item.dateLabel}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-bg-elevated/60 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Time</p>
              <p className="mt-2 inline-flex items-center gap-2 text-sm text-white">
                <Clock className="size-4 text-gold" />
                {item.timeLabel}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-bg-elevated/60 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Price</p>
              <p className="mt-2 inline-flex items-center gap-2 text-sm text-white">
                <Tag className="size-4 text-gold" />
                {item.priceLabel}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-bg-elevated/60 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Availability</p>
              <p className="mt-2 inline-flex items-center gap-2 text-sm text-white">
                <Users className="size-4 text-gold" />
                {item.seatsLabel ?? item.availabilityLabel}
              </p>
            </div>
            {item.mediaType === "pdf" && item.mediaUrl && (
              <a
                href={item.mediaUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-border bg-bg-elevated/60 p-4 transition-colors hover:border-gold/40 sm:col-span-2"
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Attachment</p>
                <p className="mt-2 inline-flex items-center gap-2 text-sm text-white">
                  <FileText className="size-4 text-gold" />
                  {item.mediaName ?? "Open PDF"}
                </p>
              </a>
            )}
          </div>
        </div>

        <aside className="border-t border-border bg-bg-elevated/30 p-5 sm:p-6 lg:border-l lg:border-t-0">
          <h3 className="font-serif text-xl text-white">
            {item.source === "event" ? "Book this event" : "Book this promotion"}
          </h3>
          <div className="mt-4 space-y-3 text-sm text-text-secondary">
            <p className="flex justify-between gap-4">
              <span>Restaurant</span>
              {canOpenRestaurant ? (
                <button
                  type="button"
                  onClick={() => onRestaurantOpen?.(item)}
                  className="text-right text-white underline-offset-4 transition-colors hover:text-gold hover:underline"
                >
                  {item.restaurantName}
                </button>
              ) : (
                <span className="text-right text-white">{item.restaurantName}</span>
              )}
            </p>
            <p className="flex justify-between gap-4">
              <span>{item.source === "event" ? "Per cover" : "Offer"}</span>
              <span className="text-right text-white">{item.perCoverLabel ?? item.priceLabel}</span>
            </p>
            {item.promoCode && (
              <p className="flex justify-between gap-4">
                <span>Promo code</span>
                <span className="font-mono uppercase text-gold">{item.promoCode}</span>
              </p>
            )}
            <p className="flex justify-between gap-4">
              <span>Status</span>
              <span className={item.isActive ? "text-success" : "text-text-muted"}>
                {item.isActive ? "Visible to diners" : "Draft preview"}
              </span>
            </p>
          </div>

          <Button
            className="mt-5 h-12 w-full gap-2 rounded-md font-semibold"
            onClick={() => onReserve?.(item)}
          >
            <Ticket className="size-4" />
            {preview ? "Preview only" : "Book"}
          </Button>
          {canOpenRestaurant && (
            <Button
              type="button"
              variant="outline"
              className="mt-3 h-11 w-full rounded-md font-semibold"
              onClick={() => onRestaurantOpen?.(item)}
            >
              View restaurant menu
            </Button>
          )}

          <p className="mt-5 flex gap-2 text-[11px] leading-relaxed text-text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0 text-gold" />
            Diners see this card from promotions and restaurant event surfaces.
          </p>
        </aside>
      </div>
    </article>
  );
}

export function EventPromotionDetailDialog({
  item,
  open,
  onOpenChange,
  onReserve,
  onRestaurantOpen,
  keepOpenOnOutsideInteraction = false,
  modal = true,
  preview = false,
}: {
  item: EventPromotionDisplay | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReserve?: (item: EventPromotionDisplay) => void;
  onRestaurantOpen?: (item: EventPromotionDisplay) => void;
  keepOpenOnOutsideInteraction?: boolean;
  modal?: boolean;
  preview?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={modal}>
      <DialogContent
        className="max-h-[92vh] overflow-y-auto border-border bg-bg-base p-0 text-text-primary sm:max-w-4xl"
        onEscapeKeyDown={(event) => {
          if (keepOpenOnOutsideInteraction) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (keepOpenOnOutsideInteraction) event.preventDefault();
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{item?.title ?? "Event preview"}</DialogTitle>
        </DialogHeader>
        {item && (
          <EventPromotionDetailCard
            item={item}
            onReserve={onReserve}
            onRestaurantOpen={onRestaurantOpen}
            preview={preview}
            className="border-0 shadow-none"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
