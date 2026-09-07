import { assertChatReady, streamChatReply } from "@/ai/chat";
import { describeAnthropicError } from "@/ai/client";
import { MAX_HISTORY_MESSAGES, MAX_MESSAGE_CHARS } from "@/shared/limits";
import { encodeEvent } from "@/shared/stream";
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

/**
 * Transport only: validate the request, then hand the conversation to
 * @/ai/chat and forward whatever it emits as server-sent events. Every model
 * and catalog decision lives behind streamChatReply.
 */
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

  try {
    assertChatReady();
  } catch (error) {
    const { status, message } = describeAnthropicError(error);
    return Response.json({ error: message }, { status });
  }

  const encoder = new TextEncoder();
  const aborter = new AbortController();
  // Abort the model call and the catalog lookup when the browser disconnects,
  // so a cancelled reply stops being billed.
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

      try {
        await streamChatReply(
          parsed.messages,
          (event) => send(encodeEvent(event)),
          aborter.signal,
        );
        send(encodeEvent({ type: "done" }));
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
