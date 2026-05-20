// CancelSubscriptionModal — confirmation modal for the soft-cancel flow.
// Explains what will happen and lets the owner change their mind.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

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

interface CancelSubscriptionModalProps {
  restaurantId: string;
  open: boolean;
  onClose: () => void;
  onCancelled?: () => void;
}

export function CancelSubscriptionModal({
  restaurantId,
  open,
  onClose,
  onCancelled,
}: CancelSubscriptionModalProps) {
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
        `${getSupabaseProjectUrl()}/functions/v1/cancel-subscription`,
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
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; period_end_iso?: string | null; error?: string }
        | null;
      if (!res.ok || body?.error) {
        toast.error(body?.error ?? "Couldn't cancel subscription.");
        return;
      }
      const periodEnd = body?.period_end_iso
        ? new Date(body.period_end_iso).toLocaleDateString("en-CA", {
          month: "long",
          day: "numeric",
        })
        : "the end of your billing cycle";
      toast.success(`Subscription will end on ${periodEnd}. You can resume any time before then.`);
      onCancelled?.();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel your Cenaiva subscription?</DialogTitle>
          <DialogDescription>
            Your restaurant stays live and bookings keep flowing until the end of your current billing cycle. After that, your restaurant will be unpublished from Discover.
            <br /><br />
            You can <strong>change your mind any time before then</strong> — just hit Resume on this page and you're back to normal, no charges or downtime.
            <br /><br />
            If you'd rather pause billing temporarily without unpublishing later, hit Never mind and use the Pause button instead.
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
            Yes, cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
