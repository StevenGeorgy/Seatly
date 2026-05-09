import { describe, expect, it } from "vitest";
import type { AssistantResponseType } from "@cenaiva/assistant";

import {
  applyClientDiscoveryMemory,
  capSingleRecommendationSpokenText,
  getCenaivaRecommendationMode,
  isSingleRestaurantRecommendationIntent,
  normalizeSingleRestaurantRecommendationResponse,
} from "@/lib/cenaiva/recommendationIntent";

function response(patch: Partial<AssistantResponseType>): AssistantResponseType {
  return {
    conversation_id: "conv-1",
    spoken_text: "I would try La Piazza because it is closest to you.",
    intent: "discover_restaurants" as AssistantResponseType["intent"],
    step: "recommend_options" as AssistantResponseType["step"],
    next_expected_input: "none" as AssistantResponseType["next_expected_input"],
    ui_actions: [],
    booking: null,
    map: null,
    filters: null,
    ...patch,
  };
}

describe("recommendation intent", () => {
  it("detects one-restaurant recommendation requests", () => {
    expect(getCenaivaRecommendationMode("what's the closest restaurant to me")).toBe("single");
    expect(getCenaivaRecommendationMode("I want the nearest spot")).toBe("single");
    expect(getCenaivaRecommendationMode("pick one place for dinner")).toBe("single");
    expect(isSingleRestaurantRecommendationIntent("where should I eat?")).toBe(true);
  });

  it("does not convert booking or plural discovery prompts to single recommendations", () => {
    expect(getCenaivaRecommendationMode("book the closest restaurant for two")).toBeNull();
    expect(getCenaivaRecommendationMode("show me restaurants near me")).toBe("list");
    expect(getCenaivaRecommendationMode("what other restaurants are there")).toBe("list");
    expect(isSingleRestaurantRecommendationIntent("show me the closest restaurants")).toBe(false);
  });

  it("caps restaurant cards, map markers, and list-style speech to one result", () => {
    const normalized = normalizeSingleRestaurantRecommendationResponse(
      response({
        spoken_text:
          "Pai Northern Thai Kitchen, Minami Vancouver, or Le Fantôme look good. Which one sounds best?",
        ui_actions: [
          { type: "show_map" },
          { type: "show_restaurant_cards", restaurant_ids: ["r1", "r2", "r3"] },
          { type: "update_map_markers", restaurant_ids: ["r1", "r2", "r3"] },
          { type: "start_booking", restaurant_id: "r1" },
        ],
        booking: { restaurant_id: "r1", status: "collecting_minimum_fields" },
        map: {
          visible: true,
          marker_restaurant_ids: ["r1", "r2", "r3"],
          highlighted_restaurant_id: null,
        },
      }),
      "what's the closest restaurant to me",
    );

    expect(normalized.spoken_text).toBe("I'd go with Pai Northern Thai Kitchen.");
    expect(normalized.booking).toBeNull();
    expect(normalized.map?.marker_restaurant_ids).toEqual(["r1"]);
    expect(normalized.map?.highlighted_restaurant_id).toBe("r1");
    expect(normalized.ui_actions).toEqual([
      { type: "show_map" },
      { type: "show_restaurant_cards", restaurant_ids: ["r1"] },
      { type: "update_map_markers", restaurant_ids: ["r1"] },
    ]);
  });

  it("leaves already single spoken recommendations alone", () => {
    expect(
      capSingleRecommendationSpokenText("I would try La Piazza because it is closest to you."),
    ).toBe("I would try La Piazza because it is closest to you.");
  });

  it("keeps the full ranked list behind a capped single recommendation", () => {
    const raw = response({
      map: {
        visible: true,
        marker_restaurant_ids: ["r1", "r2", "r3"],
        highlighted_restaurant_id: null,
      },
    });
    const normalized = normalizeSingleRestaurantRecommendationResponse(
      raw,
      "what's the closest restaurant to me",
    );
    const next = applyClientDiscoveryMemory(normalized, "what's the closest restaurant to me", {
      rawResponse: raw,
      recommendationMode: "single",
    });

    expect(next.map?.marker_restaurant_ids).toEqual(["r1"]);
    expect(next.assistant_memory?.discovery).toMatchObject({
      recommendation_mode: "single",
      sort_by: "distance",
      full_restaurant_ids: ["r1", "r2", "r3"],
      displayed_restaurant_ids: ["r1"],
      exhausted_restaurant_ids: ["r1"],
    });
  });

  it("uses discovery memory for other-restaurant follow-ups without repeating shown cards", () => {
    const next = applyClientDiscoveryMemory(
      response({
        map: {
          visible: true,
          marker_restaurant_ids: ["r1", "r2", "r3"],
          highlighted_restaurant_id: null,
        },
        ui_actions: [{ type: "show_restaurant_cards", restaurant_ids: ["r1", "r2", "r3"] }],
      }),
      "what other restaurants are there",
      {
        recommendationMode: "list",
        previousMemory: {
          booking_process: null,
          discovery: {
            transcript: "what's the closest restaurant to me",
            recommendation_mode: "single",
            cuisine: null,
            cuisine_group: null,
            city: null,
            query: null,
            sort_by: "distance",
            full_restaurant_ids: ["r1", "old-fallback"],
            displayed_restaurant_ids: ["r1"],
            exhausted_restaurant_ids: ["r1"],
          },
        },
      },
    );

    expect(next.map?.marker_restaurant_ids).toEqual(["r2", "r3"]);
    expect(next.ui_actions).toEqual([
      { type: "show_restaurant_cards", restaurant_ids: ["r2", "r3"] },
    ]);
    expect(next.assistant_memory?.discovery?.displayed_restaurant_ids).toEqual(["r2", "r3"]);
    expect(next.assistant_memory?.discovery?.exhausted_restaurant_ids).toEqual([
      "r1",
      "r2",
      "r3",
    ]);
  });
});
