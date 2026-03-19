import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/layout/PageHeader";

type TableStatus = "empty" | "seated" | "arriving" | "overdue" | "reserved";

type AssignedTable = {
  id: number;
  status: TableStatus;
  guestName?: string;
  partySize?: number;
  allergies: string[];
};

const getTableSurfaceClass = (status: TableStatus) => {
  switch (status) {
    case "empty":
      return "bg-floor-plan-empty border-floor-plan-empty-border";
    case "seated":
      return "bg-floor-plan-seated border-floor-plan-seated-border";
    case "arriving":
      return "bg-floor-plan-arriving border-floor-plan-arriving-border";
    case "overdue":
      return "bg-floor-plan-overdue border-floor-plan-overdue-border";
    case "reserved":
      return "bg-floor-plan-reserved border-floor-plan-reserved-border";
  }
};

const MY_TABLES: AssignedTable[] = [
  { id: 2, status: "seated", guestName: "Smith", partySize: 4, allergies: ["Nuts"] },
  { id: 5, status: "arriving", allergies: [] },
  { id: 6, status: "seated", guestName: "Chen", partySize: 3, allergies: ["Shellfish"] },
  { id: 9, status: "overdue", guestName: "Lee", partySize: 6, allergies: [] },
];

export default function MyTablesPage({
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
        <PageHeader title="My Tables" />
        <LoadingState />
      </div>
    );
  }

  if (empty || MY_TABLES.length === 0) {
    return (
      <div>
        <PageHeader title="My Tables" />
        <EmptyState
          title="No tables assigned"
          message="When the host assigns you tables, they’ll appear here."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="My Tables" />
        <div className="flex flex-col items-center justify-center rounded-lg border border-error bg-error-muted p-xl text-center">
          <p className="text-base font-medium text-error">
            Something went wrong. Please try again.
          </p>
          <Link
            href="/my-tables?state=loading"
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
      <PageHeader title="My Tables" />

      <div className="grid grid-cols-12 gap-lg">
        <section className="col-span-12 app-card-elevated p-xl">
          <div className="mb-lg flex flex-col gap-md sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Assigned tables
              </p>
              <p className="mt-xs text-sm text-text-muted-on-dark">
                Review table status and allergy alerts during service.
              </p>
            </div>

            <div className="flex items-center gap-md">
              <div className="rounded-md border border-border-card bg-surface-dark px-md py-sm text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Today
              </div>
            </div>
          </div>

          <div className="grid grid-cols-12 gap-lg">
            {MY_TABLES.map((t) => (
              <article key={t.id} className="col-span-12 sm:col-span-6 lg:col-span-4">
                <div
                  className={`rounded-lg border p-xl ${getTableSurfaceClass(t.status)}`}
                >
                  <div className="flex items-start justify-between gap-md">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                        Table
                      </p>
                      <p className="mt-xs text-lg font-semibold text-text-on-dark">
                        {t.id}
                      </p>
                    </div>
                    <div className="rounded-full border border-gold/30 bg-gold/10 px-sm py-xs">
                      <p className="text-xs font-medium uppercase tracking-widest text-gold">
                        {t.status}
                      </p>
                    </div>
                  </div>

                  {t.guestName ? (
                    <div className="mt-md">
                      <p className="text-sm font-semibold text-text-on-dark">
                        {t.guestName}
                      </p>
                      <p className="mt-xs text-sm text-text-muted-on-dark">
                        Party of {t.partySize}
                      </p>
                    </div>
                  ) : null}

                  {t.allergies.length > 0 ? (
                    <div className="mt-md flex flex-col gap-xs">
                      {t.allergies.map((a) => (
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
                      No allergy flags
                    </div>
                  )}

                  <div className="mt-md flex flex-col gap-md">
                    <button
                      type="button"
                      disabled
                      className="rounded-md bg-gold/10 px-lg py-md text-sm font-semibold text-text-on-gold opacity-70"
                    >
                      Open guest card (coming soon)
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
