"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export function LandingNavbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav
      className={`sticky top-0 z-50 border-b transition-colors duration-400 ${
        scrolled ? "border-border-dark/80 bg-black/80" : "border-transparent bg-black/50"
      } backdrop-blur-xl`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-xl py-md">
        <Link
          href="/"
          className="text-2xl font-extrabold tracking-tight-hero text-text-on-dark"
        >
          Seatly
        </Link>
        <div className="flex items-center gap-md">
          <a
            href="/#features"
            className="hidden rounded-md px-lg py-sm text-sm font-medium text-text-on-dark transition-colors hover:text-gold sm:block"
          >
            Product
          </a>
          <Link
            href="/features"
            className="hidden rounded-md px-lg py-sm text-sm font-medium text-text-on-dark transition-colors hover:text-gold sm:block"
          >
            Features
          </Link>
          <Link
            href="/ai"
            className="hidden rounded-md px-lg py-sm text-sm font-medium text-text-on-dark transition-colors hover:text-gold sm:block"
          >
            AI
          </Link>
          <a
            href="/#pricing"
            className="hidden rounded-md px-lg py-sm text-sm font-medium text-text-on-dark transition-colors hover:text-gold sm:block"
          >
            Pricing
          </a>
          <Link
            href="/about"
            className="hidden rounded-md px-lg py-sm text-sm font-medium text-text-on-dark transition-colors hover:text-gold sm:block"
          >
            About
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-gold px-lg py-sm text-sm font-medium text-gold transition-colors hover:bg-gold/10"
          >
            Login
          </Link>
          <Link
            href="/signup"
            className="rounded-md bg-gold px-lg py-sm text-sm font-semibold text-text-on-gold transition-colors hover:bg-gold-muted"
          >
            Get Started
          </Link>
        </div>
      </div>
    </nav>
  );
}
