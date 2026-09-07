"use client";

import { useEffect, useRef } from "react";

import type { ChatStatus } from "@/hooks/useChat";
import type { UiMessage } from "@/types/chat";

import Message from "./Message";
import styles from "./MessageList.module.css";

const SUGGESTIONS = [
  "What livestock is available from India?",
  "I need cashews, under $40 per kg",
  "Show me what you have in stock right now",
];

interface MessageListProps {
  messages: UiMessage[];
  status: ChatStatus;
  onSuggestion: (text: string) => void;
}

export default function MessageList({ messages, status, onSuggestion }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Keep the newest tokens and cards in view as they stream in.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  return (
    <div className={styles.list} role="log" aria-live="polite" aria-busy={status === "streaming"}>
      {messages.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Ask about anything in the catalog</p>
          <div className={styles.suggestions}>
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className={styles.suggestion}
                onClick={() => onSuggestion(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : (
        messages.map((message, index) => (
          <Message
            key={message.id}
            message={message}
            isStreaming={status === "streaming" && index === messages.length - 1}
          />
        ))
      )}
      <div ref={bottomRef} />
    </div>
  );
}
