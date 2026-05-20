import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import { MarketingShell } from "@/components/marketing/MarketingShell";
import { BookDemoForm, type BookDemoFormValues } from "@/components/marketing/BookDemoForm";
import { Button } from "@/components/ui/button";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

function SectionEyebrow({ children }: { children: string }) {
  return (
    <p className="font-mono text-[11px] font-medium uppercase tracking-[0.32em] text-gold">
      {children}
    </p>
  );
}

export default function BookDemoPage() {
  const [submitted, setSubmitted] = useState<BookDemoFormValues | null>(null);

  return (
    <MarketingShell>
      <section className="relative overflow-hidden border-b border-border/40">
        <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:radial-gradient(ellipse_at_28%_0%,var(--gold)_0%,transparent_52%)]" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:64px_64px]" />
        <div className="relative w-full px-12 py-20 sm:px-16 md:px-20 lg:px-24 lg:py-28 xl:px-32 2xl:px-40">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease }}
            className="max-w-3xl"
          >
            <SectionEyebrow>For restaurants</SectionEyebrow>
            <h1 className="mt-6 font-serif text-5xl leading-[1.02] text-white sm:text-6xl">
              {submitted ? (
                <>
                  Got it.{" "}
                  <span className="italic text-gold">We'll be in touch.</span>
                </>
              ) : (
                <>
                  Let's show you{" "}
                  <span className="italic text-gold">Cenaiva.</span>
                </>
              )}
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-text-secondary sm:text-lg">
              {submitted ? (
                <>
                  Thanks, {submitted.name}. We received your request and will
                  reach out at <span className="text-gold">{submitted.email}</span>{" "}
                  within one business day.
                </>
              ) : (
                <>
                  Tell us about your restaurant. We'll reach out within one
                  business day to walk you through reservations, floor plan,
                  payments, and our AI assistant.
                </>
              )}
            </p>
          </motion.div>
        </div>
      </section>

      <section className="border-b border-border/40 py-16 lg:py-24">
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-12 sm:px-16 md:px-20 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:px-24 xl:px-32 2xl:px-40">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease }}
          >
            {submitted ? (
              <div className="rounded-lg border border-gold/30 bg-gold/5 p-8">
                <div className="flex items-start gap-4">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-full border border-gold/30 bg-gold/10 text-gold">
                    <CheckCircle2 className="size-6" />
                  </span>
                  <div>
                    <h2 className="font-serif text-2xl text-white">
                      Request received
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-text-secondary">
                      A real human reads every request. We'll match you with
                      someone who knows venues like yours and reach out within
                      one business day.
                    </p>
                  </div>
                </div>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Button asChild className="h-11 rounded-md px-6 font-semibold">
                    <Link to="/setup">
                      Or set up your restaurant now <ArrowRight className="ml-1 size-4" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="h-11 rounded-md px-6">
                    <Link to="/">Back to home</Link>
                  </Button>
                </div>
              </div>
            ) : (
              <BookDemoForm onSuccess={setSubmitted} />
            )}
          </motion.div>

          <motion.aside
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease, delay: 0.08 }}
            className="space-y-6"
          >
            <div className="rounded-lg border border-border/60 bg-bg-surface/40 p-6">
              <h3 className="font-serif text-xl text-white">What you get</h3>
              <ul className="mt-5 space-y-4 text-sm leading-relaxed text-text-secondary">
                <li className="flex gap-3">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-gold" />
                  <span>
                    <span className="block font-semibold text-white">
                      Free for 3 months
                    </span>
                    Set everything up. Take real bookings. No card required to
                    publish.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-gold" />
                  <span>
                    <span className="block font-semibold text-white">
                      Honest pricing
                    </span>
                    $199.99 CAD/month after trial. $1 per confirmed booking. 5.5% on
                    pre-orders &amp; deposits. Zero commission on menu prices.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-gold" />
                  <span>
                    <span className="block font-semibold text-white">
                      Cancel any month
                    </span>
                    No setup fee, no long-term contract.
                  </span>
                </li>
              </ul>
            </div>

            <div className="rounded-lg border border-border/40 bg-bg-surface/20 p-6">
              <p className="text-xs uppercase tracking-[0.18em] text-text-muted">
                Already convinced?
              </p>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                Skip the demo and start setting up your restaurant now. Most
                restaurants finish in about an hour, depending on menu size and
                photos.
              </p>
              <Button asChild variant="outline" className="mt-4 h-10 rounded-md font-semibold">
                <Link to="/setup">
                  List my restaurant <ArrowRight className="ml-1 size-4" />
                </Link>
              </Button>
            </div>
          </motion.aside>
        </div>
      </section>
    </MarketingShell>
  );
}
