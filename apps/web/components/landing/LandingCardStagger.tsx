"use client";

import React from "react";
import { useInView } from "@/hooks/useInView";

interface LandingCardStaggerProps {
  children: React.ReactNode;
  className?: string;
  staggerDelayMs?: number;
  /** When true, each child wrapper gets flex-1 for flex layouts */
  flexChildren?: boolean;
}

export function LandingCardStagger({
  children,
  className = "",
  staggerDelayMs = 100,
  flexChildren = false,
}: LandingCardStaggerProps) {
  const { ref, isInView } = useInView();
  const items = React.Children.toArray(children);

  return (
    <div ref={ref as React.RefObject<HTMLDivElement>} className={className}>
      {items.map((child, index) => (
        <div
          key={index}
          className={`transition-opacity duration-600 ease-out ${flexChildren ? "flex min-w-0 flex-1 flex-col" : ""} ${
            isInView ? "animate-fade-in-up opacity-100" : "opacity-0"
          }`}
          style={{
            animationDelay: isInView ? `${index * staggerDelayMs}ms` : undefined,
            animationFillMode: "forwards",
          }}
        >
          {child}
        </div>
      ))}
    </div>
  );
}
