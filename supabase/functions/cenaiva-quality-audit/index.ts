// Cenaiva quality audit — LLM-as-judge over recent conversations.
//
// Picks N random recent conversations, asks gpt-4o-mini to rate the AI's
// response on a 1-5 quality scale, stores results in `cenaiva_quality_audits`.
// Run nightly via pg_cron (see schedule below) or trigger manually:
//   curl -X POST .../functions/v1/cenaiva-quality-audit -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
//
// Dashboard query to triage failures:
//   SELECT created_at, user_transcript, ai_response, score, judge_reasoning, flags
//   FROM cenaiva_quality_audits
//   WHERE score < 3 AND reviewed = false
//   ORDER BY created_at DESC;

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import OpenAI from "https://esm.sh/openai@4.65.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SAMPLE_SIZE = parseInt(Deno.env.get("CENAIVA_AUDIT_SAMPLE_SIZE") ?? "20", 10);
const LOOKBACK_HOURS = parseInt(Deno.env.get("CENAIVA_AUDIT_LOOKBACK_HOURS") ?? "24", 10);

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const RUBRIC = `You are a quality judge for Cenaiva — an AI restaurant booking assistant.
You will see one USER message and the AI's RESPONSE. Rate the response 1-5:

5 = Excellent — natural, on-task, advances the user's goal
4 = Good — correct but slightly robotic or could be clearer
3 = OK — answers but misses context or feels off
2 = Bad — wrong info, confusing, or off-topic
1 = Broken — refuses, hallucinates, or makes no sense

Also flag any of these issues (return as JSON array of strings):
- "robotic" — sounds like a templated bot
- "wrong_restaurant" — references restaurant user didn't mention
- "lost_context" — forgot earlier in conversation
- "refusal" — refused a reasonable request
- "hallucination" — made up data (e.g. hours, reviews)
- "off_topic" — didn't address the user's question
- "missing_followup" — should have offered next step but didn't

Return ONLY JSON like: {"score": 4, "reasoning": "...", "flags": ["..."]}`;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // Pick N random recent assistant messages with their preceding user turn.
    const { data: recentMessages, error: queryErr } = await admin
      .from("chat_messages")
      .select("conversation_id, role, content, created_at")
      .gte("created_at", new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(SAMPLE_SIZE * 4); // 4x buffer to find pairs

    if (queryErr || !recentMessages) {
      return new Response(JSON.stringify({ error: "query_failed", detail: queryErr?.message }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

    // Build (user transcript → AI response) pairs from consecutive messages.
    // chat_messages is sorted DESC, so we iterate in reverse for natural order.
    const pairs: Array<{ conversation_id: string; user: string; ai: string }> = [];
    const byConv = new Map<string, Array<{ role: string; content: string }>>();
    for (const m of recentMessages.reverse()) {
      const arr = byConv.get(m.conversation_id as string) ?? [];
      arr.push({ role: m.role as string, content: m.content as string });
      byConv.set(m.conversation_id as string, arr);
    }
    for (const [convId, msgs] of byConv) {
      for (let i = 1; i < msgs.length; i++) {
        if (msgs[i - 1].role === "user" && msgs[i].role === "assistant") {
          pairs.push({
            conversation_id: convId,
            user: msgs[i - 1].content,
            ai: msgs[i].content,
          });
        }
      }
    }

    // Randomly sample SAMPLE_SIZE pairs.
    const shuffled = pairs.sort(() => Math.random() - 0.5).slice(0, SAMPLE_SIZE);

    const results: Array<Record<string, unknown>> = [];
    for (const pair of shuffled) {
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0,
          max_tokens: 200,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: RUBRIC },
            { role: "user", content: `USER: ${pair.user}\n\nAI RESPONSE: ${pair.ai}` },
          ],
        });
        const raw = completion.choices[0]?.message?.content ?? "{}";
        const parsed = JSON.parse(raw);
        const score = Math.max(1, Math.min(5, Math.round(Number(parsed.score) || 3)));
        await admin.from("cenaiva_quality_audits").insert({
          conversation_id: pair.conversation_id,
          user_transcript: pair.user,
          ai_response: pair.ai,
          score,
          judge_reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 500) : null,
          flags: Array.isArray(parsed.flags) ? parsed.flags.slice(0, 10) : [],
        });
        results.push({ conversation_id: pair.conversation_id, score, flags: parsed.flags });
      } catch (err) {
        const e = err as { message?: string };
        console.error("audit pair failed:", e?.message);
      }
    }

    return new Response(JSON.stringify({
      audited: results.length,
      sample_size: SAMPLE_SIZE,
      avg_score: results.length ? results.reduce((s, r) => s + ((r.score as number) || 0), 0) / results.length : null,
      low_score_count: results.filter((r) => (r.score as number) < 3).length,
    }, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const e = err as { message?: string };
    return new Response(JSON.stringify({ error: e?.message ?? "unknown" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
