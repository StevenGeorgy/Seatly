import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { AuthPageLayout } from "@/components/auth/AuthPageLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolvePostLoginPath } from "@/lib/auth/post-login-redirect";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { loadUserContext } from "@/lib/supabase/load-user-context";
import {
  formatE164ForDisplay,
  isValidOtpCode,
  normalizeE164Phone,
} from "@/lib/validation/phone-schemas";

// Phase 2 of diner auth overhaul (2026-05-15): phone-number sign-in
// via Supabase Auth + Twilio. Two-step UI: (1) enter phone → server
// texts a 6-digit code, (2) enter code → server creates the session.
// WhatsApp transport offered as an inline alternative ("Send code via
// WhatsApp instead") — Supabase + Twilio support both via the same
// `signInWithOtp` call with a different `channel` arg.
//
// After successful verify, falls into the same loadUserContext flow as
// LoginPage/RegisterPage. The Phase 1 DB trigger guarantees the
// `user_profiles` row exists by the time we redirect, and the trigger
// also copies `auth.users.phone` into `user_profiles.phone` automatically.
// Diners without a name/email yet will get bounced through `/onboarding`
// the moment they try to book (Phase 3 gate).

type Transport = "sms" | "whatsapp";

export default function PhoneLoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const from = params.get("from") ?? undefined;

  const [step, setStep] = useState<"enter-phone" | "enter-code">("enter-phone");
  const [phoneInput, setPhoneInput] = useState("");
  const [normalizedPhone, setNormalizedPhone] = useState<string | null>(null);
  const [transport, setTransport] = useState<Transport>("sms");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSendCode = async (e?: React.FormEvent, nextTransport?: Transport) => {
    if (e) e.preventDefault();
    if (submitting) return;
    if (!isSupabaseConfigured()) {
      toast.error("Auth is not configured. Try again later.");
      return;
    }
    const normalized = normalizeE164Phone(phoneInput);
    if (!normalized) {
      toast.error("That doesn't look like a phone number. Try +1 416 555 1234.");
      return;
    }
    setNormalizedPhone(normalized);
    const channel: Transport = nextTransport ?? transport;
    setTransport(channel);

    setSubmitting(true);
    try {
      const client = getSupabaseBrowserClient();
      const { error } = await client.auth.signInWithOtp({
        phone: normalized,
        options: {
          // Supabase passes this through to Twilio. "sms" or "whatsapp".
          channel,
        },
      });
      if (error) {
        const msg = error.message || "Couldn't send the code. Try again.";
        toast.error(msg);
        return;
      }
      setStep("enter-code");
      toast.success(
        channel === "whatsapp"
          ? "Code sent via WhatsApp — check your messages."
          : "Code sent — check your text messages.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !normalizedPhone) return;
    if (!isValidOtpCode(code)) {
      toast.error("Enter the 6-digit code from your text.");
      return;
    }
    if (!isSupabaseConfigured()) {
      toast.error("Auth is not configured. Try again later.");
      return;
    }
    setSubmitting(true);
    try {
      const client = getSupabaseBrowserClient();
      const { data, error } = await client.auth.verifyOtp({
        phone: normalizedPhone,
        token: code.trim(),
        type: "sms",
      });
      if (error) {
        toast.error(error.message || "That code didn't work. Try again.");
        return;
      }
      if (!data.session) {
        toast.error("Verification failed — no session returned.");
        return;
      }
      const ctx = await loadUserContext(client, data.session);
      if (!ctx.ok) {
        toast.error(ctx.error.message);
        return;
      }
      navigate(resolvePostLoginPath(from, ctx), { replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSwitchTransport = () => {
    const next: Transport = transport === "sms" ? "whatsapp" : "sms";
    void handleSendCode(undefined, next);
  };

  const handleBack = () => {
    setStep("enter-phone");
    setCode("");
  };

  if (step === "enter-code" && normalizedPhone) {
    return (
      <AuthPageLayout titleKey="auth.phone.title">
        <form className="space-y-4" onSubmit={(e) => void handleVerify(e)} noValidate>
          <div>
            <h2 className="font-serif text-2xl text-white">Enter your code</h2>
            <p className="mt-1.5 text-sm text-text-secondary">
              We sent a 6-digit code to{" "}
              <span className="font-medium text-white">
                {formatE164ForDisplay(normalizedPhone)}
              </span>{" "}
              via {transport === "whatsapp" ? "WhatsApp" : "text"}.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone-otp-code">6-digit code</Label>
            <Input
              id="phone-otp-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="h-12 px-4 rounded-md tracking-[0.5em] text-center text-lg font-medium"
              placeholder="• • • • • •"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              autoFocus
            />
          </div>
          <Button
            className="h-12 w-full text-base font-semibold"
            disabled={submitting || code.length !== 6}
            type="submit"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Verifying…
              </>
            ) : (
              "Verify and sign in"
            )}
          </Button>
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={handleBack}
              className="text-text-secondary underline-offset-4 hover:text-white hover:underline"
              disabled={submitting}
            >
              ← Use a different number
            </button>
            <button
              type="button"
              onClick={() => void handleSendCode(undefined, transport)}
              className="text-text-secondary underline-offset-4 hover:text-white hover:underline"
              disabled={submitting}
            >
              Resend code
            </button>
          </div>
          <p className="text-center text-xs text-text-muted">
            Didn't get the {transport === "whatsapp" ? "WhatsApp message" : "text"}?{" "}
            <button
              type="button"
              onClick={handleSwitchTransport}
              className="text-gold underline-offset-4 hover:underline"
              disabled={submitting}
            >
              Try via {transport === "whatsapp" ? "text" : "WhatsApp"} instead
            </button>
          </p>
        </form>
      </AuthPageLayout>
    );
  }

  return (
    <AuthPageLayout titleKey="auth.phone.title">
      <form className="space-y-4" onSubmit={(e) => void handleSendCode(e)} noValidate>
        <div>
          <h2 className="font-serif text-2xl text-white">Sign in with phone</h2>
          <p className="mt-1.5 text-sm text-text-secondary">
            We'll text you a 6-digit code to confirm it's you. No password to remember.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone-input">Phone number</Label>
          <Input
            id="phone-input"
            type="tel"
            autoComplete="tel"
            className="h-12 px-4 rounded-md"
            placeholder="+1 (416) 555-1234"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            autoFocus
          />
          <p className="text-xs text-text-muted">
            Canadian and US numbers work without a country code. Add{" "}
            <span className="font-mono">+</span> for international.
          </p>
        </div>
        <Button
          className="h-12 w-full text-base font-semibold"
          disabled={submitting || phoneInput.trim().length < 7}
          type="submit"
        >
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Sending code…
            </>
          ) : (
            "Send me a code"
          )}
        </Button>
        <button
          type="button"
          onClick={() => void handleSendCode(undefined, "whatsapp")}
          disabled={submitting || phoneInput.trim().length < 7}
          className="h-11 w-full rounded-md border border-border bg-bg-surface/40 text-sm font-medium text-text-secondary transition-colors hover:border-gold/40 hover:text-white disabled:opacity-50"
        >
          Send code via WhatsApp instead
        </button>
      </form>
      <p className="text-center text-sm text-text-secondary">
        <Link
          className="text-primary underline-offset-4 hover:underline"
          to={from ? `/login?from=${encodeURIComponent(from)}` : "/login"}
        >
          ← Use a different sign-in method
        </Link>
      </p>
    </AuthPageLayout>
  );
}
