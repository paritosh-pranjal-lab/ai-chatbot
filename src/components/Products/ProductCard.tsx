"use client";

import { useState } from "react";

import type { Product } from "@/types/product";

import styles from "./ProductCard.module.css";

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // An unrecognised currency code should not blank out the price.
    return `${currency} ${value}`;
  }
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact" }).format(value);
}

export default function ProductCard({ product }: { product: Product }) {
  // Upstream images occasionally 404 or are formats the browser cannot decode.
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = product.imageUrl !== null && !imageFailed;

  // One muted line carries type, origin and rating, so each is not its own row.
  const facts = [product.category, product.country, product.rating !== null && product.rating > 0 ? `★ ${product.rating.toFixed(1)}` : null]
    .filter((fact): fact is string => typeof fact === "string" && fact.length > 0)
    .join(" · ");

  const body = (
    <>
      <div className={styles.thumb}>
        {showImage ? (
          // A plain <img>: next/image would need every S3 bucket declared in
          // next.config.ts under images.remotePatterns.
          <img
            src={product.imageUrl ?? ""}
            alt=""
            className={styles.image}
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span className={styles.placeholder} aria-hidden="true">
            {product.name.slice(0, 1)}
          </span>
        )}
      </div>

      <div className={styles.body}>
        <span className={styles.name}>{product.name}</span>
        {facts.length > 0 && <span className={styles.facts}>{facts}</span>}

        <div className={styles.priceRow}>
          <span className={styles.price}>{formatMoney(product.price, product.currency)}</span>
          <span className={styles.unit}>/{product.unitType}</span>
          {product.listPrice !== null && (
            <span className={styles.listPrice}>
              {formatMoney(product.listPrice, product.currency)}
            </span>
          )}
          {product.minQuantity !== null && (
            <span className={styles.moq}>min {formatCount(product.minQuantity)}</span>
          )}
          {!product.inStock && <span className={styles.oos}>out of stock</span>}
        </div>
      </div>
    </>
  );

  if (product.url !== null) {
    return (
      <a className={styles.card} href={product.url} target="_blank" rel="noopener noreferrer">
        {body}
      </a>
    );
  }

  return <article className={styles.card}>{body}</article>;
}
