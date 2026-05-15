import { Fragment } from "react";
import { Check } from "lucide-react";

export type Phase = {
  label: string;
};

type PhaseStepperProps = {
  phases: Phase[];
  currentPhase: number;
};

/**
 * 4-phase visual stepper for the restaurant onboarding wizard. Mirrors the
 * diner-side StepBar pattern from RestaurantPublicPage. Renders numbered
 * circles + labels + horizontal connectors. Active phase: gold border with
 * light gold fill. Past phases: solid gold with check icon. Future: grey.
 */
export function PhaseStepper({ phases, currentPhase }: PhaseStepperProps) {
  const idx = Math.max(0, Math.min(phases.length - 1, currentPhase - 1));
  return (
    <div className="flex w-full items-center">
      {phases.map((phase, i) => {
        const done = i < idx;
        const active = i === idx;
        const circle = (
          <div
            className={`flex size-8 items-center justify-center rounded-full border-2 text-sm font-bold transition-all ${
              done
                ? "border-gold bg-gold text-bg-base"
                : active
                  ? "border-gold bg-gold/15 text-gold"
                  : "border-border bg-bg-elevated text-text-muted"
            }`}
          >
            {done ? <Check className="size-4" /> : i + 1}
          </div>
        );
        const caption = (
          <span
            className={`text-[11px] font-semibold uppercase tracking-wider ${
              active ? "text-gold" : done ? "text-text-secondary" : "text-text-muted"
            }`}
          >
            {phase.label}
          </span>
        );
        return (
          <Fragment key={phase.label}>
            <div className="flex flex-col items-center gap-1">
              {circle}
              {caption}
            </div>
            {i < phases.length - 1 && (
              <div
                className={`mb-4 h-px flex-1 mx-2 transition-colors ${
                  i < idx ? "bg-gold" : "bg-border"
                }`}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

export const WIZARD_PHASES: Phase[] = [
  { label: "Details" },
  { label: "Setup" },
  { label: "Content" },
  { label: "Payment" },
];

/**
 * Map an 8-step wizard step number to a 4-phase index (1-based).
 *   Steps 1-2 → Phase 1 (Details: Basics + Hours)
 *   Steps 3-4 → Phase 2 (Setup: Floor plan + Booking rules)
 *   Steps 5-6 → Phase 3 (Content: Menu + Photos)
 *   Steps 7-8 → Phase 4 (Payment: Deposit + Payment)
 */
export function stepToPhase(step: number): number {
  return Math.min(WIZARD_PHASES.length, Math.max(1, Math.ceil(step / 2)));
}
