import type Anthropic from "@anthropic-ai/sdk";

import type { Product, ProductQuery } from "@/types/product";

import { MAX_PRODUCTS_PER_SEARCH } from "@/shared/limits";
import { productSource } from "./catalog";

export const SEARCH_PRODUCTS = "search_products";

/**
 * The tool the model sees. The description is doing real work here — it is the
 * only place the model learns when to search and what the filters mean.
 */
export const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: SEARCH_PRODUCTS,
    description: `Search the WorldTradeX wholesale catalog of agricultural
produce and livestock. Call this whenever the buyer is looking for a commodity,
asking what is available, or asking about price, origin, stock, or minimum
order quantity. Translate what they said into a short search phrase plus
whatever filters they implied. Prices are per unit (per head, per kilogram, per
litre) and every listing carries a minimum order quantity. Returns matches
cheapest first, or an empty list when nothing matches.`,
    input_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description:
            "Free-text search phrase — a commodity name works best, e.g. 'goat', 'cashew', 'orange juice'. Keep it to a few words and drop filler like 'I want' or 'show me'. Leave empty to browse everything.",
        },
        countries: {
          type: "array",
          items: { type: "string" },
          description:
            "Countries of origin to restrict to, as full names, e.g. ['India', 'United States']. Only set this when the buyer names a sourcing country.",
        },
        productType: {
          type: "string",
          enum: ["Livestock", "Agricultural"],
          description:
            "Restrict to live animals (Livestock) or crops and processed produce (Agricultural). Omit if the buyer did not distinguish.",
        },
        minPrice: {
          type: "number",
          description: "Lowest acceptable price per unit.",
        },
        maxPrice: {
          type: "number",
          description:
            "Highest acceptable price per unit. Set this whenever the buyer mentions a budget — note it is per unit, not per order.",
        },
        inStockOnly: {
          type: "boolean",
          description: "Set true when the buyer only wants listings with stock available now.",
        },
        limit: {
          type: "number",
          description: `Maximum number of products to return, 1 to ${MAX_PRODUCTS_PER_SEARCH}. Defaults to ${MAX_PRODUCTS_PER_SEARCH}.`,
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
];

/**
 * The model's arguments are JSON but not trusted — a wrong type or a negative
 * price should narrow the search, never throw.
 */
export function normaliseQuery(input: unknown): ProductQuery {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const query: ProductQuery = {};

  if (typeof raw.text === "string" && raw.text.trim().length > 0) {
    query.text = raw.text.trim().slice(0, 200);
  }
  if (Array.isArray(raw.countries)) {
    const countries = raw.countries
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim().slice(0, 80))
      .slice(0, 10);
    if (countries.length > 0) query.countries = countries;
  }
  if (typeof raw.productType === "string" && raw.productType.trim().length > 0) {
    query.productType = raw.productType.trim().slice(0, 40);
  }
  if (typeof raw.minPrice === "number" && Number.isFinite(raw.minPrice) && raw.minPrice >= 0) {
    query.minPrice = raw.minPrice;
  }
  if (typeof raw.maxPrice === "number" && Number.isFinite(raw.maxPrice) && raw.maxPrice > 0) {
    query.maxPrice = raw.maxPrice;
  }
  if (typeof raw.inStockOnly === "boolean") {
    query.inStockOnly = raw.inStockOnly;
  }
  if (typeof raw.limit === "number" && Number.isFinite(raw.limit)) {
    query.limit = Math.max(1, Math.min(Math.trunc(raw.limit), MAX_PRODUCTS_PER_SEARCH));
  }

  return query;
}

/** A short human label for the status line the UI shows during a lookup. */
export function describeQuery(query: ProductQuery): string {
  if (query.text !== undefined) return `Searching for “${query.text}”…`;
  if (query.productType !== undefined) return `Browsing ${query.productType}…`;
  if (query.countries !== undefined) return `Browsing listings from ${query.countries.join(", ")}…`;
  return "Searching the catalog…";
}

export interface SearchOutcome {
  /** Rendered as cards by the UI. */
  products: Product[];
  /** Sent back to the model as the tool result. */
  resultText: string;
}

/**
 * Executes one search_products call. Trims each product down to the fields the
 * model actually needs to reason about — the UI already holds the full objects,
 * so sending image URLs into the prompt would just cost tokens.
 */
export async function runSearchProducts(
  input: unknown,
  signal: AbortSignal,
): Promise<SearchOutcome> {
  const query = normaliseQuery(input);
  const { products, totalHits, suggestions } = await productSource.search(query, signal);

  if (products.length === 0) {
    return {
      products,
      resultText: JSON.stringify({
        matchCount: 0,
        query,
        // Elasticsearch suggestions are weak — "goat" comes back as "guar" —
        // so they are labelled rather than presented as corrections.
        unreliableSpellingGuesses: suggestions,
        note: "Nothing matched. Suggest looser filters or a different commodity name. Do not treat the spelling guesses as facts, and do not invent listings.",
      }),
    };
  }

  return {
    products,
    resultText: JSON.stringify({
      matchCount: products.length,
      totalServerMatches: totalHits,
      products: products.map((product) => ({
        id: product.id,
        name: product.name,
        description: product.description,
        productType: product.category,
        pricePerUnit: product.price,
        currency: product.currency,
        unitType: product.unitType,
        minOrderQuantity: product.minQuantity,
        stockAvailable: product.stock,
        country: product.country,
        rating: product.rating,
        inStock: product.inStock,
      })),
    }),
  };
}

/** Category names for the system prompt, or an empty list if unavailable. */
export async function loadCategories(signal: AbortSignal): Promise<string[]> {
  if (productSource.categories === undefined) return [];
  try {
    return await productSource.categories(signal);
  } catch {
    // A catalog that cannot list categories is not a reason to fail the chat.
    return [];
  }
}
