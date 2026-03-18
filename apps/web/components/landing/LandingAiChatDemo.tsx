"use client";

import { useEffect, useState } from "react";

const AI_PAGE_CONVERSATIONS = [
  {
    owner: "Who are my top spenders this month?",
    ai: (
      <div className="overflow-hidden rounded border border-gold/20">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-gold/20 bg-gold/10">
              <th className="px-sm py-xs font-medium text-gold">Guest</th>
              <th className="px-sm py-xs font-medium text-gold">Visits</th>
              <th className="px-sm py-xs font-medium text-gold">Spend</th>
            </tr>
          </thead>
          <tbody className="text-text-on-dark">
            <tr className="border-b border-gold/10">
              <td className="px-sm py-xs">Sarah Chen</td>
              <td className="px-sm py-xs">8</td>
              <td className="px-sm py-xs">$1,240</td>
            </tr>
            <tr className="border-b border-gold/10">
              <td className="px-sm py-xs">Marcus Lee</td>
              <td className="px-sm py-xs">6</td>
              <td className="px-sm py-xs">$980</td>
            </tr>
            <tr>
              <td className="px-sm py-xs">Emma Wilson</td>
              <td className="px-sm py-xs">5</td>
              <td className="px-sm py-xs">$720</td>
            </tr>
          </tbody>
        </table>
      </div>
    ),
  },
  {
    owner: "Which guests have a birthday this week?",
    ai: (
      <div className="space-y-xs text-sm text-text-on-dark">
        <p>Sarah Chen — Mar 18</p>
        <p>David Park — Mar 20</p>
        <p>Emma Wilson — Mar 22</p>
      </div>
    ),
  },
  {
    owner: "Flag anyone with a nut allergy tonight",
    ai: (
      <div className="space-y-xs text-sm text-text-on-dark">
        <p className="font-medium text-gold">2 guests flagged:</p>
        <p>Marcus Lee — Table 4, 7:30 PM</p>
        <p>Rachel Kim — Table 8, 8:00 PM</p>
      </div>
    ),
  },
  {
    owner: "What was revenue last Friday?",
    ai: (
      <div className="text-sm text-text-on-dark">
        <p className="font-semibold text-gold">$6,420</p>
        <p className="mt-xs text-text-muted-on-dark">
          84 covers · $76.43 avg
        </p>
      </div>
    ),
  },
];

type Variant = "landing" | "ai-page";

interface LandingAiChatDemoProps {
  variant?: Variant;
}

export function LandingAiChatDemo({ variant = "landing" }: LandingAiChatDemoProps) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (variant === "ai-page") {
      const phase = step % 4; // 0=owner, 1=typing, 2=ai, 3=pause
      const delays = [600, 1000, 2500, 1500];
      const timeout = setTimeout(() => {
        setStep((s) => s + 1);
      }, delays[phase] ?? 1500);
      return () => clearTimeout(timeout);
    }

    const delays = [800, 1200, 800, 800, 1200, 2000, 1500];
    const totalSteps = 7;
    const timeout = setTimeout(() => {
      setStep((s) => (s + 1) % totalSteps);
    }, delays[step] ?? 1500);
    return () => clearTimeout(timeout);
  }, [step, variant]);

  // AI page: show one conversation at a time, cycle through
  if (variant === "ai-page") {
    const convIndex = Math.floor(step / 4) % AI_PAGE_CONVERSATIONS.length;
    const phase = step % 4;
    const conv = AI_PAGE_CONVERSATIONS[convIndex];
    const showOwner = phase >= 0;
    const showTyping = phase === 1;
    const showAi = phase >= 2;

    return (
      <div className="w-full overflow-hidden rounded-lg border border-border-card bg-surface-dark">
        <div className="border-b border-border-dark px-md py-sm">
          <p className="text-xs font-medium text-text-muted-on-dark">Alex</p>
        </div>
        <div className="flex min-h-[220px] flex-col gap-md p-md">
          <div
            className={`self-end rounded-lg rounded-tr-sm bg-surface-dark-elevated px-md py-sm transition-opacity duration-500 ${
              showOwner ? "opacity-100" : "opacity-0"
            }`}
          >
            <p className="text-sm text-text-on-dark">{conv.owner}</p>
          </div>
          <div
            className={`flex items-center gap-1 self-start rounded-lg rounded-tl-sm bg-gold-tint px-md py-sm transition-opacity duration-300 ${
              showTyping ? "opacity-100" : "opacity-0"
            }`}
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-gold" />
            <span className="h-2 w-2 animate-pulse rounded-full bg-gold" style={{ animationDelay: "0.2s" }} />
            <span className="h-2 w-2 animate-pulse rounded-full bg-gold" style={{ animationDelay: "0.4s" }} />
          </div>
          <div
            className={`self-start rounded-lg rounded-tl-sm border-l-2 border-gold bg-gold-tint px-md py-sm transition-opacity duration-500 ${
              showAi ? "opacity-100" : "opacity-0"
            }`}
          >
            {conv.ai}
          </div>
        </div>
      </div>
    );
  }

  const showOwner1 = step >= 0;
  const showTyping1 = step === 1;
  const showAi1 = step >= 2;
  const showOwner2 = step >= 3;
  const showTyping2 = step === 4;
  const showAi2 = step >= 5;

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border-card bg-surface-dark">
      <div className="border-b border-border-dark px-md py-sm">
        <p className="text-xs font-medium text-text-muted-on-dark">AI Assistant</p>
      </div>
      <div className="flex min-h-[320px] flex-col gap-md p-md">
        {/* Owner message 1 */}
        <div
          className={`self-end rounded-lg rounded-tr-sm bg-surface-dark-elevated px-md py-sm transition-opacity duration-500 ${
            showOwner1 ? "opacity-100" : "opacity-0"
          }`}
        >
          <p className="text-sm text-text-on-dark">
            Who are my top 10 guests this month?
          </p>
        </div>

        {/* Typing indicator 1 */}
        <div
          className={`flex items-center gap-1 self-start rounded-lg rounded-tl-sm bg-gold-tint px-md py-sm transition-opacity duration-300 ${
            showTyping1 ? "opacity-100" : "opacity-0"
          }`}
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-gold" />
          <span
            className="h-2 w-2 animate-pulse rounded-full bg-gold"
            style={{ animationDelay: "0.2s" }}
          />
          <span
            className="h-2 w-2 animate-pulse rounded-full bg-gold"
            style={{ animationDelay: "0.4s" }}
          />
        </div>

        {/* AI response 1 - table */}
        <div
          className={`self-start rounded-lg rounded-tl-sm border-l-2 border-gold bg-gold-tint px-md py-sm transition-opacity duration-500 ${
            showAi1 ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="overflow-hidden rounded border border-gold/20">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gold/20 bg-gold/10">
                  <th className="px-sm py-xs font-medium text-gold">Guest</th>
                  <th className="px-sm py-xs font-medium text-gold">Visits</th>
                  <th className="px-sm py-xs font-medium text-gold">Spend</th>
                </tr>
              </thead>
              <tbody className="text-text-on-dark">
                <tr className="border-b border-gold/10">
                  <td className="px-sm py-xs">Sarah Chen</td>
                  <td className="px-sm py-xs">8</td>
                  <td className="px-sm py-xs">$1,240</td>
                </tr>
                <tr className="border-b border-gold/10">
                  <td className="px-sm py-xs">Marcus Lee</td>
                  <td className="px-sm py-xs">6</td>
                  <td className="px-sm py-xs">$980</td>
                </tr>
                <tr>
                  <td className="px-sm py-xs">Emma Wilson</td>
                  <td className="px-sm py-xs">5</td>
                  <td className="px-sm py-xs">$720</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Owner message 2 */}
        <div
          className={`self-end rounded-lg rounded-tr-sm bg-surface-dark-elevated px-md py-sm transition-opacity duration-500 ${
            showOwner2 ? "opacity-100" : "opacity-0"
          }`}
        >
          <p className="text-sm text-text-on-dark">
            Which regulars haven&apos;t visited in 60 days?
          </p>
        </div>

        {/* Typing indicator 2 */}
        <div
          className={`flex items-center gap-1 self-start rounded-lg rounded-tl-sm bg-gold-tint px-md py-sm transition-opacity duration-300 ${
            showTyping2 ? "opacity-100" : "opacity-0"
          }`}
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-gold" />
          <span
            className="h-2 w-2 animate-pulse rounded-full bg-gold"
            style={{ animationDelay: "0.2s" }}
          />
          <span
            className="h-2 w-2 animate-pulse rounded-full bg-gold"
            style={{ animationDelay: "0.4s" }}
          />
        </div>

        {/* AI response 2 - list */}
        <div
          className={`self-start rounded-lg rounded-tl-sm border-l-2 border-gold bg-gold-tint px-md py-sm transition-opacity duration-500 ${
            showAi2 ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="space-y-xs text-sm text-text-on-dark">
            <p>James M. — last visit 64 days ago</p>
            <p>Rachel K. — last visit 78 days ago</p>
            <p>David O. — last visit 72 days ago</p>
          </div>
        </div>
      </div>
    </div>
  );
}
