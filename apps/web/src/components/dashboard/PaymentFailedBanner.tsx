// PaymentFailedBanner — shown when a restaurant's last subscription charge
// failed and the restaurant has been unpublished as a result
// (paused_reason === 'payment_failed' AND deleted_at IS NULL).
//
// Clicking "Update card" opens a Dialog containing the in-page
// ChangeSubscriptionCard (Stripe Elements form). After a successful
// card swap the parent refreshes restaurant state — the stripe-webhook
// retries the open invoice and flips paused_reason back to NULL.

import { useState } from "react";
import { AlertTriangle, CreditCard } from "lucide-react";
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

type PaymentFailedBannerProps = {
  restaurantId: string;
  restaurantName: string | null;
  pausedReason: string | null | undefined;
  deletedAt: string | null | undefined;
  onUpdated: () => void;
};

export function PaymentFailedBanner({
  restaurantId,
  restaurantName,
  pausedReason,
  deletedAt,
  onUpdated,
}: PaymentFailedBannerProps) {
  const [open, setOpen] = useState(false);
  if (deletedAt) return null;
  if (pausedReason !== "payment_failed") return null;

  return (
    <>
      <div className="flex flex-col gap-3 border-b border-amber-400/40 bg-amber-400/10 px-5 py-4 text-sm text-text-primary sm:flex-row sm:items-center sm:gap-4 sm:px-6 lg:px-8">
        <div className="flex items-start gap-3 sm:items-center">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-400/15 sm:mt-0">
            <AlertTriangle className="size-4 text-amber-300" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-white">
              Your last payment failed.
            </p>
            <p className="mt-0.5 text-xs text-text-muted">
              {restaurantName ? `${restaurantName} is` : "This restaurant is"}{" "}
              hidden from diners. Update your card to come back online.
            </p>
          </div>
        </div>
        <div className="sm:ml-auto">
          <Button
            type="button"
            size="sm"
            disabled={!stripePromise}
            onClick={() => setOpen(true)}
          >
            <CreditCard className="mr-1.5 size-3.5" />
            Update card
          </Button>
        </div>
      </div>

      <Dialog
        open={open && !!stripePromise}
        onOpenChange={(next) => setOpen(next)}
      >
        <DialogContent className="max-w-lg gap-0 overflow-hidden border-border bg-bg-base p-0">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle className="font-serif text-xl text-white">
              Update your card
            </DialogTitle>
          </DialogHeader>
          <div className="px-6 py-5">
            {stripePromise ? (
              <ChangeSubscriptionCard
                restaurantId={restaurantId}
                stripePromiseRef={stripePromise}
                onSuccess={() => {
                  setOpen(false);
                  toast.success(
                    "Card updated. We'll retry the failed invoice shortly.",
                  );
                  onUpdated();
                }}
                onCancel={() => setOpen(false)}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
