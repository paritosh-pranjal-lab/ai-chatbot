"use client";

import { useCallback, useRef, useState } from "react";

import { parseEventBuffer } from "@/lib/stream";
import type { ChatMessage, UiMessage } from "@/types/chat";
import type { Product } from "@/types/product";

export type ChatStatus = "idle" | "streaming";

let idCounter = 0;
const nextId = () => `msg-${++idCounter}`;

/** Keeps the first occurrence of each product across repeated searches. */
function mergeProducts(existing: Product[] | undefined, incoming: Product[]): Product[] {
  const merged = [...(existing ?? [])];
  const seen = new Set(merged.map((product) => product.id));

  for (const product of incoming) {
    if (seen.has(product.id)) continue;
    seen.add(product.id);
    merged.push(product);
  }

  return merged;
}

export interface UseChatResult {
  messages: UiMessage[];
  status: ChatStatus;
  error: string | null;
  send: (input: string) => Promise<void>;
  stop: () => void;
  clear: () => void;
}

/**
 * Owns the conversation state and the fetch/read loop against /api/chat.
 * Text deltas, status lines, and product results are all patched onto the
 * placeholder assistant message as they arrive.
 */
export function useChat(): UseChatResult {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
  }, []);

  const send = useCallback(
    async (input: string) => {
      const content = input.trim();
      if (!content || status === "streaming") return;

      setError(null);

      // The route is stateless, so the whole history goes with every request.
      // Products and statuses stay client-side; the model reconstructs what it
      // found from its own tool results.
      const history: ChatMessage[] = [
        ...messages
          .filter((message) => message.content.trim().length > 0)
          .map(({ role, content: text }) => ({ role, content: text })),
        { role: "user", content },
      ];

      const assistantId = nextId();
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "user", content },
        { id: assistantId, role: "assistant", content: "" },
      ]);
      setStatus("streaming");

      const controller = new AbortController();
      abortRef.current = controller;

      const patchAssistant = (update: (message: UiMessage) => UiMessage) =>
        setMessages((prev) =>
          prev.map((message) => (message.id === assistantId ? update(message) : message)),
        );

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const message = await response
            .json()
            .then((data: { error?: string }) => data.error)
            .catch(() => undefined);
          throw new Error(message ?? `Request failed with status ${response.status}.`);
        }

        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        let streamError: string | null = null;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += value;
          const { events, rest } = parseEventBuffer(buffer);
          buffer = rest;

          for (const event of events) {
            switch (event.type) {
              case "text":
                patchAssistant((message) => ({
                  ...message,
                  content: message.content + event.text,
                  status: undefined,
                }));
                break;
              case "status":
                patchAssistant((message) => ({
                  ...message,
                  status: event.label.length > 0 ? event.label : undefined,
                }));
                break;
              case "products":
                patchAssistant((message) => ({
                  ...message,
                  products: mergeProducts(message.products, event.items),
                }));
                break;
              case "error":
                streamError = event.message;
                break;
              case "done":
                break;
            }
          }
        }

        if (streamError) setError(streamError);
      } catch (caught) {
        // An abort is the user pressing Stop, not a failure.
        if (!(caught instanceof Error) || caught.name !== "AbortError") {
          setError(caught instanceof Error ? caught.message : "Something went wrong.");
        }
      } finally {
        abortRef.current = null;
        setStatus("idle");
        setMessages((prev) =>
          prev
            // Clear any status line left behind by an aborted turn.
            .map((message) =>
              message.id === assistantId ? { ...message, status: undefined } : message,
            )
            // Drop a placeholder that never received anything.
            .filter(
              (message) =>
                message.id !== assistantId ||
                message.content.trim().length > 0 ||
                (message.products?.length ?? 0) > 0,
            ),
        );
      }
    },
    [messages, status],
  );

  return { messages, status, error, send, stop, clear };
}
