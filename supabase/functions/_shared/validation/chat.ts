// chat.ts: shared schemas for AI/voice edge fns (TTS, menu suggestions).
// Phase C input-validation rollout (2026-05-20). Coordinate with Agent A
// before adding new schemas here.

import { z } from "zod";
import { BoundedText, Uuid } from "./base.ts";

// elevenlabs-tts: { text, voice_id? }. Hard cap text at 5000 chars to
// prevent abuse-driven ElevenLabs quota burn.
export const ElevenLabsTtsSchema = z.object({
  text: BoundedText(5000).min(1),
  voice_id: BoundedText(64).optional(),
});
export type ElevenLabsTtsInput = z.infer<typeof ElevenLabsTtsSchema>;

// generate-menu-suggestions: { restaurant_id, language? }
export const GenerateMenuSuggestionsSchema = z.object({
  restaurant_id: Uuid,
  language: BoundedText(16).optional(),
});
export type GenerateMenuSuggestionsInput = z.infer<
  typeof GenerateMenuSuggestionsSchema
>;

// cenaiva-chat — message-based chat with optional restaurant + geo context.
// The user-visible `message` field is the only text that originates from
// the diner; cap it aggressively to block prompt-injection payloads and
// runaway transcripts.
export const CenaivaChatSchema = z.object({
  message: BoundedText(5000).min(1, "message is required"),
  conversation_id: Uuid.optional(),
  restaurant_id: Uuid.optional(),
  language: BoundedText(8).optional(),
  mode: z.enum(["customer", "owner"]).optional(),
  user_lat: z.number().finite().optional(),
  user_lng: z.number().finite().optional(),
});
export type CenaivaChatInput = z.infer<typeof CenaivaChatSchema>;

// cenaiva-orchestrate — the voice orchestrator's request body. This is a
// large surface; we hard-cap the user-supplied `transcript` (and the
// array of recognizer alternatives) but accept opaque `booking_state`,
// `map_state`, `filters`, and `assistant_memory` objects as `unknown`
// because they are populated by the client and shaped by deterministic
// upstream logic (not by user free-text). The orchestrator does its own
// shape-checking on those fields downstream.
export const CenaivaOrchestrateSchema = z.object({
  transcript: BoundedText(5000).optional(),
  transcript_alternatives: z.array(BoundedText(5000)).max(10).optional(),
  screen: BoundedText(64).optional(),
  booking_state: z.record(z.string(), z.unknown()).optional(),
  map_state: z.record(z.string(), z.unknown()).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  visible_restaurant_ids: z.array(Uuid).max(200).optional(),
  selected_restaurant_id: Uuid.nullable().optional(),
  user_location: z
    .object({ lat: z.number().finite(), lng: z.number().finite() })
    .nullable()
    .optional(),
  timezone: BoundedText(64).optional(),
  conversation_id: BoundedText(128).optional(),
  has_saved_card: z.boolean().optional(),
  guest_id: Uuid.nullable().optional(),
  reservation_id: Uuid.nullable().optional(),
  // recommendation_mode / assistant_memory are validated/normalized
  // further downstream by dedicated parsers; accept any JSON-ish shape
  // here so we don't reject valid payloads at the gate.
  recommendation_mode: z.unknown().optional(),
  assistant_memory: z.unknown().optional(),
});
export type CenaivaOrchestrateInput = z.infer<typeof CenaivaOrchestrateSchema>;

// cenaiva-small-prompt — short conversational filler/disambig prompt.
// The user transcript is the only free-text field; cap at 2000.
export const CenaivaSmallPromptSchema = z.object({
  transcript: BoundedText(2000).min(1, "transcript is required"),
  booking: z
    .object({
      restaurant_id: z.unknown().optional(),
      restaurant_name: z.unknown().optional(),
      party_size: z.unknown().optional(),
      date: z.unknown().optional(),
      time: z.unknown().optional(),
    })
    .optional(),
  voice_id: BoundedText(128).optional(),
});
export type CenaivaSmallPromptInput = z.infer<typeof CenaivaSmallPromptSchema>;
