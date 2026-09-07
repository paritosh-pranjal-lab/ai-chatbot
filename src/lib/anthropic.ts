import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | undefined;

/**
 * Lazily built singleton. Lazy so a missing key surfaces as a handled error on
 * the first chat request rather than crashing at module load.
 */
export function getAnthropicClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. Copy .env.example to .env.local and add your key.");
  }
  client ??= new Anthropic();
  return client;
}

/**
 * Turns an SDK error into something safe to show a browser: a status code and a
 * message that never leaks the key, the prompt, or a stack trace.
 */
export function describeAnthropicError(error: unknown): { status: number; message: string } {
  if (error instanceof Anthropic.AuthenticationError) {
    return { status: 500, message: "The server's Anthropic API key is missing or invalid." };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { status: 429, message: "Rate limited by the Claude API. Try again in a moment." };
  }
  if (error instanceof Anthropic.BadRequestError) {
    return { status: 400, message: "The Claude API rejected this request." };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { status: 502, message: "Could not reach the Claude API." };
  }
  if (error instanceof Anthropic.APIError) {
    return { status: error.status ?? 502, message: "The Claude API returned an error." };
  }
  if (error instanceof Error && error.message.includes("ANTHROPIC_API_KEY")) {
    return { status: 500, message: error.message };
  }
  return { status: 500, message: "Something went wrong generating a reply." };
}
