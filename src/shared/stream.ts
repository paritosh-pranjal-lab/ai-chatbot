import type { ChatStreamEvent } from "@/types/chat";

/** Serialises one event as an SSE `data:` frame. */
export function encodeEvent(event: ChatStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Splits a raw SSE body into events, returning whatever trailing fragment did
 * not form a complete frame so the caller can prepend it to the next chunk.
 */
export function parseEventBuffer(buffer: string): {
  events: ChatStreamEvent[];
  rest: string;
} {
  const frames = buffer.split("\n\n");
  const rest = frames.pop() ?? "";
  const events: ChatStreamEvent[] = [];

  for (const frame of frames) {
    const line = frame.trim();
    if (!line.startsWith("data:")) continue;
    try {
      events.push(JSON.parse(line.slice("data:".length).trim()) as ChatStreamEvent);
    } catch {
      // A malformed frame is not worth tearing the stream down for.
    }
  }

  return { events, rest };
}
