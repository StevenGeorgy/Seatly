import { useState } from "react";
import { ChefHat, PencilLine, Tag, PartyPopper, Sparkles, RefreshCw, X, ChevronDown, ChevronUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMenuSuggestions, type SuggestionRow, type SuggestionType } from "@/hooks/useMenuSuggestions";
import { cn } from "@/lib/utils";

import { SuggestionPreviewDialog } from "./SuggestionPreviewDialog";

const TYPE_META: Record<SuggestionType, { label: string; icon: typeof ChefHat; color: string; badgeClass: string }> = {
  menu_item: {
    label: "New Menu Item",
    icon: ChefHat,
    color: "text-emerald-400",
    badgeClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  },
  menu_item_update: {
    label: "Menu Edit",
    icon: PencilLine,
    color: "text-blue-400",
    badgeClass: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  },
  promotion: {
    label: "Promotion",
    icon: Tag,
    color: "text-amber-400",
    badgeClass: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  },
  event: {
    label: "Event",
    icon: PartyPopper,
    color: "text-purple-400",
    badgeClass: "border-purple-500/30 bg-purple-500/10 text-purple-400",
  },
};

function SuggestionCard({
  suggestion,
  onDismiss,
  onPreview,
}: {
  suggestion: SuggestionRow;
  onDismiss: () => void;
  onPreview: () => void;
}) {
  const [rationale, setRationale] = useState(false);
  const meta = TYPE_META[suggestion.suggestion_type] ?? TYPE_META.menu_item;
  const Icon = meta.icon;

  const diffFields = suggestion.suggestion_type === "menu_item_update"
    ? Object.entries(suggestion.payload).filter(([k]) => k !== "id")
    : [];

  return (
    <Card className="relative border-border/70 bg-bg-elevated/40 transition-colors hover:border-gold/25">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <div className={cn("mt-0.5 shrink-0", meta.color)}>
            <Icon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide", meta.badgeClass)}>
                {meta.label}
              </Badge>
            </div>
            <p className="text-sm font-semibold leading-snug text-text-primary">{suggestion.title}</p>
            {suggestion.summary ? (
              <p className="mt-0.5 text-xs text-text-muted">{suggestion.summary}</p>
            ) : null}

            {/* Diff preview for menu_item_update */}
            {diffFields.length > 0 ? (
              <div className="mt-2 flex flex-col gap-1">
                {diffFields.map(([key, val]) => (
                  <div key={key} className="flex items-center gap-1 rounded-md bg-bg-surface/60 px-2 py-1 text-[11px]">
                    <span className="font-medium capitalize text-text-muted">{key.replace(/_/g, " ")}:</span>
                    <span className="font-semibold text-gold">{String(val)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 rounded p-0.5 text-text-muted transition-colors hover:text-text-primary"
            aria-label="Dismiss suggestion"
          >
            <X className="size-3.5" />
          </button>
        </div>

        {suggestion.rationale ? (
          <div>
            <button
              type="button"
              className="flex items-center gap-1 text-[11px] font-medium text-text-muted transition-colors hover:text-text-secondary"
              onClick={() => setRationale((v) => !v)}
            >
              {rationale ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              Why this?
            </button>
            {rationale ? (
              <p className="mt-1.5 text-[11px] leading-relaxed text-text-secondary">{suggestion.rationale}</p>
            ) : null}
          </div>
        ) : null}

        <Button
          variant="outline"
          size="sm"
          className="mt-1 h-8 w-full gap-1.5 border-gold/30 text-xs text-gold hover:bg-gold/[0.07]"
          onClick={onPreview}
        >
          Preview &amp; Apply
        </Button>
      </CardContent>
    </Card>
  );
}

type Props = { onClose: () => void };

export function MenuSuggestionsPanel({ onClose }: Props) {
  const { suggestions, loading, generating, generate, dismiss } = useMenuSuggestions();
  const [previewTarget, setPreviewTarget] = useState<SuggestionRow | null>(null);

  return (
    <div className="mb-6 rounded-lg border border-border bg-bg-surface p-5">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="size-4 text-gold" />
        <span className="text-sm font-semibold text-text-primary">AI Suggestions</span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 border-gold/30 px-3 text-xs text-gold hover:bg-gold/[0.07]"
            disabled={generating}
            onClick={() => void generate()}
          >
            <RefreshCw className={cn("size-3", generating && "animate-spin")} />
            {generating ? "Generating…" : suggestions.length > 0 ? "Refresh" : "Generate"}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* Body */}
      {generating ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-lg" />
          ))}
        </div>
      ) : suggestions.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <Sparkles className="size-8 text-gold/40" />
          <p className="text-sm font-medium text-text-secondary">No suggestions yet</p>
          <p className="max-w-xs text-xs text-text-muted">
            Generate AI suggestions based on your menu, upcoming holidays, and guest patterns.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-1 gap-1.5 border-gold/30 text-xs text-gold hover:bg-gold/[0.07]"
            disabled={generating}
            onClick={() => void generate()}
          >
            <Sparkles className="size-3" />
            Generate suggestions
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {suggestions.map((s) => (
            <SuggestionCard
              key={s.id}
              suggestion={s}
              onDismiss={() => void dismiss(s.id)}
              onPreview={() => setPreviewTarget(s)}
            />
          ))}
        </div>
      )}

      <SuggestionPreviewDialog
        open={previewTarget !== null}
        suggestion={previewTarget}
        onOpenChange={(o) => { if (!o) setPreviewTarget(null); }}
      />
    </div>
  );
}
