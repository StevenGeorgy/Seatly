import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/layout/PageHeader";

type GuestProfile = {
  id: string;
  name: string;
  vip: boolean;
  phone: string;
  lastVisitLabel: string;
  allergies: string[];
  preferences: {
    seating: string;
    noise: string;
    occasion: string;
  };
  notes: string;
  stats: {
    parties: number;
    avgSpendLabel: string;
    loyaltyTier: string;
  };
};

const GUESTS: Record<string, GuestProfile> = {
  "g-1": {
    id: "g-1",
    name: "Smith",
    vip: true,
    phone: "(555) 010-1220",
    lastVisitLabel: "2 days ago",
    allergies: ["Nuts", "Milk"],
    preferences: {
      seating: "Window",
      noise: "Low",
      occasion: "Anniversary",
    },
    notes: "Prefers spicy margaritas and warm lighting.",
    stats: {
      parties: 12,
      avgSpendLabel: "$86 avg",
      loyaltyTier: "Gold",
    },
  },
  "g-2": {
    id: "g-2",
    name: "Riley",
    vip: false,
    phone: "(555) 010-3301",
    lastVisitLabel: "3 weeks ago",
    allergies: ["Gluten"],
    preferences: {
      seating: "Booth",
      noise: "Balanced",
      occasion: "Date night",
    },
    notes: "Orders the same appetizer each visit.",
    stats: {
      parties: 4,
      avgSpendLabel: "$62 avg",
      loyaltyTier: "Silver",
    },
  },
  "g-3": {
    id: "g-3",
    name: "Lee",
    vip: false,
    phone: "(555) 010-8840",
    lastVisitLabel: "11 months ago",
    allergies: ["Egg"],
    preferences: {
      seating: "Center",
      noise: "Low",
      occasion: "Birthday",
    },
    notes: "Often celebrates with large groups.",
    stats: {
      parties: 7,
      avgSpendLabel: "$74 avg",
      loyaltyTier: "Silver",
    },
  },
};

const VISITS_BY_GUEST: Record<
  string,
  { label: string; notes: string; riskLabel: string }[]
> = {
  "g-1": [
    { label: "Mar 18", notes: "Requested window + low noise.", riskLabel: "No-show risk: low" },
    { label: "Feb 12", notes: "Spicy margaritas, extra salsa.", riskLabel: "No-show risk: medium" },
    { label: "Jan 06", notes: "Allergy check completed.", riskLabel: "No-show risk: low" },
    { label: "Dec 02", notes: "Anniversary seating confirmed.", riskLabel: "No-show risk: low" },
  ],
  "g-2": [
    { label: "Feb 24", notes: "Gluten-free confirmation.", riskLabel: "No-show risk: low" },
    { label: "Jan 29", notes: "Booth seating, balanced noise.", riskLabel: "No-show risk: medium" },
  ],
  "g-3": [
    { label: "Apr 04", notes: "Egg-free dessert options.", riskLabel: "No-show risk: high" },
    { label: "Sep 19", notes: "Birthday celebration, low noise.", riskLabel: "No-show risk: low" },
  ],
};

export default function GuestProfilePage({
  params,
  searchParams,
}: {
  params: { guest_id: string };
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

  const guest = GUESTS[params.guest_id];

  if (loading) {
    return (
      <div>
        <PageHeader title="Guest Profile" />
        <LoadingState />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Guest Profile" />
        <div className="flex flex-col items-center justify-center rounded-lg border border-error bg-error-muted p-xl text-center">
          <p className="text-base font-medium text-error">
            Something went wrong. Please try again.
          </p>
          <Link
            href={`/crm/${params.guest_id}?state=loading`}
            className="mt-lg rounded-md bg-error px-lg py-sm text-sm font-medium text-text-on-gold hover:opacity-90"
          >
            Retry
          </Link>
        </div>
      </div>
    );
  }

  if (empty || !guest) {
    return (
      <div>
        <PageHeader title="Guest Profile" />
        <EmptyState
          title="Guest not found"
          message="This guest profile may not exist in the restaurant database yet."
        />
      </div>
    );
  }

  const visits = VISITS_BY_GUEST[guest.id] ?? [];

  return (
    <div>
      <PageHeader title="Guest Profile" />

      <div className="grid grid-cols-12 gap-lg">
        <section className="col-span-12 rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
          <div className="flex flex-col gap-lg sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-md">
                <p className="text-2xl font-bold text-text-on-dark">
                  {guest.name}
                </p>
                {guest.vip ? (
                  <div className="rounded-full border border-gold px-sm py-xs">
                    <span className="text-xs font-medium uppercase tracking-widest text-gold">
                      VIP
                    </span>
                  </div>
                ) : null}
              </div>
              <p className="mt-xs text-sm text-text-muted-on-dark">
                {guest.phone} · Last visit {guest.lastVisitLabel}
              </p>

              {guest.allergies.length > 0 ? (
                <div className="mt-md flex flex-wrap gap-sm">
                  {guest.allergies.map((a) => (
                    <div
                      key={a}
                      className="rounded-md border-l-4 border-error bg-error-muted px-sm py-xs text-xs font-medium text-error"
                    >
                      {a}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-md rounded-md border border-border-card bg-surface-dark p-md text-sm text-text-muted-on-dark">
                  No allergies flagged
                </div>
              )}
            </div>

            <div className="w-full sm:max-w-md">
              <div className="rounded-lg border border-border-card bg-surface-dark p-xl">
                <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                  Preferences
                </p>

                <div className="mt-md space-y-md">
                  <div className="flex items-center justify-between gap-md">
                    <span className="text-sm text-text-muted-on-dark">
                      Seating
                    </span>
                    <span className="text-sm font-medium text-text-on-dark">
                      {guest.preferences.seating}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-md">
                    <span className="text-sm text-text-muted-on-dark">
                      Noise
                    </span>
                    <span className="text-sm font-medium text-text-on-dark">
                      {guest.preferences.noise}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-md">
                    <span className="text-sm text-text-muted-on-dark">
                      Occasion
                    </span>
                    <span className="text-sm font-medium text-text-on-dark">
                      {guest.preferences.occasion}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-lg grid grid-cols-12 gap-lg">
            <div className="col-span-12 lg:col-span-7">
              <div className="rounded-lg border border-border-card bg-surface-dark p-xl">
                <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                  Visit timeline
                </p>
                {visits.length > 0 ? (
                  <div className="mt-md space-y-md">
                    {visits.map((v) => (
                      <div
                        key={v.label}
                        className="rounded-md border border-border-card bg-surface-dark-elevated p-md"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-md">
                          <p className="text-sm font-semibold text-text-on-dark">
                            {v.label}
                          </p>
                          <p className="text-xs uppercase tracking-widest text-gold">
                            {v.riskLabel}
                          </p>
                        </div>
                        <p className="mt-xs text-sm text-text-muted-on-dark">
                          {v.notes}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-md text-sm text-text-muted-on-dark">
                    No visit history yet.
                  </div>
                )}
              </div>
            </div>

            <div className="col-span-12 lg:col-span-5">
              <div className="rounded-lg border border-border-card bg-surface-dark p-xl">
                <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                  Loyalty & insights
                </p>

                <div className="mt-md space-y-md">
                  <div className="flex items-center justify-between gap-md">
                    <span className="text-sm text-text-muted-on-dark">
                      Loyalty tier
                    </span>
                    <span className="text-sm font-medium text-text-on-dark">
                      {guest.stats.loyaltyTier}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-md">
                    <span className="text-sm text-text-muted-on-dark">
                      Parties
                    </span>
                    <span className="text-sm font-medium text-text-on-dark">
                      {guest.stats.parties}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-md">
                    <span className="text-sm text-text-muted-on-dark">
                      Avg spend
                    </span>
                    <span className="text-sm font-medium text-text-on-dark">
                      {guest.stats.avgSpendLabel}
                    </span>
                  </div>

                  <div className="rounded-md border border-border-card bg-surface-dark-elevated p-md">
                    <p className="text-xs uppercase tracking-widest text-gold">
                      Notes
                    </p>
                    <p className="mt-xs text-sm text-text-muted-on-dark">
                      {guest.notes}
                    </p>
                  </div>
                </div>

                <div className="mt-lg">
                  <Link
                    href="/crm?state=loading"
                    className="rounded-md border border-gold px-lg py-md text-sm font-semibold text-gold hover:bg-gold/10 hover:scale-[1.02] transition-transform duration-400"
                  >
                    Back to CRM
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
