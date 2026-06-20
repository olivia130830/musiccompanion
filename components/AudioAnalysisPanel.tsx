"use client";

import type {
  CSSProperties,
} from "react";

import type {
  AudioAnalysisStatus,
} from "@/types/music";

interface AudioAnalysisPanelProps {
  status: AudioAnalysisStatus;
  summary: string;
  error: string;
  commentCount: number;
  hasAudio: boolean;
  onRetry: () => void;
  onUseDemo: () => void;
}

const STATUS_CONTENT: Record<
  AudioAnalysisStatus,
  {
    title: string;
    description: string;
  }
> = {
  idle: {
    title: "等待选择音乐",
    description:
      "选择音乐后，AI会先完整聆听并生成时间点评论。",
  },

  uploading: {
    title: "正在准备音乐",
    description:
      "音频正在安全上传到临时存储，请不要关闭页面。",
  },

  analyzing: {
    title: "AI正在聆听",
    description:
      "正在寻找情绪变化、节奏进入、停顿与主题回归。",
  },

  success: {
    title: "共同聆听已准备好",
    description:
      "AI评论已经生成，现在可以开始播放音乐。",
  },

  error: {
    title: "这次没有分析成功",
    description:
      "你可以重新分析，或者先使用演示评论测试播放器。",
  },

  fallback: {
    title: "正在使用演示评论",
    description:
      "这些评论用于测试时间轴，并不是针对当前歌曲生成的。",
  },
};

export default function AudioAnalysisPanel({
  status,
  summary,
  error,
  commentCount,
  hasAudio,
  onRetry,
  onUseDemo,
}: AudioAnalysisPanelProps) {
  if (!hasAudio && status === "idle") {
    return null;
  }

  const content =
    STATUS_CONTENT[status];

  const isWorking =
    status === "uploading" ||
    status === "analyzing";

  return (
    <section
      style={styles.panel}
      aria-live="polite"
      aria-busy={isWorking}
    >
      <div style={styles.headingRow}>
        <div>
          <p style={styles.eyebrow}>
            AI AUDIO ANALYSIS
          </p>

          <h2 style={styles.title}>
            {content.title}
          </h2>
        </div>

        {isWorking && (
          <span
            style={styles.spinner}
            aria-hidden="true"
          />
        )}

        {status === "success" && (
          <span style={styles.successBadge}>
            {commentCount} 条评论
          </span>
        )}
      </div>

      <p style={styles.description}>
        {content.description}
      </p>

      {summary && (
        <div style={styles.summary}>
          <span style={styles.summaryLabel}>
            整体感受
          </span>

          <p style={styles.summaryText}>
            {summary}
          </p>
        </div>
      )}

      {error && (
        <p
          style={styles.error}
          role="alert"
        >
          {error}
        </p>
      )}

      {status === "error" && (
        <div style={styles.actions}>
          <button
            type="button"
            style={styles.primaryButton}
            onClick={onRetry}
          >
            重新分析
          </button>

          <button
            type="button"
            style={styles.secondaryButton}
            onClick={onUseDemo}
          >
            使用演示评论
          </button>
        </div>
      )}
    </section>
  );
}

const styles: Record<
  string,
  CSSProperties
> = {
  panel: {
    width: "100%",
    maxWidth: "520px",
    padding: "21px",
    border:
      "1px solid rgba(111, 132, 169, 0.16)",
    borderRadius: "24px",
    background:
      "rgba(255, 255, 255, 0.72)",
    boxShadow:
      "0 22px 65px rgba(63, 93, 148, 0.12)",
    backdropFilter: "blur(22px)",
  },

  headingRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "18px",
  },

  eyebrow: {
    margin: "0 0 5px",
    color: "var(--accent)",
    fontSize: "10px",
    letterSpacing: "0.12em",
  },

  title: {
    margin: 0,
    color: "var(--text-primary)",
    fontSize: "18px",
    fontWeight: 400,
  },

  description: {
    margin: "12px 0 0",
    color: "var(--text-secondary)",
    fontSize: "13px",
    lineHeight: 1.75,
  },

  spinner: {
    width: "23px",
    height: "23px",
    flexShrink: 0,
    border:
      "3px solid rgba(85, 120, 237, 0.15)",
    borderTopColor: "var(--accent)",
    borderRadius: "50%",
    animation:
      "analysis-spinner 850ms linear infinite",
  },

  successBadge: {
    flexShrink: 0,
    padding: "6px 10px",
    borderRadius: "999px",
    background:
      "rgba(85, 120, 237, 0.1)",
    color: "var(--accent-strong)",
    fontSize: "11px",
  },

  summary: {
    marginTop: "16px",
    padding: "14px 15px",
    borderRadius: "15px",
    background:
      "rgba(235, 243, 255, 0.7)",
  },

  summaryLabel: {
    display: "block",
    marginBottom: "6px",
    color: "var(--text-tertiary)",
    fontSize: "10px",
    letterSpacing: "0.08em",
  },

  summaryText: {
    margin: 0,
    color: "var(--text-primary)",
    fontSize: "13px",
    lineHeight: 1.75,
  },

  error: {
    margin: "14px 0 0",
    color: "#c64f68",
    fontSize: "12px",
    lineHeight: 1.65,
  },

  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    marginTop: "16px",
  },

  primaryButton: {
    padding: "9px 17px",
    borderRadius: "999px",
    background:
      "linear-gradient(135deg, var(--accent), var(--accent-purple))",
    color: "#ffffff",
    fontSize: "12px",
  },

  secondaryButton: {
    padding: "9px 17px",
    border:
      "1px solid var(--border)",
    borderRadius: "999px",
    background:
      "rgba(255, 255, 255, 0.72)",
    color: "var(--text-secondary)",
    fontSize: "12px",
  },
};