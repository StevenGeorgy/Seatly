// /account/security — diner login security: change password + change
// email. Both forms hide automatically for users without a password
// identity (Apple / Google / Phone-only sign-ins).
//
// Sits next to the other Preferences sub-pages (voice, connected
// accounts, privacy, my data, sign-in history) and is reached from
// the Preferences tab on /account.

import { Link } from "react-router-dom";
import { ShieldCheck } from "lucide-react";

import { AccountShell } from "@/components/customer/AccountShell";
import { ChangeEmailSection } from "@/components/customer/ChangeEmailSection";
import { ChangePasswordSection } from "@/components/customer/ChangePasswordSection";

export default function SecurityPage(): JSX.Element {
  return (
    <AccountShell activeSection="preferences">
      <header>
        <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
          <span className="h-px w-3 bg-gold/60" /> My Account
        </span>
        <h1 className="mt-2 font-serif text-5xl leading-none text-white">
          Security
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Change your password or the email you sign in with. Sensitive
          changes are kept here so they don't get bumped accidentally.
        </p>
      </header>

      <ChangePasswordSection />
      <ChangeEmailSection />

      <Link
        to="/account/sign-in-history"
        className="mt-5 flex items-center justify-between rounded-2xl border border-border bg-bg-surface p-5 transition-colors hover:border-gold/40"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-gold" />
          <div>
            <p className="font-serif text-lg text-white">Sign-in history</p>
            <p className="mt-1 text-xs text-text-secondary">
              Review recent sign-ins and sign out of every device.
            </p>
          </div>
        </div>
        <span className="text-xl text-gold" aria-hidden>
          →
        </span>
      </Link>
    </AccountShell>
  );
}
