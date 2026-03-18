"use client";

import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = "" }: CardProps) {
  return (
    <div
      className={`rounded-lg border border-gold-glass bg-gold-glass p-xl backdrop-blur-xl transition-shadow duration-400 hover:shadow-gold-glow ${className}`}
    >
      {children}
    </div>
  );
}
