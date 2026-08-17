"use client";

import {
  useState,
  type CSSProperties,
} from "react";

import {
  AUDIO_FILE_ACCEPT,
  getAcceptedAudioDescription,
  isSupportedAudioFile,
} from "@/lib/audio/formats";

type AudioUploaderProps = {
  disabled?: boolean;
  onFileSelect: (file: File) => void;
};

export default function AudioUploader({
  disabled = false,
  onFileSelect,
}: AudioUploaderProps) {
  const [error, setError] = useState("");

  return (
    <div style={styles.wrapper}>
      <label
        style={{
          ...styles.uploadButton,
          ...(disabled ? styles.disabled : null),
        }}
      >
        <input
          type="file"
          accept={AUDIO_FILE_ACCEPT}
          disabled={disabled}
          style={styles.input}
          onChange={(event) => {
            const file = event.target.files?.[0];

            if (!file) {
              return;
            }

            if (!isSupportedAudioFile(file)) {
              setError(
                `暂不支持这个格式。可上传 ${getAcceptedAudioDescription()}。`,
              );
              event.target.value = "";
              return;
            }

            setError("");
            onFileSelect(file);
            event.target.value = "";
          }}
        />

        选择音乐文件
      </label>

      {error && <p style={styles.error}>{error}</p>}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "10px",
  },

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

  error: {
    maxWidth: "420px",
    margin: 0,
    color: "#c2410c",
    fontSize: "12px",
    lineHeight: 1.6,
    textAlign: "center",
  },
};
