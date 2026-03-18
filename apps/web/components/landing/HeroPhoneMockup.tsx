"use client";

import { useEffect, useState } from "react";

type PhoneState = "booking" | "table-ready" | "ai-chat";

export function HeroPhoneMockup() {
  const [state, setState] = useState<PhoneState>("booking");

  useEffect(() => {
    const cycle = () => {
      setState((prev) => {
        if (prev === "booking") return "table-ready";
        if (prev === "table-ready") return "ai-chat";
        return "booking";
      });
    };
    const id = setInterval(cycle, 4000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative flex justify-center">
      {/* Gold glow behind phone */}
      <div
        className="absolute -inset-12 rounded-[3rem] bg-gold/15 blur-3xl"
        aria-hidden
      />
      <div className="relative">
        {/* Phone frame: 320×580px, 40px radius, 2px gold border */}
        <div
          className="relative overflow-hidden rounded-[40px] border-2 border-gold bg-surface-dark shadow-gold-glow"
          style={{ width: 320, height: 580 }}
        >
          {/* Notch */}
          <div className="absolute left-1/2 top-0 z-10 h-5 w-24 -translate-x-1/2 rounded-b-xl bg-surface-dark" />
          {/* Screen content area */}
          <div className="relative mx-2 mt-7 mb-2 overflow-hidden rounded-[28px] bg-surface-dark-elevated">
            <div className="min-h-[520px] p-5">
              {/* State 1: Booking confirmed */}
              <div
                className={`absolute inset-5 flex flex-col transition-opacity duration-500 ease-in-out ${
                  state === "booking"
                    ? "opacity-100"
                    : "pointer-events-none opacity-0"
                }`}
              >
                <p className="text-sm font-medium text-gold">Seatly</p>
                <div className="mt-xl flex flex-col items-center">
                  <svg
                    className="mb-md h-10 w-10 shrink-0 text-gold"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  <p className="text-base font-bold text-text-on-dark">
                    Booking Confirmed
                  </p>
                  <p className="mt-sm text-sm text-text-muted-on-dark">
                    Bistro La Maison
                  </p>
                  <p className="mt-xs text-sm text-text-muted-on-dark">
                    Saturday, March 22
                  </p>
                  <p className="mt-xs text-sm text-text-muted-on-dark">
                    7:30 PM
                  </p>
                  <p className="mt-xs text-sm text-text-muted-on-dark">
                    Party of 2
                  </p>
                  <div className="mt-xl inline-flex w-fit items-center justify-center rounded-full border border-gold bg-gold/10 px-lg py-sm">
                    <span className="text-sm font-medium text-gold">
                      View Details
                    </span>
                  </div>
                </div>
              </div>

              {/* State 2: Table ready */}
              <div
                className={`absolute inset-5 flex flex-col items-center transition-opacity duration-500 ease-in-out ${
                  state === "table-ready"
                    ? "opacity-100"
                    : "pointer-events-none opacity-0"
                }`}
              >
                <p className="text-sm font-medium text-gold">Seatly</p>
                <div className="mt-xl flex flex-col items-center">
                  <svg
                    className="mb-md h-10 w-10 shrink-0 text-gold"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                  <p className="text-base font-bold text-text-on-dark">
                    Your Table is Ready
                  </p>
                  <p className="mt-sm text-sm text-text-muted-on-dark">
                    Table 8 — Window seat
                  </p>
                  <p className="mt-xs text-sm text-text-muted-on-dark">
                    Welcome, Sarah
                  </p>
                  <div className="mt-md flex items-center gap-xs">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-gold" />
                    <span className="text-sm font-medium text-gold">
                      Walk in now
                    </span>
                  </div>
                  <div className="mt-xl inline-flex w-fit items-center justify-center rounded-full border border-gold bg-gold/10 px-lg py-sm">
                    <span className="text-sm font-medium text-gold">
                      Check In
                    </span>
                  </div>
                </div>
              </div>

              {/* State 3: AI chat */}
              <div
                className={`absolute inset-5 flex flex-col gap-md transition-opacity duration-500 ease-in-out ${
                  state === "ai-chat"
                    ? "opacity-100"
                    : "pointer-events-none opacity-0"
                }`}
              >
                <p className="text-sm font-medium text-gold">Alex AI</p>
                <div className="mt-sm flex flex-col gap-md">
                  <div className="rounded-lg rounded-tl-sm bg-surface-dark px-md py-sm">
                    <p className="text-[13px] text-text-on-dark">
                      Italian dinner, Saturday, 2 people
                    </p>
                  </div>
                  <div className="rounded-lg rounded-tl-sm border-l-2 border-gold bg-gold-tint px-md py-sm">
                    <p className="text-[13px] text-text-on-dark">
                      Found Bistro La Maison
                    </p>
                    <p className="mt-xs text-[13px] text-text-muted-on-dark">
                      Sat 7:30 PM — 2 available
                    </p>
                  </div>
                  <div className="rounded-lg rounded-tl-sm bg-surface-dark px-md py-sm">
                    <p className="text-[13px] text-text-on-dark">Book it</p>
                  </div>
                  <div className="rounded-lg rounded-tl-sm border-l-2 border-gold bg-gold-tint px-md py-sm">
                    <p className="text-[13px] text-text-on-dark">Booked ✓</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
