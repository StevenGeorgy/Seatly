"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { StatCard } from "@/components/dashboard/StatCard";
import {
  Users,
  DollarSign,
  Star,
  AlertTriangle,
  Sparkles,
  LayoutDashboard,
} from "lucide-react";

type NoShowFlag = {
  label: string;
  risk: "low" | "medium" | "high";
  guestName: string;
  guestId?: string;
};

type VipArriving = {
  name: string;
  eta: string;
  partySize: number;
  guestId?: string;
};

type RecentReservation = {
  guest: string;
  time: string;
  partySize: number;
  table: string;
  status: "confirmed" | "seated" | "arriving" | "overdue";
  guestId?: string;
};

const VIP_ARRIVING: VipArriving[] = [
  { name: "Smith", eta: "7:15 PM", partySize: 4, guestId: "g-1" },
  { name: "Chen", eta: "8:00 PM", partySize: 3 },
  { name: "Park", eta: "8:45 PM", partySize: 2 },
];

const NO_SHOW_FLAGS: NoShowFlag[] = [
  { label: "High risk", risk: "high", guestName: "Lee", guestId: "g-3" },
  { label: "Medium risk", risk: "medium", guestName: "Riley", guestId: "g-2" },
  { label: "Low risk", risk: "low", guestName: "Jordan" },
];

const RECENT_RESERVATIONS: RecentReservation[] = [
  { guest: "Smith", time: "7:15 PM", partySize: 4, table: "T4", status: "arriving", guestId: "g-1" },
  { guest: "Chen", time: "8:00 PM", partySize: 3, table: "T2", status: "confirmed" },
  { guest: "Park", time: "8:45 PM", partySize: 2, table: "T7", status: "seated" },
  { guest: "Lee", time: "9:30 PM", partySize: 6, table: "T1", status: "overdue", guestId: "g-3" },
];

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatDate(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function getServiceContext(): string {
  const hour = new Date().getHours();
  if (hour < 11) return "Breakfast service";
  if (hour < 14) return "Lunch shift";
  if (hour < 17) return "Afternoon service";
  return "Tonight's service";
}

export default function DashboardPage() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const stateParam = searchParams.get("state");
  const state = typeof stateParam === "string" ? stateParam : undefined;

  const loading = state === "loading";
  const empty = state === "empty";
  const error = state === "error";

  const [activeTab, setActiveTab] = useState<"vips" | "noshow">("vips");
  const router = useRouter();

  if (loading) {
    return (
      <div className="space-y-section-gap">
        <div className="flex items-start gap-md">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-surface-dark" />
          <div>
            <div className="h-3 w-16 animate-pulse rounded bg-surface-dark" />
            <div className="mt-2 h-8 w-48 animate-pulse rounded bg-surface-dark" />
            <div className="mt-2 h-4 w-32 animate-pulse rounded bg-surface-dark" />
          </div>
        </div>
        <LoadingState />
      </div>
    );
  }

  if (empty) {
    return (
      <div className="space-y-section-gap">
        <div className="flex items-start gap-md">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border-card bg-surface-dark">
            <LayoutDashboard className="h-5 w-5 text-gold" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-gold">Business</p>
            <h1 className="mt-0.5 text-greeting font-bold text-text-on-dark">
              {getGreeting()}, {user?.fullName ?? "there"}
            </h1>
            <p className="mt-xs text-sm text-header-date-muted">{formatDate()}</p>
            <p className="mt-0.5 text-xs text-text-muted-on-dark">{getServiceContext()}</p>
            <div className="mt-md h-px w-12 rounded-full bg-gold/50" />
          </div>
        </div>
        <EmptyState
          title="No dashboard data yet"
          message="Once your restaurant begins taking reservations, today's metrics and AI briefing will appear here."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-section-gap">
        <div className="flex items-start gap-md">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border-card bg-surface-dark">
            <LayoutDashboard className="h-5 w-5 text-gold" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-gold">Business</p>
            <h1 className="mt-0.5 text-greeting font-bold text-text-on-dark">
              {getGreeting()}, {user?.fullName ?? "there"}
            </h1>
            <p className="mt-xs text-sm text-header-date-muted">{formatDate()}</p>
            <p className="mt-0.5 text-xs text-text-muted-on-dark">{getServiceContext()}</p>
            <div className="mt-md h-px w-12 rounded-full bg-gold/50" />
          </div>
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl border border-error bg-error-muted p-xl text-center">
          <p className="text-base font-medium text-error">
            Something went wrong. Please try again.
          </p>
          <Link
            href="/dashboard?state=loading"
            className="mt-lg rounded-md bg-error px-lg py-sm text-sm font-medium text-text-on-gold hover:opacity-90"
          >
            Retry
          </Link>
        </div>
      </div>
    );
  }

  const riskClass = (risk: NoShowFlag["risk"]) => {
    switch (risk) {
      case "high":
        return "bg-error/20 text-error";
      case "medium":
        return "bg-warning/20 text-warning";
      case "low":
        return "bg-success/20 text-success";
    }
  };

  const statusClass = (status: RecentReservation["status"]) => {
    switch (status) {
      case "arriving":
        return "bg-status-arriving-bg text-status-arriving-text";
      case "confirmed":
        return "bg-status-confirmed-bg text-status-confirmed-text";
      case "seated":
        return "bg-status-seated-bg text-status-seated-text";
      case "overdue":
        return "bg-status-overdue-bg text-status-overdue-text";
      default:
        return "bg-content-inner-muted text-text-muted-on-dark";
    }
  };

  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  return (
    <div className="space-y-section-gap transition-all duration-400 ease-out">
      <div className="flex items-start gap-md">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border-card bg-surface-dark">
          <LayoutDashboard className="h-5 w-5 text-gold" strokeWidth={1.5} />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-gold">Business</p>
          <h1 className="mt-0.5 text-greeting font-bold tracking-tight text-text-on-dark">
            {getGreeting()}, {user?.fullName ?? "there"}
          </h1>
          <p className="mt-sm text-sm leading-relaxed text-header-date-muted">{formatDate()}</p>
          <p className="mt-1 text-xs uppercase tracking-widest text-gold/80">{getServiceContext()}</p>
          <div className="mt-md h-px w-12 rounded-full bg-gold/50" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-stat-card-gap md:grid-cols-4">
        <StatCard label="Covers tonight" value={42} icon={Users} subtext="On track" />
        <StatCard label="Revenue so far" value="$3,940" icon={DollarSign} />
        <StatCard label="VIPs arriving" value={3} icon={Star} />
        <StatCard
          label="No-show risk flagged"
          value={2}
          icon={AlertTriangle}
          subtext="Review recommended"
        />
      </div>

      <div className="mt-section-margin flex flex-wrap gap-md">
        <Link
          href="/floor-plan"
          className="rounded-button-radius border border-gold/30 px-5 py-2.5 text-sm font-medium text-gold/80 transition duration-200 hover:border-gold hover:bg-gold/10"
        >
          View Floor Plan
        </Link>
        <Link
          href="/reservations/new"
          className="rounded-button-radius bg-gold px-5 py-2.5 text-sm font-semibold text-text-on-gold transition duration-200 hover:bg-gold-muted"
        >
          Add Reservation
        </Link>
        <Link
          href="/crm"
          className="rounded-button-radius border border-gold/30 px-5 py-2.5 text-sm font-medium text-gold/80 transition duration-200 hover:border-gold hover:bg-gold/10"
        >
          View CRM
        </Link>
      </div>

      <div className="mt-section-margin grid grid-cols-1 gap-2xl lg:grid-cols-[65%_35%]">
        <section className="group relative overflow-hidden rounded-card-radius-large border border-card-border bg-card-bg p-stat-card shadow-inset-card transition-all duration-400 hover:border-gold/30">
          <div className="absolute inset-x-0 top-0 h-32 bg-gold-gradient-card-top opacity-0 transition-opacity duration-400 group-hover:opacity-100" />
          <div className="relative z-10 flex items-center justify-between border-b border-card-border pb-md">
            <p className="text-xs font-medium uppercase tracking-widest text-gold">
              Guests
            </p>
            <div className="flex gap-md">
              <button
                type="button"
                onClick={() => setActiveTab("vips")}
                className={`px-md py-sm text-sm font-medium transition-all duration-200 ${
                  activeTab === "vips"
                    ? "border-b-2 border-gold text-gold"
                    : "text-white/40 hover:text-text-on-dark"
                }`}
              >
                VIPs Arriving
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("noshow")}
                className={`px-md py-sm text-sm font-medium transition-all duration-200 ${
                  activeTab === "noshow"
                    ? "border-b-2 border-gold text-gold"
                    : "text-white/40 hover:text-text-on-dark"
                }`}
              >
                No-Show Risk Flags
              </button>
            </div>
          </div>
          <div className="relative z-10 my-lg border-b border-card-border" />
          {activeTab === "vips" ? (
            <div className="relative z-10 space-y-0">
              {VIP_ARRIVING.map((v, i) => (
                <Link
                  key={v.name}
                  href={v.guestId ? `/crm/${v.guestId}` : "/crm"}
                  className={`flex cursor-pointer items-center gap-md py-3.5 transition-colors duration-200 hover:bg-row-hover-bg ${
                    i < VIP_ARRIVING.length - 1 ? "border-b border-row-divider" : ""
                  }`}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gold/20 bg-gold/10 text-sm font-semibold text-gold">
                    {getInitials(v.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-guest-name font-semibold text-text-on-dark">
                      {v.name}
                    </p>
                    <p className="mt-0.5 text-guest-detail text-header-date-muted">
                      ETA {v.eta} · Party {v.partySize}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-0.5 text-stat-card-label font-semibold text-gold/90">
                    VIP
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="relative z-10 space-y-0">
              {NO_SHOW_FLAGS.map((f, i) => (
                <Link
                  key={f.guestName}
                  href={f.guestId ? `/crm/${f.guestId}` : "/crm"}
                  className={`flex cursor-pointer items-center gap-md py-3.5 transition-colors duration-200 hover:bg-row-hover-bg ${
                    i < NO_SHOW_FLAGS.length - 1 ? "border-b border-row-divider" : ""
                  }`}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-briefing-inner-bg text-sm font-medium text-text-muted-on-dark">
                    {getInitials(f.guestName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-guest-name font-semibold text-text-on-dark">
                      {f.guestName}
                    </p>
                    <p className="mt-0.5 text-guest-detail text-header-date-muted">
                      {f.label}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-stat-card-label font-semibold uppercase tracking-widest ${riskClass(
                      f.risk
                    )}`}
                  >
                    {f.risk}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <aside>
          <div className="group relative overflow-hidden rounded-card-radius-large border border-card-border bg-card-bg p-stat-card shadow-inset-card transition-all duration-400 hover:border-gold/30">
            <div className="absolute inset-x-0 top-0 h-32 bg-gold-gradient-card-top opacity-0 transition-opacity duration-400 group-hover:opacity-100" />
            <div className="relative z-10 flex items-center justify-between gap-md">
              <div className="flex items-center gap-md">
                <span className="flex items-center gap-xs rounded-full border border-gold px-sm py-xs text-xs font-medium uppercase tracking-widest text-gold">
                  <Sparkles className="h-3 w-3" strokeWidth={2} />
                  AI
                </span>
                <p className="text-xs font-medium uppercase tracking-widest text-gold">
                  SHIFT BRIEFING
                </p>
              </div>
              <p className="text-xs text-text-muted-on-dark">Updated 2 min ago</p>
            </div>
            <p className="relative z-10 mt-md text-sm text-text-muted-on-dark">
              A quick, actionable briefing for tonight&apos;s service.
            </p>
            <div className="relative z-10 mt-md space-y-2.5">
              <div className="rounded-briefing-inner-radius border border-briefing-inner-border bg-briefing-inner-bg p-3.5 px-4">
                <p className="text-briefing-label font-medium uppercase tracking-wide text-gold">
                  Priority
                </p>
                <p className="mt-xs text-guest-detail text-briefing-text">
                  Confirm allergy notes and keep an eye on high no-show risk
                  guests.
                </p>
              </div>
              <div className="rounded-briefing-inner-radius border border-briefing-inner-border bg-briefing-inner-bg p-3.5 px-4">
                <p className="text-briefing-label font-medium uppercase tracking-wide text-gold">
                  Suggested table flow
                </p>
                <p className="mt-xs text-guest-detail text-briefing-text">
                  Seat VIP arrivals early; avoid overdue tables receiving
                  additional walk-ins.
                </p>
              </div>
            </div>
            <Link
              href="/assistant"
              className="mt-lg flex w-full items-center justify-center gap-sm rounded-button-radius bg-gold py-3 text-sm font-semibold text-text-on-gold transition duration-200 hover:bg-gold-muted"
            >
              <Sparkles className="h-4 w-4" strokeWidth={2} />
              Ask Alex
            </Link>
          </div>
        </aside>
      </div>

      <section className="group relative mt-section-margin overflow-hidden rounded-card-radius-large border border-card-border bg-card-bg p-stat-card shadow-inset-card transition-all duration-400 hover:border-gold/30">
        <div className="absolute inset-x-0 top-0 h-32 bg-gold-gradient-card-top opacity-0 transition-opacity duration-400 group-hover:opacity-100" />
        <p className="relative z-10 text-xs font-medium uppercase tracking-widest text-gold">
          Recent Reservations
        </p>
        <div className="relative z-10 mt-lg overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-card-border">
                <th className="px-md pb-3 text-stat-card-label font-medium uppercase tracking-wide text-table-header-text">
                  Guest
                </th>
                <th className="px-md pb-3 text-stat-card-label font-medium uppercase tracking-wide text-table-header-text">
                  Time
                </th>
                <th className="px-md pb-3 text-stat-card-label font-medium uppercase tracking-wide text-table-header-text">
                  Party Size
                </th>
                <th className="px-md pb-3 text-stat-card-label font-medium uppercase tracking-wide text-table-header-text">
                  Table
                </th>
                <th className="px-md pb-3 text-stat-card-label font-medium uppercase tracking-wide text-table-header-text">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="text-text-on-dark">
              {RECENT_RESERVATIONS.map((r) => (
                <tr
                  key={`${r.guest}-${r.time}`}
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    router.push(r.guestId ? `/crm/${r.guestId}` : "/reservations")
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(r.guestId ? `/crm/${r.guestId}` : "/reservations");
                    }
                  }}
                  className="cursor-pointer border-b border-row-divider transition-colors duration-200 hover:bg-row-hover-bg"
                >
                  <td className="px-md py-3.5 text-sm text-table-row-text">{r.guest}</td>
                  <td className="px-md py-3.5 text-sm text-table-row-text">{r.time}</td>
                  <td className="px-md py-3.5 text-sm text-table-row-text">{r.partySize}</td>
                  <td className="px-md py-3.5 text-sm text-table-row-text">{r.table}</td>
                  <td className="px-md py-3.5">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-stat-card-label font-semibold ${statusClass(
                        r.status
                      )}`}
                    >
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="relative z-10 mt-lg flex justify-end">
          <Link
            href="/reservations"
            className="text-sm font-medium text-gold transition-colors duration-200 hover:text-gold/80"
          >
            View all reservations →
          </Link>
        </div>
      </section>
    </div>
  );
}
