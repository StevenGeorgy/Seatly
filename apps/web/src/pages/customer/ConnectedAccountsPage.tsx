import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/useUser";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

// Phase 5 of diner auth overhaul (2026-05-15): the proactive linking
// surface. Even outside the merge-on-sign-in flow, diners may want to
// connect another provider so they can sign in with Apple on iPhone
// AND Google on laptop without having two accounts.
//
// Uses Supabase's built-in identity linking:
//   - `client.auth.linkIdentity({ provider })` — initiates OAuth for
//     the new provider; on callback Supabase attaches the new identity
//     to the CURRENT user instead of creating a new auth.users row.
//   - `client.auth.unlinkIdentity(identity)` — disconnects a provider;
//     Supabase prevents disconnecting the last identity (would lock
//     the diner out).

const PROVIDER_LABELS: Record<string, { label: string; description: string }> = {
  apple: { label: "Apple", description: "Sign in with Apple ID" },
  google: { label: "Google", description: "Sign in with Google account" },
  phone: { label: "Phone", description: "SMS verification code" },
  email: { label: "Email", description: "Email + password" },
};

type IdentityRow = {
  identity_id: string;
  provider: string;
  identity_data?: Record<string, unknown>;
  created_at?: string;
  last_sign_in_at?: string | null;
};

export default function ConnectedAccountsPage() {
  const { user, loading: userLoading, refreshUser } = useUser();
  const [identities, setIdentities] = useState<IdentityRow[]>([]);
  const [linkingProvider, setLinkingProvider] = useState<string | null>(null);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

  const refreshIdentities = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    const client = getSupabaseBrowserClient();
    const { data, error } = await client.auth.getUserIdentities();
    if (error) {
      toast.error(error.message || "Couldn't load your connected accounts.");
      return;
    }
    setIdentities((data?.identities ?? []) as IdentityRow[]);
  }, []);

  useEffect(() => {
    if (userLoading) return;
    if (!user) return;
    void refreshIdentities();
  }, [user, userLoading, refreshIdentities]);

  const linkedProviders = useMemo(
    () => new Set(identities.map((i) => i.provider)),
    [identities],
  );
  const availableToLink = (
    ["apple", "google", "phone"] as const
  ).filter((p) => !linkedProviders.has(p));

  const handleLink = async (provider: "apple" | "google") => {
    if (!isSupabaseConfigured()) {
      toast.error("Auth is not configured.");
      return;
    }
    setLinkingProvider(provider);
    try {
      const client = getSupabaseBrowserClient();
      const { error } = await client.auth.linkIdentity({
        provider,
        options: {
          redirectTo: `${window.location.origin}/account/connected-accounts`,
        },
      });
      if (error) {
        toast.error(error.message || `Couldn't link your ${provider} account.`);
      }
      // On success the browser redirects to provider OAuth; nothing else to do here.
    } finally {
      setLinkingProvider(null);
    }
  };

  const handleUnlink = async (identity: IdentityRow) => {
    if (!isSupabaseConfigured()) return;
    if (identities.length <= 1) {
      toast.error(
        "You need at least one sign-in method. Add another before removing this one.",
      );
      return;
    }
    setUnlinkingId(identity.identity_id);
    try {
      const client = getSupabaseBrowserClient();
      // Supabase's unlinkIdentity wants the full identity object.
      const { error } = await client.auth.unlinkIdentity(
        identity as unknown as Parameters<typeof client.auth.unlinkIdentity>[0],
      );
      if (error) {
        toast.error(error.message || "Couldn't disconnect that account.");
        return;
      }
      toast.success(`${PROVIDER_LABELS[identity.provider]?.label ?? identity.provider} disconnected.`);
      await refreshIdentities();
      await refreshUser();
    } finally {
      setUnlinkingId(null);
    }
  };

  if (userLoading) {
    return (
      <div className="min-h-screen bg-bg-base text-white">
        <main className="mx-auto max-w-3xl px-6 py-10 lg:px-10">
          <Loader2 className="size-5 animate-spin text-text-muted" />
        </main>
      </div>
    );
  }

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

        <h1 className="mt-4 font-serif text-3xl">Connected accounts</h1>
        <p className="mt-2 max-w-xl text-sm text-text-secondary">
          Sign in to Cenaiva with any of these methods. They all point at the same
          account, so you'll see the same bookings, saved cards, and history no matter
          which one you use.
        </p>

        <section className="mt-8 space-y-3">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
            Linked sign-in methods
          </h2>
          {identities.length === 0 ? (
            <div className="rounded-2xl border border-border bg-bg-surface/60 p-4 text-sm text-text-secondary">
              No identities found.
            </div>
          ) : (
            identities.map((identity) => {
              const label =
                PROVIDER_LABELS[identity.provider]?.label ?? identity.provider;
              const desc = PROVIDER_LABELS[identity.provider]?.description ?? "";
              const sub =
                (identity.identity_data?.email as string | undefined) ??
                (identity.identity_data?.phone as string | undefined) ??
                desc;
              return (
                <div
                  key={identity.identity_id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-bg-surface/60 p-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white">{label}</p>
                    <p className="truncate text-xs text-text-muted">{sub}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleUnlink(identity)}
                    disabled={unlinkingId === identity.identity_id || identities.length <= 1}
                    className="text-danger hover:text-danger/80"
                  >
                    {unlinkingId === identity.identity_id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                  </Button>
                </div>
              );
            })
          )}
        </section>

        {availableToLink.length > 0 ? (
          <section className="mt-8 space-y-3">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
              Add another sign-in method
            </h2>
            {availableToLink.map((provider) => {
              const label = PROVIDER_LABELS[provider]?.label ?? provider;
              const desc = PROVIDER_LABELS[provider]?.description ?? "";
              const canLink = provider === "apple" || provider === "google";
              return (
                <div
                  key={provider}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-dashed border-border bg-bg-surface/30 p-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white">{label}</p>
                    <p className="truncate text-xs text-text-muted">{desc}</p>
                  </div>
                  {canLink ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleLink(provider)}
                      disabled={linkingProvider === provider}
                      className="gap-1.5"
                    >
                      {linkingProvider === provider ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Plus className="size-4" />
                      )}
                      Link
                    </Button>
                  ) : (
                    <span className="text-xs text-text-muted">
                      Sign in with this method to add it
                    </span>
                  )}
                </div>
              );
            })}
          </section>
        ) : null}

        <p className="mt-8 text-xs text-text-muted">
          Disconnecting a sign-in method doesn't delete your account — you'll just need
          to use one of the other methods to sign in next time. The last remaining
          method can't be removed.
        </p>
      </main>
    </div>
  );
}
