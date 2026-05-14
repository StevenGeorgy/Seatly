import { format, parseISO } from "date-fns";
import { Star } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { RestaurantPhoto } from "@/hooks/useRestaurantPhotos";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photo: RestaurantPhoto | null;
  restaurantName: string;
};

export function PhotoReviewDialog({ open, onOpenChange, photo, restaurantName }: Props) {
  if (!photo) return null;
  const reviewerName = photo.poster_name ?? "A diner";
  const rating = photo.paired_review?.rating ?? photo.rating ?? null;
  const reviewText = photo.paired_review?.review_text ?? null;
  const caption = photo.caption ?? null;
  let postedDate: string | null = null;
  try {
    postedDate = format(parseISO(photo.created_at), "MMM d, yyyy");
  } catch {
    postedDate = null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Snap from {reviewerName} at {restaurantName}</DialogTitle>
          <DialogDescription>
            {reviewText ?? caption ?? "View this diner's snap."}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] w-full overflow-hidden bg-bg-base">
          <img
            src={photo.image_url}
            alt={caption ?? `Photo at ${restaurantName}`}
            className="size-full object-contain"
          />
        </div>
        <div className="space-y-3 p-5">
          <div className="flex items-center gap-3">
            {photo.poster_avatar_url ? (
              <img
                src={photo.poster_avatar_url}
                alt=""
                className="size-10 rounded-full object-cover"
              />
            ) : (
              <div className="flex size-10 items-center justify-center rounded-full bg-gold/15 text-sm font-semibold text-gold">
                {reviewerName.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{reviewerName}</p>
              {postedDate ? (
                <p className="text-xs text-text-muted">{postedDate}</p>
              ) : null}
            </div>
            {rating ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-gold/10 px-3 py-1 text-sm font-semibold text-gold">
                <Star className="size-4 fill-gold" />
                {rating}
              </span>
            ) : null}
          </div>
          {reviewText ? (
            <p className="whitespace-pre-line text-sm leading-relaxed text-text-secondary">
              {reviewText}
            </p>
          ) : null}
          {caption && caption !== reviewText ? (
            <p className="whitespace-pre-line text-sm italic leading-relaxed text-text-muted">
              {caption}
            </p>
          ) : null}
          {!reviewText && !caption ? (
            <p className="text-sm italic text-text-muted">No caption.</p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
