"use client";

import Link from "next/link";
import { useInView } from "@/hooks/useInView";
import { HeroPhoneMockup } from "./HeroPhoneMockup";

export function LandingHero() {
  const { ref, isInView } = useInView();

  return (
    <section
      id="hero"
      ref={ref as React.RefObject<HTMLElement>}
      className="hero-noise relative bg-background-dark pt-20 pb-32 lg:pt-32 lg:pb-40"
    >
      {/* Layered backgrounds */}
      <div className="pointer-events-none absolute inset-0 bg-radial-gradient-dark-center bg-no-repeat" />
      <div className="absolute inset-0 bg-gold-gradient-hero bg-[length:120%_120%] bg-[position:50%_0%] bg-no-repeat" />
      <div className="absolute inset-0 bg-grid-pattern bg-[position:0_0] bg-[length:24px_24px] opacity-[0.03]" />

      <div className="relative mx-auto max-w-[1200px] min-h-[700px] px-xl">
        <div className="grid grid-cols-1 items-center gap-20 lg:grid-cols-2">
          {/* Left: Content */}
          <div className="flex flex-1 flex-col items-center text-center lg:max-w-[560px] lg:items-start lg:text-left">
            <div
              className={`transition-opacity duration-600 ease-out ${
                isInView ? "animate-fade-in-up opacity-100" : "opacity-0"
              }`}
              style={{ animationDelay: "0ms", animationFillMode: "forwards" }}
            >
              <span className="inline-block rounded-full border border-gold/50 bg-gold/10 px-md py-xs text-xs font-medium uppercase tracking-label text-gold">
                Trusted by 500+ restaurants
              </span>
            </div>

            <h1
              className={`mx-auto mt-xl max-w-2xl bg-gold-gradient-text bg-clip-text text-5xl font-extrabold tracking-tight-hero text-transparent transition-opacity duration-600 ease-out sm:text-6xl lg:mx-0 lg:mt-xl lg:text-7xl ${
                isInView ? "animate-fade-in-up opacity-100" : "opacity-0"
              }`}
              style={{ animationDelay: "100ms", animationFillMode: "forwards" }}
            >
              The Operating System for Modern Restaurants
            </h1>

            <p
              className={`mx-auto mt-xl max-w-[520px] text-lg leading-relaxed text-text-muted-on-dark transition-opacity duration-600 ease-out sm:text-xl lg:mx-0 ${
                isInView ? "animate-fade-in-up opacity-100" : "opacity-0"
              }`}
              style={{ animationDelay: "200ms", animationFillMode: "forwards" }}
            >
              Booking platform, floor management, and guest CRM with AI — all in one.
              Your guests pre-order, your staff sees everything in real time.
            </p>

            <div
              className={`mt-2xl flex flex-col items-center gap-md sm:flex-row lg:items-start transition-opacity duration-600 ease-out ${
                isInView ? "animate-fade-in-up opacity-100" : "opacity-0"
              }`}
              style={{ animationDelay: "300ms", animationFillMode: "forwards" }}
            >
              <div className="cta-gradient-border">
                <Link
                  href="/signup"
                  className="cta-shimmer block w-full rounded-md bg-gold px-2xl py-lg text-base font-semibold text-text-on-gold transition-transform duration-400 hover:scale-[1.02] hover:bg-gold-muted sm:w-auto"
                >
                  Get Started Free
                </Link>
              </div>
              <Link
                href="#"
                className="w-full rounded-md border border-border-dark px-2xl py-lg text-base font-medium text-text-on-dark transition-transform duration-400 hover:scale-[1.02] hover:border-gold hover:text-gold sm:w-auto"
              >
                Watch Demo
              </Link>
            </div>

            <p
              className={`mt-lg text-sm text-text-muted-on-dark transition-opacity duration-600 ease-out ${
                isInView ? "opacity-100" : "opacity-0"
              }`}
              style={{ animationDelay: "400ms" }}
            >
              No credit card required
            </p>
          </div>

          {/* Right: Phone mockup - centered */}
          <div
            className={`order-first flex min-w-0 flex-1 justify-center lg:order-last transition-opacity duration-600 ease-out ${
              isInView ? "animate-fade-in-up opacity-100" : "opacity-0"
            }`}
            style={{ animationDelay: "200ms", animationFillMode: "forwards" }}
          >
            <HeroPhoneMockup />
          </div>
        </div>
      </div>

      {/* Bottom gradient divider */}
      <div
        className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gold/30 to-transparent"
        aria-hidden
      />
    </section>
  );
}
