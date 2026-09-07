/**
 * The shape the UI renders and the model reads. Mapped from the WTX
 * searchProductsElastic payload in src/lib/products/wtx-source.ts.
 */
export interface Product {
  id: string;
  name: string;
  description: string;
  /** "Livestock" or "Agricultural" on WTX. */
  category: string;
  /** Price actually charged per unit, in major units. */
  price: number;
  /** Undiscounted unit price, when it is higher than `price`. */
  listPrice: number | null;
  /** ISO 4217 code, used for formatting. */
  currency: string;
  /** Unit the price is quoted per — head, kilograms, litres. */
  unitType: string;
  /** Minimum order quantity, in `unitType` units. */
  minQuantity: number | null;
  /** Country of origin. */
  country: string | null;
  imageUrl: string | null;
  /** Product detail page, if WTX_PRODUCT_URL_TEMPLATE is configured. */
  url: string | null;
  /** 0–5, or null when unrated. */
  rating: number | null;
  inStock: boolean;
  /** Units available, for the model to reason about large orders. */
  stock: number | null;
}

/** Normalised search input, built from whatever arguments the model produces. */
export interface ProductQuery {
  text?: string;
  /** Server-side filter on the WTX API. */
  countries?: string[];
  /** Applied client-side: the API has no product-type filter. */
  productType?: string;
  /** Applied client-side. */
  minPrice?: number;
  /** Applied client-side. */
  maxPrice?: number;
  /** Applied client-side. */
  inStockOnly?: boolean;
  limit?: number;
}

/** What one lookup returns, beyond the products themselves. */
export interface ProductSearchResult {
  products: Product[];
  /** Total server-side matches before client-side filters were applied. */
  totalHits: number;
  /**
   * Spelling alternatives from Elasticsearch. Low confidence — "goat" comes
   * back as "guar" — so only worth showing the model when nothing matched.
   */
  suggestions: string[];
}

/**
 * The seam between the bot and the catalog. Swap the implementation and
 * nothing else in the project changes.
 */
export interface ProductSource {
  search(query: ProductQuery, signal: AbortSignal): Promise<ProductSearchResult>;
  /** Known category names, injected into the system prompt. Optional. */
  categories?(signal: AbortSignal): Promise<string[]>;
}
