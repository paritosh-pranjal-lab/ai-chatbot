import type Anthropic from "@anthropic-ai/sdk";

import { describeAnthropicError, getAnthropicClient } from "@/lib/anthropic";
import {
  buildSystemPrompt,
  CHAT_MODEL,
  FALLBACK_MODEL,
  MAX_TOKENS,
  MAX_TOOL_TURNS,
} from "@/lib/config";
import { MAX_HISTORY_MESSAGES, MAX_MESSAGE_CHARS } from "@/lib/limits";
import { encodeEvent } from "@/lib/stream";
import {
  describeQuery,
  loadCategories,
  normaliseQuery,
  runSearchProducts,
  SEARCH_PRODUCTS,
  tools,
} from "@/lib/tools";
import type { ChatMessage } from "@/types/chat";

// The Anthropic SDK is a Node client, and streaming must not be cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatRequestBody {
  messages: ChatMessage[];
}

/** Returns the parsed body, or a message explaining why it was rejected. */
function parseBody(raw: unknown): ChatRequestBody | string {
  if (typeof raw !== "object" || raw === null) return "Expected a JSON object.";

  const { messages } = raw as { messages?: unknown };
  if (!Array.isArray(messages) || messages.length === 0) {
    return "The `messages` field must be a non-empty array.";
  }
  if (messages.length > MAX_HISTORY_MESSAGES) {
    return `Send at most ${MAX_HISTORY_MESSAGES} turns per request.`;
  }

  const parsed: ChatMessage[] = [];
  for (const message of messages) {
    if (typeof message !== "object" || message === null) {
      return "Each message must be an object.";
    }
    const { role, content } = message as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") {
      return "Each message needs a role of user or assistant.";
    }
    if (typeof content !== "string" || content.trim().length === 0) {
      return "Each message needs non-empty string content.";
    }
    if (content.length > MAX_MESSAGE_CHARS) {
      return `Messages are limited to ${MAX_MESSAGE_CHARS} characters.`;
    }
    parsed.push({ role, content });
  }

  if (parsed.at(-1)?.role !== "user") {
    return "The last message must come from the user.";
  }

  return { messages: parsed };
}

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Request body was not valid JSON." }, { status: 400 });
  }

  const parsed = parseBody(raw);
  if (typeof parsed === "string") {
    return Response.json({ error: parsed }, { status: 400 });
  }

  let client: Anthropic;
  try {
    client = getAnthropicClient();
  } catch (error) {
    const { status, message } = describeAnthropicError(error);
    return Response.json({ error: message }, { status });
  }

  const encoder = new TextEncoder();
  const aborter = new AbortController();
  // Abort the upstream request and the catalog lookup when the browser
  // disconnects, so a cancelled reply stops being billed.
  request.signal.addEventListener("abort", () => aborter.abort(), { once: true });

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Client went away mid-stream; `cancel` below aborts the rest.
        }
      };

      const conversation: Anthropic.MessageParam[] = parsed.messages.map((message) => ({
        role: message.role,
        content: message.content,
      }));

      let sawText = false;

      try {
        const system = buildSystemPrompt(await loadCategories(aborter.signal));

        // The agentic loop: stream a turn, run whatever tool the model asked
        // for, feed the results back, repeat until it answers in prose.
        for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
          const stream = client.beta.messages.stream(
            {
              model: CHAT_MODEL,
              max_tokens: MAX_TOKENS,
              system,
              messages: conversation,
              tools,
              // Adaptive thinking pays for itself here: it is what turns
              // "something warm under 3k" into the right filter arguments.
              thinking: { type: "adaptive" },
              output_config: { effort: "medium" },
              // Server-side refusal fallback: if Claude declines for safety
              // reasons, the API retries on FALLBACK_MODEL inside this call.
              // To opt out, delete the next two lines and change
              // client.beta.messages.stream to client.messages.stream.
              betas: ["server-side-fallback-2026-06-01"],
              fallbacks: [{ model: FALLBACK_MODEL }],
            },
            { signal: aborter.signal },
          );

          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta" &&
              event.delta.text.length > 0
            ) {
              sawText = true;
              send(encodeEvent({ type: "text", text: event.delta.text }));
            }
          }

          const reply = await stream.finalMessage();
          // Push the blocks verbatim — thinking blocks must be echoed back
          // unchanged for the next turn of a tool-using conversation.
          conversation.push({ role: "assistant", content: reply.content });

          if (reply.stop_reason === "refusal") {
            send(
              encodeEvent({
                type: "error",
                message: "The assistant declined to answer that one. Try rephrasing it.",
              }),
            );
            break;
          }

          if (reply.stop_reason !== "tool_use") break;

          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const block of reply.content) {
            if (block.type !== "tool_use") continue;

            if (block.name !== SEARCH_PRODUCTS) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: `Unknown tool: ${block.name}`,
                is_error: true,
              });
              continue;
            }

            send(
              encodeEvent({ type: "status", label: describeQuery(normaliseQuery(block.input)) }),
            );

            try {
              const outcome = await runSearchProducts(block.input, aborter.signal);
              if (outcome.products.length > 0) {
                send(encodeEvent({ type: "products", items: outcome.products }));
              }
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: outcome.resultText,
              });
            } catch (error) {
              console.error("[api/chat] product search failed", error);
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: "The catalog search failed. Tell the user the catalog is unreachable.",
                is_error: true,
              });
            }
          }

          // Every tool_result for one assistant turn goes back in a single user
          // message, or the model learns to stop calling tools in parallel.
          conversation.push({ role: "user", content: toolResults });
          send(encodeEvent({ type: "status", label: "" }));
        }

        if (!sawText) {
          send(
            encodeEvent({
              type: "error",
              message: "The assistant stopped without answering. Try asking again.",
            }),
          );
        }
        send(encodeEvent({ type: "done" }));
      } catch (error) {
        if (aborter.signal.aborted) return;
        console.error("[api/chat] stream failed", error);
        send(encodeEvent({ type: "error", message: describeAnthropicError(error).message }));
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
    cancel() {
      aborter.abort();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Stops proxies (nginx, some CDNs) from buffering the stream.
      "X-Accel-Buffering": "no",
    },
  });
}
