import { ArrowLeft, Check, Loader2, Mic } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useCenaivaVoicePreference } from "@/hooks/useCenaivaVoicePreference";
import type { CenaivaTtsVoice } from "@/lib/cenaiva/voicePreference";
import { cn } from "@/lib/utils";

const VOICE_OPTIONS: { id: CenaivaTtsVoice; label: string; description: string }[] = [
  {
    id: "female",
    label: "Female",
    description: "Warm, conversational. Default for most diners.",
  },
  {
    id: "male",
    label: "Male",
    description: "Lower register, calmer cadence.",
  },
];

export default function AccountVoicePage() {
  const { voicePreference, isLoading, isSaving, setVoicePreference } =
    useCenaivaVoicePreference();

  const handleSelect = async (voice: CenaivaTtsVoice) => {
    if (voice === voicePreference || isSaving) return;
    await setVoicePreference(voice);
  };

  return (
    <div className="min-h-screen bg-bg-base text-white">
      <main className="mx-auto max-w-3xl px-6 py-10 lg:px-10">
        <Link
          to="/account"
          className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-[0.2em] text-text-muted hover:text-white"
        >
          <ArrowLeft className="size-3.5" />
          Back to account
        </Link>

        <header className="mt-6">
          <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
            <span className="h-px w-3 bg-gold/60" /> Cenaiva voice
          </span>
          <h1 className="mt-2 font-serif text-5xl leading-none text-white">
            Choose your voice
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            How Cenaiva sounds when she speaks back. Your choice syncs across
            web and mobile.
          </p>
        </header>

        <section className="mt-8 space-y-3">
          {VOICE_OPTIONS.map((option) => {
            const selected = voicePreference === option.id;
            return (
              <button
                key={option.id}
                type="button"
                disabled={isSaving || isLoading}
                onClick={() => void handleSelect(option.id)}
                className={cn(
                  "flex w-full items-center justify-between rounded-2xl border p-5 text-left transition",
                  selected
                    ? "border-gold/60 bg-gold/10"
                    : "border-border bg-bg-elevated hover:border-gold/30",
                  (isSaving || isLoading) && "cursor-not-allowed opacity-60",
                )}
              >
                <div className="flex items-start gap-4">
                  <div
                    className={cn(
                      "flex size-10 items-center justify-center rounded-xl border",
                      selected
                        ? "border-gold/40 bg-gold/15 text-gold"
                        : "border-border bg-bg-base text-text-secondary",
                    )}
                  >
                    <Mic className="size-4" />
                  </div>
                  <div>
                    <p className="text-base font-medium text-white">{option.label}</p>
                    <p className="mt-1 text-xs text-text-secondary">
                      {option.description}
                    </p>
                  </div>
                </div>
                {selected ? (
                  <Check className="size-5 text-gold" />
                ) : isSaving ? (
                  <Loader2 className="size-4 animate-spin text-text-muted" />
                ) : null}
              </button>
            );
          })}
        </section>

        <p className="mt-6 text-xs text-text-muted">
          You can change this anytime. The next thing Cenaiva says will use the
          new voice.
        </p>

        <div className="mt-10">
          <Link to="/account">
            <Button variant="outline">Done</Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
