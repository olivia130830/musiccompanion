"use client";

import type { CSSProperties } from "react";

type AudioUploaderProps = {
  disabled?: boolean;
  onFileSelect: (file: File) => void;
};

const ACCEPTED_AUDIO_TYPES = [
  "audio/*",
  ".mp3",
  ".m4a",
  ".aac",
  ".wav",
  ".flac",
  ".ogg",
  ".oga",
  ".webm",
].join(",");

export default function AudioUploader({
  disabled = false,
  onFileSelect,
}: AudioUploaderProps) {
  return (
    <label
      style={{
        ...styles.uploadButton,
        ...(disabled ? styles.disabled : null),
      }}
    >
      <input
        type="file"
        accept={ACCEPTED_AUDIO_TYPES}
        disabled={disabled}
        style={styles.input}
        onChange={(event) => {
          const file = event.target.files?.[0];

          if (!file) {
            return;
          }

          onFileSelect(file);
          event.target.value = "";
        }}
      />

      选择音乐文件
    </label>
  );
}

const styles: Record<string, CSSProperties> = {
  uploadButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid rgba(116, 139, 181, 0.2)",
    borderRadius: "999px",
    padding: "11px 18px",
    background: "rgba(255, 255, 255, 0.72)",
    color: "var(--text-secondary)",
    fontSize: "14px",
    cursor: "pointer",
    boxShadow: "0 10px 30px rgba(74, 107, 163, 0.08)",
    backdropFilter: "blur(16px)",
  },

  disabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },

  input: {
    display: "none",
  },
};