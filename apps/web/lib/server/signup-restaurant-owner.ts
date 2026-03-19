import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

async function findUniqueSlug(supabase: SupabaseClient, baseSlug: string): Promise<string> {
  let slug = baseSlug;
  let suffix = 2;
  while (true) {
    const { data } = await supabase.from("restaurants").select("id").eq("slug", slug).maybeSingle();
    if (!data) return slug;
    slug = `${baseSlug}-${suffix}`;
    suffix++;
  }
}

export type SignupRestaurantOwnerInput = {
  restaurant_name: string;
  email: string;
  password: string;
  full_name: string;
};

export type SignupRestaurantOwnerSuccess = {
  ok: true;
  restaurant_id: string;
  user_id: string;
  profile: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    restaurantId: string | null;
  };
};

export type SignupRestaurantOwnerFailure = {
  error: string;
  status: number;
};

export async function signupRestaurantOwner(
  input: SignupRestaurantOwnerInput,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<SignupRestaurantOwnerSuccess | SignupRestaurantOwnerFailure> {
  const restaurantName = input.restaurant_name.trim();
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  const fullName = input.full_name.trim();

  if (!restaurantName) {
    return { error: "Restaurant name is required", status: 400 };
  }
  if (!email) {
    return { error: "Email is required", status: 400 };
  }
  if (!password) {
    return { error: "Password is required", status: 400 };
  }
  if (!fullName) {
    return { error: "Full name is required", status: 400 };
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const baseSlug = slugify(restaurantName);
  const slug = await findUniqueSlug(supabase, baseSlug);

  const { data: restaurant, error: restaurantError } = await supabase
    .from("restaurants")
    .insert({
      name: restaurantName,
      slug,
      plan: "free",
      is_active: true,
      timezone: "America/Toronto",
      currency: "CAD",
      country: "Canada",
    })
    .select("id")
    .single();

  if (restaurantError || !restaurant) {
    return {
      error: restaurantError?.message ?? "Failed to create restaurant",
      status: 500,
    };
  }

  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError) {
    await supabase.from("restaurants").delete().eq("id", restaurant.id);
    const msg = authError.message.toLowerCase();
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
      return { error: "An account with this email already exists", status: 409 };
    }
    return { error: authError.message, status: 400 };
  }

  if (!authUser.user) {
    await supabase.from("restaurants").delete().eq("id", restaurant.id);
    return { error: "Failed to create user", status: 500 };
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("user_profiles")
    .insert({
      auth_user_id: authUser.user.id,
      full_name: fullName,
      email,
      role: "owner",
      restaurant_id: restaurant.id,
    })
    .select("id, email, full_name, role, restaurant_id")
    .single();

  if (profileError || !profileRow) {
    await supabase.auth.admin.deleteUser(authUser.user.id);
    await supabase.from("restaurants").delete().eq("id", restaurant.id);
    return {
      error: profileError?.message ?? "Failed to create profile",
      status: 500,
    };
  }

  return {
    ok: true,
    restaurant_id: restaurant.id,
    user_id: authUser.user.id,
    profile: {
      id: profileRow.id,
      email: profileRow.email ?? "",
      fullName: profileRow.full_name ?? "",
      role: profileRow.role,
      restaurantId: profileRow.restaurant_id,
    },
  };
}
