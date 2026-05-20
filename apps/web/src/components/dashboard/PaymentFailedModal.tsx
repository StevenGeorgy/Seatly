// PaymentFailedModal — pops up once per browser session on dashboard
// mount when the restaurant has paused_reason === 'payment_failed' AND
// deleted_at IS NULL. Dismissal is tracked in sessionStorage keyed by
// restaurant_id so we don't nag the owner on every navigation.
//
// The modal sits *above* the PaymentFailedBanner (two-layer pattern):
// dismissing the modal still leaves the banner visible at the top of
// every dashboard route. The banner re-opens the same flow when
// clicked.
//
// "Update card now" opens the ChangeSubscriptionCard form inside this
// same Dialog. "Later" simply closes + records dismissal.

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChangeSubscriptionCard } from "@/components/billing/ChangeSubscriptionCard";
import { stripePromise } from "@/lib/stripe";

type PaymentFailedModalProps = {
  restaurantId: string;
  pausedReason: string | null | undefined;
  deletedAt: string | null | undefined;
  onUpdated: () => void;
};

function dismissedKey(restaurantId: string): string {
  return `cenaiva-payment-failed-modal-${restaurantId}-dismissed`;
}

export function PaymentFailedModal({
  restaurantId,
  pausedReason,
  deletedAt,
  onUpdated,
}: PaymentFailedModalProps) {
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const active = pausedReason === "payment_failed" && !deletedAt;

  useEffect(() => {
    if (!active) {
      setOpen(false);
      setShowForm(false);
      return;
    }
    try {
      const dismissed = sessionStorage.getItem(dismissedKey(restaurantId));
      if (!dismissed) {
        setOpen(true);
        setShowForm(false);
      }
    } catch {
      // sessionStorage unavailable (private window etc.) — fall back to
      // always-show; banner is still the durable signal.
      setOpen(true);
      setShowForm(false);
    }
  }, [active, restaurantId]);

  const dismiss = () => {
    try {
      sessionStorage.setItem(dismissedKey(restaurantId), "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
    setShowForm(false);
  };

  if (!active) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss();
        else setOpen(true);
      }}
    >
      <DialogContent className="max-w-lg gap-0 overflow-hidden border-border bg-bg-base p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="flex items-center gap-2 font-serif text-xl text-white">
            <AlertTriangle className="size-5 text-amber-300" />
            Payment didn't go through.
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-6 py-5 text-sm text-text-secondary">
          {!showForm ? (
            <>
              <p>
                Your restaurant is hidden from diners until you update your
                card on file. Once payment succeeds, you're back online
                automatically.
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Button
                  type="button"
                  disabled={!stripePromise}
                  onClick={() => setShowForm(true)}
                >
                  Update card now
                </Button>
                <Button type="button" variant="ghost" onClick={dismiss}>
                  Later
                </Button>
              </div>
            </>
          ) : stripePromise ? (
            <ChangeSubscriptionCard
              restaurantId={restaurantId}
              stripePromiseRef={stripePromise}
              onSuccess={() => {
                toast.success(
                  "Card updated. We'll retry the failed invoice shortly.",
                );
                dismiss();
                onUpdated();
              }}
              onCancel={() => setShowForm(false)}
            />
          ) : (
            <p className="text-warning">
              Stripe is not configured on this site. Please contact support.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
