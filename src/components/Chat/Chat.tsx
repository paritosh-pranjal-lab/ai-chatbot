"use client";

import { useChat } from "@/hooks/useChat";
import { BOT_NAME } from "@/lib/config";

import styles from "./Chat.module.css";
import Composer from "./Composer";
import MessageList from "./MessageList";

export default function Chat() {
  const { messages, status, error, send, stop, clear } = useChat();

  return (
    <section className={styles.chat} aria-label="Sourcing chat">
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{BOT_NAME}</h1>
          <p className={styles.subtitle}>Searches the WorldTradeX catalog</p>
        </div>
        <button
          type="button"
          className={styles.clear}
          onClick={clear}
          disabled={messages.length === 0}
        >
          New chat
        </button>
      </header>

      <MessageList messages={messages} status={status} onSuggestion={send} />

      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <Composer status={status} onSend={send} onStop={stop} />
    </section>
  );
}
