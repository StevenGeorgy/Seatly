import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/layout/PageHeader";

type GuestProfile = {
  id: string;
  name: string;
  vip: boolean;
  phone: string;
  email?: string;
  partyCount: number;
  lastVisitLabel: string;
  allergies: string[];
  notes: string;
};

const GUESTS: GuestProfile[] = [
  {
    id: "g-1",
    name: "Smith",
    vip: true,
    phone: "(555) 010-1220",
    partyCount: 12,
    lastVisitLabel: "2 days ago",
    allergies: ["Nuts", "Milk"],
    notes: "Prefers window seating. Loves spicy margaritas.",
  },
  {
    id: "g-2",
    name: "Riley",
    vip: false,
    phone: "(555) 010-3301",
    partyCount: 4,
    lastVisitLabel: "3 weeks ago",
    allergies: ["Gluten"],
    notes: "Orders the same appetizer every time.",
  },
  {
    id: "g-3",
    name: "Lee",
    vip: false,
    phone: "(555) 010-8840",
    partyCount: 7,
    lastVisitLabel: "11 months ago",
    allergies: ["Egg"],
    notes: "Celebrates birthdays often. Requests low-noise tables.",
  },
];

export default function CrmPage({
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

  if (loading) {
    return (
      <div>
        <PageHeader title="Guest CRM" />
        <LoadingState />
      </div>
    );
  }

  if (empty || GUESTS.length === 0) {
    return (
      <div>
        <PageHeader title="Guest CRM" />
        <EmptyState
          title="No guests found"
          message="Search for a guest by name or phone during service."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Guest CRM" />
        <div className="flex flex-col items-center justify-center rounded-lg border border-error bg-error-muted p-xl text-center">
          <p className="text-base font-medium text-error">
            Something went wrong. Please try again.
          </p>
          <Link
            href="/crm?state=loading"
            className="mt-lg rounded-md bg-error px-lg py-sm text-sm font-medium text-text-on-gold hover:opacity-90"
          >
            Retry
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Guest CRM" />

      <div className="grid grid-cols-12 gap-lg">
        <section className="col-span-12 app-card-elevated p-xl">
          <div className="mb-lg flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Search & filter
              </p>
              <p className="mt-xs text-sm text-text-muted-on-dark">
                Mock searchable CRM. Use this screen during service to find guest
                history and allergies.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-md">
              <div className="rounded-md border border-border-card bg-surface-dark px-md py-sm text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                VIP
              </div>
              <div className="rounded-md border border-border-card bg-surface-dark px-md py-sm text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Allergies
              </div>
              <div className="rounded-md border border-border-card bg-surface-dark px-md py-sm text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Recent
              </div>
            </div>
          </div>

          <div className="mb-lg">
            <label className="text-xs uppercase tracking-widest text-gold">
              Search by name or phone
            </label>
            <div className="mt-xs flex items-center gap-md">
              <input
                className="w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark focus:border-gold focus:ring-1 focus:ring-gold"
                placeholder="e.g., Smith or (555)…"
                defaultValue=""
              />
              <Link
                href="/guests/search"
                className="rounded-md border border-gold px-lg py-sm text-sm font-semibold text-gold hover:bg-gold/10 hover:scale-[1.02] transition-transform duration-400"
              >
                Advanced search
              </Link>
            </div>
          </div>

          <div className="space-y-md">
            {GUESTS.map((g) => (
              <article
                key={g.id}
                className="app-card p-xl"
              >
                <div className="flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-md">
                      <p className="text-lg font-semibold text-text-on-dark">
                        {g.name}
                      </p>
                      {g.vip ? (
                        <div className="rounded-full border border-gold px-sm py-xs">
                          <span className="text-xs font-medium uppercase tracking-widest text-gold">
                            VIP
                          </span>
                        </div>
                      ) : null}
                    </div>
                    <p className="mt-xs text-sm text-text-muted-on-dark">
                      {g.phone} · {g.partyCount} parties · Last visit {g.lastVisitLabel}
                    </p>
                  </div>

                  <div className="flex flex-col gap-md sm:items-end">
                    <Link
                      href={`/crm/${g.id}`}
                      className="rounded-md bg-gold px-lg py-md text-sm font-semibold text-text-on-gold hover:scale-[1.02] transition-transform duration-400"
                    >
                      View profile
                    </Link>
                  </div>
                </div>

                {g.allergies.length > 0 ? (
                  <div className="mt-md flex flex-wrap gap-sm">
                    {g.allergies.map((a) => (
                      <div
                        key={a}
                        className="rounded-md border-l-4 border-error bg-error-muted px-sm py-xs text-xs font-medium text-error"
                      >
                        {a}
                      </div>
                    ))}
                  </div>
                ) : null}

                <p className="mt-md text-sm text-text-muted-on-dark">{g.notes}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
