import { useState } from "react";
import { format } from "date-fns";
import { Star, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useReservationReviewRequests } from "@/hooks/useReservationReviewRequests";
import { useUser } from "@/hooks/useUser";
import { useErrorToast } from "@/lib/errors";

// Inline review prompt on the Discover page. Reads the same source of truth
// as the global modal — submit from either UI, both close. Hides itself
// when the user has no pending review or session-dismissed the active one.
//
// Cross-device: shared hook's realtime subscription on restaurant_reviews
// closes this banner in <1s when another device (mobile, another tab)
// submits a review for the same reservation. See
// useReservationReviewRequests for the dedup story.
export function DiscoverReviewBanner() {
  const { user, profile } = useUser();
  const { activeRequest, submit, dismiss } = useReservationReviewRequests();
  const { errorToast } = useErrorToast();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Auth gate: a review banner only makes sense for a signed-in diner whose
  // profile is loaded. Without this guard, stale state in the singleton store
  // from a prior session could leak after signout.
  if (!user || !profile) return null;
  if (!activeRequest) return null;

  const handleSubmit = async () => {
    if (rating < 1 || submitting) return;
    setSubmitting(true);
    try {
      const outcome = await submit(activeRequest.reservation_id, rating, text.trim() || null);
      toast.success(outcome === "already-reviewed" ? "Already reviewed — thanks!" : "Thanks for the review.");
      setRating(0);
      setText("");
    } catch (error) {
      errorToast(error, {
        fallback: "Could not submit review.",
        logTag: "[DiscoverReviewBanner.submit]",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = () => {
    dismiss(activeRequest.reservation_id);
    setRating(0);
    setText("");
  };

  return (
    <section className="mb-6 rounded-2xl border border-gold/30 bg-gradient-to-br from-gold/[0.08] via-bg-surface to-bg-surface p-5 shadow-[0_8px_30px_-12px_rgba(180,140,60,0.35)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold/80">
            Rate your visit
          </p>
          <h3 className="mt-1 font-serif text-xl text-white">
            How was {activeRequest.restaurant_name}?
          </h3>
          <p className="mt-0.5 text-xs text-text-muted">
            {format(new Date(activeRequest.reserved_at), "EEEE, MMMM d")}
          </p>
        </div>
        <button
          type="button"
          onClick={handleSkip}
          className="rounded-full p-1.5 text-text-muted transition-colors hover:bg-bg-elevated hover:text-white"
          aria-label="Skip review"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mt-4 flex items-center gap-1.5" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setRating(value)}
            className="rounded-md p-1 text-gold transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
            aria-label={`${value} star${value === 1 ? "" : "s"}`}
          >
            <Star
              className={cn(
                "size-7",
                value <= rating ? "fill-gold text-gold" : "text-text-muted",
              )}
            />
          </button>
        ))}
      </div>

      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Add a note (optional)"
        className="mt-3 min-h-20 resize-none bg-bg-elevated/60"
        maxLength={1200}
      />

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={handleSkip}>
          Skip
        </Button>
        <Button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={rating < 1 || submitting}
        >
          {submitting ? "Submitting..." : "Submit review"}
        </Button>
      </div>
    </section>
  );
}
