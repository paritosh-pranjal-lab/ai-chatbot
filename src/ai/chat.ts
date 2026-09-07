import type Anthropic from "@anthropic-ai/sdk";

import type { ChatMessage, ChatStreamEvent } from "@/types/chat";

import { describeAnthropicError, getAnthropicClient } from "./client";
import {
  buildSystemPrompt,
  CHAT_MODEL,
  FALLBACK_MODEL,
  MAX_TOKENS,
  MAX_TOOL_TURNS,
} from "./config";
import {
  describeQuery,
  loadCategories,
  normaliseQuery,
  runSearchProducts,
  SEARCH_PRODUCTS,
  tools,
} from "./tools";

/**
 * Where a reply's events go. The route handler passes an SSE encoder; a test
 * could pass an array push.
 */
export type ChatEventSink = (event: ChatStreamEvent) => void;

/**
 * Throws when the AI side cannot run at all — currently only a missing key.
 * Called before streaming starts so the failure can be a plain HTTP error
 * instead of an error buried inside a 200 response.
 */
export function assertChatReady(): void {
  getAnthropicClient();
}

/**
 * Runs one assistant turn to completion: streams text, executes any catalog
 * lookup the model asks for, feeds the results back, and repeats until it
 * answers in prose.
 *
 * Emits `text`, `status`, `products` and `error` events. It never emits `done`
 * — that belongs to whoever owns the transport.
 */
export async function streamChatReply(
  messages: ChatMessage[],
  emit: ChatEventSink,
  signal: AbortSignal,
): Promise<void> {
  const client = getAnthropicClient();

  const conversation: Anthropic.Beta.BetaMessageParam[] = messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  console.log("🚀 ~ streamChatReply ~ conversation:", conversation)

  let sawText = false;

  try {
    const system = buildSystemPrompt(await loadCategories(signal));

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const stream = client.beta.messages.stream(
        {
          model: CHAT_MODEL,
          max_tokens: MAX_TOKENS,
          system,
          messages: conversation,
          tools,
          // Adaptive thinking pays for itself here: it is what turns
          // "goats from India, under $25 a head" into the right filters.
          thinking: { type: "adaptive" },
          output_config: { effort: "medium" },
          // Server-side refusal fallback: if Claude declines for safety
          // reasons, the API retries on FALLBACK_MODEL inside this call.
          // To opt out, delete the next two lines and change
          // client.beta.messages.stream to client.messages.stream.
          betas: ["server-side-fallback-2026-06-01"],
          fallbacks: [{ model: FALLBACK_MODEL }],
        },
        { signal },
      );

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta" &&
          event.delta.text.length > 0
        ) {
          sawText = true;
          emit({ type: "text", text: event.delta.text });
        }
      }

      const reply = await stream.finalMessage();
      // Push the blocks verbatim — thinking and tool_use blocks must be echoed
      // back unchanged or the next request is rejected.
      conversation.push({ role: "assistant", content: reply.content });

      if (reply.stop_reason === "refusal") {
        emit({
          type: "error",
          message: "The assistant declined to answer that one. Try rephrasing it.",
        });
        return;
      }

      if (reply.stop_reason !== "tool_use") break;

      const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];

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

        emit({ type: "status", label: describeQuery(normaliseQuery(block.input)) });

        try {
          const outcome = await runSearchProducts(block.input, signal);
          if (outcome.products.length > 0) {
            emit({ type: "products", items: outcome.products });
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: outcome.resultText,
          });
        } catch (error) {
          console.error("[ai/chat] catalog search failed", error);
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
      emit({ type: "status", label: "" });
    }

    if (!sawText) {
      emit({
        type: "error",
        message: "The assistant stopped without answering. Try asking again.",
      });
    }
  } catch (error) {
    // A cancelled reply is not a failure; the client is already gone.
    if (signal.aborted) return;
    console.error("[ai/chat] reply failed", error);
    emit({ type: "error", message: describeAnthropicError(error).message });
  }
}
