"use client";

import { useInView } from "@/hooks/useInView";

interface SectionWithFadeProps {
  children: React.ReactNode;
  className?: string;
  id?: string;
}

export function SectionWithFade({ children, className = "", id }: SectionWithFadeProps) {
  const { ref, isInView } = useInView();

  return (
    <section
      ref={ref}
      id={id}
      className={`${isInView ? "animate-fade-in-up" : "opacity-0"} ${className}`}
    >
      {children}
    </section>
  );
}
