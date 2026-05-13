import { type Page, type Response } from "@playwright/test";

/**
 * Captures Cenaiva pipeline responses for multi-turn testing.
 *
 * Intercepts every network call to the four-stage pipeline endpoints,
 * parses the SSE / JSON body, and exposes the final assistant response
 * (`spoken_text`, `booking`, `ui_actions`, `intent`, `step`) for each turn.
 *
 * Stage 1 (local booking collector) doesn't hit the network. For local
 * responses, the test should fall back to DOM scraping via expectSpokenText.
 */

export interface CapturedResponse {
  url: string;
  stage: "orchestrate" | "availability" | "small-prompt" | "unknown";
  spoken_text: string | null;
  booking: Record<string, unknown> | null;
  ui_actions: unknown[];
  intent: string | null;
  step: string | null;
  raw: string;
  timestamp: number;
}

export class TurnRecorder {
  private responses: CapturedResponse[] = [];
  private cursor = 0;
  private pendingResponses: Promise<void>[] = [];

  constructor(private page: Page) {
    page.on("response", (resp) => {
      const p = this.handleResponse(resp).catch(() => {
        // swallow — tests will catch missing responses via timeout
      });
      this.pendingResponses.push(p);
      // Self-clean once resolved to avoid memory growth.
      p.finally(() => {
        this.pendingResponses = this.pendingResponses.filter((q) => q !== p);
      });
    });
  }

  private async handleResponse(resp: Response): Promise<void> {
    const url = resp.url();
    const stage = detectStage(url);
    if (stage === "unknown") return;

    // Skip prewarm fire-and-forget calls — useCenaivaSmallPrompt.prewarm()
    // hits the same endpoint with `{ prewarm: true }` on page load and would
    // otherwise pollute the first captured turn with a stale "Anytime!"
    // reply.
    const reqBody = resp.request().postData() ?? "";
    if (reqBody.includes('"prewarm":true') || reqBody.includes('"prewarm": true')) {
      return;
    }

    // Read as Buffer + decode as UTF-8 explicitly. Playwright's `resp.text()`
    // can default to ISO-8859-1 when Content-Type lacks charset (cenaiva-
    // orchestrate sends `text/event-stream` with no charset), which mangles
    // accented characters (â → Ã¢, é → Ã©, etc.). User bug 2026-05-12:
    // "Bâton Rouge" in real responses was failing /b[âa]ton/i tests because
    // the recorder saw "BÃ¢ton".
    let body: string;
    try {
      const buf = await resp.body();
      body = new TextDecoder("utf-8").decode(buf);
      // Defensive un-mojibake — if the SSE bytes were already misinterpreted
      // upstream (server middleware, etc.) into latin-1 chars, undo it.
      if (/Ã[¢©¨ªà]|â€[œ"™””]/.test(body)) {
        try {
          const bytes = new Uint8Array(body.length);
          for (let i = 0; i < body.length; i++) bytes[i] = body.charCodeAt(i) & 0xff;
          body = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        } catch {
          // keep mangled version if re-decode fails
        }
      }
    } catch {
      return;
    }

    const finalPayload = parsePipelineBody(body);
    if (!finalPayload) return;

    const captured = {
      url,
      stage,
      spoken_text: finalPayload.spoken_text ?? null,
      booking: (finalPayload.booking as Record<string, unknown>) ?? null,
      ui_actions: (finalPayload.ui_actions as unknown[]) ?? [],
      intent: (finalPayload.intent as string) ?? null,
      step: (finalPayload.step as string) ?? null,
      raw: body,
      timestamp: Date.now(),
    };
    this.responses.push(captured);
    if (process.env.CENAIVA_RECORDER_DEBUG === "true") {
      console.log(`[recorder] captured stage=${stage} booking_id=${(captured.booking as { restaurant_id?: string })?.restaurant_id ?? "(none)"} text="${(captured.spoken_text ?? "").slice(0, 80)}"`);
    }
  }

  /**
   * Wait for the next pipeline response since the last consumed one.
   * Times out if no new response arrives.
   *
   * After the first response arrives, keeps a short tail window (1.5s) to
   * collect any additional responses fired in the same turn (e.g., Stage 2
   * availability fires, then Stage 4 orchestrator fires). Returns the BEST
   * response: orchestrator over small-prompt over availability, breaking
   * ties by "richest booking" (has restaurant_id > has any field > nothing).
   * Without this, a turn that fires both availability + orchestrator was
   * returning the availability response first (no booking field), failing
   * custom assertions that depend on resp.booking.restaurant_id.
   */
  async waitForNext(timeoutMs = 30_000, tailMs = 1500): Promise<CapturedResponse> {
    const startCursor = this.cursor;
    // Drain any in-flight handler parses so we don't poll before they
    // append. Cap with a short timeout so a hung response doesn't block.
    await Promise.race([
      Promise.all(this.pendingResponses).then(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, Math.min(timeoutMs / 2, 5000))),
    ]);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.responses.length > startCursor) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (this.responses.length <= startCursor) {
      throw new Error(
        `TurnRecorder timed out waiting for response (had ${this.responses.length}, cursor ${this.cursor})`,
      );
    }
    // Tail-collect any additional responses fired in the same turn.
    const tailDeadline = Date.now() + tailMs;
    while (Date.now() < tailDeadline) {
      await new Promise((r) => setTimeout(r, 200));
    }
    const candidates = this.responses.slice(startCursor);
    this.cursor = this.responses.length;
    // Score: orchestrate=3, small-prompt=2, availability=1; +1 if booking is non-null;
    // +1 if booking.restaurant_id is set.
    const scored = candidates.map((r) => {
      let score = r.stage === "orchestrate" ? 3 : r.stage === "small-prompt" ? 2 : r.stage === "availability" ? 1 : 0;
      if (r.booking) score += 1;
      const b = r.booking as Record<string, unknown> | null;
      if (b && typeof b.restaurant_id === "string") score += 1;
      return { r, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0].r;
  }

  /** Reset the consumed-cursor so subsequent waitForNext starts fresh. */
  reset(): void {
    this.cursor = this.responses.length;
  }

  /** All captured responses since recorder was attached. */
  all(): CapturedResponse[] {
    return [...this.responses];
  }
}

function detectStage(url: string): CapturedResponse["stage"] {
  if (url.includes("/cenaiva-orchestrate")) return "orchestrate";
  if (url.includes("/cenaiva-availability")) return "availability";
  if (url.includes("/cenaiva-small-prompt")) return "small-prompt";
  return "unknown";
}

/**
 * Parse the response body for the final payload.
 *
 * Orchestrate uses SSE with `data: {...}` frames. We look for the
 * `type: "final"` frame and return its `payload`.
 *
 * Availability and small-prompt return plain JSON.
 */
function parsePipelineBody(body: string): Record<string, unknown> | null {
  // Try JSON first (availability, small-prompt).
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object") {
      // Small-prompt response shape: { spoken_text: "...", ... }
      // Availability response shape: { available_slots: [...], ... } — no
      // spoken_text but still useful to log.
      if ("spoken_text" in parsed || "available_slots" in parsed) {
        return parsed as Record<string, unknown>;
      }
    }
  } catch {
    // not JSON — likely SSE.
  }

  // SSE: split on blank lines, each frame is `data: {json}`.
  const frames = body.split(/\n\n/);
  for (const frame of frames) {
    const m = frame.match(/^data:\s*(\{.*\})/s);
    if (!m) continue;
    try {
      const evt = JSON.parse(m[1]) as { type?: string; payload?: unknown };
      if (evt.type === "final" && evt.payload && typeof evt.payload === "object") {
        return evt.payload as Record<string, unknown>;
      }
    } catch {
      // skip malformed frame
    }
  }
  return null;
}
