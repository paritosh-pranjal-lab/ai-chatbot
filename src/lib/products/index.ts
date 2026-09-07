import type { ProductSource } from "@/types/product";

import { wtxProductSource } from "./wtx-source";

/**
 * The catalog the bot searches. Swap this for another ProductSource
 * implementation and nothing else in the project changes.
 */
export const productSource: ProductSource = wtxProductSource;
