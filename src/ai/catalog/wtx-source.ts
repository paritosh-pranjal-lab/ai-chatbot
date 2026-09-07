import { MAX_PRODUCTS_PER_SEARCH } from "@/shared/limits";
import type {
  Product,
  ProductQuery,
  ProductSearchResult,
  ProductSource,
} from "@/types/product";

const DEFAULT_ENDPOINT = "https://stage-buyer-api.worldtradex.com/graphQL";
const REQUEST_TIMEOUT_MS = 15_000;

/** Over-fetch this much when filters have to be applied client-side. */
const OVER_FETCH_FACTOR = 8;
const MAX_SERVER_PAGE = 60;

const SEARCH_QUERY = `
  query SearchProductsElastic($input: ProductSearchInput!) {
    searchProductsElastic(input: $input) {
      products
      totalHits
      spellCorrection
      suggestions {
        text
        score
        freq
      }
    }
  }
`;

/**
 * `products` comes back as a JSON scalar, so every field is untyped and any of
 * them can be absent — the payload varies product to product.
 */
type RawProduct = Record<string, unknown>;

interface SearchResponse {
  data?: {
    searchProductsElastic?: {
      products?: unknown;
      totalHits?: unknown;
      spellCorrection?: unknown;
      suggestions?: unknown;
    };
  };
  errors?: { message?: string }[];
}

/* ------------------------------- helpers -------------------------------- */

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

const RENDERABLE_IMAGE = /\.(jpe?g|png|webp|gif|avif)(\?|$)/i;

/**
 * Descriptions arrive as Markdown ("# Chicken\n\n…") or HTML ("<p>…</p>"),
 * so strip both — the card renders plain text and the model does not need the
 * markup either.
 */
function toPlainText(value: unknown, maxChars = 320): string {
  const raw = str(value);
  if (raw === null) return "";

  const text = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*|__|[*_`>]/g, "")
    .replace(/---+/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

  return text.length > maxChars ? `${text.slice(0, maxChars - 1).trimEnd()}…` : text;
}

/** First image the browser can actually display — .heic files are skipped. */
function pickImage(raw: RawProduct): string | null {
  const direct = str(raw.image);
  if (direct !== null && RENDERABLE_IMAGE.test(direct)) return direct;

  if (Array.isArray(raw.images)) {
    for (const entry of raw.images) {
      if (typeof entry !== "object" || entry === null) continue;
      const url = str((entry as Record<string, unknown>).url);
      if (url !== null && RENDERABLE_IMAGE.test(url)) return url;
    }
  }

  return null;
}

function productUrl(id: string): string | null {
  const template = process.env.WTX_PRODUCT_URL_TEMPLATE;
  if (template === undefined || !template.includes("{id}")) return null;
  return template.replace("{id}", encodeURIComponent(id));
}

function toProduct(raw: RawProduct): Product | null {
  const id = str(raw.id);
  const name = str(raw.name) ?? str(raw.searchableName);
  if (id === null || name === null) return null;
  if (raw.active === false) return null;

  const unitPrice = num(raw.unitPrice);
  const discounted = num(raw.discountedPrice);
  // discountedPrice is 0 on products that have no discount, so it cannot be
  // trusted on its own — fall back to unitPrice.
  const price =
    discounted !== null && discounted > 0 ? discounted : (unitPrice ?? 0);
  const listPrice =
    unitPrice !== null && unitPrice > price ? unitPrice : null;

  const stock = num(raw.stock) ?? num(raw.normalizedStock);

  return {
    id,
    name,
    description: toPlainText(raw.description),
    category: str(raw.productType) ?? "Uncategorised",
    price,
    listPrice,
    currency: process.env.PRODUCT_CURRENCY ?? "USD",
    // Casing is inconsistent upstream (Kilograms / kilograms / liters).
    unitType: (str(raw.unitType) ?? "unit").toLowerCase(),
    minQuantity: num(raw.minQuantity),
    country: str(raw.country),
    imageUrl: pickImage(raw),
    url: productUrl(id),
    rating: num(raw.averageRating),
    inStock: stock === null ? true : stock > 0,
    stock,
  };
}

/** Filters the WTX API cannot apply itself. */
function matchesLocalFilters(product: Product, query: ProductQuery): boolean {
  if (query.inStockOnly === true && !product.inStock) return false;
  if (
    query.productType !== undefined &&
    product.category.toLowerCase() !== query.productType.toLowerCase()
  ) {
    return false;
  }
  if (query.minPrice !== undefined && product.price < query.minPrice) return false;
  if (query.maxPrice !== undefined && product.price > query.maxPrice) return false;
  return true;
}

function needsLocalFiltering(query: ProductQuery): boolean {
  return (
    query.productType !== undefined ||
    query.minPrice !== undefined ||
    query.maxPrice !== undefined ||
    query.inStockOnly === true
  );
}

function extractSuggestions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) =>
      typeof entry === "object" && entry !== null
        ? str((entry as Record<string, unknown>).text)
        : null,
    )
    .filter((text): text is string => text !== null);
}

/* -------------------------------- source -------------------------------- */

function headers(): HeadersInit {
  const base: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Search is public on stage; these are here for when it is not.
  const auth = process.env.WTX_AUTH_TOKEN;
  const idToken = process.env.WTX_ID_TOKEN;
  if (auth !== undefined && auth.length > 0) base.Authorization = auth;
  if (idToken !== undefined && idToken.length > 0) base.IdToken = idToken;

  return base;
}

export const wtxProductSource: ProductSource = {
  async search(query, signal): Promise<ProductSearchResult> {
    const limit = Math.min(query.limit ?? MAX_PRODUCTS_PER_SEARCH, MAX_PRODUCTS_PER_SEARCH);
    // Price and product-type filters run client-side, so ask for a wider page
    // when they are in play or the filter would only see the first few rows.
    const size = needsLocalFiltering(query)
      ? Math.min(limit * OVER_FETCH_FACTOR, MAX_SERVER_PAGE)
      : limit;

    const response = await fetch(process.env.WTX_GRAPHQL_URL ?? DEFAULT_ENDPOINT, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        query: SEARCH_QUERY,
        variables: {
          input: {
            searchQuery: query.text ?? "",
            size,
            from: 0,
            countries: query.countries ?? null,
            states: null,
            cities: null,
          },
        },
      }),
      // Abort on client disconnect, and independently after a timeout, so a
      // slow catalog cannot hold the chat stream open indefinitely.
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`WTX search responded ${response.status}`);
    }

    const payload = (await response.json()) as SearchResponse;

    // GraphQL reports failures in a 200 body, so this has to be checked
    // explicitly rather than relying on response.ok above.
    if (payload.errors !== undefined && payload.errors.length > 0) {
      throw new Error(payload.errors[0]?.message ?? "WTX search returned an error");
    }

    const result = payload.data?.searchProductsElastic;
    const rows = Array.isArray(result?.products) ? result.products : [];

    const products = rows
      .filter((row): row is RawProduct => typeof row === "object" && row !== null)
      .map(toProduct)
      .filter((product): product is Product => product !== null)
      .filter((product) => matchesLocalFilters(product, query))
      .slice(0, limit);

    return {
      products,
      totalHits: num(result?.totalHits) ?? products.length,
      suggestions: extractSuggestions(result?.suggestions),
    };
  },

  async categories() {
    // The API exposes only opaque category UUIDs; productType is the one
    // human-readable grouping, and it has exactly these two values.
    return ["Livestock", "Agricultural"];
  },
};
