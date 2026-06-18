"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import type { PlaybackSnapshot } from "@/types/music";
import { formatTime } from "@/utils/formatTime";

interface MusicPlayerProps {
  audioFile: File | null;

  /**
   * 把播放器当前状态传给父组件，
   * 供时间点评论系统使用。
   */
  onPlaybackStateChange?: (
    snapshot: PlaybackSnapshot,
  ) => void;
}

interface AudioState extends PlaybackSnapshot {
  isLoading: boolean;
  error: string;
}

const INITIAL_STATE: AudioState = {
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  isSeeking: false,
  isLoading: false,
  error: "",
};

export default function MusicPlayer({
  audioFile,
  onPlaybackStateChange,
}: MusicPlayerProps) {
  const audioRef =
    useRef<HTMLAudioElement | null>(null);

  const objectUrlRef = useRef("");

  const [state, setState] =
    useState<AudioState>(INITIAL_STATE);

  /**
   * 把播放状态通知父组件。
   */
  useEffect(() => {
    onPlaybackStateChange?.({
      currentTime: state.currentTime,
      duration: state.duration,
      isPlaying: state.isPlaying,
      isSeeking: state.isSeeking,
    });
  }, [
    onPlaybackStateChange,
    state.currentTime,
    state.duration,
    state.isPlaying,
    state.isSeeking,
  ]);

  /**
   * 当用户选择或更换音乐时，
   * 创建新的本地播放地址。
   */
  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    /**
     * 先停止并清理上一首音乐。
     */
    audio.pause();
    audio.removeAttribute("src");
    audio.load();

    if (objectUrlRef.current) {
      URL.revokeObjectURL(
        objectUrlRef.current,
      );

      objectUrlRef.current = "";
    }

    setState(INITIAL_STATE);

    if (!audioFile) {
      return;
    }

    const objectUrl =
      URL.createObjectURL(audioFile);

    objectUrlRef.current = objectUrl;

    audio.src = objectUrl;
    audio.load();

    /**
     * 文件变化或组件卸载时释放资源。
     */
    return () => {
      audio.pause();

      if (objectUrlRef.current) {
        URL.revokeObjectURL(
          objectUrlRef.current,
        );

        objectUrlRef.current = "";
      }
    };
  }, [audioFile]);

  /**
   * 监听原生audio事件。
   */
  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    const handleTimeUpdate = () => {
      setState((previous) => ({
        ...previous,
        currentTime: audio.currentTime,
      }));
    };

    const handleLoadedMetadata = () => {
      setState((previous) => ({
        ...previous,
        duration: Number.isFinite(
          audio.duration,
        )
          ? audio.duration
          : 0,
        isLoading: false,
      }));
    };

    const handleDurationChange = () => {
      setState((previous) => ({
        ...previous,
        duration: Number.isFinite(
          audio.duration,
        )
          ? audio.duration
          : 0,
      }));
    };

    const handlePlay = () => {
      setState((previous) => ({
        ...previous,
        isPlaying: true,
        error: "",
      }));
    };

    const handlePause = () => {
      setState((previous) => ({
        ...previous,
        isPlaying: false,
      }));
    };

    const handleEnded = () => {
      setState((previous) => ({
        ...previous,
        isPlaying: false,
        currentTime:
          audio.duration ||
          previous.currentTime,
      }));
    };

    const handleSeeking = () => {
      setState((previous) => ({
        ...previous,
        isSeeking: true,
      }));
    };

    const handleSeeked = () => {
      setState((previous) => ({
        ...previous,
        currentTime: audio.currentTime,
        isSeeking: false,
      }));
    };

    const handleError = () => {
      setState((previous) => ({
        ...previous,
        isPlaying: false,
        isLoading: false,
        error:
          "这个音频无法播放，请尝试其他文件。",
      }));
    };

    const handleLoadStart = () => {
      setState((previous) => ({
        ...previous,
        isLoading: true,
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        isSeeking: false,
        error: "",
      }));
    };

    audio.addEventListener(
      "timeupdate",
      handleTimeUpdate,
    );

    audio.addEventListener(
      "loadedmetadata",
      handleLoadedMetadata,
    );

    audio.addEventListener(
      "durationchange",
      handleDurationChange,
    );

    audio.addEventListener(
      "play",
      handlePlay,
    );

    audio.addEventListener(
      "pause",
      handlePause,
    );

    audio.addEventListener(
      "ended",
      handleEnded,
    );

    audio.addEventListener(
      "seeking",
      handleSeeking,
    );

    audio.addEventListener(
      "seeked",
      handleSeeked,
    );

    audio.addEventListener(
      "error",
      handleError,
    );

    audio.addEventListener(
      "loadstart",
      handleLoadStart,
    );

    return () => {
      audio.removeEventListener(
        "timeupdate",
        handleTimeUpdate,
      );

      audio.removeEventListener(
        "loadedmetadata",
        handleLoadedMetadata,
      );

      audio.removeEventListener(
        "durationchange",
        handleDurationChange,
      );

      audio.removeEventListener(
        "play",
        handlePlay,
      );

      audio.removeEventListener(
        "pause",
        handlePause,
      );

      audio.removeEventListener(
        "ended",
        handleEnded,
      );

      audio.removeEventListener(
        "seeking",
        handleSeeking,
      );

      audio.removeEventListener(
        "seeked",
        handleSeeked,
      );

      audio.removeEventListener(
        "error",
        handleError,
      );

      audio.removeEventListener(
        "loadstart",
        handleLoadStart,
      );
    };
  }, []);

  /**
   * 播放或暂停音乐。
   */
  const handlePlayPause = async () => {
    const audio = audioRef.current;

    if (
      !audio ||
      !audioFile ||
      state.isLoading
    ) {
      return;
    }

    try {
      if (state.isPlaying) {
        audio.pause();
      } else {
        await audio.play();
      }
    } catch {
      setState((previous) => ({
        ...previous,
        isPlaying: false,
        error:
          "播放失败，请检查音频文件。",
      }));
    }
  };

  /**
   * 用户拖动播放进度条。
   */
  const handleProgressChange = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    const nextTime = Number(
      event.currentTarget.value,
    );

    if (!Number.isFinite(nextTime)) {
      return;
    }

    audio.currentTime = nextTime;

    setState((previous) => ({
      ...previous,
      currentTime: nextTime,
    }));
  };

  const duration = Number.isFinite(
    state.duration,
  )
    ? state.duration
    : 0;

  const currentTime = Number.isFinite(
    state.currentTime,
  )
    ? Math.min(
        state.currentTime,
        duration || state.currentTime,
      )
    : 0;

  const isDisabled =
    !audioFile || state.isLoading;

  return (
    <section
      className="music-player-card"
      aria-label="音乐播放器"
    >
      <audio
        ref={audioRef}
        preload="metadata"
      />

      {audioFile && (
        <p className="music-file-name">
          {audioFile.name}
        </p>
      )}

      <button
        type="button"
        className="music-play-button"
        onClick={handlePlayPause}
        disabled={isDisabled}
      >
        {state.isLoading
          ? "正在读取…"
          : state.isPlaying
            ? "暂停"
            : "播放"}
      </button>

      {audioFile && (
        <>
          <input
            aria-label="播放进度"
            type="range"
            min={0}
            max={duration}
            step={0.01}
            value={
              duration > 0
                ? currentTime
                : 0
            }
            onChange={
              handleProgressChange
            }
            disabled={duration <= 0}
          />

          <p className="music-time-display">
            {formatTime(currentTime)} /{" "}
            {formatTime(duration)}
          </p>
        </>
      )}

      {state.error && (
        <p
          role="alert"
          className="music-error"
        >
          {state.error}
        </p>
      )}
    </section>
  );
}