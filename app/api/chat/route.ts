import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";
import { buildDataContext, SYSTEM_PROMPT } from "@/lib/chat-context";

export const maxDuration = 300;

type ChatTurn = { role: "user" | "assistant"; content: string };

const client = new Anthropic(); // reads ANTHROPIC_API_KEY

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });
  }

  const body = await req.json().catch(() => null) as { messages?: ChatTurn[]; focusDays?: number } | null;
  const history = (body?.messages ?? [])
    .filter(m => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-30);
  if (!history.length || history[history.length - 1].role !== "user") {
    return NextResponse.json({ error: "Send at least one user message." }, { status: 400 });
  }

  let data: string;
  try {
    data = await buildDataContext(createServiceClient());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not load data" }, { status: 500 });
  }

  const today = new Date().toISOString().split("T")[0];
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map(m => ({ role: m.role, content: m.content }));
  if (body?.focusDays) {
    // Volatile per-request note goes after the cached prefix
    messages.push({ role: "system", content: `The dashboard is currently showing the ${body.focusDays}-day period. Default to it unless asked otherwise.` });
  }

  const stream = client.beta.messages.stream({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium" },
    system: [
      { type: "text", text: SYSTEM_PROMPT },
      { type: "text", text: `## Account data (as of ${today})\n\n${data}`, cache_control: { type: "ephemeral" } },
    ],
    messages,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          controller.enqueue(encoder.encode("\n\n_The model declined to answer this one. Try rephrasing._"));
        } else if (final.stop_reason === "max_tokens") {
          controller.enqueue(encoder.encode("\n\n_(Answer cut off at the length limit.)_"));
        }
      } catch (err) {
        const msg = err instanceof Anthropic.APIError ? `API error ${err.status}: ${err.message}` : err instanceof Error ? err.message : "Unknown error";
        controller.enqueue(encoder.encode(`\n\n_Error: ${msg}_`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
