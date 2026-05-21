import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { invokeEdgeFunction } from "@/lib/supabase/edge-fn";

type ReasonCode = "duplicate" | "failed" | "other";

const REASON_OPTIONS: { value: ReasonCode; label: string; helper: string }[] = [
  {
    value: "duplicate",
    label: "Duplicate charge",
    helper: "I was charged more than once for the same booking.",
  },
  {
    value: "failed",
    label: "Failed transaction",
    helper: "The booking didn't complete but my card was charged.",
  },
  {
    value: "other",
    label: "Other",
    helper: "Something else — I'll explain below.",
  },
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reservationId: string;
  paymentIntentId?: string | null;
};

export function RefundRequestDialog({
  open,
  onOpenChange,
  reservationId,
  paymentIntentId,
}: Props) {
  const [reasonCode, setReasonCode] = useState<ReasonCode>("other");
  const [reasonText, setReasonText] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function reset() {
    setReasonCode("other");
    setReasonText("");
    setBusy(false);
    setErrorMessage(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrorMessage(null);

    const result = await invokeEdgeFunction<{
      ok: boolean;
      request_id: string;
      status: string;
    }>(
      "request-refund",
      {
        reservation_id: reservationId,
        payment_intent_id: paymentIntentId ?? null,
        reason_code: reasonCode,
        reason_text: reasonText.trim() || null,
      },
      { caller: "RefundRequestDialog" },
    );

    setBusy(false);

    if (!result.ok) {
      setErrorMessage(result.error);
      return;
    }

    if (result.data.status === "auto_resolved") {
      toast.success(
        "Refund processed. It should appear on your statement within 5–10 business days.",
      );
    } else {
      toast.success(
        "Refund request submitted. You'll hear back within 5 business days.",
      );
    }
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          if (!next) reset();
          onOpenChange(next);
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request a refund</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-text-secondary">
            Tell us what happened. We'll review and reply within 5 business
            days. Duplicate charges may be refunded automatically.
          </p>

          <fieldset className="space-y-2" disabled={busy}>
            <legend className="text-xs font-mono uppercase tracking-[0.18em] text-text-muted">
              Reason
            </legend>
            <div className="space-y-2">
              {REASON_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer gap-3 rounded-xl border border-border bg-bg-elevated p-3 text-sm hover:bg-bg-hover"
                >
                  <input
                    type="radio"
                    name="reason_code"
                    value={option.value}
                    checked={reasonCode === option.value}
                    onChange={() => setReasonCode(option.value)}
                    className="mt-1 size-4 accent-gold"
                  />
                  <span className="flex-1">
                    <span className="block font-medium text-text-primary">
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-text-muted">
                      {option.helper}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="refund-details">Details (optional)</Label>
            <Textarea
              id="refund-details"
              value={reasonText}
              onChange={(event) => setReasonText(event.target.value.slice(0, 2000))}
              placeholder="Anything that helps us investigate (order details, dates, what went wrong)."
              rows={4}
              disabled={busy}
              maxLength={2000}
            />
            <p className="text-[10px] uppercase tracking-[0.18em] text-text-muted">
              {reasonText.length}/2000
            </p>
          </div>

          {errorMessage && (
            <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {errorMessage}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Submitting…
                </>
              ) : (
                "Submit request"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
