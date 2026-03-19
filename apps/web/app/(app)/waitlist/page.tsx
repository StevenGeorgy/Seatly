import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/layout/PageHeader";
import { PAGE_HEADERS } from "@/lib/page-headers";

type WaitlistGuest = {
  id: string;
  name: string;
  partySize: number;
  addedLabel: string;
  allergies: string[];
  vip: boolean;
};

const WAITLIST_GUESTS: WaitlistGuest[] = [
  {
    id: "w-1",
    name: "Taylor",
    partySize: 3,
    addedLabel: "Added 6m ago",
    allergies: ["Nuts"],
    vip: false,
  },
  {
    id: "w-2",
    name: "Morgan",
    partySize: 2,
    addedLabel: "Added 11m ago",
    allergies: [],
    vip: true,
  },
  {
    id: "w-3",
    name: "Patel",
    partySize: 5,
    addedLabel: "Added 18m ago",
    allergies: ["Shellfish"],
    vip: false,
  },
];

export default function WaitlistPage({
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
        <PageHeader {...PAGE_HEADERS.waitlist} />
        <LoadingState />
      </div>
    );
  }

  if (empty || WAITLIST_GUESTS.length === 0) {
    return (
      <div>
        <PageHeader {...PAGE_HEADERS.waitlist} />
        <EmptyState
          title="Waitlist is clear"
          message="Walk-ins will appear here when they join."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader {...PAGE_HEADERS.waitlist} />
        <div className="flex flex-col items-center justify-center rounded-lg border border-error bg-error-muted p-xl text-center">
          <p className="text-base font-medium text-error">
            Something went wrong. Please try again.
          </p>
          <Link
            href="/waitlist?state=loading"
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
      <PageHeader {...PAGE_HEADERS.waitlist} />

      <div className="grid grid-cols-12 gap-lg">
        <section className="col-span-12 app-card-elevated p-xl">
          <div className="mb-lg flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Live queue
              </p>
              <p className="mt-xs text-sm text-text-muted-on-dark">
                Seat walk-in guests as tables open up. (Mock UI)
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-md">
              <Link
                href="/waitlist?filter=all"
                className="rounded-md border border-border-card bg-surface-dark px-md py-sm text-xs font-medium uppercase tracking-widest text-text-muted-on-dark hover:bg-gold/5 hover:text-text-on-dark"
              >
                All
              </Link>
              <Link
                href="/waitlist?filter=vip"
                className="rounded-md border border-border-card bg-surface-dark px-md py-sm text-xs font-medium uppercase tracking-widest text-text-muted-on-dark hover:bg-gold/5 hover:text-text-on-dark"
              >
                VIP
              </Link>
              <Link
                href="/waitlist?filter=allergies"
                className="rounded-md border border-border-card bg-surface-dark px-md py-sm text-xs font-medium uppercase tracking-widest text-text-muted-on-dark hover:bg-gold/5 hover:text-text-on-dark"
              >
                Allergies
              </Link>
            </div>
          </div>

          <div className="space-y-md">
            {WAITLIST_GUESTS.map((g) => (
              <div
                key={g.id}
                className="app-card p-xl"
              >
                <div className="flex flex-col gap-md sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-md">
                      <p className="text-lg font-semibold text-text-on-dark">
                        {g.name}
                      </p>
                      <p className="text-sm text-text-muted-on-dark">
                        Party of {g.partySize}
                      </p>
                    </div>
                    <p className="mt-xs text-sm text-text-muted-on-dark">
                      {g.addedLabel}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-md">
                    {g.vip ? (
                      <div className="rounded-full border border-gold px-sm py-xs">
                        <span className="text-xs font-medium uppercase tracking-widest text-gold">
                          VIP
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>

                {g.allergies.length > 0 ? (
                  <div className="mt-md flex flex-wrap gap-sm">
                    {g.allergies.map((a) => (
                      <div
                        key={a}
                        className="rounded-md border-l-4 border-error bg-error-muted px-sm py-xs text-xs font-medium text-error"
                      >
                        {a} allergy
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-md rounded-md border border-border-card bg-surface-dark p-md text-sm text-text-muted-on-dark">
                    No allergies flagged
                  </div>
                )}

                <div className="mt-md flex flex-col gap-md sm:flex-row sm:items-center sm:justify-end">
                  <button
                    type="button"
                    disabled
                    className="rounded-md bg-gold/10 px-lg py-md text-sm font-semibold text-text-on-gold opacity-70"
                  >
                    Seat now (coming soon)
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
