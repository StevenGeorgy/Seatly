import { useCallback, useRef } from "react";

export type LatencyTransport = "readable_stream" | "buffered_text" | "xhr_event_source";

export type LatencyCheckpoints = {
  transcriptAt?: number;
  requestSentAt?: number;
  firstSpeechChunkAt?: number;
  finalReceivedAt?: number;
  playbackRequestedAt?: number;
  firstAudioDecodedAt?: number;
  streamingTransport?: LatencyTransport;
};

type NumericCheckpoint = Exclude<keyof LatencyCheckpoints, "streamingTransport">;

const DEBUG = (import.meta.env.VITE_CENAIVA_VOICE_DEBUG ?? "") === "true";

function setNumericCheckpoint(
  cp: LatencyCheckpoints,
  name: NumericCheckpoint,
  value: number,
): void {
  cp[name] = value;
}

export function useCenaivaLatencyBudget() {
  const turnsRef = useRef(new Map<number, LatencyCheckpoints>());

  const start = useCallback((turnId: number) => {
    if (!DEBUG) return;
    turnsRef.current.set(turnId, {});
  }, []);

  const mark = useCallback((turnId: number, name: NumericCheckpoint) => {
    if (!DEBUG) return;
    const cp = turnsRef.current.get(turnId);
    if (!cp) return;
    if (cp[name] != null) return; // first-write wins
    setNumericCheckpoint(cp, name, performance.now());
  }, []);

  const markTransport = useCallback((turnId: number, transport: LatencyTransport) => {
    if (!DEBUG) return;
    const cp = turnsRef.current.get(turnId);
    if (cp) cp.streamingTransport = transport;
  }, []);

  const summarize = useCallback((turnId: number) => {
    if (!DEBUG) return;
    const cp = turnsRef.current.get(turnId);
    if (!cp || cp.transcriptAt == null) return;
    const dur = (a?: number, b?: number) =>
      a != null && b != null ? `${Math.round(b - a)}ms` : "n/a";
    console.log(
      `[cenaiva-latency] turn=${turnId}` +
        ` t→firstSpeech=${dur(cp.transcriptAt, cp.firstSpeechChunkAt)}` +
        ` t→final=${dur(cp.transcriptAt, cp.finalReceivedAt)}` +
        ` t→firstAudio=${dur(cp.transcriptAt, cp.firstAudioDecodedAt)}` +
        ` transport=${cp.streamingTransport ?? "n/a"}`,
    );
    turnsRef.current.delete(turnId);
  }, []);

  return { start, mark, markTransport, summarize };
}
