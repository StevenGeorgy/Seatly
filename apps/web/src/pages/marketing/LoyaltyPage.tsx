import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

function SectionEyebrow({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.28em] text-gold">
      <span className="h-px w-4 bg-gold/60" />
      {children}
    </span>
  );
}

async function submitWaitlist(email: string, source: string | null): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Sign-ups are temporarily unavailable." };
  }
  const client = getSupabaseBrowserClient();
  const { data: sessionData } = await client.auth.getSession();
  const token = sessionData.session?.access_token;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: getSupabaseAnonKey(),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/loyalty-waitlist-signup`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, source }),
  });
  let parsed: { error?: string; ok?: boolean } = {};
  try {
    parsed = await res.json();
  } catch {
    parsed = {};
  }
  if (!res.ok) {
    return { ok: false, error: parsed.error ?? `Request failed (${res.status})` };
  }
  return { ok: true };
}

export default function LoyaltyPage() {
  const [searchParams] = useSearchParams();
  const source = searchParams.get("ref");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error("Enter your email so we know where to send the news.");
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    const result = await submitWaitlist(trimmed, source);
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't sign you up. Try again in a moment.");
      return;
    }
    setSubmitted(true);
  };

  return (
    <MarketingShell>
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:radial-gradient(ellipse_at_35%_0%,var(--gold)_0%,transparent_52%)]" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:64px_64px]" />
        <div className="relative w-full px-6 py-24 sm:px-12 md:px-20 lg:px-24 lg:py-32 xl:px-32 2xl:px-40">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease }}
            className="mx-auto max-w-3xl text-center"
          >
            <SectionEyebrow>Coming Soon</SectionEyebrow>
            <h1 className="mt-6 font-serif text-3xl leading-tight text-white sm:text-6xl sm:leading-[1.04] lg:text-7xl">
              Loyalty points, coming to your{" "}
              <span className="italic text-gold">favourite restaurants</span>.
            </h1>
            <p className="mx-auto mt-7 max-w-2xl text-base leading-relaxed text-text-secondary sm:text-lg">
              We're building a points program that pays you back for booking, pre-ordering,
              and dining out — one pass across every restaurant on Cenaiva.
            </p>

            <div className="mx-auto mt-10 max-w-md">
              {submitted ? (
                <div className="flex items-center justify-center gap-2 rounded-md border border-success/30 bg-success/5 px-4 py-3 text-sm text-success">
                  <CheckCircle2 className="size-4" />
                  Thanks — we'll email you the moment it's live.
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
                  <label className="relative flex-1">
                    <span className="sr-only">Email address</span>
                    <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
                    <input
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      required
                      maxLength={254}
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                      disabled={submitting}
                      className="h-11 w-full rounded-md border border-border bg-bg-surface pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus-visible:border-gold/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/20 disabled:opacity-60"
                    />
                  </label>
                  <Button
                    type="submit"
                    disabled={submitting}
                    className="h-11 rounded-md px-5 font-semibold"
                  >
                    {submitting ? (
                      <Loader2 className="mr-1.5 size-4 animate-spin" />
                    ) : null}
                    Notify me at launch
                  </Button>
                </form>
              )}
            </div>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild className="h-11 rounded-md px-6 font-semibold">
                <Link to="/discover">
                  Browse restaurants <ArrowRight className="ml-1 size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-11 rounded-md px-6">
                <Link to="/features">See features</Link>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>
    </MarketingShell>
  );
}
