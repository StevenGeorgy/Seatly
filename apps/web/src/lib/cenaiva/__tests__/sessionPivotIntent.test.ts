import { describe, expect, it } from "vitest";

import { isCenaivaProcessPrompt } from "../simplePromptIntent";

describe("session-pivot + session-end routing", () => {
  describe("session-end affirmatives route to orchestrator (skip small-prompt)", () => {
    it.each([
      "no",
      "nope",
      "nah",
      "no thanks",
      "no thank you",
      "i'm good",
      "i'm done",
      "we're done",
      "that's it",
      "that's all",
      "nothing else",
      "all done",
      "all good",
      "nothing",
    ])("matches %s as a process prompt", (input) => {
      expect(isCenaivaProcessPrompt(input)).toBe(true);
    });
  });

  describe("session-pivot phrases route to orchestrator", () => {
    it.each([
      // map
      "show me the map",
      "take me to the map",
      "back to map",
      "back to the map",
      "go to map",
      "return to discover",
      // deals
      "show me deals",
      "any deals",
      "see the deals",
      "are there any deals",
      "do you have deals",
      // different restaurant
      "different restaurant",
      "show me another restaurant",
      "find me a different place",
      "show me different spot",
    ])("matches %s as a process prompt", (input) => {
      expect(isCenaivaProcessPrompt(input)).toBe(true);
    });
  });

  describe("regression — common phrases that already routed correctly", () => {
    it("'show me the menu' still routes to orchestrator (preorder hand-off)", () => {
      // 'menu' is a booking-adjacent / process keyword, so this already routes.
      expect(isCenaivaProcessPrompt("show me the menu")).toBe(true);
    });

    it("'cancel my reservation' still routes to orchestrator", () => {
      expect(isCenaivaProcessPrompt("cancel my reservation")).toBe(true);
    });
  });

  describe("non-pivot small talk still falls through to small-prompt LLM", () => {
    it.each([
      "i love you",
      "do you have a girlfriend",
      "what's the meaning of life",
    ])("rejects %s", (input) => {
      expect(isCenaivaProcessPrompt(input)).toBe(false);
    });
  });
});
