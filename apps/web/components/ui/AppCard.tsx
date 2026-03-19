"use client";

import type { ReactNode } from "react";

interface AppCardProps {
  children: ReactNode;
  className?: string;
  /** Use elevated background (#1A1A1A) for nested/secondary cards */
  elevated?: boolean;
  /** Show gold gradient on hover */
  hover?: boolean;
  /** Padding - defaults to p-stat-card (28px) */
  padding?: "none" | "sm" | "md" | "lg";
}

export function AppCard({
  children,
  className = "",
  elevated = false,
  hover = true,
  padding = "lg",
}: AppCardProps) {
  const paddingClass =
    padding === "none"
      ? ""
      : padding === "sm"
        ? "p-md"
        : padding === "md"
          ? "p-xl"
          : "p-stat-card";

  return (
    <div
      className={`relative overflow-hidden rounded-card-radius-large border border-card-border shadow-inset-card transition-all duration-400 ${
        elevated ? "bg-surface-dark-elevated" : "bg-card-bg"
      } ${paddingClass} ${hover ? "group hover:border-gold/30" : ""} ${className}`}
    >
      {hover && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gold-gradient-card-top opacity-0 transition-opacity duration-400 group-hover:opacity-100"
          aria-hidden
        />
      )}
      <div className={hover ? "relative z-10" : ""}>{children}</div>
    </div>
  );
}
