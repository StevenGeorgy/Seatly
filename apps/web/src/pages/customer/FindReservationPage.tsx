import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, KeyRound, Loader2, Mail } from "lucide-react";

import { CenaivaWordmark } from "@/components/brand/CenaivaWordmark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getSupabaseAnonKey,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

type CodeLookupResponse = {
  ok?: boolean;
  found?: boolean;
  slug?: string;
  code?: string;
  error?: string;
};

export default function FindReservationPage() {
  const navigate = useNavigate();
  const location = useLocation();

  // Left card — confirmation code. Email is now required alongside the code
  // (security: closes the code-only enumeration attack — the email is on the
  // same confirmation message that contained the code).
  const [code, setCode] = useState("");
  const [codeEmail, setCodeEmail] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  // Right card — contact lookup.
  const [contactEmail, setContactEmail] = useState("");
  const [contactLastName, setContactLastName] = useState("");
  const [contactBusy, setContactBusy] = useState(false);

  const callFindReservation = async (body: Record<string, unknown>): Promise<Response> => {
    return fetch(`${getSupabaseProjectUrl()}/functions/v1/find-reservation`, {
      method: "POST",
      headers: {
        apikey: getSupabaseAnonKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  };

  const handleCodeSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCodeError(null);
    const trimmedCode = code.trim();
    const trimmedEmail = codeEmail.trim();
    if (!trimmedCode) {
      setCodeError("Enter your confirmation code.");
      return;
    }
    if (!trimmedEmail) {
      setCodeError("Enter the email on the reservation.");
      return;
    }
    if (!isSupabaseConfigured()) {
      setCodeError("We can't reach the lookup service right now. Please try again later.");
      return;
    }
    setCodeBusy(true);
    try {
      const res = await callFindReservation({
        lookup_type: "code",
        code: trimmedCode,
        email: trimmedEmail,
      });
      if (res.status === 429) {
        setCodeError("Too many attempts. Please wait a few minutes and try again.");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as CodeLookupResponse;
      if (!res.ok || body.error || body.ok !== true) {
        setCodeError(body.error ?? "Something went wrong. Please try again.");
        return;
      }
      if (body.found && body.slug && body.code) {
        // Pass email forward to ManageBookingView so cancel/modify can
        // re-prove identity on the next call.
        navigate(
          `/${body.slug}?confirmation=${encodeURIComponent(body.code)}&email=${encodeURIComponent(trimmedEmail)}`,
        );
        return;
      }
      setCodeError(
        "We couldn't find a reservation with that code and email. Double-check both, or use the email lookup on the right.",
      );
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : "Lookup failed. Please try again.");
    } finally {
      setCodeBusy(false);
    }
  };

  const handleContactSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = contactEmail.trim();
    const lastName = contactLastName.trim();
    if (!email || !lastName) {
      toast.error("Enter both your email and last name.");
      return;
    }
    if (!isSupabaseConfigured()) {
      toast.error("We can't reach the lookup service right now. Please try again later.");
      return;
    }
    setContactBusy(true);
    try {
      const res = await callFindReservation({
        lookup_type: "contact",
        email,
        last_name: lastName,
      });
      if (res.status === 429) {
        toast.error("Too many attempts. Please wait a few minutes and try again.");
        return;
      }
      // Generic response regardless of match — never reveal existence.
      toast.success("If we found a match, we've sent the manage link to your email.");
      setContactEmail("");
      setContactLastName("");
    } catch (err) {
      // Network errors fall through to the generic message too.
      toast.success("If we found a match, we've sent the manage link to your email.");
      console.warn("[FindReservation] contact lookup error:", err);
    } finally {
      setContactBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border/40 bg-background/85 backdrop-blur-xl">
        <div className="flex h-[5.5rem] w-full items-center px-4 sm:px-5">
          <Link to="/" className="flex shrink-0 items-center" aria-label="Cenaiva home">
            <CenaivaWordmark />
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-5 py-10 lg:px-8 lg:py-14">
        <div className="mb-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // location.key is "default" on the first router entry (deep link,
              // fresh tab, email click) and a generated string after any
              // in-app navigation. Fall back to "/" only when there's no
              // in-app history to pop.
              if (location.key !== "default") navigate(-1);
              else void navigate("/");
            }}
            className="-ml-2 gap-1.5 text-text-secondary"
          >
            <ArrowLeft className="size-4" />
            Back
          </Button>
          <h1 className="mt-6 font-serif text-3xl text-white sm:text-4xl">
            Find your reservation
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-text-secondary">
            Lost the confirmation email or SMS we sent? Pick the option that fits — we'll get
            you back to your booking.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          {/* Left card — confirmation code */}
          <form
            onSubmit={handleCodeSubmit}
            className="rounded-3xl border border-border bg-bg-surface p-6 shadow-2xl shadow-black/30 sm:p-7"
          >
            <div className="flex items-center gap-2">
              <span className="inline-flex size-9 items-center justify-center rounded-full border border-border bg-bg-elevated text-gold">
                <KeyRound className="size-4" />
              </span>
              <h2 className="font-serif text-xl text-white">I have my confirmation code</h2>
            </div>
            <p className="mt-3 text-sm text-text-secondary">
              Your code is in the email or SMS we sent when you booked — it looks like{" "}
              <span className="font-mono text-white">SEAT-A8B2</span>.
            </p>

            <div className="mt-5 space-y-3">
              <div className="space-y-2">
                <Label htmlFor="find-code" className="text-text-secondary">
                  Confirmation code
                </Label>
                <Input
                  id="find-code"
                  value={code}
                  maxLength={20}
                  onChange={(e) => {
                    setCode(e.target.value.slice(0, 20).toUpperCase());
                    if (codeError) setCodeError(null);
                  }}
                  placeholder="SEAT-A8B2"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  disabled={codeBusy}
                  className="font-mono uppercase tracking-[0.18em]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="find-code-email" className="text-text-secondary">
                  Email on the reservation
                </Label>
                <Input
                  id="find-code-email"
                  type="email"
                  value={codeEmail}
                  maxLength={254}
                  onChange={(e) => {
                    setCodeEmail(e.target.value.slice(0, 254));
                    if (codeError) setCodeError(null);
                  }}
                  placeholder="you@example.com"
                  autoComplete="email"
                  disabled={codeBusy}
                />
              </div>
              {codeError ? (
                <p className="text-xs text-danger">{codeError}</p>
              ) : null}
            </div>

            <Button
              type="submit"
              disabled={codeBusy}
              className="mt-5 h-11 w-full rounded-xl font-semibold"
            >
              {codeBusy ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Looking…
                </>
              ) : (
                "Find my booking"
              )}
            </Button>
          </form>

          {/* Right card — contact lookup */}
          <form
            onSubmit={handleContactSubmit}
            className="rounded-3xl border border-border bg-bg-surface p-6 shadow-2xl shadow-black/30 sm:p-7"
          >
            <div className="flex items-center gap-2">
              <span className="inline-flex size-9 items-center justify-center rounded-full border border-border bg-bg-elevated text-gold">
                <Mail className="size-4" />
              </span>
              <h2 className="font-serif text-xl text-white">I lost my code</h2>
            </div>
            <p className="mt-3 text-sm text-text-secondary">
              Enter the email and last name on the reservation. If they match, we'll re-send
              the manage link to your inbox.
            </p>

            <div className="mt-5 space-y-3">
              <div className="space-y-2">
                <Label htmlFor="find-email" className="text-text-secondary">
                  Email
                </Label>
                <Input
                  id="find-email"
                  type="email"
                  maxLength={254}
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value.slice(0, 254))}
                  placeholder="you@example.com"
                  autoComplete="email"
                  disabled={contactBusy}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="find-last-name" className="text-text-secondary">
                  Last name
                </Label>
                <Input
                  id="find-last-name"
                  maxLength={120}
                  value={contactLastName}
                  onChange={(e) => setContactLastName(e.target.value.slice(0, 120))}
                  placeholder="Smith"
                  autoComplete="family-name"
                  disabled={contactBusy}
                />
              </div>
            </div>

            <Button
              type="submit"
              variant="outline"
              disabled={contactBusy}
              className="mt-5 h-11 w-full rounded-xl font-semibold"
            >
              {contactBusy ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Sending…
                </>
              ) : (
                "Send me the link"
              )}
            </Button>
            <p className="mt-3 text-xs text-text-muted">
              For your security, we'll show the same confirmation regardless of whether we
              found a match.
            </p>
          </form>
        </div>

        <p className="mt-10 text-xs text-text-muted">
          Still stuck? Reach out to the restaurant directly — their phone number is on the
          original confirmation message we sent.
        </p>
      </main>
    </div>
  );
}
