import { describe, expect, it } from "vitest";

import {
  isCenaivaAffirmativeBookingConfirmation,
  isCenaivaBookingConfirmationReply,
  isCenaivaNegativeBookingConfirmation,
  shouldRouteAsCenaivaBookingConfirmation,
  transcriptForCenaivaBookingConfirmation,
} from "../confirmationIntent";

describe("confirmationIntent", () => {
  describe("isCenaivaAffirmativeBookingConfirmation", () => {
    it.each([
      "yes",
      "Yes please",
      "yeah",
      "yep",
      "sure",
      "ok",
      "alright",
      "let's do it",
      "book it",
      "confirm",
      "lock it in",
      "go ahead",
      "make the reservation",
    ])("matches affirmative %s", (input) => {
      expect(isCenaivaAffirmativeBookingConfirmation(input)).toBe(true);
    });

    it.each(["no", "wait", "actually no", ""])("does not match %s", (input) => {
      expect(isCenaivaAffirmativeBookingConfirmation(input)).toBe(false);
    });
  });

  describe("isCenaivaNegativeBookingConfirmation", () => {
    it.each(["no", "nope", "Nah", "not yet", "wait", "cancel", "different time"])(
      "matches negative %s",
      (input) => {
        expect(isCenaivaNegativeBookingConfirmation(input)).toBe(true);
      },
    );

    it.each(["yes", "ok", "go ahead", ""])("does not match %s", (input) => {
      expect(isCenaivaNegativeBookingConfirmation(input)).toBe(false);
    });
  });

  describe("isCenaivaBookingConfirmationReply", () => {
    it("returns true for either polarity", () => {
      expect(isCenaivaBookingConfirmationReply("yes")).toBe(true);
      expect(isCenaivaBookingConfirmationReply("no")).toBe(true);
    });

    it("returns false for unrelated", () => {
      expect(isCenaivaBookingConfirmationReply("table for two")).toBe(false);
    });
  });

  describe("shouldRouteAsCenaivaBookingConfirmation", () => {
    it("only routes when status === 'confirming'", () => {
      expect(shouldRouteAsCenaivaBookingConfirmation("confirming", "yes")).toBe(true);
      expect(shouldRouteAsCenaivaBookingConfirmation("idle", "yes")).toBe(false);
      expect(shouldRouteAsCenaivaBookingConfirmation(null, "yes")).toBe(false);
    });

    it("returns false for non-confirmation transcripts", () => {
      expect(shouldRouteAsCenaivaBookingConfirmation("confirming", "what time")).toBe(
        false,
      );
    });
  });

  describe("transcriptForCenaivaBookingConfirmation", () => {
    it("rewrites affirmative when confirming", () => {
      expect(transcriptForCenaivaBookingConfirmation("confirming", "yes")).toBe(
        "yes, confirm booking",
      );
      expect(transcriptForCenaivaBookingConfirmation("confirming", "Yes please")).toBe(
        "yes, confirm booking",
      );
    });

    it("preserves transcript otherwise", () => {
      expect(transcriptForCenaivaBookingConfirmation("idle", "yes")).toBe("yes");
      expect(transcriptForCenaivaBookingConfirmation("confirming", "no")).toBe("no");
    });
  });
});
