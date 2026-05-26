import { useState } from "react";
import { Database, Download, FileSearch, Loader2, Pencil } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { AccountShell } from "@/components/customer/AccountShell";
import { Button } from "@/components/ui/button";
import { useErrorToast } from "@/lib/errors";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

function todayStamp(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function MyDataPage(): JSX.Element {
  const { errorToast } = useErrorToast();
  const [downloading, setDownloading] = useState<boolean>(false);

  async function handleDownload(): Promise<void> {
    if (downloading) return;
    if (!isSupabaseConfigured()) {
      toast.error("Supabase isn't configured.");
      return;
    }
    setDownloading(true);
    try {
      const client = getSupabaseBrowserClient();
      const { data: sessionData } = await client.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        toast.error("Sign in expired — refresh and try again.");
        setDownloading(false);
        return;
      }
      const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/export-my-data`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: getSupabaseAnonKey(),
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        let detail = `Request failed (${res.status})`;
        try {
          const parsed: unknown = await res.json();
          if (
            parsed &&
            typeof parsed === "object" &&
            "error" in parsed &&
            typeof (parsed as { error: unknown }).error === "string"
          ) {
            detail = (parsed as { error: string }).error;
          }
        } catch {
          // fall through with status message
        }
        toast.error(detail);
        return;
      }
      const payload: unknown = await res.json();
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cenaiva-my-data-${todayStamp()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke after the click handler has run; small timeout avoids
      // Safari occasionally cancelling the download.
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast.success("Your data export has been downloaded.");
    } catch (err) {
      errorToast(err, {
        fallback: "Couldn't export your data. Try again or email privacy@cenaiva.com.",
        logTag: "[MyDataPage.download]",
      });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <AccountShell activeSection="preferences">
      <header>
          <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
            <span className="h-px w-3 bg-gold/60" /> My Account
          </span>
          <h1 className="mt-2 font-serif text-5xl leading-none text-white">My data</h1>
          <p className="mt-2 text-sm text-text-secondary">
            See what we hold about you, download a copy, or ask us to fix something
            that looks wrong. Per ToS §19.
          </p>
        </header>

        <section className="mt-6 space-y-4">
          <article className="rounded-2xl border border-border bg-bg-surface p-6">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-gold/30 bg-gold/10 text-gold">
                <Download className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-serif text-xl text-white">Download my data</p>
                <p className="mt-1 text-sm text-text-secondary">
                  Download a JSON file containing your profile, bookings, payments,
                  reviews, and recent sign-in events.
                </p>
                <div className="mt-4">
                  <Button
                    type="button"
                    onClick={() => void handleDownload()}
                    disabled={downloading}
                    className="gap-2"
                  >
                    {downloading ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Preparing…
                      </>
                    ) : (
                      <>
                        <Download className="size-4" />
                        Download my data
                      </>
                    )}
                  </Button>
                </div>
                <p className="mt-4 text-xs text-text-muted">
                  We'll respond to data-rights requests within 30 days per ToS §19.
                  Email{" "}
                  <a
                    className="text-gold underline-offset-4 hover:underline"
                    href="mailto:privacy@cenaiva.com"
                  >
                    privacy@cenaiva.com
                  </a>{" "}
                  for help.
                </p>
              </div>
            </div>
          </article>

          <Link
            to="/account/my-profile-data"
            className="flex items-start gap-3 rounded-2xl border border-border bg-bg-surface p-6 transition-colors hover:border-gold/40"
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-gold/30 bg-gold/10 text-gold">
              <FileSearch className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <p className="font-serif text-xl text-white">
                  What restaurants see about me
                </p>
                <span className="text-xl text-gold" aria-hidden>
                  →
                </span>
              </div>
              <p className="mt-1 text-sm text-text-secondary">
                View the tags, preferences, and notes that restaurants see when you
                book.
              </p>
            </div>
          </Link>

          <Link
            to="/account/my-profile-data"
            className="flex items-start gap-3 rounded-2xl border border-border bg-bg-surface p-6 transition-colors hover:border-gold/40"
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-gold/30 bg-gold/10 text-gold">
              <Pencil className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <p className="font-serif text-xl text-white">Request a correction</p>
                <span className="text-xl text-gold" aria-hidden>
                  →
                </span>
              </div>
              <p className="mt-1 text-sm text-text-secondary">
                If something looks wrong or out of date, let us know.
              </p>
            </div>
          </Link>

          <div className="rounded-2xl border border-border bg-bg-surface/60 p-5">
            <div className="flex items-start gap-3">
              <Database className="mt-0.5 size-4 shrink-0 text-text-muted" />
              <p className="text-xs text-text-secondary">
                Cenaiva keeps payment records for 7 years for CRA compliance, even
                after account deletion. Personally identifying information is
                anonymized 30 days after deletion. Full details in our{" "}
                <Link to="/privacy" className="text-gold hover:underline">
                  Privacy Policy
                </Link>
                .
              </p>
            </div>
          </div>
      </section>
    </AccountShell>
  );
}
