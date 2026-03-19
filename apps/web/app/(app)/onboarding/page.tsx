import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/layout/PageHeader";

type WizardStep = {
  key: number;
  label: string;
  title: string;
};

const STEPS: WizardStep[] = [
  { key: 1, label: "Details", title: "Restaurant details" },
  { key: 2, label: "Hours", title: "Booking hours & window" },
  { key: 3, label: "Floor plan", title: "Set up your floor plan" },
  { key: 4, label: "Shifts", title: "Create service periods" },
  { key: 5, label: "Menu", title: "Add menu categories & items" },
  { key: 6, label: "Staff", title: "Invite and assign staff roles" },
  { key: 7, label: "Done", title: "Finish onboarding" },
];

const stepTitleDescription = (stepKey: number) => {
  switch (stepKey) {
    case 1:
      return "Capture your restaurant profile so guests know what to expect.";
    case 2:
      return "Configure booking hours and minimum notice times.";
    case 3:
      return "Add tables, sections, and capacity so seating can happen in real time.";
    case 4:
      return "Define service periods and slot durations for reservations.";
    case 5:
      return "Create categories and dishes so orders can be taken.";
    case 6:
      return "Set up staff accounts and assign the correct roles.";
    case 7:
      return "Review everything and enable live reservations.";
    default:
      return "Complete onboarding step-by-step.";
  }
};

export default function OnboardingPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const stateParam = searchParams.state;
  const state =
    typeof stateParam === "string"
      ? stateParam
      : Array.isArray(stateParam)
        ? stateParam[0]
        : undefined;

  const loading = state === "loading";
  const empty = state === "empty";
  const error = state === "error";

  const stepParam = searchParams.step;
  const stepKeyRaw =
    typeof stepParam === "string"
      ? Number(stepParam)
      : Array.isArray(stepParam)
        ? Number(stepParam[0])
        : 1;

  const stepKey = Number.isFinite(stepKeyRaw) && stepKeyRaw >= 1 ? stepKeyRaw : 1;
  const step = STEPS.find((s) => s.key === stepKey) ?? STEPS[0];

  if (loading) {
    return (
      <div>
        <PageHeader title="Restaurant Onboarding Wizard" />
        <LoadingState />
      </div>
    );
  }

  if (empty) {
    return (
      <div>
        <PageHeader title="Restaurant Onboarding Wizard" />
        <EmptyState
          title="Onboarding not available"
          message="Create a restaurant account first."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Restaurant Onboarding Wizard" />
        <div className="flex flex-col items-center justify-center rounded-lg border border-error bg-error-muted p-xl text-center">
          <p className="text-base font-medium text-error">
            Something went wrong. Please try again.
          </p>
          <Link
            href="/onboarding?state=loading"
            className="mt-lg rounded-md bg-error px-lg py-sm text-sm font-medium text-text-on-gold hover:opacity-90"
          >
            Retry
          </Link>
        </div>
      </div>
    );
  }

  const nextStep = STEPS.find((s) => s.key === step.key + 1) ?? STEPS[STEPS.length - 1];

  return (
    <div>
      <PageHeader title="Restaurant Onboarding Wizard" />

      <div className="grid grid-cols-12 gap-lg">
        <section className="col-span-12 lg:col-span-4 rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
          <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
            Steps
          </p>
          <div className="mt-md space-y-md">
            {STEPS.map((s) => {
              const isActive = s.key === step.key;
              const isDone = s.key < step.key;
              return (
                <div
                  key={s.key}
                  className={`rounded-lg border px-md py-sm ${
                    isActive
                      ? "border-gold bg-gold/10"
                      : isDone
                        ? "border-success/30 bg-success/10"
                        : "border-border-card bg-surface-dark"
                  }`}
                >
                  <div className="flex items-center justify-between gap-md">
                    <p className="text-xs uppercase tracking-widest text-text-muted-on-dark">
                      Step {s.key}
                    </p>
                    <div className="rounded-full border border-border-dark bg-surface-dark-elevated px-sm py-xs">
                      <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                        {s.label}
                      </p>
                    </div>
                  </div>
                  <p className={`mt-xs text-sm font-semibold ${isActive ? "text-gold" : "text-text-on-dark"}`}>
                    {s.title}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="col-span-12 lg:col-span-8 rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
          <div className="mb-lg flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                {step.label}
              </p>
              <p className="mt-xs text-2xl font-bold text-text-on-dark">
                {step.title}
              </p>
              <p className="mt-xs text-sm text-text-muted-on-dark">
                {stepTitleDescription(step.key)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-md">
              <div className="rounded-md border border-border-card bg-surface-dark px-md py-sm text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Mock wizard
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border-card bg-surface-dark p-xl">
            {step.key === 1 ? (
              <div className="space-y-md">
                <div className="grid grid-cols-12 gap-md">
                  <div className="col-span-12 sm:col-span-6">
                    <label className="text-xs uppercase tracking-widest text-gold">
                      Restaurant name
                    </label>
                    <input
                      disabled
                      defaultValue="Seatly Test Kitchen"
                      className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark opacity-70"
                    />
                  </div>
                  <div className="col-span-12 sm:col-span-6">
                    <label className="text-xs uppercase tracking-widest text-gold">
                      Cuisine type
                    </label>
                    <select
                      disabled
                      defaultValue="Japanese"
                      className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark opacity-70"
                    >
                      <option value="Japanese">Japanese</option>
                      <option value="Italian">Italian</option>
                      <option value="American">American</option>
                    </select>
                  </div>
                  <div className="col-span-12">
                    <label className="text-xs uppercase tracking-widest text-gold">
                      Description
                    </label>
                    <textarea
                      disabled
                      rows={4}
                      defaultValue="Premium, allergy-aware dining built for fast service."
                      className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark opacity-70"
                    />
                  </div>
                </div>
              </div>
            ) : null}

            {step.key === 2 ? (
              <div className="space-y-md">
                <div className="grid grid-cols-12 gap-md">
                  <div className="col-span-12 sm:col-span-6">
                    <label className="text-xs uppercase tracking-widest text-gold">
                      Advance reservations
                    </label>
                    <input
                      disabled
                      defaultValue="14 days"
                      className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark opacity-70"
                    />
                  </div>
                  <div className="col-span-12 sm:col-span-6">
                    <label className="text-xs uppercase tracking-widest text-gold">
                      Minimum notice
                    </label>
                    <input
                      disabled
                      defaultValue="30 minutes"
                      className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark opacity-70"
                    />
                  </div>
                  <div className="col-span-12">
                    <div className="rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
                      <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                        Hours preview (mock)
                      </p>
                      <p className="mt-xs text-sm text-text-muted-on-dark">
                        Mon–Thu 5–10, Fri–Sun 4–11. Hours editor comes later.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {step.key === 3 ? (
              <div className="space-y-md">
                <div className="rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
                  <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                    Floor plan setup (mock)
                  </p>
                  <p className="mt-xs text-sm text-text-muted-on-dark">
                    Add tables, sections, and capacity in the Floor Plan editor.
                  </p>
                  <Link
                    href="/settings/floor-plan?state=ready"
                    className="mt-md inline-flex rounded-md border border-gold px-lg py-md text-sm font-semibold text-gold hover:bg-gold/10 hover:scale-[1.02] transition-transform duration-400"
                  >
                    Open floor plan editor
                  </Link>
                </div>
              </div>
            ) : null}

            {step.key === 4 ? (
              <div className="space-y-md">
                <div className="rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
                  <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                    Service periods (mock)
                  </p>
                  <p className="mt-xs text-sm text-text-muted-on-dark">
                    Define shift windows and blackout dates in Shift Management.
                  </p>
                  <Link
                    href="/settings/shifts?state=ready"
                    className="mt-md inline-flex rounded-md border border-gold px-lg py-md text-sm font-semibold text-gold hover:bg-gold/10 hover:scale-[1.02] transition-transform duration-400"
                  >
                    Configure shifts
                  </Link>
                </div>
              </div>
            ) : null}

            {step.key === 5 ? (
              <div className="space-y-md">
                <div className="rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
                  <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                    Menu setup (mock)
                  </p>
                  <p className="mt-xs text-sm text-text-muted-on-dark">
                    Add categories and dishes so ordering can start.
                  </p>
                  <Link
                    href="/menu?state=ready"
                    className="mt-md inline-flex rounded-md border border-gold px-lg py-md text-sm font-semibold text-gold hover:bg-gold/10 hover:scale-[1.02] transition-transform duration-400"
                  >
                    Open menu management
                  </Link>
                </div>
              </div>
            ) : null}

            {step.key === 6 ? (
              <div className="space-y-md">
                <div className="rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
                  <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                    Staff setup (mock)
                  </p>
                  <p className="mt-xs text-sm text-text-muted-on-dark">
                    Invite staff and assign roles for service.
                  </p>
                  <Link
                    href="/settings/staff?state=ready"
                    className="mt-md inline-flex rounded-md border border-gold px-lg py-md text-sm font-semibold text-gold hover:bg-gold/10 hover:scale-[1.02] transition-transform duration-400"
                  >
                    Open staff management
                  </Link>
                </div>
              </div>
            ) : null}

            {step.key === 7 ? (
              <div className="space-y-md">
                <div className="rounded-lg border border-border-card bg-surface-dark p-xl">
                  <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                    Ready to go live
                  </p>
                  <p className="mt-xs text-sm text-text-muted-on-dark">
                    Enable live reservations after you confirm everything looks correct.
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-lg flex flex-col gap-md sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-text-muted-on-dark">
              Step {step.key} of {STEPS.length}
            </div>
            <Link
              href={`/onboarding?state=ready&step=${nextStep.key}`}
              className="rounded-md bg-gold px-lg py-md text-sm font-semibold text-text-on-gold hover:bg-gold-muted hover:scale-[1.02] transition-transform duration-400"
            >
              Continue (mock)
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
