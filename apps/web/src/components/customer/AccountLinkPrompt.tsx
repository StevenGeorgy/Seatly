import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
} from "@/lib/supabase/client";
import { showErrorToast } from "@/lib/errors";

// Phase 5 of diner auth overhaul (2026-05-15). Shown after AuthCallback
// detects another user_profiles row with matching email/phone but a
// different auth.users id — i.e., the diner has two accounts. The
// modal lets them merge (preserving bookings + saved cards + history
// under one account) or keep them separate.
//
// On confirm, fires merge-diner-accounts edge fn. The merge is
// IRREVERSIBLE — the duplicate auth.users is hard-deleted. We surface
// that clearly in the dialog body.

export type DuplicateAccountInfo = {
  canonicalAuthUserId: string;
  archivedAuthUserId: string;
  matchedOn: "email" | "phone" | "both";
  matchedValue: string; // e.g. "mark@example.com" or "+14165551234"
  archivedCreatedAt: string; // ISO
  archivedBookingCount: number;
};

type Props = {
  info: DuplicateAccountInfo | null;
  onDone: () => void;
};

export function AccountLinkPrompt({ info, onDone }: Props) {
  const [submitting, setSubmitting] = useState(false);

  if (!info) return null;

  const handleMerge = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const client = getSupabaseBrowserClient();
      const { data: { session } } = await client.auth.getSession();
      if (!session) {
        toast.error("Your session expired. Please sign in again.");
        onDone();
        return;
      }
      const res = await fetch(
        `${getSupabaseProjectUrl()}/functions/v1/merge-diner-accounts`,
        {
          method: "POST",
          headers: {
            apikey: getSupabaseAnonKey(),
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            canonical_auth_user_id: info.canonicalAuthUserId,
            archived_auth_user_id: info.archivedAuthUserId,
          }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        counts?: {
          reservations?: number;
          saved_cards?: number;
          guests?: number;
          deposits?: number;
          reviews?: number;
          alerts?: number;
          notifications?: number;
        };
      };
      if (!res.ok || body.ok !== true) {
        showErrorToast(body.error ?? null, {
          fallback: "Couldn't merge your accounts. Try again or contact support.",
          logTag: "[AccountLinkPrompt.merge]",
        });
        return;
      }
      const moved =
        (body.counts?.reservations ?? 0) +
        (body.counts?.saved_cards ?? 0) +
        (body.counts?.guests ?? 0);
      toast.success(
        moved > 0
          ? `Accounts merged. ${moved} ${moved === 1 ? "item" : "items"} moved to your main account.`
          : "Accounts merged.",
      );
      onDone();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={Boolean(info)} onOpenChange={(open) => !open && !submitting && onDone()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Welcome back — link your accounts?</DialogTitle>
          <DialogDescription>
            We found another Cenaiva account using this {info.matchedOn === "phone" ? "phone number" : "email"}.
            Want to combine them so all your bookings, saved cards, and history live under one account?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 rounded-2xl border border-border bg-bg-surface/50 p-4">
          <p className="text-sm text-text-secondary">
            We'll move everything from the older account into the one you just signed into. The
            older sign-in method will stop working after this.
          </p>
          {info.archivedBookingCount > 0 ? (
            <p className="text-xs text-text-muted">
              {info.archivedBookingCount} booking
              {info.archivedBookingCount === 1 ? "" : "s"} will be moved over.
            </p>
          ) : null}
          <p className="text-xs text-warning">This can't be undone.</p>
        </div>

        <DialogFooter className="gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={onDone}
            disabled={submitting}
          >
            Keep them separate
          </Button>
          <Button
            type="button"
            onClick={() => void handleMerge()}
            disabled={submitting}
            className="gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Merging…
              </>
            ) : (
              "Yes, merge"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
