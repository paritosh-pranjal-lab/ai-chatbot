import ProductGrid from "@/components/Products/ProductGrid";
import { BOT_NAME } from "@/lib/config";
import type { UiMessage } from "@/types/chat";

import styles from "./Message.module.css";

interface MessageProps {
  message: UiMessage;
  /** True while this is the turn currently receiving deltas. */
  isStreaming: boolean;
}

export default function Message({ message, isStreaming }: MessageProps) {
  const isUser = message.role === "user";
  const showCaret = isStreaming && !isUser;
  const hasText = message.content.length > 0;
  const products = message.products ?? [];

  return (
    <article className={isUser ? styles.user : styles.assistant}>
      <span className={styles.role}>{isUser ? "You" : BOT_NAME}</span>

      {message.status !== undefined && (
        <span className={styles.status}>
          <span className={styles.spinner} aria-hidden="true" />
          {message.status}
        </span>
      )}

      {(hasText || (!isUser && products.length === 0 && message.status === undefined)) && (
        <div className={styles.bubble}>
          {hasText ? (
            <>
              {message.content}
              {showCaret && <span className={styles.caret} aria-hidden="true" />}
            </>
          ) : (
            <span className={styles.dots} aria-label={`${BOT_NAME} is typing`}>
              <span />
              <span />
              <span />
            </span>
          )}
        </div>
      )}

      {products.length > 0 && <ProductGrid products={products} />}
    </article>
  );
}
