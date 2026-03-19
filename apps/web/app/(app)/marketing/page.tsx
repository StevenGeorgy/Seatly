import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/layout/PageHeader";

type SegmentKey = "vip" | "allergies" | "high-risk" | "recent";

type Segment = {
  key: SegmentKey;
  label: string;
  previewCount: number;
};

const SEGMENTS: Segment[] = [
  { key: "vip", label: "VIPs arriving tonight", previewCount: 12 },
  { key: "allergies", label: "Guests with allergy flags", previewCount: 18 },
  { key: "high-risk", label: "High no-show risk", previewCount: 7 },
  { key: "recent", label: "Recent return guests", previewCount: 24 },
];

export default function MarketingPage({
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

  const segmentParam = searchParams.segment;
  const segment =
    typeof segmentParam === "string"
      ? (segmentParam as SegmentKey)
      : Array.isArray(segmentParam)
        ? (segmentParam[0] as SegmentKey)
        : "vip";

  const activeSegment = SEGMENTS.find((s) => s.key === segment) ?? SEGMENTS[0];

  if (loading) {
    return (
      <div>
        <PageHeader title="Marketing Messages" />
        <LoadingState />
      </div>
    );
  }

  if (empty) {
    return (
      <div>
        <PageHeader title="Marketing Messages" />
        <EmptyState
          title="No guests available for segments"
          message="Once guests match your filters, you can compose and send marketing messages."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Marketing Messages" />
        <div className="flex flex-col items-center justify-center rounded-lg border border-error bg-error-muted p-xl text-center">
          <p className="text-base font-medium text-error">
            Something went wrong. Please try again.
          </p>
          <Link
            href="/marketing?state=loading"
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
      <PageHeader title="Marketing Messages" />

      <div className="grid grid-cols-12 gap-lg">
        <section className="col-span-12 lg:col-span-4 app-card-elevated p-xl">
          <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
            Guest segments
          </p>
          <p className="mt-xs text-sm text-text-muted-on-dark">
            Choose who to message (mock preview counts).
          </p>

          <div className="mt-lg flex flex-col gap-md">
            {SEGMENTS.map((s) => {
              const isActive = s.key === activeSegment.key;
              return (
                <Link
                  key={s.key}
                  href={`/marketing?state=ready&segment=${s.key}`}
                  className={`rounded-md border px-md py-sm text-xs font-medium uppercase tracking-widest transition-transform duration-400 hover:scale-[1.02] ${
                    isActive
                      ? "border-gold bg-gold/10 text-gold"
                      : "border-border-card bg-surface-dark text-text-muted-on-dark hover:bg-gold/5 hover:text-text-on-dark"
                  }`}
                >
                  <div className="flex items-center justify-between gap-md">
                    <span className="min-w-0 truncate">{s.label}</span>
                    <span>{s.previewCount}</span>
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="mt-lg app-card p-xl">
            <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
              Preview count
            </p>
            <p className="mt-xs text-2xl font-bold text-gold">
              {activeSegment.previewCount}
            </p>
            <p className="mt-xs text-sm text-text-muted-on-dark">
              Guests that match this segment.
            </p>
          </div>
        </section>

        <section className="col-span-12 lg:col-span-8 app-card-elevated p-xl">
          <div className="mb-lg flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Compose message
              </p>
              <p className="mt-xs text-sm text-text-muted-on-dark">
                Send SMS or email to the selected segment. (Mock UI)
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-md">
              <div className="rounded-md border border-gold/30 bg-gold/10 px-md py-sm text-xs font-medium uppercase tracking-widest text-gold">
                {activeSegment.label}
              </div>
            </div>
          </div>

          <form action="#">
            <div className="grid grid-cols-12 gap-md">
              <div className="col-span-12 sm:col-span-6">
                <label className="text-xs uppercase tracking-widest text-gold">
                  Channel
                </label>
                <select
                  disabled
                  className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark opacity-70"
                  defaultValue="sms"
                >
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                </select>
              </div>

              <div className="col-span-12 sm:col-span-6">
                <label className="text-xs uppercase tracking-widest text-gold">
                  Send time
                </label>
                <input
                  disabled
                  className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark opacity-70"
                  defaultValue="Tonight · 6:45 PM"
                />
              </div>

              <div className="col-span-12">
                <label className="text-xs uppercase tracking-widest text-gold">
                  Message
                </label>
                <textarea
                  rows={6}
                  disabled
                  className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark opacity-70"
                  defaultValue="Hi! We’re excited to host you tonight. Reply to confirm any allergy notes. See you soon."
                />
              </div>

              <div className="col-span-12">
                <div className="flex flex-col gap-md sm:flex-row sm:items-center sm:justify-between">
                  <div className="app-card p-xl">
                    <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                      Delivery preview
                    </p>
                    <p className="mt-xs text-sm text-text-muted-on-dark">
                      This message will be sent to {activeSegment.previewCount} guests.
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled
                    className="rounded-md bg-gold px-lg py-md text-sm font-semibold text-text-on-gold opacity-70 hover:scale-[1.02] transition-transform duration-400"
                  >
                    Send (coming soon)
                  </button>
                </div>
              </div>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
