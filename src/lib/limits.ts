/**
 * Limits shared by the browser and the route handler. Kept free of
 * `process.env` so client components can import them safely.
 */

/**
 * Turns sent per request. The route is stateless — the browser resends the
 * whole history every time — so this caps how large one request can get.
 */
export const MAX_HISTORY_MESSAGES = 40;

/** Characters accepted in a single user turn. */
export const MAX_MESSAGE_CHARS = 4_000;

/** Products returned by one lookup. Keeps the prompt (and the bill) bounded. */
export const MAX_PRODUCTS_PER_SEARCH = 8;
