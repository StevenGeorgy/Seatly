import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/layout/PageHeader";

type GuestSearchResult = {
  id: string;
  name: string;
  vip: boolean;
  phone: string;
  allergies: string[];
  lastVisitLabel: string;
};

const ALL_GUESTS: GuestSearchResult[] = [
  {
    id: "g-1",
    name: "Smith",
    vip: true,
    phone: "(555) 010-1220",
    allergies: ["Nuts", "Milk"],
    lastVisitLabel: "2 days ago",
  },
  {
    id: "g-2",
    name: "Riley",
    vip: false,
    phone: "(555) 010-3301",
    allergies: ["Gluten"],
    lastVisitLabel: "3 weeks ago",
  },
  {
    id: "g-3",
    name: "Lee",
    vip: false,
    phone: "(555) 010-8840",
    allergies: ["Egg"],
    lastVisitLabel: "11 months ago",
  },
];

export default function GuestSearchPage({
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

  const qParam = searchParams.q;
  const q =
    typeof qParam === "string"
      ? qParam
      : Array.isArray(qParam)
        ? qParam[0]
        : "";

  const qNormalized = q.trim().toLowerCase();
  const results =
    qNormalized.length === 0
      ? []
      : ALL_GUESTS.filter((g) => {
          const nameMatch = g.name.toLowerCase().includes(qNormalized);
          const phoneMatch = g.phone.toLowerCase().includes(qNormalized);
          return nameMatch || phoneMatch;
        });

  if (loading) {
    return (
      <div>
        <PageHeader title="Guest Search" />
        <LoadingState />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Guest Search" />
        <div className="flex flex-col items-center justify-center rounded-lg border border-error bg-error-muted p-xl text-center">
          <p className="text-base font-medium text-error">
            Something went wrong. Please try again.
          </p>
          <Link
            href="/guests/search?state=loading"
            className="mt-lg rounded-md bg-error px-lg py-sm text-sm font-medium text-text-on-gold hover:opacity-90"
          >
            Retry
          </Link>
        </div>
      </div>
    );
  }

  if (empty || qNormalized.length === 0) {
    return (
      <div>
        <PageHeader title="Guest Search" />
        <EmptyState
          title="Type a name or phone"
          message="Use search mid-service to pull allergy alerts and visit history."
        />
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div>
        <PageHeader title="Guest Search" />

        <EmptyState
          title="No matches"
          message="Try a different name or phone number."
          action={
            <Link
              href="/guests/search"
              className="rounded-md border border-gold px-lg py-sm text-sm font-semibold text-gold hover:bg-gold/10 hover:scale-[1.02] transition-transform duration-400"
            >
              Clear search
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Guest Search" />

      <div className="grid grid-cols-12 gap-lg">
        <section className="col-span-12 app-card-elevated p-xl">
          <div className="mb-lg">
            <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
              Results for
            </p>
            <p className="mt-xs text-sm text-text-muted-on-dark">
              {q} · {results.length} guest{results.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="space-y-md">
            {results.map((g) => (
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
                      {g.phone} · Last visit {g.lastVisitLabel}
                    </p>
                  </div>

                  <div className="flex flex-col gap-md sm:items-end">
                    <Link
                      href={`/crm/${g.id}`}
                      className="rounded-md bg-gold px-lg py-md text-sm font-semibold text-text-on-gold hover:scale-[1.02] transition-transform duration-400"
                    >
                      Open profile
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
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
