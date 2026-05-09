import { describe, expect, it } from "vitest";

import {
  getCenaivaImmediateFiller,
  isCenaivaProcessPrompt,
  shouldResetCenaivaBookingContext,
} from "../simplePromptIntent";

describe("simplePromptIntent", () => {
  describe("isCenaivaProcessPrompt", () => {
    it.each([
      "find me italian near me",
      "table for 4 tomorrow",
      "what's on the menu",
      "can i bring a dog",
      "is there parking",
      "book it",
      "cancel that",
      "tomorrow at 7 pm",
    ])("matches dining-process prompt %s", (input) => {
      expect(isCenaivaProcessPrompt(input)).toBe(true);
    });

    it.each([
      "i love you",
      "do you love me",
      "what's the meaning of life",
      "hack my ex",
      "",
    ])("rejects clear small-prompts: %s", (input) => {
      expect(isCenaivaProcessPrompt(input)).toBe(false);
    });

    it.each([
      "hurry up",
      "why is this taking so long",
      "less talking, more booking",
    ])("rejects pure impatience: %s", (input) => {
      expect(isCenaivaProcessPrompt(input)).toBe(false);
    });
  });

  describe("getCenaivaImmediateFiller", () => {
    it("returns 'One moment please.' for actionable dining requests", () => {
      expect(getCenaivaImmediateFiller("find italian near me")).toBe("One moment please.");
    });

    it("returns null for clear small-prompts", () => {
      expect(getCenaivaImmediateFiller("i love you")).toBeNull();
    });

    it("returns null for pure 'table for N' transcripts", () => {
      expect(getCenaivaImmediateFiller("table for 4")).toBeNull();
      expect(getCenaivaImmediateFiller("for 4")).toBeNull();
    });

    it("returns null when no dining scope present", () => {
      expect(getCenaivaImmediateFiller("hello there")).toBeNull();
    });
  });

  describe("shouldResetCenaivaBookingContext", () => {
    it.each([
      "start over",
      "different restaurant",
      "change restaurant",
      "find italian near me",
      "look for cheaper places",
    ])("matches reset/new-search %s", (input) => {
      expect(shouldResetCenaivaBookingContext(input)).toBe(true);
    });

    it.each(["yes", "table for 4", "i love you"])(
      "does not match unrelated %s",
      (input) => {
        expect(shouldResetCenaivaBookingContext(input)).toBe(false);
      },
    );
  });
});
