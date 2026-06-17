"use client";

import {
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

interface UserReplyBoxProps {
  disabled: boolean;
  onSend: (text: string) => void;
}

export default function UserReplyBox({
  disabled,
  onSend,
}: UserReplyBoxProps) {
  const [text, setText] = useState("");

  const trimmedText = text.trim();
  const cannotSend =
    disabled || trimmedText.length === 0;

  const sendMessage = () => {
    if (cannotSend) {
      return;
    }

    onSend(trimmedText);
    setText("");
  };

  const handleSubmit = (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    sendMessage();
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {
      event.preventDefault();
      sendMessage();
    }
  };

  return (
    <form
      className="reply-box"
      onSubmit={handleSubmit}
    >
      <label
        className="reply-label"
        htmlFor="listener-reply"
      >
        分享你此刻的感受
      </label>

      <textarea
        id="listener-reply"
        className="reply-textarea"
        value={text}
        disabled={disabled}
        placeholder={
          disabled
            ? "先选择一首音乐"
            : "写下你此刻听到的感受……"
        }
        rows={3}
        maxLength={300}
        onChange={(event) =>
          setText(event.currentTarget.value)
        }
        onKeyDown={handleKeyDown}
      />

      <div className="reply-actions">
        <span className="reply-help">
          Enter 发送，Shift + Enter 换行
        </span>

        <button
          className="reply-send-button"
          type="submit"
          disabled={cannotSend}
        >
          发送
        </button>
      </div>
    </form>
  );
}