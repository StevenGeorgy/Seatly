import { type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Eye, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type WizardShellProps = {
  currentStep: number;
  totalSteps: number;
  restaurantId: string | null;
  children: ReactNode;
  onBack: () => void;
  onNext: () => void;
  onSaveAndExit: () => void;
  onPreviewClick?: () => void;
  canGoNext: boolean;
  nextLabel?: string;
  busy?: boolean;
};

export function WizardShell({
  currentStep,
  totalSteps,
  restaurantId,
  children,
  onBack,
  onNext,
  onSaveAndExit,
  onPreviewClick,
  canGoNext,
  nextLabel,
  busy,
}: WizardShellProps) {
  const progressPct = Math.min(100, Math.round((currentStep / totalSteps) * 100));
  const isFirstStep = currentStep <= 1;
  const previewEnabled = Boolean(restaurantId) && Boolean(onPreviewClick);

  return (
    <div className="flex min-h-screen flex-col bg-bg-base text-text-primary">
      <header className="border-b border-border bg-bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <span className="text-sm font-bold tracking-[0.2em] text-gold">CENAIVA</span>
          <span className="rounded-full border border-border bg-bg-elevated px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
            Step {currentStep} of {totalSteps}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={!previewEnabled}
            onClick={onPreviewClick}
          >
            <Eye className="size-3.5" />
            <span className="hidden sm:inline">Preview as diner</span>
            <span className="sm:hidden">Preview</span>
          </Button>
        </div>
        <div className="h-1 w-full bg-bg-elevated">
          <div
            className="h-full bg-gold transition-all duration-300 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        {children}
      </main>

      <footer className="sticky bottom-0 border-t border-border bg-bg-surface/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-2 px-4 py-3 sm:px-6 sm:py-4">
          <Button
            type="button"
            variant="ghost"
            onClick={onBack}
            disabled={isFirstStep || busy}
            className="gap-1.5"
          >
            <ArrowLeft className="size-4" />
            <span className="hidden sm:inline">Back</span>
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onSaveAndExit}
              disabled={busy}
              className="gap-1.5 text-text-muted hover:text-white"
            >
              <Save className="size-3.5" />
              <span className="hidden sm:inline">Save &amp; exit</span>
              <span className="sm:hidden">Exit</span>
            </Button>
            <Button
              type="button"
              onClick={onNext}
              disabled={!canGoNext || busy}
              className={cn("gap-1.5 px-4 sm:px-6", busy && "opacity-70")}
            >
              {busy ? "Saving…" : nextLabel ?? "Next"}
              {!busy ? <ArrowRight className="size-4" /> : null}
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}
