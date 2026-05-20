// RestoreRestaurantBanner — shown when a restaurant has been soft-deleted
// but is still within the 30-day grace window
// (deleted_at IS NOT NULL AND scheduled_purge_at > NOW()).
//
// The owner can click Restore to call the recover-restaurant edge fn which
// clears deleted_at + scheduled_purge_at + paused_reason='pending_deletion'.
//
// Mounted on the dashboard chrome (DashboardLayout) so it appears on every
// dashboard route until restored or purged.

import { useMemo, useState } from "react";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { toUserFacingError } from "@/lib/errors";

type RestoreRestaurantBannerProps = {
  restaurantId: string;
  restaurantName: string | null;
  deletedAt: string | null | undefined;
  scheduledPurgeAt: string | null | undefined;
  onRestored: () => void;
};

function formatPurgeDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function RestoreRestaurantBanner({
  restaurantId,
  restaurantName,
  deletedAt,
  scheduledPurgeAt,
  onRestored,
}: RestoreRestaurantBannerProps) {
  const [restoring, setRestoring] = useState(false);

  const daysLeft = useMemo(() => {
    if (!scheduledPurgeAt) return null;
    const purgeMs = new Date(scheduledPurgeAt).getTime();
    if (Number.isNaN(purgeMs)) return null;
    const ms = purgeMs - Date.now();
    return Math.max(0, Math.ceil(ms / 86_400_000));
  }, [scheduledPurgeAt]);

  if (!deletedAt || !scheduledPurgeAt) return null;
  // Guard: hide once the purge window has already passed (cron will sweep
  // these up but we shouldn't show a useless Restore button in the gap).
  if (daysLeft === 0) return null;

  const handleRestore = async () => {
    if (!isSupabaseConfigured()) {
      toast.error("Supabase is not configured.");
      return;
    }
    setRestoring(true);
    try {
      const client = getSupabaseBrowserClient();
      const { data, error } = await client.functions.invoke<{
        ok?: boolean;
        error?: string;
      }>("recover-restaurant", {
        body: { restaurant_id: restaurantId },
      });
      if (error || data?.error) {
        const friendly = error ? toUserFacingError(error) : null;
        const msg = data?.error ?? friendly?.message ?? "Couldn't restore restaurant.";
        toast.error(msg);
        console.error(
          "[RestoreRestaurantBanner.recover]",
          friendly?.code,
          friendly?.technical ?? error ?? data,
        );
        setRestoring(false);
        return;
      }
      toast.success("Restaurant restored.");
      onRestored();
    } catch (e) {
      const friendly = toUserFacingError(e, "Couldn't restore restaurant.");
      toast.error(friendly.message);
      console.error("[RestoreRestaurantBanner.catch]", friendly.code, friendly.technical ?? e);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-b border-danger/30 bg-danger/10 px-5 py-4 text-sm text-text-primary sm:flex-row sm:items-center sm:gap-4 sm:px-6 lg:px-8">
      <div className="flex items-start gap-3 sm:items-center">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-danger/15 sm:mt-0">
          <Trash2 className="size-4 text-danger" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-white">
            {restaurantName ?? "This restaurant"} is scheduled for deletion on{" "}
            {formatPurgeDate(scheduledPurgeAt)}
            {typeof daysLeft === "number" ? (
              <>
                {" "}
                <span className="text-danger">
                  ({daysLeft} {daysLeft === 1 ? "day" : "days"} left)
                </span>
              </>
            ) : null}
            .
          </p>
          <p className="mt-0.5 text-xs text-text-muted">
            Restore now to bring it back. After that, all data is anonymized.
          </p>
        </div>
      </div>
      <div className="sm:ml-auto">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={restoring}
          onClick={() => void handleRestore()}
        >
          {restoring ? (
            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
          ) : (
            <RotateCcw className="mr-1.5 size-3.5" />
          )}
          {restoring ? "Restoring…" : "Restore"}
        </Button>
      </div>
    </div>
  );
}
