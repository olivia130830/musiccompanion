"use client";

import { useEffect, useRef, useState } from "react";
import { formatTime } from "@/utils/formatTime";

interface MusicPlayerProps {
  audioFile: File | null;
}

interface AudioState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isLoading: boolean;
  error: string;
}

/**
 * 音乐播放器
 * - 使用原生 audio 元素
 * - 管理播放状态
 * - 处理进度条
 * - 释放 Object URL
 */
export default function MusicPlayer({ audioFile }: MusicPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const objectUrlRef = useRef<string>("");
  const [state, setState] = useState<AudioState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    isLoading: false,
    error: "",
  });

  // 创建和管理 Object URL
  useEffect(() => {
    if (!audioFile) {
      return;
    }

    // 释放旧的 URL
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }

    // 创建新的 URL
    const url = URL.createObjectURL(audioFile);
    objectUrlRef.current = url;

    if (audioRef.current) {
      audioRef.current.src = url;
      // 状态重置由事件监听器负责处理（loadstart、error等）
    }

    return () => {
      // 组件卸载或文件改变时释放 URL
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = "";
      }
    };
  }, [audioFile]);

  // 音频事件监听
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setState((prev) => ({
        ...prev,
        currentTime: audio.currentTime,
      }));
    };

    const handleLoadedMetadata = () => {
      setState((prev) => ({
        ...prev,
        duration: audio.duration,
        isLoading: false,
      }));
    };

    const handlePlay = () => {
      setState((prev) => ({
        ...prev,
        isPlaying: true,
        error: "",
      }));
    };

    const handlePause = () => {
      setState((prev) => ({
        ...prev,
        isPlaying: false,
      }));
    };

    const handleEnded = () => {
      setState((prev) => ({
        ...prev,
        isPlaying: false,
        currentTime: 0,
      }));
    };

    const handleError = () => {
      setState((prev) => ({
        ...prev,
        isPlaying: false,
        error: "这个音频无法播放，请尝试其他文件。",
      }));
    };

    const handleLoadStart = () => {
      setState((prev) => ({
        ...prev,
        isLoading: true,
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        error: "",
      }));
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);
    audio.addEventListener("loadstart", handleLoadStart);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
      audio.removeEventListener("loadstart", handleLoadStart);
    };
  }, []);

  const handlePlayPause = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    try {
      if (state.isPlaying) {
        audio.pause();
      } else {
        const playPromise = audio.play();
        if (playPromise) {
          await playPromise;
        }
      }
    } catch {
      setState((prev) => ({
        ...prev,
        error: "播放失败，请检查文件。",
        isPlaying: false,
      }));
    }
  };

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;

    const newTime = parseFloat(e.currentTarget.value);
    audio.currentTime = newTime;

    setState((prev) => ({
      ...prev,
      currentTime: newTime,
    }));
  };

  const isDisabled = !audioFile;
  const fileName = audioFile?.name || "";
  const progressValue = state.isLoading ? 0 : state.currentTime;
  const progressMax = Number.isFinite(state.duration) ? state.duration : 0;

  return (
    <div style={styles.container}>
      <audio ref={audioRef} />

      {audioFile && <div style={styles.fileName}>{fileName}</div>}

      <div style={styles.controlsContainer}>
        <button
          style={{
            ...styles.button,
            ...(isDisabled ? styles.buttonDisabled : {}),
          }}
          onClick={handlePlayPause}
          disabled={isDisabled}
          aria-label={state.isPlaying ? "暂停" : "播放"}
        >
          {state.isPlaying ? "⏸ 暂停" : "▶ 播放"}
        </button>
      </div>

      {audioFile && (
        <>
          <div style={styles.timeDisplay}>
            <span>{formatTime(state.currentTime)}</span>
            <span>/</span>
            <span>{formatTime(state.duration)}</span>
          </div>

          <input
            type="range"
            min="0"
            max={progressMax}
            value={progressValue}
            onChange={handleProgressChange}
            disabled={isDisabled}
            style={styles.progressBar}
            aria-label="播放进度"
          />
        </>
      )}

      {state.error && <div style={styles.error}>{state.error}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    width: "100%",
    maxWidth: "400px",
  },
  fileName: {
    fontSize: "13px",
    color: "var(--text-secondary)",
    wordBreak: "break-all",
    textAlign: "center",
  },
  controlsContainer: {
    display: "flex",
    gap: "8px",
    justifyContent: "center",
  },
  button: {
    padding: "8px 16px",
    backgroundColor: "var(--accent)",
    color: "var(--bg-primary)",
    borderRadius: "4px",
    fontSize: "13px",
    fontWeight: "500",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  timeDisplay: {
    display: "flex",
    justifyContent: "center",
    gap: "8px",
    fontSize: "12px",
    color: "var(--text-secondary)",
  },
  progressBar: {
    width: "100%",
    height: "4px",
    cursor: "pointer",
    WebkitAppearance: "none",
    appearance: "none",
    backgroundColor: "var(--border)",
    borderRadius: "2px",
    outline: "none",
  } as React.CSSProperties,
  error: {
    color: "#ff6b6b",
    fontSize: "12px",
    textAlign: "center",
  },
};
