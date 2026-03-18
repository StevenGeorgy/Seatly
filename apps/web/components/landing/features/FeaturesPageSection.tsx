"use client";

import { SectionWithFade } from "../SectionWithFade";

interface FeaturesPageSectionProps {
  title: string;
  description: string;
  mockup: React.ComponentType;
  imageRight?: boolean;
}

export function FeaturesPageSection({
  title,
  description,
  mockup: MockupComponent,
  imageRight = false,
}: FeaturesPageSectionProps) {
  return (
    <SectionWithFade
      className={`py-24 lg:py-32 ${
        imageRight ? "bg-surface-dark-alt" : "bg-background-dark"
      }`}
    >
      <div className="mx-auto max-w-6xl px-xl">
        <div
          className={`flex flex-col gap-3xl lg:flex-row lg:items-center lg:gap-4xl ${
            imageRight ? "lg:flex-row-reverse" : ""
          }`}
        >
          <div className="flex-1">
            <h2 className="text-3xl font-semibold tracking-tight-section text-text-on-dark lg:text-4xl">
              {title}
            </h2>
            <p className="mt-xl max-w-xl leading-relaxed text-text-muted-on-dark">
              {description}
            </p>
          </div>
          <div className="flex min-h-[280px] flex-1 items-center justify-center">
            <MockupComponent />
          </div>
        </div>
      </div>
    </SectionWithFade>
  );
}
