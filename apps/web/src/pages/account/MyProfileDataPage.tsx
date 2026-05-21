import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ArrowLeft, Info, Loader2, Send } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useUser } from "@/hooks/useUser";
import { useErrorToast } from "@/lib/errors";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

// Shape we hope to see from get-my-profile-tags. The mobile fn lives
// outside this repo, so we treat the response as `unknown` and apply
// defensive guards before rendering.
type ProfileTag = {
  key: string;
  value: string | null;
  updated_at: string | null;
};

type ProfileTagsResponse = {
  tags: ProfileTag[];
  no_show_risk_score: number | null;
  lifetime_value_cents: number | null;
};

type CorrectionRow = {
  id: string;
  field: string;
  current_value: string | null;
  proposed_value: string;
  rationale: string | null;
  status: string;
  created_at: string;
};

const FIELD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "profile_name", label: "Profile name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "allergy_tag", label: "Allergy tag" },
  { value: "no_show_risk_score", label: "No-show risk score" },
  { value: "other", label: "Other" },
];

const PROPOSED_MAX = 500;
const RATIONALE_MAX = 1000;

function isProfileTag(v: unknown): v is ProfileTag {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  if (typeof r.key !== "string") return false;
  if (r.value !== null && typeof r.value !== "string") return false;
  if (r.updated_at !== null && typeof r.updated_at !== "string" && r.updated_at !== undefined) {
    return false;
  }
  return true;
}

function parseProfileTagsResponse(raw: unknown): ProfileTagsResponse {
  const out: ProfileTagsResponse = {
    tags: [],
    no_show_risk_score: null,
    lifetime_value_cents: null,
  };
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.tags)) {
    out.tags = obj.tags.filter(isProfileTag).map((t) => ({
      key: t.key,
      value: t.value ?? null,
      updated_at: typeof t.updated_at === "string" ? t.updated_at : null,
    }));
  }
  if (typeof obj.no_show_risk_score === "number") {
    out.no_show_risk_score = obj.no_show_risk_score;
  }
  if (typeof obj.lifetime_value_cents === "number") {
    out.lifetime_value_cents = obj.lifetime_value_cents;
  }
  return out;
}

function humanizeTagKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "Unknown";
  try {
    return format(new Date(iso), "MMM d, yyyy");
  } catch {
    return iso;
  }
}

function correctionStatusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "approved") return "default";
  if (status === "rejected" || status === "withdrawn") return "destructive";
  return "secondary";
}

export default function MyProfileDataPage(): JSX.Element {
  const navigate = useNavigate();
  const { user, profile } = useUser();
  const { errorToast } = useErrorToast();

  const [tagsLoading, setTagsLoading] = useState<boolean>(true);
  const [tagsError, setTagsError] = useState<string | null>(null);
  const [tagsData, setTagsData] = useState<ProfileTagsResponse>({
    tags: [],
    no_show_risk_score: null,
    lifetime_value_cents: null,
  });

  const [field, setField] = useState<string>("profile_name");
  const [currentValue, setCurrentValue] = useState<string>("");
  const [proposedValue, setProposedValue] = useState<string>("");
  const [rationale, setRationale] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);

  const [requests, setRequests] = useState<CorrectionRow[]>([]);
  const [requestsLoading, setRequestsLoading] = useState<boolean>(true);

  const tagsByKey = useMemo(() => {
    const map = new Map<string, ProfileTag>();
    for (const t of tagsData.tags) map.set(t.key, t);
    return map;
  }, [tagsData.tags]);

  // Seed `currentValue` from the profile / tags response when the
  // selected field maps to something we already know.
  useEffect(() => {
    let next = "";
    switch (field) {
      case "profile_name":
        next = profile?.full_name ?? "";
        break;
      case "email":
        next = profile?.email ?? "";
        break;
      case "phone":
        next = profile?.phone ?? "";
        break;
      case "allergy_tag":
        next = (profile?.allergies ?? []).join(", ");
        break;
      case "no_show_risk_score":
        next =
          tagsData.no_show_risk_score !== null
            ? String(tagsData.no_show_risk_score)
            : "";
        break;
      default: {
        // For "other" / unmapped, try matching a tag with the same key.
        const t = tagsByKey.get(field);
        next = t?.value ?? "";
      }
    }
    setCurrentValue(next);
  }, [field, profile, tagsData, tagsByKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadTags(): Promise<void> {
      if (!isSupabaseConfigured()) {
        setTagsLoading(false);
        return;
      }
      try {
        const client = getSupabaseBrowserClient();
        const { data: sessionData } = await client.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) {
          if (!cancelled) {
            setTagsError("Sign in expired — refresh and try again.");
            setTagsLoading(false);
          }
          return;
        }
        const res = await fetch(
          `${getSupabaseProjectUrl()}/functions/v1/get-my-profile-tags`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              apikey: getSupabaseAnonKey(),
            },
            body: JSON.stringify({}),
          },
        );
        if (!res.ok) {
          if (!cancelled) {
            setTagsError(`Couldn't load tags (status ${res.status}).`);
            setTagsLoading(false);
          }
          return;
        }
        const payload: unknown = await res.json();
        if (!cancelled) {
          setTagsData(parseProfileTagsResponse(payload));
          setTagsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setTagsError(
            err instanceof Error ? err.message : "Couldn't load your profile data.",
          );
          setTagsLoading(false);
        }
      }
    }

    async function loadRequests(): Promise<void> {
      if (!profile || !isSupabaseConfigured()) {
        setRequestsLoading(false);
        return;
      }
      try {
        const client = getSupabaseBrowserClient();
        const { data, error } = await client
          .from("data_correction_requests")
          .select(
            "id, field, current_value, proposed_value, rationale, status, created_at",
          )
          .eq("user_profile_id", profile.id)
          .order("created_at", { ascending: false })
          .limit(50)
          .returns<CorrectionRow[]>();
        if (error) throw error;
        if (!cancelled) {
          setRequests(data ?? []);
          setRequestsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setRequestsLoading(false);
          errorToast(err, {
            fallback: "Couldn't load your prior correction requests.",
            logTag: "[MyProfileDataPage.loadRequests]",
          });
        }
      }
    }

    void loadTags();
    void loadRequests();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, profile?.id]);

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/account/my-data");
  };

  const proposedTrimmed = proposedValue.trim();
  const canSubmit =
    !submitting &&
    Boolean(profile) &&
    proposedTrimmed.length > 0 &&
    proposedTrimmed.length <= PROPOSED_MAX &&
    rationale.length <= RATIONALE_MAX;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit || !profile) return;
    if (!isSupabaseConfigured()) {
      toast.error("Supabase isn't configured.");
      return;
    }
    setSubmitting(true);
    try {
      const client = getSupabaseBrowserClient();
      const { error } = await client.from("data_correction_requests").insert({
        user_profile_id: profile.id,
        field,
        current_value: currentValue.trim() || null,
        proposed_value: proposedTrimmed,
        rationale: rationale.trim() || null,
      });
      if (error) throw error;
      toast.success(
        "Correction request submitted. We'll review and reply within 30 days at privacy@cenaiva.com.",
      );
      setProposedValue("");
      setRationale("");
      // Reload the list so the new row appears at the top.
      const { data } = await client
        .from("data_correction_requests")
        .select(
          "id, field, current_value, proposed_value, rationale, status, created_at",
        )
        .eq("user_profile_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(50)
        .returns<CorrectionRow[]>();
      setRequests(data ?? []);
    } catch (err) {
      errorToast(err, {
        fallback: "Couldn't submit your request. Try again.",
        logTag: "[MyProfileDataPage.submit]",
      });
    } finally {
      setSubmitting(false);
    }
  }

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
            My profile data
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            The tags, preferences, and notes restaurants see when you book. Ask us to
            fix anything that's wrong.
          </p>
        </header>

        <section className="mt-6 rounded-2xl border border-border bg-bg-surface p-6">
          <p className="font-serif text-2xl text-white">My profile tags</p>
          <p className="mt-1 text-xs text-text-secondary">
            These signals come from your bookings, profile, and explicit
            preferences. We don't share them outside the restaurant you're booking
            with.
          </p>

          {tagsLoading ? (
            <div className="mt-5 flex items-center gap-2 text-sm text-text-muted">
              <Loader2 className="size-4 animate-spin" /> Loading your profile data…
            </div>
          ) : tagsError ? (
            <p className="mt-5 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
              {tagsError}
            </p>
          ) : tagsData.tags.length === 0 &&
            tagsData.no_show_risk_score === null &&
            tagsData.lifetime_value_cents === null ? (
            <p className="mt-5 text-sm text-text-muted">
              No restaurant-visible tags on file yet. Book and dine a few times and
              they'll start showing up here.
            </p>
          ) : (
            <div className="mt-5 divide-y divide-border rounded-xl border border-border">
              {tagsData.no_show_risk_score !== null && (
                <ProfileRow
                  label="No-show risk score"
                  value={`${tagsData.no_show_risk_score}`}
                  updatedAt={null}
                />
              )}
              {tagsData.lifetime_value_cents !== null && (
                <ProfileRow
                  label="Lifetime value"
                  value={`CA$${(tagsData.lifetime_value_cents / 100).toFixed(2)}`}
                  updatedAt={null}
                />
              )}
              {tagsData.tags.map((tag) => (
                <ProfileRow
                  key={tag.key}
                  label={humanizeTagKey(tag.key)}
                  value={tag.value ?? "Not available"}
                  updatedAt={tag.updated_at}
                />
              ))}
            </div>
          )}
        </section>

        <section className="mt-6 rounded-2xl border border-border bg-bg-surface p-6">
          <p className="font-serif text-2xl text-white">Request a correction</p>
          <p className="mt-1 text-xs text-text-secondary">
            Tell us what's wrong and what it should say. We'll respond within 30 days
            per ToS §19.
          </p>

          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="mt-5 space-y-4"
            aria-label="Submit a data correction request"
          >
            <div className="space-y-1.5">
              <Label htmlFor="correction-field">Field</Label>
              <Select value={field} onValueChange={setField}>
                <SelectTrigger id="correction-field">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="correction-current">Current value</Label>
              <Input
                id="correction-current"
                value={currentValue}
                onChange={(e) => setCurrentValue(e.target.value)}
                placeholder="What we currently have on file"
                maxLength={500}
              />
              <p className="text-[11px] text-text-muted">
                Auto-filled from your profile where we know it.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="correction-proposed">
                Proposed value <span className="text-danger">*</span>
              </Label>
              <Textarea
                id="correction-proposed"
                value={proposedValue}
                onChange={(e) => setProposedValue(e.target.value)}
                placeholder="What it should say instead"
                maxLength={PROPOSED_MAX}
                rows={3}
                required
              />
              <p className="text-[11px] text-text-muted">
                {proposedTrimmed.length}/{PROPOSED_MAX}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="correction-rationale">Rationale (optional)</Label>
              <Textarea
                id="correction-rationale"
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder="Anything that helps us understand the change"
                maxLength={RATIONALE_MAX}
                rows={3}
              />
              <p className="text-[11px] text-text-muted">
                {rationale.length}/{RATIONALE_MAX}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={!canSubmit} className="gap-2">
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Submitting…
                  </>
                ) : (
                  <>
                    <Send className="size-4" />
                    Submit request
                  </>
                )}
              </Button>
              <p className="inline-flex items-center gap-1.5 text-[11px] text-text-muted">
                <Info className="size-3.5" />
                We never modify your record without confirming with you first.
              </p>
            </div>
          </form>
        </section>

        <section className="mt-6 rounded-2xl border border-border bg-bg-surface p-6">
          <p className="font-serif text-2xl text-white">Your prior requests</p>
          <p className="mt-1 text-xs text-text-secondary">
            History of corrections you've submitted.
          </p>

          {requestsLoading ? (
            <div className="mt-5 flex items-center gap-2 text-sm text-text-muted">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : requests.length === 0 ? (
            <p className="mt-5 text-sm text-text-muted">
              You haven't submitted any correction requests yet.
            </p>
          ) : (
            <ul className="mt-5 space-y-3">
              {requests.map((row) => (
                <li
                  key={row.id}
                  className="rounded-xl border border-border bg-bg-elevated p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-serif text-base text-white">
                      {humanizeTagKey(row.field)}
                    </p>
                    <div className="flex items-center gap-2">
                      <Badge variant={correctionStatusVariant(row.status)}>
                        {row.status}
                      </Badge>
                      <span className="text-[11px] text-text-muted">
                        {formatTimestamp(row.created_at)}
                      </span>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-text-secondary">
                    <span className="text-text-muted">Proposed:</span>{" "}
                    {row.proposed_value}
                  </p>
                  {row.current_value && (
                    <p className="mt-1 text-xs text-text-secondary">
                      <span className="text-text-muted">Currently:</span>{" "}
                      {row.current_value}
                    </p>
                  )}
                  {row.rationale && (
                    <p className="mt-1 text-xs text-text-muted">"{row.rationale}"</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function ProfileRow({
  label,
  value,
  updatedAt,
}: {
  label: string;
  value: string;
  updatedAt: string | null;
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">
          {label}
        </p>
        <p className="mt-1 truncate text-sm text-white" title={value}>
          {value || "Not available"}
        </p>
      </div>
      <span className="shrink-0 text-[11px] text-text-muted">
        {updatedAt ? `Updated ${formatTimestamp(updatedAt)}` : ""}
      </span>
    </div>
  );
}
