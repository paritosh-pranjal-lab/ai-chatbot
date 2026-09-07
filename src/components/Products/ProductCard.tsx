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
  return new Intl.NumberFormat("en-US").format(value);
}

export default function ProductCard({ product }: { product: Product }) {
  // Upstream images occasionally 404 or are formats the browser cannot decode.
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = product.imageUrl !== null && !imageFailed;

  const body = (
    <>
      <div className={styles.media}>
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
        {!product.inStock && <span className={styles.badge}>Out of stock</span>}
      </div>

      <div className={styles.body}>
        <span className={styles.category}>
          {product.category}
          {product.country !== null && ` · ${product.country}`}
        </span>

        <span className={styles.name}>{product.name}</span>

        <div className={styles.priceRow}>
          <span className={styles.price}>{formatMoney(product.price, product.currency)}</span>
          <span className={styles.unit}>/ {product.unitType}</span>
          {product.listPrice !== null && (
            <span className={styles.listPrice}>
              {formatMoney(product.listPrice, product.currency)}
            </span>
          )}
        </div>

        <div className={styles.meta}>
          {product.minQuantity !== null && (
            <span>
              Min {formatCount(product.minQuantity)} {product.unitType}
            </span>
          )}
          {product.rating !== null && product.rating > 0 && (
            <span>★ {product.rating.toFixed(1)}</span>
          )}
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
