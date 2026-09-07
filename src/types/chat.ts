import type { Product } from "./product";

/** Roles the UI and the API route exchange. */
export type ChatRole = "user" | "assistant";

/** One turn as it travels over the wire to /api/chat. */
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** One turn as the UI holds it: adds an id, products, and a transient status. */
export interface UiMessage extends ChatMessage {
  id: string;
  /** Results of any product lookups made while answering this turn. */
  products?: Product[];
  /** What the bot is doing right now; cleared when the turn ends. */
  status?: string;
}

/**
 * Server-sent events emitted by /api/chat. One JSON object per SSE `data:` line.
 */
export type ChatStreamEvent =
  | { type: "text"; text: string }
  | { type: "status"; label: string }
  | { type: "products"; items: Product[] }
  | { type: "error"; message: string }
  | { type: "done" };
