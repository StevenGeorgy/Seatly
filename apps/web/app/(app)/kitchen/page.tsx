import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/layout/PageHeader";

type TicketStatus = "new" | "preparing" | "ready" | "served";

type KitchenTicket = {
  id: string;
  tableLabel: string;
  guestName: string;
  course: string;
  notes?: string;
  allergies: string[];
  status: TicketStatus;
  mods?: string[];
};

const TICKETS: KitchenTicket[] = [
  {
    id: "kt-1",
    tableLabel: "Table 2",
    guestName: "Smith",
    course: "Appetizer",
    mods: ["No dairy sauce"],
    allergies: ["Nuts", "Milk"],
    status: "preparing",
    notes: "Hold 2 minutes for timing.",
  },
  {
    id: "kt-2",
    tableLabel: "Table 9",
    guestName: "Lee",
    course: "Main",
    mods: ["Extra lemon"],
    allergies: ["Egg"],
    status: "new",
  },
  {
    id: "kt-3",
    tableLabel: "Table 6",
    guestName: "Chen",
    course: "Dessert",
    mods: [],
    allergies: ["Shellfish"],
    status: "ready",
  },
];

function getTicketStatusPill(status: TicketStatus) {
  switch (status) {
    case "new":
      return "border-warning/50 bg-warning/10 text-warning";
    case "preparing":
      return "border-gold/50 bg-gold/10 text-gold";
    case "ready":
      return "border-success/50 bg-success/10 text-success";
    case "served":
      return "border-border-card bg-surface-dark-elevated text-text-muted-on-dark";
  }
}

export default function KitchenPage({
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
        <PageHeader title="Kitchen Display" />
        <LoadingState />
      </div>
    );
  }

  if (empty || TICKETS.length === 0) {
    return (
      <div>
        <PageHeader title="Kitchen Display" />
        <EmptyState
          title="No active tickets"
          message="Tickets will appear as new reservations place orders."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Kitchen Display" />
        <div className="flex flex-col items-center justify-center rounded-lg border border-error bg-error-muted p-xl text-center">
          <p className="text-base font-medium text-error">
            Something went wrong. Please try again.
          </p>
          <Link
            href="/kitchen?state=loading"
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
      <PageHeader title="Kitchen Display" />

      <div className="grid grid-cols-12 gap-lg">
        <section className="col-span-12 app-card-elevated p-xl">
          <div className="mb-lg flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Tickets
              </p>
              <p className="mt-xs text-sm text-text-muted-on-dark">
                Course breakdown + allergy flags for kitchen staff. (Mock UI)
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-md">
              {[
                ["new", "New"],
                ["preparing", "Preparing"],
                ["ready", "Ready"],
              ].map(([key, label]) => (
                <Link
                  key={key}
                  href={`/kitchen?filter=${key}`}
                  className="rounded-md border border-border-card bg-surface-dark px-md py-sm text-xs font-medium uppercase tracking-widest text-text-muted-on-dark hover:bg-gold/5 hover:text-text-on-dark"
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>

          <div className="space-y-md">
            {TICKETS.map((t) => (
              <article
                key={t.id}
                className="app-card p-xl"
              >
                <div className="flex flex-col gap-md sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-md">
                      <p className="text-lg font-semibold text-text-on-dark">
                        {t.course}
                      </p>
                      <p className="text-sm text-text-muted-on-dark">
                        {t.tableLabel} · {t.guestName}
                      </p>
                    </div>
                  </div>

                  <div
                    className={`rounded-full border px-sm py-xs text-xs uppercase tracking-widest ${getTicketStatusPill(
                      t.status,
                    )}`}
                  >
                    {t.status}
                  </div>
                </div>

                {t.mods && t.mods.length > 0 ? (
                  <div className="mt-md">
                    <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                      Modifications
                    </p>
                    <div className="mt-xs flex flex-wrap gap-sm">
                      {t.mods.map((m) => (
                        <div
                          key={m}
                          className="rounded-md border border-border-card bg-surface-dark-elevated px-sm py-xs text-xs text-text-muted-on-dark"
                        >
                          {m}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {t.allergies.length > 0 ? (
                  <div className="mt-md flex flex-col gap-xs">
                    {t.allergies.map((a) => (
                      <div
                        key={a}
                        className="rounded-md border-l-4 border-error bg-error-muted px-sm py-xs text-xs font-medium text-error"
                      >
                        {a} allergy
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-md rounded-md border border-border-card bg-surface-dark-elevated p-md text-sm text-text-muted-on-dark">
                    No allergies flagged
                  </div>
                )}

                {t.notes ? (
                  <p className="mt-md text-sm text-text-muted-on-dark">
                    {t.notes}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
