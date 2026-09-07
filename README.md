# WTX Sourcing Assistant

A wholesale sourcing chatbot: Next.js App Router, TypeScript, CSS Modules, and
Claude with **tool calling** against the live WorldTradeX catalog. The model does
not memorise the catalog — it calls a `search_products` tool, which queries
`searchProductsElastic` on the buyer GraphQL API, and the matches come back as
product cards in the chat.

## Setup

```bash
npm install
```

Get an API key from https://console.anthropic.com/settings/keys, then:

```bash
copy .env.example .env.local
```

```
ANTHROPIC_API_KEY=sk-ant-...
```

```bash
npm run dev
```

Open http://localhost:3000. The catalog needs no configuration — search on the
stage buyer API is public, and the endpoint is the only default that matters.

## The catalog integration

[`src/lib/products/wtx-source.ts`](src/lib/products/wtx-source.ts) owns
everything WTX-specific. What it does and why:

| Concern | How it is handled |
| --- | --- |
| `products` is a JSON scalar | Every field is untyped and optional; each one goes through a `str`/`num` guard, and a row missing `id` or `name` is dropped. |
| Price | `discountedPrice` is `0` on undiscounted listings, so it cannot be trusted alone — falls back to `unitPrice`. When `unitPrice` is higher, it renders struck through. |
| No currency in the payload | Formatting only, from `PRODUCT_CURRENCY` (default `USD`). |
| Descriptions | Arrive as Markdown (`# Chicken\n\n…`) or HTML (`<p>…</p>`); both are stripped and truncated before the model or the card sees them. |
| Images | `.heic` files and dead URLs are skipped — renderable extensions only, plus an `onError` fallback to a letter tile. |
| Inconsistent units | `Kilograms` / `kilograms` / `liters` / `head` are lowercased for display. |
| Category | The API exposes only category UUIDs, so `productType` (`Livestock` / `Agricultural`) is the grouping used. |

### What the API can and cannot filter

`ProductSearchInput` accepts `searchQuery`, `size`, `from`, `countries`,
`states`, `cities` — so **text and country filter server-side**, and product
type, price range and stock are applied in TypeScript after the fetch. When any
of those local filters is in play the source over-fetches (up to 60 rows) so the
filter is not just looking at the first page.

`spellCorrection` and `suggestions` are returned to the model **labelled as
unreliable** — the API answers "goat" with "guar" — and only when a search found
nothing.

## Product URLs

Cards are only clickable if you set a template, since the buyer app's product
route is not inferable from the API:

```
WTX_PRODUCT_URL_TEMPLATE=https://stage-buyer.worldtradex.com/product/{id}
```

## How the tool call works

```
browser ── POST /api/chat ──▶ route handler
                                  │
                                  ├─▶ Claude, holding the search_products tool
                                  │      ◀── tool_use { text: "goat", countries: ["India"] }
                                  ├─▶ searchProductsElastic ── stage-buyer-api
                                  │      ──▶ trimmed products back to Claude
                                  │      ◀── prose framing the results
                                  ▼
        SSE: status → products → text → done
```

The loop is in [`src/app/api/chat/route.ts`](src/app/api/chat/route.ts) and runs
at most `MAX_TOOL_TURNS` (3) times, so a second looser search is possible but a
runaway loop is not.

Two design choices worth knowing:

- **Products stream as structured data, not prose.** The route emits
  `{"type":"products","items":[...]}` and the UI renders real cards. The system
  prompt tells Claude *not* to restate price, origin, or minimum quantity,
  because the card already shows them — it writes the framing instead.
- **The prompt is built around wholesale rules.** Prices are per unit and the
  unit differs per listing, every listing has a minimum order quantity, and
  stock is finite. Claude is told to flag when a requested volume is below the
  MOQ or above available stock, and never to state a fact that did not come from
  a tool result.

## Layout

```
src/
  app/
    api/chat/route.ts        validation, the tool-calling loop, SSE output
    layout.tsx  page.tsx     shell
    globals.css              design tokens (light + dark) and the reset
  components/
    Chat/                    Chat, MessageList, Message, Composer
    Products/                ProductGrid, ProductCard
  hooks/useChat.ts           conversation state + the fetch/read loop
  lib/
    anthropic.ts             lazy SDK client, error → safe message mapping
    config.ts                model, system prompt, tool-turn cap
    limits.ts                limits shared by client and server
    stream.ts                SSE encode / parse helpers
    tools.ts                 search_products schema, executor, arg validation
    products/
      index.ts               selects the ProductSource
      wtx-source.ts          the GraphQL call and the field mapping
  types/
    chat.ts  product.ts
```

## Tuning

| Want to change | Where |
| --- | --- |
| Model, or the system prompt | `src/lib/config.ts` |
| Reasoning depth / cost | `output_config.effort` in `route.ts` — `"medium"` now; `"low"` is faster, `"high"` picks filters more carefully |
| What the tool accepts | `tools` in `src/lib/tools.ts` — the descriptions are what teach the model to use it |
| Results per search | `MAX_PRODUCTS_PER_SEARCH` in `src/lib/limits.ts` |
| Over-fetch width for local filters | `OVER_FETCH_FACTOR` / `MAX_SERVER_PAGE` in `wtx-source.ts` |
| Card design | `src/components/Products/ProductCard.module.css` |

A refusal fallback is enabled in `route.ts` (`betas` + `fallbacks`): if Claude
declines a request on safety grounds, the API retries it on `claude-opus-4-8`
inside the same call. Delete those two lines and change
`client.beta.messages.stream` to `client.messages.stream` to opt out.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on :3000 |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |

ESLint is not configured — add `eslint` and `eslint-config-next` if you want it.
