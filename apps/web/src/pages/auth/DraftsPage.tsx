import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, ChevronLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useUser } from "@/hooks/useUser";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  computeDraftStep,
  WIZARD_TOTAL_STEPS,
} from "@/lib/onboarding/computeDraftStep";
import type { HoursJson } from "@/components/onboarding/wizardTypes";

type DraftRow = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  province: string | null;
  hours_json: HoursJson | null;
  cover_photo_url: string | null;
  deposit_tiers: unknown[] | null;
  created_at: string;
  hasTables: boolean;
  hasShift: boolean;
  tierItemCount: number;
};

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} hr ago`;
  if (diffSec < 30 * 86400) return `${Math.floor(diffSec / 86400)} days ago`;
  return new Date(iso).toLocaleDateString();
}

export default function DraftsPage() {
  const navigate = useNavigate();
  const { profile } = useUser();
  const [drafts, setDrafts] = useState<DraftRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchDrafts = useCallback(async () => {
    if (!profile?.id || !isSupabaseConfigured()) {
      setDrafts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const client = getSupabaseBrowserClient();

    const { data: roleRows } = await client
      .from("user_restaurant_roles")
      .select("restaurant_id")
      .eq("user_id", profile.id)
      .eq("role", "owner");
    const ownedIds = (roleRows ?? [])
      .map((r) => (r as { restaurant_id: string | null }).restaurant_id)
      .filter((id): id is string => Boolean(id));

    if (ownedIds.length === 0) {
      setDrafts([]);
      setLoading(false);
      return;
    }

    const { data: restaurants } = await client
      .from("restaurants")
      .select(
        "id, name, address, city, province, hours_json, cover_photo_url, deposit_tiers, created_at",
      )
      .in("id", ownedIds)
      .eq("is_published", false)
      .order("created_at", { ascending: false });

    const draftRows = (restaurants ?? []) as Array<{
      id: string;
      name: string | null;
      address: string | null;
      city: string | null;
      province: string | null;
      hours_json: HoursJson | null;
      cover_photo_url: string | null;
      deposit_tiers: unknown[] | null;
      created_at: string;
    }>;

    // Resolve has-tables / has-shift / tier-item-count per draft. Cheap-ish
    // since there are typically <5 drafts per user.
    const enriched: DraftRow[] = await Promise.all(
      draftRows.map(async (row) => {
        const [{ count: tableCount }, { count: shiftCount }, { data: tierCat }] =
          await Promise.all([
            client
              .from("tables")
              .select("id", { count: "exact", head: true })
              .eq("restaurant_id", row.id)
              .eq("is_active", true),
            client
              .from("shifts")
              .select("id", { count: "exact", head: true })
              .eq("restaurant_id", row.id)
              .eq("is_active", true),
            client
              .from("menu_categories")
              .select("id")
              .eq("restaurant_id", row.id)
              .eq("is_active", true)
              .eq("is_pricing_tier_source", true)
              .maybeSingle(),
          ]);

        let tierItemCount = 0;
        if (tierCat) {
          const { count } = await client
            .from("menu_items")
            .select("id", { count: "exact", head: true })
            .eq("restaurant_id", row.id)
            .eq("category_id", (tierCat as { id: string }).id)
            .eq("is_active", true);
          tierItemCount = count ?? 0;
        }

        return {
          id: row.id,
          name: row.name ?? "Untitled",
          address: row.address,
          city: row.city,
          province: row.province,
          hours_json: row.hours_json,
          cover_photo_url: row.cover_photo_url,
          deposit_tiers: row.deposit_tiers,
          created_at: row.created_at,
          hasTables: (tableCount ?? 0) > 0,
          hasShift: (shiftCount ?? 0) > 0,
          tierItemCount,
        };
      }),
    );

    setDrafts(enriched);
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => {
    void fetchDrafts();
  }, [fetchDrafts]);

  const allSelected = useMemo(() => {
    if (!drafts || drafts.length === 0) return false;
    return drafts.every((d) => selectedIds.has(d.id));
  }, [drafts, selectedIds]);

  const toggleSelectAll = () => {
    if (!drafts) return;
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(drafts.map((d) => d.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirmDelete = async () => {
    if (!confirmIds || confirmIds.length === 0) return;
    setDeleting(true);
    try {
      const client = getSupabaseBrowserClient();
      // The is_published=false filter is a belt-and-suspenders guard against
      // deleting a row that got published in another tab between list-load
      // and delete-click.
      const { error, data } = await client
        .from("restaurants")
        .delete()
        .in("id", confirmIds)
        .eq("is_published", false)
        .select("id");
      if (error) {
        toast.error(`Couldn't delete: ${error.message}`);
        return;
      }
      const deletedCount = data?.length ?? 0;
      toast.success(
        deletedCount === 1
          ? "Draft deleted."
          : `${deletedCount} drafts deleted.`,
      );
      setSelectedIds(new Set());
      setConfirmIds(null);
      await fetchDrafts();
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-base">
        <div className="mx-auto max-w-3xl space-y-4 p-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  const isEmpty = !drafts || drafts.length === 0;

  return (
    <div className="min-h-screen bg-bg-base text-text-primary">
      <header className="border-b border-border bg-bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-text-muted hover:text-white"
            onClick={() => {
              // Prefer browser back if there's a history entry to return to;
              // otherwise fall back to /dashboard so the user isn't stranded.
              if (window.history.length > 1) {
                navigate(-1);
              } else {
                navigate("/dashboard");
              }
            }}
          >
            <ChevronLeft className="size-4" />
            Back
          </Button>
          <span className="text-sm font-bold tracking-[0.2em] text-gold">
            CENAIVA
          </span>
          <Button asChild size="sm" className="gap-1.5">
            <Link to="/setup?new=1">
              <Plus className="size-4" />
              <span className="hidden sm:inline">Start a new restaurant</span>
              <span className="sm:hidden">New</span>
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6">
          <h1 className="text-2xl font-bold sm:text-3xl">
            Your unfinished restaurants
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Pick up where you left off, or clear out drafts you don't need.
          </p>
        </div>

        {isEmpty ? (
          <Card className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-base text-text-secondary">No drafts yet.</p>
            <Button asChild className="gap-1.5">
              <Link to="/setup?new=1">
                <Plus className="size-4" />
                Start a new restaurant
              </Link>
            </Button>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Bulk-action bar */}
            <div className="flex items-center justify-between rounded-xl border border-border bg-bg-surface/60 px-4 py-3">
              <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all drafts"
                />
                <span className="text-text-secondary">
                  {selectedIds.size === 0
                    ? `${drafts!.length} draft${drafts!.length === 1 ? "" : "s"}`
                    : `${selectedIds.size} selected`}
                </span>
              </label>
              {selectedIds.size > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-danger/40 text-danger hover:bg-danger/10"
                  onClick={() => setConfirmIds(Array.from(selectedIds))}
                >
                  <Trash2 className="size-4" />
                  Delete {selectedIds.size}
                </Button>
              ) : null}
            </div>

            {drafts!.map((draft) => {
              const step = computeDraftStep({
                hours_json: draft.hours_json,
                cover_photo_url: draft.cover_photo_url,
                deposit_tiers: draft.deposit_tiers,
                hasTables: draft.hasTables,
                hasShift: draft.hasShift,
                tierItemCount: draft.tierItemCount,
              });
              const location = [draft.city, draft.province]
                .filter(Boolean)
                .join(", ");
              const isSelected = selectedIds.has(draft.id);
              return (
                <Card
                  key={draft.id}
                  className={`!flex-row items-center gap-4 px-4 py-3 transition-colors ${
                    isSelected ? "border-gold/50 bg-gold/5" : ""
                  }`}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleSelect(draft.id)}
                    aria-label={`Select ${draft.name}`}
                  />
                  <button
                    type="button"
                    onClick={() => navigate(`/setup?restaurant_id=${draft.id}`)}
                    className="flex flex-1 flex-col items-start gap-1 text-left"
                  >
                    <div className="text-base font-semibold">{draft.name}</div>
                    <div className="text-xs text-text-muted">
                      <span className="font-medium text-gold">
                        Draft · Step {step} of {WIZARD_TOTAL_STEPS}
                      </span>
                      {location ? <> · {location}</> : null}
                      <> · Updated {formatRelativeTime(draft.created_at)}</>
                    </div>
                  </button>
                  <Button
                    asChild
                    size="sm"
                    className="gap-1.5"
                  >
                    <Link to={`/setup?restaurant_id=${draft.id}`}>
                      Continue
                      <ArrowRight className="size-3.5" />
                    </Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-text-muted hover:text-danger"
                    onClick={() => setConfirmIds([draft.id])}
                    aria-label={`Delete ${draft.name}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      <Dialog
        open={confirmIds !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmIds(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {confirmIds?.length === 1 ? "this draft" : `${confirmIds?.length ?? 0} drafts`}?
            </DialogTitle>
            <DialogDescription>
              This permanently removes the draft restaurant
              {confirmIds && confirmIds.length > 1 ? "s" : ""} and any
              setup progress (tables, menu, hours). This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmIds(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void confirmDelete()}
              disabled={deleting}
              className="bg-danger text-white hover:bg-danger/90"
            >
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
