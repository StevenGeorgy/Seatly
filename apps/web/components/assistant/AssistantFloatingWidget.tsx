"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { LandingAiChatDemo } from "@/components/landing/LandingAiChatDemo";

export function AssistantFloatingWidget() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const canShow = user?.role === "owner" || user?.role === "admin";
  if (!canShow) return null;

  return (
    <div className="fixed bottom-md right-md z-50 flex flex-col items-end gap-sm">
      {open ? (
        <div
          className="w-full max-w-sm overflow-hidden rounded-lg border border-border-card bg-surface-dark-elevated"
          aria-hidden={!open}
        >
          <div className="flex items-center justify-between gap-md border-b border-border-card px-md py-sm">
            <p className="text-sm font-semibold text-text-on-dark">AI Assistant</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-border-card px-sm py-xs text-sm text-text-muted-on-dark transition-colors duration-200 hover:border-gold/40 hover:text-text-on-dark"
            >
              Close
            </button>
          </div>

          <div className="max-h-[65vh] overflow-y-auto p-md">
            <LandingAiChatDemo variant="ai-page" />
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="rounded-md bg-gold px-lg py-md text-sm font-semibold text-text-on-gold shadow-gold-glow-hover transition-transform duration-400 hover:scale-[1.02]"
      >
        AI
      </button>
    </div>
  );
}

