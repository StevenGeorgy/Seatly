import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";

import { buildWakeGreeting } from "../buildWakeGreeting";

function makeUser(meta: Record<string, unknown> | null | undefined): User {
  return {
    id: "u1",
    aud: "authenticated",
    app_metadata: {},
    user_metadata: meta ?? {},
    created_at: new Date().toISOString(),
    email: "test@example.com",
  } as unknown as User;
}

describe("buildWakeGreeting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'Good morning' before noon", () => {
    vi.setSystemTime(new Date(2026, 4, 8, 8, 0, 0));
    expect(buildWakeGreeting(null)).toBe(
      "Good morning. How may I help with your reservation?",
    );
  });

  it("returns 'Good afternoon' between noon and 5pm", () => {
    vi.setSystemTime(new Date(2026, 4, 8, 14, 0, 0));
    expect(buildWakeGreeting(null)).toBe(
      "Good afternoon. How may I help with your reservation?",
    );
  });

  it("returns 'Good evening' after 5pm", () => {
    vi.setSystemTime(new Date(2026, 4, 8, 19, 0, 0));
    expect(buildWakeGreeting(null)).toBe(
      "Good evening. How may I help with your reservation?",
    );
  });

  it("appends first name from user_metadata.full_name", () => {
    vi.setSystemTime(new Date(2026, 4, 8, 8, 0, 0));
    expect(buildWakeGreeting(makeUser({ full_name: "Steven Georgy" }))).toBe(
      "Good morning, Steven. How may I help with your reservation?",
    );
  });

  it("falls back to user_metadata.name when full_name absent", () => {
    vi.setSystemTime(new Date(2026, 4, 8, 8, 0, 0));
    expect(buildWakeGreeting(makeUser({ name: "Mark" }))).toBe(
      "Good morning, Mark. How may I help with your reservation?",
    );
  });

  it("omits name when no user", () => {
    vi.setSystemTime(new Date(2026, 4, 8, 8, 0, 0));
    expect(buildWakeGreeting(undefined)).toBe(
      "Good morning. How may I help with your reservation?",
    );
  });
});
