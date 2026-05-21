import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2, Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { useUser } from "@/hooks/useUser";
import { useErrorToast } from "@/lib/errors";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

type ProfileNotifRow = {
  marketing_emails_consent: boolean | null;
  sms_opt_out: boolean | null;
};

type ReservationJoinRow = {
  restaurant_id: string;
  restaurants: { id: string; name: string | null } | null;
};

type CommPrefRow = {
  restaurant_id: string;
  marketing_opt_in: boolean | null;
};

type BookedRestaurant = {
  id: string;
  name: string;
};

const DEBOUNCE_MS = 350;

export default function NotificationsPreferencesPage(): JSX.Element {
  const navigate = useNavigate();
  const { user, profile } = useUser();
  const { errorToast } = useErrorToast();

  const [marketingEmails, setMarketingEmails] = useState<boolean>(false);
  const [marketingSms, setMarketingSms] = useState<boolean>(false);
  // Push notifications: placeholder (web push not yet implemented).
  const [pushNotifications] = useState<boolean>(false);

  const [bookedRestaurants, setBookedRestaurants] = useState<BookedRestaurant[]>([]);
  const [restaurantPrefs, setRestaurantPrefs] = useState<Record<string, boolean>>({});

  const [loading, setLoading] = useState<boolean>(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const emailsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const smsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restaurantTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const masterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user || !profile || !isSupabaseConfigured()) {
        setLoading(false);
        return;
      }
      try {
        const client = getSupabaseBrowserClient();

        const [{ data: prof }, { data: resvs }, { data: prefs }] = await Promise.all([
          client
            .from("user_profiles")
            .select("marketing_emails_consent, sms_opt_out")
            .eq("auth_user_id", user.id)
            .maybeSingle<ProfileNotifRow>(),
          client
            .from("reservations")
            .select("restaurant_id, restaurants(id, name)")
            .eq("user_profile_id", profile.id)
            .order("reserved_at", { ascending: false })
            .returns<ReservationJoinRow[]>(),
          client
            .from("user_restaurant_comm_prefs")
            .select("restaurant_id, marketing_opt_in")
            .eq("user_profile_id", profile.id)
            .returns<CommPrefRow[]>(),
        ]);

        if (cancelled) return;

        setMarketingEmails(Boolean(prof?.marketing_emails_consent));
        // sms_opt_out=true means OPTED OUT, so allow = !opt_out.
        setMarketingSms(!Boolean(prof?.sms_opt_out));

        // Dedupe past reservations by restaurant_id, keep most recent.
        const seen = new Set<string>();
        const booked: BookedRestaurant[] = [];
        for (const row of resvs ?? []) {
          if (!row.restaurant_id || seen.has(row.restaurant_id)) continue;
          seen.add(row.restaurant_id);
          booked.push({
            id: row.restaurant_id,
            name: row.restaurants?.name ?? "Restaurant",
          });
        }
        setBookedRestaurants(booked);

        const prefMap: Record<string, boolean> = {};
        for (const r of booked) {
          // Default opted in unless explicit row says otherwise.
          prefMap[r.id] = true;
        }
        for (const p of prefs ?? []) {
          if (p.restaurant_id in prefMap) {
            prefMap[p.restaurant_id] = p.marketing_opt_in !== false;
          }
        }
        setRestaurantPrefs(prefMap);
      } catch (err) {
        if (!cancelled) {
          errorToast(err, {
            fallback: "Couldn't load your notification preferences.",
            logTag: "[NotificationsPreferencesPage.load]",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, profile?.id]);

  useEffect(() => {
    return () => {
      if (emailsTimer.current) clearTimeout(emailsTimer.current);
      if (smsTimer.current) clearTimeout(smsTimer.current);
      if (masterTimer.current) clearTimeout(masterTimer.current);
      for (const t of Object.values(restaurantTimers.current)) clearTimeout(t);
    };
  }, []);

  async function persistProfile(
    key: "marketing_emails" | "marketing_sms",
    next: boolean,
  ): Promise<void> {
    if (!user || !isSupabaseConfigured()) return;
    setSavingKey(key);
    try {
      const client = getSupabaseBrowserClient();
      const nowIso = new Date().toISOString();
      const patch: Record<string, unknown> =
        key === "marketing_emails"
          ? {
              marketing_emails_consent: next,
              marketing_emails_consent_at: next ? nowIso : null,
            }
          : {
              // toggle = allow marketing SMS; storage column is sms_opt_out (inverted).
              sms_opt_out: !next,
            };
      const { error } = await client
        .from("user_profiles")
        .update(patch)
        .eq("auth_user_id", user.id);
      if (error) throw error;
    } catch (err) {
      // Revert optimistic UI on failure.
      if (key === "marketing_emails") setMarketingEmails((prev) => !prev);
      else setMarketingSms((prev) => !prev);
      errorToast(err, {
        fallback: "Couldn't save your preference. Try again.",
        logTag: `[NotificationsPreferencesPage.save.${key}]`,
      });
      throw err;
    } finally {
      setSavingKey(null);
    }
  }

  function onMarketingEmailsToggle(next: boolean) {
    setMarketingEmails(next);
    if (emailsTimer.current) clearTimeout(emailsTimer.current);
    emailsTimer.current = setTimeout(() => {
      persistProfile("marketing_emails", next)
        .then(() => {
          toast.success(
            next ? "Marketing emails enabled." : "Marketing emails disabled.",
          );
        })
        .catch(() => {
          /* error toast already fired */
        });
    }, DEBOUNCE_MS);
  }

  function onMarketingSmsToggle(next: boolean) {
    setMarketingSms(next);
    if (smsTimer.current) clearTimeout(smsTimer.current);
    smsTimer.current = setTimeout(() => {
      persistProfile("marketing_sms", next)
        .then(() => {
          toast.success(
            next ? "Marketing SMS enabled." : "Marketing SMS disabled.",
          );
        })
        .catch(() => {
          /* error toast already fired */
        });
    }, DEBOUNCE_MS);
  }

  async function persistRestaurantPref(
    restaurantId: string,
    next: boolean,
  ): Promise<void> {
    if (!profile || !isSupabaseConfigured()) return;
    setSavingKey(`restaurant:${restaurantId}`);
    try {
      const client = getSupabaseBrowserClient();
      const { error } = await client.from("user_restaurant_comm_prefs").upsert(
        {
          user_profile_id: profile.id,
          restaurant_id: restaurantId,
          marketing_opt_in: next,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_profile_id,restaurant_id" },
      );
      if (error) throw error;
    } catch (err) {
      // Revert optimistic UI on failure.
      setRestaurantPrefs((prev) => ({ ...prev, [restaurantId]: !next }));
      errorToast(err, {
        fallback: "Couldn't save your preference. Try again.",
        logTag: "[NotificationsPreferencesPage.save.restaurant]",
      });
      throw err;
    } finally {
      setSavingKey(null);
    }
  }

  function onRestaurantToggle(restaurantId: string, next: boolean) {
    setRestaurantPrefs((prev) => ({ ...prev, [restaurantId]: next }));
    const existing = restaurantTimers.current[restaurantId];
    if (existing) clearTimeout(existing);
    restaurantTimers.current[restaurantId] = setTimeout(() => {
      persistRestaurantPref(restaurantId, next)
        .then(() => {
          toast.success(next ? "Opted in." : "Opted out.");
        })
        .catch(() => {
          /* error toast already fired */
        });
    }, DEBOUNCE_MS);
  }

  const masterValue = useMemo(() => {
    if (bookedRestaurants.length === 0) return true;
    return bookedRestaurants.every((r) => restaurantPrefs[r.id] !== false);
  }, [bookedRestaurants, restaurantPrefs]);

  async function persistMaster(next: boolean): Promise<void> {
    if (!profile || !isSupabaseConfigured() || bookedRestaurants.length === 0) {
      return;
    }
    setSavingKey("master");
    try {
      const client = getSupabaseBrowserClient();
      const nowIso = new Date().toISOString();
      const rows = bookedRestaurants.map((r) => ({
        user_profile_id: profile.id,
        restaurant_id: r.id,
        marketing_opt_in: next,
        updated_at: nowIso,
      }));
      const { error } = await client
        .from("user_restaurant_comm_prefs")
        .upsert(rows, { onConflict: "user_profile_id,restaurant_id" });
      if (error) throw error;
    } catch (err) {
      // Revert optimistic UI on failure: invert all the values back.
      setRestaurantPrefs((prev) => {
        const reverted: Record<string, boolean> = { ...prev };
        for (const r of bookedRestaurants) reverted[r.id] = !next;
        return reverted;
      });
      errorToast(err, {
        fallback: "Couldn't update all restaurants. Try again.",
        logTag: "[NotificationsPreferencesPage.save.master]",
      });
      throw err;
    } finally {
      setSavingKey(null);
    }
  }

  function onMasterToggle(next: boolean) {
    // Optimistically flip all rows.
    setRestaurantPrefs((prev) => {
      const updated: Record<string, boolean> = { ...prev };
      for (const r of bookedRestaurants) updated[r.id] = next;
      return updated;
    });
    if (masterTimer.current) clearTimeout(masterTimer.current);
    masterTimer.current = setTimeout(() => {
      persistMaster(next)
        .then(() => {
          toast.success(
            next
              ? "Opted in to all restaurant marketing."
              : "Opted out of all restaurant marketing.",
          );
        })
        .catch(() => {
          /* error toast already fired */
        });
    }, DEBOUNCE_MS);
  }

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/account");
  };

  return (
    <div className="min-h-screen bg-bg-base text-text-primary">
      <main className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-8 lg:py-10">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-surface/70 px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:border-gold/40 hover:text-white"
        >
          <ArrowLeft className="size-4 text-gold" />
          Back
        </button>

        <header className="mt-6">
          <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
            <span className="h-px w-3 bg-gold/60" /> My Account
          </span>
          <h1 className="mt-2 font-serif text-5xl leading-none text-white">
            Notifications
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            Manage what we email, text, and push to you. Changes apply immediately.
          </p>
        </header>

        {loading ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-text-muted">
            <Loader2 className="size-4 animate-spin" /> Loading your preferences…
          </div>
        ) : (
          <div className="mt-6 space-y-8">
            {/* Section 1: Transactional (locked) */}
            <section>
              <h2 className="font-serif text-xl text-white">
                Transactional communications
              </h2>
              <div className="mt-3 rounded-2xl border border-border bg-bg-surface p-5">
                <div className="flex items-start gap-3 text-text-muted">
                  <Lock className="mt-0.5 size-4 shrink-0 text-text-muted" />
                  <p className="text-sm leading-relaxed">
                    These keep your bookings working — confirmations, security
                    alerts, and one-time codes. They can't be turned off because
                    they're required for your account to function safely.
                  </p>
                </div>
              </div>
            </section>

            {/* Section 2: Promotional */}
            <section>
              <h2 className="font-serif text-xl text-white">
                Promotional communications
              </h2>
              <div className="mt-3 space-y-4">
                <SettingRow
                  title="Marketing emails"
                  description="Occasional emails about deals, new restaurants, and product updates."
                  checked={marketingEmails}
                  saving={savingKey === "marketing_emails"}
                  onChange={onMarketingEmailsToggle}
                />
                <SettingRow
                  title="Allow marketing SMS"
                  description="Promotional texts about deals and new restaurants. We never share your number."
                  checked={marketingSms}
                  saving={savingKey === "marketing_sms"}
                  onChange={onMarketingSmsToggle}
                />
                <SettingRow
                  title="Push notifications"
                  description="Web push coming soon."
                  checked={pushNotifications}
                  saving={false}
                  disabled
                  onChange={() => {
                    /* disabled */
                  }}
                />
              </div>
            </section>

            {/* Section 3: Per-restaurant marketing */}
            <section>
              <h2 className="font-serif text-xl text-white">
                Restaurant marketing
              </h2>
              <p className="mt-1 text-xs text-text-secondary">
                Choose which restaurants can send you their marketing. We only
                show places you've booked.
              </p>

              {bookedRestaurants.length === 0 ? (
                <div className="mt-3 rounded-2xl border border-border bg-bg-surface p-5 text-sm text-text-muted">
                  Once you book a restaurant, you can manage marketing
                  preferences for them here.
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  <div className="rounded-2xl border border-border bg-bg-surface p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-serif text-base text-white">
                          Opt in to all restaurant marketing
                        </p>
                        <p className="mt-1 text-xs text-text-secondary">
                          Master switch — toggling this updates every restaurant
                          below.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {savingKey === "master" && (
                          <Loader2 className="size-4 animate-spin text-text-muted" />
                        )}
                        <Switch
                          checked={masterValue}
                          onCheckedChange={(next) => onMasterToggle(Boolean(next))}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="divide-y divide-border rounded-2xl border border-border bg-bg-surface">
                    {bookedRestaurants.map((r) => {
                      const checked = restaurantPrefs[r.id] !== false;
                      const saving = savingKey === `restaurant:${r.id}`;
                      return (
                        <div
                          key={r.id}
                          className="flex items-center justify-between gap-4 px-5 py-4"
                        >
                          <p className="min-w-0 truncate text-sm text-white">
                            {r.name}
                          </p>
                          <div className="flex items-center gap-2">
                            {saving && (
                              <Loader2 className="size-4 animate-spin text-text-muted" />
                            )}
                            <Switch
                              checked={checked}
                              onCheckedChange={(next) =>
                                onRestaurantToggle(r.id, Boolean(next))
                              }
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function SettingRow({
  title,
  description,
  checked,
  saving,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  saving: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-border bg-bg-surface p-5">
      <div className="min-w-0">
        <p className="font-serif text-lg text-white">{title}</p>
        <p className="mt-1 text-xs text-text-secondary">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        {saving && <Loader2 className="size-4 animate-spin text-text-muted" />}
        <Switch
          checked={checked}
          disabled={disabled}
          onCheckedChange={(next) => onChange(Boolean(next))}
        />
      </div>
    </div>
  );
}
