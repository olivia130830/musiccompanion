"use client";

import type {

  CSSProperties,

} from "react";

import type {

  CommentFeedback as CommentFeedbackValue,

} from "@/types/music";

interface CommentFeedbackProps {

  value?: CommentFeedbackValue;

  onChange: (feedback: CommentFeedbackValue) => void;

}

export default function CommentFeedback({

  value,

  onChange,

}: CommentFeedbackProps) {

  const isAgree = value === "agree";

  const isDifferent = value === "different";

  return (

    <div style={styles.container}>

      <button

        type="button"

        style={{

          ...styles.button,

          ...(isAgree ? styles.activeButton : null),

        }}

        aria-pressed={isAgree}

        onClick={() => onChange("agree")}

      >

        有感觉

      </button>

      <button

        type="button"

        style={{

          ...styles.button,

          ...(isDifferent ? styles.activeButton : null),

        }}

        aria-pressed={isDifferent}

        onClick={() => onChange("different")}

      >

        不太像

      </button>

    </div>

  );

}

const styles: Record<string, CSSProperties> = {

  container: {

    display: "flex",

    alignItems: "center",

    gap: "8px",

    marginTop: "8px",

  },

  button: {

    border: "1px solid rgba(116, 139, 181, 0.18)",

    borderRadius: "999px",

    padding: "5px 10px",

    background: "rgba(255, 255, 255, 0.52)",

    color: "var(--text-tertiary)",

    fontSize: "11px",

    lineHeight: 1.2,

    cursor: "pointer",

    transition:

      "background 160ms ease, color 160ms ease, border-color 160ms ease, transform 160ms ease",

  },

  activeButton: {

    borderColor: "rgba(93, 140, 255, 0.35)",

    background:

      "linear-gradient(135deg, rgba(93, 140, 255, 0.16), rgba(164, 122, 255, 0.14))",

    color: "var(--text-primary)",

  },

};