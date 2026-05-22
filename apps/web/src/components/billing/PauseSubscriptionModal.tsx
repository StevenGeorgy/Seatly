// PauseSubscriptionModal — confirmation modal for the pause flow.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { toUserFacingError } from "@/lib/errors";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

interface PauseSubscriptionModalProps {
  restaurantId: string;
  /** When true, owner is currently trialing — warn that trial clock keeps running. */
  isTrialing: boolean;
  open: boolean;
  onClose: () => void;
  onPaused?: () => void;
}

export function PauseSubscriptionModal({
  restaurantId,
  isTrialing,
  open,
  onClose,
  onPaused,
}: PauseSubscriptionModalProps) {
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    if (submitting) return;
    if (!isSupabaseConfigured()) {
      toast.error("Supabase is not configured.");
      return;
    }
    setSubmitting(true);
    try {
      const client = getSupabaseBrowserClient();
      const { data: sessionData } = await client.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        toast.error("Your session expired. Please sign in again.");
        return;
      }
      const res = await fetch(
        `${getSupabaseProjectUrl()}/functions/v1/pause-subscription`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: getSupabaseAnonKey(),
          },
          body: JSON.stringify({ restaurant_id: restaurantId }),
        },
      );
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || body?.error) {
        const friendly = toUserFacingError(body?.error, "Couldn't pause subscription.");
        toast.error(friendly.message);
        console.error("[PauseSubscriptionModal]", friendly.code, friendly.technical ?? body);
        return;
      }
      toast.success("Subscription paused. Resume any time.");
      onPaused?.();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pause your Cenaiva subscription?</DialogTitle>
          <DialogDescription>
            Your restaurant gets hidden from Discover immediately. Existing reservations stay valid — diners still show up for bookings they already made.
            <br /><br />
            We won't bill you while paused. Hit Resume any time to come back online.
            {isTrialing ? (
              <>
                <br /><br />
                <strong>Heads up:</strong> your free trial clock keeps running while paused. If you want to stop the trial entirely, cancel instead.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Never mind
          </Button>
          <Button
            onClick={() => void handleConfirm()}
            disabled={submitting}
            className="gap-1.5 bg-warning text-white hover:bg-warning/90"
          >
            {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Pause subscription
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
