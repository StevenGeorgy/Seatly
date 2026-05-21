import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { SignupRestaurantOwnerSchema } from "../_shared/validation/restaurant.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "restaurant"
  );
}

async function findUniqueSlug(
  supabase: ReturnType<typeof createClient>,
  baseSlug: string,
): Promise<string> {
  let slug = baseSlug;
  let suffix = 2;
  while (true) {
    const { data } = await supabase
      .from("restaurants")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!data) return slug;
    slug = `${baseSlug}-${suffix}`;
    suffix++;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Phase C input-validation rollout (2026-05-20): single-pass body
    // validation through parseJsonBody. Caps + shape are enforced before any
    // DB call. The schema accepts both snake_case and camelCase for
    // restaurant_name + full_name; we resolve below. Unknown keys pass
    // through (.passthrough()) so the operational toggle fields the
    // handler reads directly off `body` are not silently dropped.
    const parsed = await parseJsonBody(req, SignupRestaurantOwnerSchema, {
      jsonRes: (b, s) =>
        new Response(JSON.stringify(b), {
          status: s,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }),
    });
    if ("response" in parsed) return parsed.response;
    const body = parsed.data;
    const restaurantName =
      (body.restaurant_name ?? body.restaurantName ?? "").toString().trim();

    if (!restaurantName) {
      return new Response(
        JSON.stringify({ error: "Restaurant name is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Service-role client for privileged operations (bypasses RLS)
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Resolve the user ──────────────────────────────────────────────────────
    // Flow A: caller is already authenticated — use their JWT
    // Flow B: legacy sign-up flow — create a new user with email+password
    let userId: string;
    let userEmail: string;
    let userFullName: string;

    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (bearerToken) {
      // Verify the token and get the user
      const { data: { user }, error: userError } = await adminClient.auth.getUser(bearerToken);
      if (userError || !user) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired session. Please log in again." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      userId = user.id;
      userEmail = user.email ?? "";
      userFullName = (body.full_name ?? body.fullName ?? user.user_metadata?.full_name ?? "").toString().trim();
    } else {
      // Legacy: create a brand-new user
      const email = (body.email ?? "").toString().trim().toLowerCase();
      const password = (body.password ?? "").toString();
      const fullName = (body.full_name ?? body.fullName ?? "").toString().trim();

      if (!email || !password || !fullName) {
        return new Response(
          JSON.stringify({ error: "email, password and full_name are required for new accounts" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (authError || !authUser.user) {
        const msg = (authError?.message ?? "").toLowerCase();
        if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
          // Email enumeration mitigation (Vuln 9, audit 2026-05-20):
          // returning a distinct "already exists" message turned this
          // endpoint into an oracle for "is this email registered with
          // Cenaiva". Return a uniform 200 here so the caller can't tell
          // whether the email was new or known. The legitimate first-time
          // signer who got this response will never receive a verification
          // email — they figure it out and recover via the login flow.
          // Log internally so ops can still trace double-signups.
          console.log(
            `[signup-restaurant-owner] suppressed-duplicate-email signup for ${email}`,
          );
          return new Response(
            JSON.stringify({
              ok: true,
              requires_email_verification: true,
              message: "Check your email to complete setup. If you already have an account, sign in with the existing credentials.",
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({ error: authError?.message ?? "Failed to create user" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      userId = authUser.user.id;
      userEmail = email;
      userFullName = fullName;
    }

    // ── Settings payload (dietary tags live here per existing schema) ─────────
    const dietaryTags = Array.isArray(body.dietary_tags)
      ? body.dietary_tags.filter((t: unknown): t is string => typeof t === "string")
      : [];
    const settingsJson = dietaryTags.length > 0 ? { dietaryTags } : null;

    // ── Draft reuse: if the caller already has an unpublished draft, update
    // it instead of inserting a new row. Honors force_new=true (the
    // workspace "+ Add restaurant" path) and explicit restaurant_id (the
    // /drafts picker continue-this-draft path).
    const forceNew = body.force_new === true;
    const targetDraftId =
      typeof body.restaurant_id === "string" && body.restaurant_id.trim()
        ? body.restaurant_id.trim()
        : null;

    if (!forceNew) {
      const { data: profileRow } = await adminClient
        .from("user_profiles")
        .select("id")
        .eq("auth_user_id", userId)
        .maybeSingle();

      if (profileRow) {
        const profileId = (profileRow as { id: string }).id;
        let draftId: string | null = null;

        if (targetDraftId) {
          // User explicitly named a draft — verify ownership AND unpublished.
          const { data: ownedDraft } = await adminClient
            .from("user_restaurant_roles")
            .select("restaurant_id, restaurants!inner(id, is_published)")
            .eq("user_id", profileId)
            .eq("role", "owner")
            .eq("restaurant_id", targetDraftId)
            .maybeSingle();
          const ownedRestaurant = (ownedDraft as
            | { restaurants?: { is_published?: boolean } }
            | null
          )?.restaurants;
          if (ownedDraft && ownedRestaurant?.is_published === false) {
            draftId = targetDraftId;
          }
        } else {
          // Implicit fallback: most-recent unpublished draft.
          const { data: existingDraft } = await adminClient
            .from("user_restaurant_roles")
            .select("restaurant_id, restaurants!inner(id, is_published, created_at)")
            .eq("user_id", profileId)
            .eq("role", "owner")
            .eq("restaurants.is_published", false)
            .order("created_at", { ascending: false, foreignTable: "restaurants" })
            .limit(1)
            .maybeSingle();
          if (existingDraft) {
            draftId = (existingDraft as { restaurant_id: string | null }).restaurant_id ?? null;
          }
        }

        if (draftId) {
          const { error: updateErr } = await adminClient
            .from("restaurants")
            .update({
              name: restaurantName,
              address: body.address ?? null,
              city: body.city ?? null,
              province: body.province ?? null,
              country: body.country ?? "Canada",
              lat: typeof body.lat === "number" ? body.lat : null,
              lng: typeof body.lng === "number" ? body.lng : null,
              phone: body.phone ?? null,
              description: body.description ?? null,
              cuisine_type: body.cuisine_type ?? null,
              business_type: body.business_type ?? null,
              accepts_walkins: body.accepts_walkins ?? true,
              settings_json: settingsJson,
            })
            .eq("id", draftId);
          if (updateErr) {
            return new Response(
              JSON.stringify({ error: updateErr.message }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
          return new Response(
            JSON.stringify({ ok: true, restaurant_id: draftId, user_id: userId, reused_draft: true }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
    }

    // ── Create the restaurant (fresh insert path) ─────────────────────────────
    const baseSlug = slugify(restaurantName);
    const slug = await findUniqueSlug(adminClient, baseSlug);

    const depositPolicyJson = {
      requires_deposit: body.requires_deposit ?? false,
      deposit_amount: body.deposit_amount ?? null,
    };

    const loyaltyConfigJson = {
      enabled: body.loyalty_enabled ?? false,
      points_per_dollar: body.loyalty_points_per_dollar ?? 1,
    };

    const { data: restaurant, error: restaurantError } = await adminClient
      .from("restaurants")
      .insert({
        name: restaurantName,
        slug,
        plan: "free",
        is_active: true,
        timezone: body.timezone ?? "America/Toronto",
        currency: body.currency ?? "CAD",
        country: body.country ?? "Canada",
        address: body.address ?? null,
        city: body.city ?? null,
        province: body.province ?? null,
        lat: typeof body.lat === "number" ? body.lat : null,
        lng: typeof body.lng === "number" ? body.lng : null,
        phone: body.phone ?? null,
        description: body.description ?? null,
        cuisine_type: body.cuisine_type ?? null,
        business_type: body.business_type ?? null,
        hours_json: body.hours_json ?? null,
        accepts_walkins: body.accepts_walkins ?? true,
        no_show_fee: body.no_show_fee ?? null,
        cancellation_hours: body.cancellation_hours ?? 24,
        deposit_policy_json: depositPolicyJson,
        loyalty_config_json: loyaltyConfigJson,
        settings_json: settingsJson,
      })
      .select("id")
      .single();

    if (restaurantError || !restaurant) {
      return new Response(
        JSON.stringify({ error: restaurantError?.message ?? "Failed to create restaurant" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Default shift + floor plan + tables ───────────────────────────────────
    // Wrapped in try/catch — failures here are logged but do NOT roll back the
    // restaurant row. The owner can edit these later from the dashboard.
    try {
      const hoursJson = (body.hours_json ?? null) as Record<string, { open: string; close: string } | null> | null;
      const dayKeys = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ] as const;
      let daysOfWeek: number[] = [];
      let startTime = "17:00";
      let endTime = "22:00";
      if (hoursJson) {
        const opens: string[] = [];
        const closes: string[] = [];
        dayKeys.forEach((day, idx) => {
          const value = hoursJson[day];
          if (value && typeof value.open === "string" && typeof value.close === "string") {
            daysOfWeek.push(idx);
            opens.push(value.open);
            closes.push(value.close);
          }
        });
        opens.sort();
        closes.sort();
        if (opens.length > 0) startTime = opens[0];
        if (closes.length > 0) endTime = closes[closes.length - 1];
      }
      if (daysOfWeek.length === 0) daysOfWeek = [0, 1, 2, 3, 4, 5, 6];

      const { error: shiftError } = await adminClient.from("shifts").insert({
        restaurant_id: restaurant.id,
        name: "Dinner",
        days_of_week: daysOfWeek,
        start_time: startTime,
        end_time: endTime,
        turn_time_minutes: 90,
        slot_duration_minutes: 30,
        advance_booking_days: 3650,
        max_covers: null,
        is_active: true,
      });
      if (shiftError) {
        console.error("[signup-restaurant-owner] shift insert failed", shiftError);
      }

      // Default floor plan (Main Floor) + section row
      const { data: sectionRow, error: sectionError } = await adminClient
        .from("restaurant_sections")
        .insert({
          restaurant_id: restaurant.id,
          name: "Main Floor",
          sort_order: 0,
          is_active: true,
        })
        .select("id")
        .single();
      let sectionId: string | null = sectionRow ? (sectionRow.id as string) : null;
      if (sectionError) {
        console.error("[signup-restaurant-owner] section insert failed", sectionError);
      }
      if (sectionId) {
        const { error: floorPlanError } = await adminClient.from("floor_plans").insert({
          restaurant_id: restaurant.id,
          section_id: sectionId,
          name: "Main Floor",
          canvas_width: 720,
          canvas_height: 480,
          layout: { walls: [], doors: [], windows: [], tableTransforms: {}, decorations: [], zones: [] },
          is_active: true,
        });
        if (floorPlanError) {
          console.error("[signup-restaurant-owner] floor_plan insert failed", floorPlanError);
        }
      }

      const inputTables = Array.isArray(body.tables) ? body.tables : [];
      const tableRows = inputTables
        .map((entry: unknown, idx: number) => {
          if (!entry || typeof entry !== "object") return null;
          const row = entry as { label?: string; capacity?: number; shape?: string };
          const label = typeof row.label === "string" && row.label.trim() ? row.label.trim() : `T${idx + 1}`;
          const capacity = typeof row.capacity === "number" && row.capacity > 0 ? Math.min(30, row.capacity) : 2;
          const shape = typeof row.shape === "string" && row.shape.length > 0 ? row.shape : "round";
          return {
            restaurant_id: restaurant.id,
            table_number: label,
            label,
            capacity,
            shape,
            section_id: sectionId,
            section: sectionId ? "Main Floor" : null,
            position_x: 0,
            position_y: 0,
            is_active: true,
          };
        })
        .filter((row: unknown): row is Record<string, unknown> => row !== null);
      if (tableRows.length > 0) {
        const { error: tableError } = await adminClient.from("tables").insert(tableRows);
        if (tableError) {
          console.error("[signup-restaurant-owner] tables insert failed", tableError);
        }
      }
    } catch (defaultsErr) {
      console.error("[signup-restaurant-owner] defaults creation failed", defaultsErr);
    }

    // ── Upsert the user profile ───────────────────────────────────────────────
    const { data: existingProfile } = await adminClient
      .from("user_profiles")
      .select("id")
      .eq("auth_user_id", userId)
      .maybeSingle();

    let profileId: string;

    if (existingProfile) {
      await adminClient
        .from("user_profiles")
        .update({ role: "owner", restaurant_id: restaurant.id })
        .eq("auth_user_id", userId);
      profileId = existingProfile.id;
    } else {
      const { data: newProfile, error: profileError } = await adminClient
        .from("user_profiles")
        .insert({
          auth_user_id: userId,
          full_name: userFullName,
          email: userEmail,
          role: "owner",
          restaurant_id: restaurant.id,
        })
        .select("id")
        .single();

      if (profileError || !newProfile) {
        await adminClient.from("restaurants").delete().eq("id", restaurant.id);
        return new Response(
          JSON.stringify({ error: profileError?.message ?? "Failed to create profile" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      profileId = newProfile.id;
    }

    // ── Create user_restaurant_roles row ──────────────────────────────────────
    // user_restaurant_roles.user_id references user_profiles.id (not auth.users.id)
    await adminClient.from("user_restaurant_roles").upsert(
      { user_id: profileId, restaurant_id: restaurant.id, role: "owner", is_primary: true },
      { onConflict: "user_id,restaurant_id" },
    );

    return new Response(
      JSON.stringify({ ok: true, restaurant_id: restaurant.id, user_id: userId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
