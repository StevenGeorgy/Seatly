import { z } from "zod";
import { Uuid } from "./base.ts";

export const TRANSCRIPT_MAX_CHARS = 5000;

export const OrchestrateTranscriptSchema = z.object({
  transcript: z.string().trim().min(1).max(TRANSCRIPT_MAX_CHARS),
  session_id: Uuid.optional(),
  booking_state: z.unknown().optional(),
});

export type OrchestrateTranscriptInput = z.infer<
  typeof OrchestrateTranscriptSchema
>;
