import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Star, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  useReservationReviewRequests,
  type ReviewRequest,
} from "@/hooks/useReservationReviewRequests";
import { useErrorToast } from "@/lib/errors";

function reviewRouteReservationId(pathname: string, search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.get("review") !== "1") return null;
  return pathname.match(/^\/bookings\/([^/?#]+)/)?.[1] ?? null;
}

export function ReservationReviewPrompt() {
  const location = useLocation();
  const navigate = useNavigate();
  const { requests, activeRequest, dismiss, submit, reactivate } = useReservationReviewRequests();

  const routeReservationId = useMemo(
    () => reviewRouteReservationId(location.pathname, location.search),
    [location.pathname, location.search],
  );

  // Deep-link path: /bookings/<id>?review=1 should reopen the prompt even
  // if the user previously dismissed it this session.
  useEffect(() => {
    if (routeReservationId) reactivate(routeReservationId);
  }, [routeReservationId, reactivate]);

  // Pick the route-pinned request first, else fall back to the hook's
  // session-aware activeRequest.
  const request = useMemo<ReviewRequest | null>(() => {
    if (routeReservationId) {
      return requests.find((r) => r.reservation_id === routeReservationId) ?? null;
    }
    return activeRequest;
  }, [requests, routeReservationId, activeRequest]);

  const closePrompt = () => {
    if (request) dismiss(request.reservation_id);
    if (routeReservationId) {
      const params = new URLSearchParams(location.search);
      params.delete("review");
      const nextSearch = params.toString();
      navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ""}`, { replace: true });
    }
  };

  const handleSubmit = async (reservationId: string, rating: number, text: string | null) => {
    const outcome = await submit(reservationId, rating, text);
    toast.success(outcome === "already-reviewed" ? "Already reviewed — thanks!" : "Thanks for the review.");
  };

  return (
    <ReviewPromptDialog
      key={request?.reservation_id ?? "closed"}
      request={request}
      onClose={closePrompt}
      onSubmit={handleSubmit}
    />
  );
}

function ReviewPromptDialog({
  request,
  onClose,
  onSubmit,
}: {
  request: ReviewRequest | null;
  onClose: () => void;
  onSubmit: (reservationId: string, rating: number, text: string | null) => Promise<void>;
}) {
  const [rating, setRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { errorToast } = useErrorToast();

  const submitReview = async () => {
    if (!request || rating < 1 || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(request.reservation_id, rating, reviewText.trim() || null);
    } catch (error) {
      errorToast(error, {
        fallback: "Could not submit review.",
        logTag: "[ReservationReviewPrompt.submit]",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="border-border bg-bg-surface text-text-primary sm:max-w-md">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-text-muted transition-colors hover:bg-bg-elevated hover:text-white"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
        <DialogHeader>
          <DialogTitle className="font-serif text-3xl font-normal text-white">
            Rate your experience
          </DialogTitle>
        </DialogHeader>

        {request ? (
          <div className="space-y-5">
            <div>
              <p className="text-sm text-text-secondary">
                How was your visit at <span className="font-medium text-white">{request.restaurant_name}</span>?
              </p>
              <p className="mt-1 text-xs text-text-muted">
                {format(new Date(request.reserved_at), "EEEE, MMMM d")}
              </p>
            </div>

            <div className="flex items-center gap-2" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRating(value)}
                  className="rounded-md p-1 text-gold transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
                  aria-label={`${value} star${value === 1 ? "" : "s"}`}
                >
                  <Star
                    className={cn(
                      "size-8",
                      value <= rating ? "fill-gold text-gold" : "text-text-muted",
                    )}
                  />
                </button>
              ))}
            </div>

            <Textarea
              value={reviewText}
              onChange={(event) => setReviewText(event.target.value)}
              placeholder="Optional review"
              className="min-h-28 resize-none"
              maxLength={1200}
            />
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={onClose}>
            Later
          </Button>
          <Button type="button" onClick={() => void submitReview()} disabled={rating < 1 || submitting}>
            {submitting ? "Submitting..." : "Submit review"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
