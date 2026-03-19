"use client";

import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  subtext?: string;
}

export function StatCard({ label, value, icon: Icon, subtext }: StatCardProps) {
  return (
    <div className="relative overflow-hidden rounded-card-radius-large border border-stat-card-border bg-stat-card-bg p-stat-card shadow-inset-card transition-all duration-400 ease-out hover:border-stat-card-hover-border hover:shadow-stat-card-hover group">
      <div className="absolute inset-x-0 top-0 h-24 bg-gold-gradient-card-top opacity-0 transition-opacity duration-400 group-hover:opacity-100" />
      <div className="relative z-10">
        <div className="flex items-start justify-between">
          <p className="mb-3 text-stat-card-label font-medium uppercase tracking-label text-header-date-muted">
            {label}
          </p>
          <Icon
            className="h-5 w-5 shrink-0 text-gold opacity-50"
            strokeWidth={1.5}
            aria-hidden
          />
        </div>
        <p className="text-stat-card-number font-bold leading-none text-gold">{value}</p>
        {subtext && (
          <p className="mt-1 text-xs text-text-muted-on-dark">{subtext}</p>
        )}
      </div>
    </div>
  );
}
