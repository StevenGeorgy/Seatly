"use client";

import { SectionWithFade } from "./SectionWithFade";

const VALUES = [
  {
    title: "Restaurant-first",
    description: "We build for the people who run restaurants, not for investors or trends.",
    icon: ValueIcon1,
  },
  {
    title: "Transparency",
    description: "Simple pricing, no hidden fees. Your data stays yours.",
    icon: ValueIcon2,
  },
  {
    title: "Continuous improvement",
    description: "We ship features that matter. Every week, every month.",
    icon: ValueIcon3,
  },
  {
    title: "Guest-centric",
    description: "Better software means better experiences for your guests.",
    icon: ValueIcon4,
  },
];

function ValueIcon1({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z" />
    </svg>
  );
}

function ValueIcon2({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function ValueIcon3({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
    </svg>
  );
}

function ValueIcon4({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  );
}

export function AboutValues() {
  return (
    <SectionWithFade
      id="values"
      className="border-t border-border-dark/50 bg-background-dark py-20 lg:py-32"
    >
      <div className="mx-auto max-w-6xl px-xl">
        <h2 className="mb-3xl text-center text-3xl font-semibold tracking-tight-section text-text-on-dark">
          Our Values
        </h2>
        <div className="grid gap-xl sm:grid-cols-2 lg:grid-cols-4">
          {VALUES.map((value) => {
            const Icon = value.icon;
            return (
              <div
                key={value.title}
                className="rounded-lg border border-border-card bg-surface-dark p-xl"
              >
                <div className="mb-md text-gold">
                  <Icon className="h-10 w-10" />
                </div>
                <h3 className="mb-sm text-lg font-semibold text-text-on-dark">
                  {value.title}
                </h3>
                <p className="text-sm leading-relaxed text-text-muted-on-dark">
                  {value.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </SectionWithFade>
  );
}
