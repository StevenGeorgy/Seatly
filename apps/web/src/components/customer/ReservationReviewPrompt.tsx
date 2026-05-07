import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Star, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useUser } from "@/hooks/useUser";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type ReviewRequest = {
  notification_id: string;
  reservation_id: string;
  restaurant_id: string;
  restaurant_name: string;
  reserved_at: string;
};

type PendingReviewRequestRow = {
  notification_id?: string | null;
  reservation_id?: string | null;
  restaurant_id?: string | null;
  restaurant_name?: string | null;
  reserved_at?: string | null;
};

const DISMISSED_STORAGE_PREFIX = "cenaiva:review-prompt-dismissed:";
const REVIEW_REQUEST_CHECK_MS = 60_000;

function normalizeReviewRequests(rows: PendingReviewRequestRow[] | null): ReviewRequest[] {
  return (rows ?? [])
    .map((row) => ({
      notification_id: row.notification_id ?? "",
      reservation_id: row.reservation_id ?? "",
      restaurant_id: row.restaurant_id ?? "",
      restaurant_name: row.restaurant_name ?? "Restaurant",
      reserved_at: row.reserved_at ?? "",
    }))
    .filter((row) => row.notification_id && row.reservation_id && row.restaurant_id && row.reserved_at);
}

function reviewRouteReservationId(pathname: string, search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.get("review") !== "1") return null;
  return pathname.match(/^\/bookings\/([^/?#]+)/)?.[1] ?? null;
}

function dismissedStorageKey(reservationId: string): string {
  return `${DISMISSED_STORAGE_PREFIX}${reservationId}`;
}

function hasDismissedPrompt(reservationId: string): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(dismissedStorageKey(reservationId)) === "1";
}

function setDismissedPrompt(reservationId: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(dismissedStorageKey(reservationId), "1");
}

function clearDismissedPrompt(reservationId: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(dismissedStorageKey(reservationId));
}

function dispatchNotificationsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("cenaiva:notifications-changed"));
}

export function ReservationReviewPrompt() {
  const { profile, user } = useUser();
  const location = useLocation();
  const navigate = useNavigate();
  const [requests, setRequests] = useState<ReviewRequest[]>([]);
  const [dismissedReservationIds, setDismissedReservationIds] = useState<Set<string>>(new Set());

  const routeReservationId = useMemo(
    () => reviewRouteReservationId(location.pathname, location.search),
    [location.pathname, location.search],
  );

  const fetchReviewRequests = useCallback(async () => {
    if (!profile?.id || !user || !isSupabaseConfigured()) {
      setRequests([]);
      return;
    }

    const client = getSupabaseBrowserClient();
    const { data, error } = await client.rpc("ensure_pending_reservation_review_requests");
    if (error) {
      setRequests([]);
      return;
    }

    const nextRequests = normalizeReviewRequests(data as PendingReviewRequestRow[] | null);
    setRequests(nextRequests);
    if (nextRequests.length > 0) dispatchNotificationsChanged();
  }, [profile?.id, user]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void fetchReviewRequests();
    }, 0);
    const interval = profile?.id && user
      ? window.setInterval(() => {
        void fetchReviewRequests();
      }, REVIEW_REQUEST_CHECK_MS)
      : null;
    return () => {
      window.clearTimeout(timeout);
      if (interval) window.clearInterval(interval);
    };
  }, [fetchReviewRequests, profile?.id, user]);

  const activeRequest = useMemo(() => {
    const routeRequest = routeReservationId
      ? requests.find((request) => request.reservation_id === routeReservationId) ?? null
      : null;
    return routeRequest
      ?? requests.find((request) => (
        !dismissedReservationIds.has(request.reservation_id)
        && !hasDismissedPrompt(request.reservation_id)
      ))
      ?? null;
  }, [dismissedReservationIds, requests, routeReservationId]);

  const closePrompt = () => {
    if (activeRequest) {
      setDismissedPrompt(activeRequest.reservation_id);
      setDismissedReservationIds((prev) => new Set(prev).add(activeRequest.reservation_id));
    }
    if (routeReservationId) {
      const params = new URLSearchParams(location.search);
      params.delete("review");
      const nextSearch = params.toString();
      navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ""}`, { replace: true });
    }
  };

  const handleSubmitted = (reservationId: string) => {
    clearDismissedPrompt(reservationId);
    setDismissedReservationIds((prev) => {
      const next = new Set(prev);
      next.delete(reservationId);
      return next;
    });
    setRequests((prev) => prev.filter((request) => request.reservation_id !== reservationId));
    dispatchNotificationsChanged();
    toast.success("Thanks for the review.");
  };

  return (
    <ReviewPromptDialog
      key={activeRequest?.reservation_id ?? "closed"}
      request={activeRequest}
      onClose={closePrompt}
      onSubmitted={handleSubmitted}
    />
  );
}

function ReviewPromptDialog({
  request,
  onClose,
  onSubmitted,
}: {
  request: ReviewRequest | null;
  onClose: () => void;
  onSubmitted: (reservationId: string) => void;
}) {
  const [rating, setRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submitReview = async () => {
    if (!request || rating < 1 || submitting || !isSupabaseConfigured()) return;

    setSubmitting(true);
    try {
      const client = getSupabaseBrowserClient();
      const { error } = await client.rpc("submit_reservation_review", {
        p_reservation_id: request.reservation_id,
        p_rating: rating,
        p_review_text: reviewText.trim() || null,
      });

      if (error) throw new Error(error.message);

      onSubmitted(request.reservation_id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit review.");
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
