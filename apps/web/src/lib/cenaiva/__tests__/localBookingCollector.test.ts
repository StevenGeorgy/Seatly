import { describe, expect, it } from "vitest";
import type { BookingState } from "@cenaiva/assistant";

import {
  buildLocalAvailabilityResponse,
  parseLocalDate,
  parseLocalPartySize,
  parseLocalTime,
  planLocalBookingTurn,
  type CenaivaAvailabilityResponse,
} from "@/lib/cenaiva/localBookingCollector";

function booking(patch: Partial<BookingState> = {}): BookingState {
  return {
    restaurant_id: null,
    restaurant_name: null,
    party_size: null,
    date: null,
    time: null,
    shift_id: null,
    slot_iso: null,
    special_request: null,
    occasion: null,
    status: "idle",
    confirmation_code: null,
    reservation_id: null,
    want_preorder: null,
    order_id: null,
    payment_status: "idle",
    tip_choice: null,
    tip_amount: null,
    tip_percent: null,
    payment_split: null,
    pending_action: null,
    cart_subtotal: 0,
    cart: [],
    has_saved_card: false,
    ...patch,
  };
}

describe("local Hey Cenaiva booking collector", () => {
  it("parses party, date, and time without turning party size into a time", () => {
    expect(parseLocalPartySize("two people")).toBe(2);
    expect(parseLocalTime("two people", { allowBareTime: true })).toBeNull();
    expect(parseLocalTime("two", { allowBareTime: false })).toBeNull();
    expect(parseLocalTime("around 7")).toBeNull();
    expect(parseLocalTime("around 7-ish")).toBeNull();
    expect(parseLocalTime("around 7 pm")).toBe("19:00");
    expect(parseLocalDate("May 10", "America/Toronto")).toMatch(/^\d{4}-05-10$/);
  });

  it("asks for AM or PM instead of assuming a bare spoken time", () => {
    const decision = planLocalBookingTurn({
      transcript: "tomorrow at 7",
      booking: booking({
        restaurant_id: "rest-1",
        restaurant_name: "Echoria",
        party_size: 2,
        status: "collecting_minimum_fields",
      }),
      conversationId: null,
      timezone: "America/Toronto",
    });

    expect(decision.kind).toBe("local_response");
    if (decision.kind !== "local_response") return;
    expect(decision.response.spoken_text).toBe("Did you mean 7 AM or 7 PM?");
    expect(decision.response.booking?.date).toBeTruthy();
    expect(decision.response.booking?.time).toBeUndefined();

    const halfPast = planLocalBookingTurn({
      transcript: "tomorrow at 7:30",
      booking: booking({
        restaurant_id: "rest-1",
        restaurant_name: "Echoria",
        party_size: 2,
        status: "collecting_minimum_fields",
      }),
      conversationId: null,
      timezone: "America/Toronto",
    });

    expect(halfPast.kind).toBe("local_response");
    if (halfPast.kind !== "local_response") return;
    expect(halfPast.response.spoken_text).toBe("Did you mean 7:30 AM or 7:30 PM?");
    expect(halfPast.response.booking?.time).toBeUndefined();
  });

  it("resolves a follow-up AM or PM answer after time clarification", () => {
    const decision = planLocalBookingTurn({
      transcript: "PM",
      booking: booking({
        restaurant_id: "rest-1",
        restaurant_name: "Echoria",
        party_size: 2,
        date: "2026-05-07",
        status: "collecting_minimum_fields",
      }),
      conversationId: null,
      timezone: "America/Toronto",
      lastAssistantPrompt: "Did you mean 7 AM or 7 PM?",
    });

    expect(decision.kind).toBe("check_availability");
    if (decision.kind !== "check_availability") return;
    expect(decision.request.time).toBe("19:00");
  });

  it("lets an explicit corrected time override the prior AM or PM clarification", () => {
    const decision = planLocalBookingTurn({
      transcript: "actually 8 PM",
      booking: booking({
        restaurant_id: "rest-1",
        restaurant_name: "Echoria",
        party_size: 2,
        date: "2026-05-07",
        status: "collecting_minimum_fields",
      }),
      conversationId: null,
      timezone: "America/Toronto",
      lastAssistantPrompt: "Did you mean 7 AM or 7 PM?",
    });

    expect(decision.kind).toBe("check_availability");
    if (decision.kind !== "check_availability") return;
    expect(decision.request.time).toBe("20:00");
  });

  it("passes named restaurant requests to the backend so restaurant matching is preserved", () => {
    const decision = planLocalBookingTurn({
      transcript: "Book La Maison for two tomorrow at 7:30",
      booking: booking(),
      conversationId: null,
      timezone: "America/Toronto",
    });

    expect(decision.kind).toBe("pass");
  });

  it("keeps off-topic prompts out of local booking collection", () => {
    const decision = planLocalBookingTurn({
      transcript: "Am I gay?",
      booking: booking(),
      conversationId: null,
      timezone: "America/Toronto",
    });

    expect(decision.kind).toBe("pass");
  });

  it("collects party size locally after a restaurant is selected", () => {
    const decision = planLocalBookingTurn({
      transcript: "two",
      booking: booking({
        restaurant_id: "rest-1",
        restaurant_name: "Echoria",
        status: "collecting_minimum_fields",
      }),
      conversationId: null,
      timezone: "America/Toronto",
    });

    expect(decision.kind).toBe("local_response");
    if (decision.kind !== "local_response") return;
    expect(decision.response.booking?.party_size).toBe(2);
    expect(decision.response.booking?.time).toBeUndefined();
    expect(decision.response.spoken_text).toBe("What date and time should I book?");
  });

  it("treats large numeric guest replies as party size, not a small prompt", () => {
    expect(parseLocalPartySize("67")).toBe(67);
    expect(parseLocalPartySize("67 guests")).toBe(67);
    expect(parseLocalPartySize("party of 120")).toBe(120);

    const decision = planLocalBookingTurn({
      transcript: "67",
      booking: booking({
        restaurant_id: "rest-1",
        restaurant_name: "Echoria",
        status: "collecting_minimum_fields",
      }),
      conversationId: null,
      timezone: "America/Toronto",
      lastAssistantPrompt: "How many guests?",
    });

    expect(decision.kind).toBe("local_response");
    if (decision.kind !== "local_response") return;
    expect(decision.response.booking?.party_size).toBe(67);
    expect(decision.response.spoken_text).toBe("What date and time should I book?");
  });

  it("checks availability after a large numeric guest reply when date and time are already known", () => {
    const decision = planLocalBookingTurn({
      transcript: "67",
      booking: booking({
        restaurant_id: "rest-1",
        restaurant_name: "Echoria",
        date: "2026-01-26",
        time: "19:00",
        status: "collecting_minimum_fields",
      }),
      conversationId: null,
      timezone: "America/Toronto",
      lastAssistantPrompt: "How many guests?",
    });

    expect(decision.kind).toBe("check_availability");
    if (decision.kind !== "check_availability") return;
    expect(decision.request.party_size).toBe(67);
    expect(decision.request.mode).toBe("exact");
  });

  it("lets a smaller guest-count correction replace a too-large party size", () => {
    const decision = planLocalBookingTurn({
      transcript: "4",
      booking: booking({
        restaurant_id: "rest-1",
        restaurant_name: "Echoria",
        party_size: 67,
        date: "2026-01-26",
        time: "19:00",
        status: "collecting_minimum_fields",
      }),
      conversationId: null,
      timezone: "America/Toronto",
      lastAssistantPrompt:
        "Echoria cannot book 67 guests. What smaller party size should I check?",
    });

    expect(decision.kind).toBe("check_availability");
    if (decision.kind !== "check_availability") return;
    expect(decision.request.party_size).toBe(4);
    expect(decision.request.date).toBe("2026-01-26");
    expect(decision.request.time).toBe("19:00");
    expect(decision.responseBeforeCheck.booking?.party_size).toBe(4);
  });

  it("checks availability only after restaurant, party size, date, and time are known", () => {
    const decision = planLocalBookingTurn({
      transcript: "tomorrow at 7 pm",
      booking: booking({
        restaurant_id: "rest-1",
        restaurant_name: "Echoria",
        party_size: 2,
        status: "collecting_minimum_fields",
      }),
      conversationId: null,
      timezone: "America/Toronto",
    });

    expect(decision.kind).toBe("check_availability");
    if (decision.kind !== "check_availability") return;
    expect(decision.request.mode).toBe("exact");
    expect(decision.request.time).toBe("19:00");
    expect(decision.filler).toBe("One moment please.");
  });

  it("supports flexible availability wording", () => {
    const anyDay = planLocalBookingTurn({
      transcript: "any day at 2 pm",
      booking: booking({
        restaurant_id: "rest-1",
        restaurant_name: "Echoria",
        party_size: 2,
      }),
      conversationId: null,
      timezone: "America/Toronto",
    });
    expect(anyDay.kind).toBe("check_availability");
    if (anyDay.kind === "check_availability") {
      expect(anyDay.request.mode).toBe("any_day_at_time");
      expect(anyDay.request.time).toBe("14:00");
    }

    const friday = planLocalBookingTurn({
      transcript: "any time Friday",
      booking: booking({
        restaurant_id: "rest-1",
        restaurant_name: "Echoria",
        party_size: 2,
      }),
      conversationId: null,
      timezone: "America/Toronto",
    });
    expect(friday.kind).toBe("check_availability");
    if (friday.kind === "check_availability") {
      expect(friday.request.mode).toBe("weekday_any_time");
      expect(friday.request.split_at).toBe("14:30");
    }
  });

  it("turns available slots into mandatory confirmation, not a completed booking", () => {
    const result: CenaivaAvailabilityResponse = {
      status: "available",
      selected_slot: {
        shift_id: "shift-1",
        shift_name: "Dinner",
        date: "2026-01-26",
        date_time: "2026-01-26T19:00:00.000Z",
        display_time: "2:00 PM",
        hours_window: "11:00 AM to 10:00 PM",
      },
      alternatives: [],
      hours_window: "11:00 AM to 10:00 PM",
    };

    const { response, pendingOptions } = buildLocalAvailabilityResponse({
      conversationId: null,
      request: {
        restaurant_id: "rest-1",
        restaurant_name: "Echoria",
        party_size: 2,
        mode: "exact",
        date: "2026-01-26",
        time: "14:00",
      },
      result,
    });

    expect(pendingOptions).toEqual([]);
    expect(response.booking?.status).toBe("confirming");
    expect(response.ui_actions.map((action) => action.type)).toEqual([
      "set_booking_field",
      "set_booking_field",
      "select_time_slot",
      "confirm_booking",
    ]);
    expect(response.spoken_text).toContain("They're open 11:00 AM to 10:00 PM on January 26.");
    expect(response.spoken_text).toMatch(/Should I book it\?$/);
  });

  it("checks selected restaurant hours without requiring a party size first", () => {
    const decision = planLocalBookingTurn({
      transcript: "what are their hours tomorrow",
      booking: booking({
        restaurant_id: "rest-1",
        restaurant_name: "Echoria",
        time: "7:00 PM",
        status: "collecting_minimum_fields",
      }),
      conversationId: null,
      timezone: "America/Toronto",
    });

    expect(decision.kind).toBe("check_availability");
    if (decision.kind !== "check_availability") return;
    expect(decision.request.purpose).toBe("hours");
    expect(decision.request.mode).toBe("date_any_time");
    expect(decision.request.party_size).toBe(1);
    expect(decision.request.date).toBeTruthy();
  });

  it("turns an hours availability result into hours plus live openings", () => {
    const result: CenaivaAvailabilityResponse = {
      status: "options",
      hours_window: "17:00 to 23:00",
      alternatives: [
        {
          shift_id: "shift-1",
          date: "2026-01-26",
          date_time: "2026-01-26T18:30:00.000Z",
          display_time: "1:30 PM",
          hours_window: "17:00 to 23:00",
        },
        {
          shift_id: "shift-1",
          date: "2026-01-26",
          date_time: "2026-01-26T19:00:00.000Z",
          display_time: "2:00 PM",
          hours_window: "17:00 to 23:00",
        },
      ],
    };

    const { response, pendingOptions } = buildLocalAvailabilityResponse({
      conversationId: null,
      request: {
        restaurant_id: "rest-1",
        restaurant_name: "Echoria",
        party_size: 1,
        mode: "date_any_time",
        purpose: "hours",
        date: "2026-01-26",
      },
      result,
    });

    expect(pendingOptions).toEqual([]);
    expect(response.spoken_text).toBe(
      "Echoria is open 5:00 PM to 11:00 PM on January 26. I see availability around January 26 at 1:30 PM or January 26 at 2:00 PM.",
    );
  });

  it("tells the user when the restaurant is fully booked at capacity", () => {
    const result: CenaivaAvailabilityResponse = {
      status: "unavailable",
      unavailable_reason: "fully_booked",
      hours_window: "17:00 to 23:00",
      alternatives: [],
      message: "The restaurant is fully booked for that date.",
    };

    const { response, pendingOptions } = buildLocalAvailabilityResponse({
      conversationId: null,
      request: {
        restaurant_id: "rest-1",
        restaurant_name: "Echoria",
        party_size: 2,
        mode: "exact",
        date: "2026-01-26",
        time: "19:00",
      },
      result,
    });

    expect(pendingOptions).toEqual([]);
    expect(response.spoken_text).toBe(
      "They're open 5:00 PM to 11:00 PM on January 26. January 26 is fully booked. What date and time should I try instead?",
    );
  });

  it("tells the user when the guest count is too large for the restaurant", () => {
    const result: CenaivaAvailabilityResponse = {
      status: "unavailable",
      unavailable_reason: "party_size_out_of_range",
      hours_window: "17:00 to 23:00",
      alternatives: [],
      message: "That party size is outside the restaurant's bookable range.",
    };

    const { response, pendingOptions } = buildLocalAvailabilityResponse({
      conversationId: null,
      request: {
        restaurant_id: "rest-1",
        restaurant_name: "Echoria",
        party_size: 67,
        mode: "exact",
        date: "2026-01-26",
        time: "19:00",
      },
      result,
    });

    expect(pendingOptions).toEqual([]);
    expect(response.next_expected_input).toBe("party_size");
    expect(response.spoken_text).toBe(
      "They're open 5:00 PM to 11:00 PM on January 26. Echoria cannot book 67 guests. What smaller party size should I check?",
    );
  });

  it("explains when a requested time lacks enough seats but nearby times exist", () => {
    const result: CenaivaAvailabilityResponse = {
      status: "unavailable",
      unavailable_reason: "insufficient_capacity",
      hours_window: "11:00 AM to 10:00 PM",
      alternatives: [
        {
          shift_id: "shift-1",
          date: "2026-01-26",
          date_time: "2026-01-26T19:30:00.000Z",
          display_time: "7:30 PM",
          hours_window: "11:00 AM to 10:00 PM",
        },
        {
          shift_id: "shift-1",
          date: "2026-01-26",
          date_time: "2026-01-26T18:30:00.000Z",
          display_time: "6:30 PM",
          hours_window: "11:00 AM to 10:00 PM",
        },
      ],
      message: "There are not enough seats available at that time.",
    };

    const { response, pendingOptions } = buildLocalAvailabilityResponse({
      conversationId: null,
      request: {
        restaurant_id: "rest-1",
        restaurant_name: "Echoria",
        party_size: 47,
        mode: "exact",
        date: "2026-01-26",
        time: "19:00",
      },
      result,
    });

    expect(pendingOptions).toHaveLength(2);
    expect(response.spoken_text).toBe(
      "Echoria does not have enough seats available at 7:00 PM for 47 guests. They're open 11:00 AM to 10:00 PM on January 26. I found January 26 at 7:30 PM or January 26 at 6:30 PM. Which should I use?",
    );
  });

  it("keeps unavailable alternatives pending for first or second selection", () => {
    const result: CenaivaAvailabilityResponse = {
      status: "unavailable",
      alternatives: [
        {
          shift_id: "shift-1",
          date: "2026-01-26",
          date_time: "2026-01-26T18:30:00.000Z",
          display_time: "1:30 PM",
        },
        {
          shift_id: "shift-1",
          date: "2026-01-27",
          date_time: "2026-01-27T19:00:00.000Z",
          display_time: "2:00 PM",
        },
      ],
    };

    const { response, pendingOptions } = buildLocalAvailabilityResponse({
      conversationId: null,
      request: {
        restaurant_id: "rest-1",
        restaurant_name: "Echoria",
        party_size: 2,
        mode: "exact",
        date: "2026-01-26",
        time: "14:00",
      },
      result,
    });

    expect(response.spoken_text).toContain("not available");
    expect(pendingOptions).toHaveLength(2);

    const selection = planLocalBookingTurn({
      transcript: "second one",
      booking: booking({
        restaurant_id: "rest-1",
        restaurant_name: "Echoria",
        party_size: 2,
      }),
      conversationId: null,
      pendingOptions,
    });
    expect(selection.kind).toBe("local_response");
    if (selection.kind === "local_response") {
      expect(selection.response.booking?.slot_iso).toBe("2026-01-27T19:00:00.000Z");
      expect(selection.response.booking?.status).toBe("confirming");
    }
  });
});
