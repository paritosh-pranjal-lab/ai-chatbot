"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { ChatStatus } from "@/hooks/useChat";
import { MAX_MESSAGE_CHARS } from "@/lib/limits";

import styles from "./Composer.module.css";

const MAX_TEXTAREA_HEIGHT = 200;

interface ComposerProps {
  status: ChatStatus;
  onSend: (text: string) => void;
  onStop: () => void;
}

export default function Composer({ status, onSend, onStop }: ComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isStreaming = status === "streaming";
  const canSend = !isStreaming && value.trim().length > 0;

  // Grow with the content up to a ceiling, then scroll inside the textarea.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [value]);

  const submit = useCallback(() => {
    if (!canSend) return;
    onSend(value);
    setValue("");
  }, [canSend, onSend, value]);

  return (
    <form
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={textareaRef}
        className={styles.input}
        value={value}
        onChange={(event) => setValue(event.target.value.slice(0, MAX_MESSAGE_CHARS))}
        onKeyDown={(event) => {
          // Enter sends; Shift+Enter is a newline.
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder="What are you looking for?"
        rows={1}
        aria-label="Message"
        maxLength={MAX_MESSAGE_CHARS}
      />

      <div className={styles.actions}>
        {value.length > MAX_MESSAGE_CHARS * 0.9 && (
          <span className={styles.counter}>
            {value.length} / {MAX_MESSAGE_CHARS}
          </span>
        )}
        {isStreaming ? (
          <button type="button" className={styles.stop} onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="submit" className={styles.send} disabled={!canSend}>
            Send
          </button>
        )}
      </div>
    </form>
  );
}
