"use client";

import type {
  CommentFeedback as CommentFeedbackValue,
} from "@/types/music";

interface CommentFeedbackProps {
  value?: CommentFeedbackValue;
  onChange: (
    value: CommentFeedbackValue,
  ) => void;
}

export default function CommentFeedback({
  value,
  onChange,
}: CommentFeedbackProps) {
  return (
    <div
      className="comment-feedback"
      aria-label="回应这条评论"
    >
      <button
        type="button"
        className={`feedback-button ${
          value === "agree"
            ? "feedback-button-selected"
            : ""
        }`}
        aria-pressed={value === "agree"}
        onClick={() => onChange("agree")}
      >
        我也觉得
      </button>

      <button
        type="button"
        className={`feedback-button ${
          value === "different"
            ? "feedback-button-selected"
            : ""
        }`}
        aria-pressed={
          value === "different"
        }
        onClick={() =>
          onChange("different")
        }
      >
        我感觉不一样
      </button>
    </div>
  );
}