import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/layout/PageHeader";

type TableShape = "round" | "square" | "booth";

type EditorTable = {
  id: string;
  label: string;
  capacity: number;
  section: string;
  shape: TableShape;
  status: "active" | "inactive";
};

const EDITOR_TABLES: EditorTable[] = [
  {
    id: "t-1",
    label: "T2",
    capacity: 4,
    section: "Main",
    shape: "round",
    status: "active",
  },
  {
    id: "t-2",
    label: "T6",
    capacity: 3,
    section: "Corner",
    shape: "booth",
    status: "active",
  },
  {
    id: "t-3",
    label: "T9",
    capacity: 6,
    section: "Center",
    shape: "square",
    status: "inactive",
  },
];

function statusPillClass(status: EditorTable["status"]) {
  return status === "active"
    ? "border-gold/50 bg-gold/10 text-gold"
    : "border-border-card bg-surface-dark-elevated text-text-muted-on-dark";
}

export default function FloorPlanEditorPage({
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
        <PageHeader title="Floor Plan Editor" />
        <LoadingState />
      </div>
    );
  }

  if (empty) {
    return (
      <div>
        <PageHeader title="Floor Plan Editor" />
        <EmptyState
          title="Floor plan is not set up"
          message="Add tables to your plan to enable live floor plan views."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Floor Plan Editor" />
        <div className="flex flex-col items-center justify-center rounded-lg border border-error bg-error-muted p-xl text-center">
          <p className="text-base font-medium text-error">
            Something went wrong. Please try again.
          </p>
          <Link
            href="/settings/floor-plan?state=loading"
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
      <PageHeader title="Floor Plan Editor" />

      <div className="grid grid-cols-12 gap-lg">
        <section className="col-span-12 lg:col-span-4 rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
          <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
            Tables (mock)
          </p>
          <p className="mt-xs text-sm text-text-muted-on-dark">
            Select a table to edit position, capacity, and section. (Coming
            soon)
          </p>

          <div className="mt-lg space-y-md">
            {EDITOR_TABLES.map((t) => (
              <article
                key={t.id}
                className="rounded-lg border border-border-card bg-surface-dark p-xl"
              >
                <div className="flex items-center justify-between gap-md">
                  <p className="text-sm font-semibold text-text-on-dark">
                    {t.label}
                  </p>
                  <div
                    className={`rounded-full border px-sm py-xs text-xs uppercase tracking-widest ${statusPillClass(
                      t.status,
                    )}`}
                  >
                    {t.status}
                  </div>
                </div>
                <p className="mt-xs text-sm text-text-muted-on-dark">
                  Capacity {t.capacity} · {t.section}
                </p>
                <p className="mt-xs text-sm text-text-muted-on-dark">
                  Shape: {t.shape}
                </p>
                <button
                  type="button"
                  disabled
                  className="mt-md w-full rounded-md border border-gold/30 bg-gold/10 px-lg py-md text-sm font-semibold text-gold opacity-70"
                >
                  Edit table (mock)
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="col-span-12 lg:col-span-8 rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
          <div className="mb-lg flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Canvas (mock)
              </p>
              <p className="mt-xs text-sm text-text-muted-on-dark">
                Drag and drop canvas will be wired to backend later.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-md">
              <button
                type="button"
                disabled
                className="rounded-md bg-gold px-lg py-md text-sm font-semibold text-text-on-gold opacity-70 hover:scale-[1.02] transition-transform duration-400"
              >
                Save changes (coming soon)
              </button>
              <Link
                href="/floor-plan?state=ready"
                className="rounded-md border border-border-card bg-surface-dark px-lg py-md text-sm font-semibold text-text-muted-on-dark hover:bg-gold/5 hover:text-text-on-dark transition-transform duration-400"
              >
                Preview live floor plan
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-border-card bg-surface-dark p-xl">
            <div className="grid grid-cols-12 gap-lg items-start">
              <div className="col-span-12 lg:col-span-7">
                <div className="rounded-lg border border-border-dark bg-surface-dark-elevated p-xl">
                  <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                    Floor plan canvas
                  </p>
                  <p className="mt-xs text-sm text-text-muted-on-dark">
                    Mock canvas placeholder (no drag/drop yet).
                  </p>

                  <div className="mt-lg grid grid-cols-6 gap-md">
                    {new Array(12).fill(null).map((_, i) => (
                      <div
                        key={i}
                        className="aspect-square rounded-md border border-border-card bg-surface-dark p-md flex items-center justify-center"
                      >
                        <span className="text-xs font-semibold text-text-muted-on-dark">
                          {i + 1}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="col-span-12 lg:col-span-5">
                <div className="rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
                  <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                    Editor tools (mock)
                  </p>

                  <div className="mt-md flex flex-col gap-md">
                    <button
                      type="button"
                      disabled
                      className="rounded-md border border-border-dark bg-surface-dark px-lg py-md text-sm font-semibold text-text-muted-on-dark opacity-70"
                    >
                      Add table
                    </button>
                    <button
                      type="button"
                      disabled
                      className="rounded-md border border-border-dark bg-surface-dark px-lg py-md text-sm font-semibold text-text-muted-on-dark opacity-70"
                    >
                      Set section
                    </button>
                    <button
                      type="button"
                      disabled
                      className="rounded-md border border-border-dark bg-surface-dark px-lg py-md text-sm font-semibold text-text-muted-on-dark opacity-70"
                    >
                      Toggle active/inactive
                    </button>
                  </div>

                  <div className="mt-lg rounded-lg border border-border-card bg-surface-dark p-xl">
                    <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                      Tip
                    </p>
                    <p className="mt-xs text-sm text-text-muted-on-dark">
                      When the real canvas is connected, drag end will persist table positions.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
