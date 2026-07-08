"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import type { PlaybackSnapshot } from "@/types/music";
import {
  createPlayableAudioBlob,
  getAcceptedAudioDescription,
} from "@/lib/audio/formats";

type MusicPlayerProps = {
  audioFile: File | null;
  onPlaybackStateChange: (snapshot: PlaybackSnapshot) => void;
};

const INITIAL_PLAYBACK: PlaybackSnapshot = {
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  isSeeking: false,
};

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");

  return `${minutes}:${remainingSeconds}`;
}

function getAudioContextClass() {
  return (
    window.AudioContext ||
    (
      window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext
  );
}

export default function MusicPlayer({
  audioFile,
  onPlaybackStateChange,
}: MusicPlayerProps) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef =
    useRef<AudioBufferSourceNode | null>(null);
  const progressIntervalRef = useRef<number | null>(null);
  const playRequestIdRef = useRef(0);
  const startedAtRef = useRef(0);
  const pausedAtRef = useRef(0);
  const playbackRef =
    useRef<PlaybackSnapshot>(INITIAL_PLAYBACK);

  const [playback, setPlayback] =
    useState<PlaybackSnapshot>(INITIAL_PLAYBACK);
  const [playerError, setPlayerError] = useState("");
  const [isDecoding, setIsDecoding] = useState(false);
  const [hasDecodedAudio, setHasDecodedAudio] =
    useState(false);

  const fileLabel = useMemo(() => {
    if (!audioFile) {
      return "还没有选择音乐";
    }

    return audioFile.name;
  }, [audioFile]);

  const updatePlayback = useCallback(
    (nextPlayback: PlaybackSnapshot) => {
      playbackRef.current = nextPlayback;
      setPlayback(nextPlayback);
      onPlaybackStateChange(nextPlayback);
    },
    [onPlaybackStateChange],
  );

  const stopProgressLoop = useCallback(() => {
    if (progressIntervalRef.current !== null) {
      window.clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }, []);

  const stopSource = useCallback(() => {
    const source = sourceRef.current;

    if (!source) {
      return;
    }

    sourceRef.current = null;
    source.onended = null;

    try {
      source.stop();
    } catch {}

    try {
      source.disconnect();
    } catch {}
  }, []);

  const readPlayingTime = useCallback(() => {
    const audioContext = audioContextRef.current;
    const audioBuffer = audioBufferRef.current;

    if (!audioContext || !audioBuffer) {
      return 0;
    }

    return Math.min(
      audioBuffer.duration,
      Math.max(
        0,
        audioContext.currentTime - startedAtRef.current,
      ),
    );
  }, []);

  const updatePlayingProgress = useCallback(() => {
    const audioBuffer = audioBufferRef.current;

    if (!audioBuffer || !sourceRef.current) {
      return;
    }

    const currentTime = readPlayingTime();

    pausedAtRef.current = currentTime;

    updatePlayback({
      currentTime,
      duration: audioBuffer.duration,
      isPlaying: true,
      isSeeking: false,
    });

  }, [readPlayingTime, updatePlayback]);

  const startProgressLoop = useCallback(() => {
    stopProgressLoop();
    updatePlayingProgress();

    progressIntervalRef.current = window.setInterval(
      updatePlayingProgress,
      160,
    );
  }, [
    stopProgressLoop,
    updatePlayingProgress,
  ]);

  const pausePlayback = useCallback(() => {
    const audioBuffer = audioBufferRef.current;

    if (!audioBuffer) {
      return;
    }

    const currentTime = readPlayingTime();
    pausedAtRef.current = currentTime;

    playRequestIdRef.current += 1;
    stopProgressLoop();
    stopSource();

    updatePlayback({
      currentTime,
      duration: audioBuffer.duration,
      isPlaying: false,
      isSeeking: false,
    });
  }, [
    readPlayingTime,
    stopProgressLoop,
    stopSource,
    updatePlayback,
  ]);

  const playFrom = useCallback(
    async (startSeconds: number) => {
      const audioContext = audioContextRef.current;
      const audioBuffer = audioBufferRef.current;
      const requestId = playRequestIdRef.current + 1;

      playRequestIdRef.current = requestId;

      if (!audioContext || !audioBuffer) {
        return;
      }

      await audioContext.resume();

      if (requestId !== playRequestIdRef.current) {
        return;
      }

      stopProgressLoop();
      stopSource();

      const safeStart = Math.min(
        Math.max(0, startSeconds),
        Math.max(0, audioBuffer.duration - 0.01),
      );

      if (safeStart >= audioBuffer.duration) {
        pausedAtRef.current = 0;
        updatePlayback({
          currentTime: audioBuffer.duration,
          duration: audioBuffer.duration,
          isPlaying: false,
          isSeeking: false,
        });
        return;
      }

      const source = audioContext.createBufferSource();

      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.onended = () => {
        if (sourceRef.current !== source) {
          return;
        }

        sourceRef.current = null;
        pausedAtRef.current = 0;
        stopProgressLoop();

        updatePlayback({
          currentTime: audioBuffer.duration,
          duration: audioBuffer.duration,
          isPlaying: false,
          isSeeking: false,
        });
      };

      sourceRef.current = source;
      startedAtRef.current =
        audioContext.currentTime - safeStart;
      pausedAtRef.current = safeStart;

      source.start(0, safeStart);
      startProgressLoop();
    },
    [
      startProgressLoop,
      stopProgressLoop,
      stopSource,
      updatePlayback,
    ],
  );

  useEffect(() => {
    playbackRef.current = playback;
  }, [playback]);

  useEffect(() => {
    let isCancelled = false;

    stopProgressLoop();
    stopSource();

    audioBufferRef.current = null;
    pausedAtRef.current = 0;
    startedAtRef.current = 0;
    window.setTimeout(() => {
      setHasDecodedAudio(false);
    }, 0);

    if (!audioFile) {
      window.setTimeout(() => {
        updatePlayback(INITIAL_PLAYBACK);
        setPlayerError("");
        setIsDecoding(false);
        setHasDecodedAudio(false);
      }, 0);
      return;
    }

    const AudioContextClass = getAudioContextClass();

    if (!AudioContextClass) {
      window.setTimeout(() => {
        setPlayerError(
          "当前浏览器不支持 Web Audio，无法播放这个音频。",
        );
        setIsDecoding(false);
        setHasDecodedAudio(false);
        updatePlayback(INITIAL_PLAYBACK);
      }, 0);
      return;
    }

    const audioContext =
      audioContextRef.current || new AudioContextClass();

    audioContextRef.current = audioContext;
    window.setTimeout(() => {
      setIsDecoding(true);
      setPlayerError("");
      updatePlayback(INITIAL_PLAYBACK);
    }, 0);

    void createPlayableAudioBlob(audioFile)
      .arrayBuffer()
      .then((arrayBuffer) =>
        audioContext.decodeAudioData(arrayBuffer.slice(0)),
      )
      .then((audioBuffer) => {
        if (isCancelled) {
          return;
        }

        audioBufferRef.current = audioBuffer;
        setHasDecodedAudio(true);
        pausedAtRef.current = 0;
        setIsDecoding(false);

        updatePlayback({
          currentTime: 0,
          duration: audioBuffer.duration,
          isPlaying: false,
          isSeeking: false,
        });
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : "音频解码失败。";

        setIsDecoding(false);
        setHasDecodedAudio(false);
        setPlayerError(
          `这个音频仍然无法解码，可以换成 ${getAcceptedAudioDescription()}。具体原因：${message}`,
        );
        updatePlayback(INITIAL_PLAYBACK);
      });

    return () => {
      isCancelled = true;
      stopProgressLoop();
      stopSource();
    };
  }, [
    audioFile,
    stopProgressLoop,
    stopSource,
    updatePlayback,
  ]);

  useEffect(() => {
    return () => {
      stopProgressLoop();
      stopSource();
      void audioContextRef.current?.close();
      audioContextRef.current = null;
    };
  }, [stopProgressLoop, stopSource]);

  const handlePlayPause = () => {
    if (playback.isPlaying) {
      pausePlayback();
      return;
    }

    void playFrom(pausedAtRef.current);
  };

  const handleSeekChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const audioBuffer = audioBufferRef.current;

    if (!audioBuffer) {
      return;
    }

    const nextTime = Number(event.target.value);
    const wasPlaying = playbackRef.current.isPlaying;

    pausedAtRef.current = nextTime;
    stopProgressLoop();
    stopSource();

    if (wasPlaying) {
      void playFrom(nextTime);
    } else {
      playRequestIdRef.current += 1;
      updatePlayback({
        currentTime: nextTime,
        duration: audioBuffer.duration,
        isPlaying: false,
        isSeeking: false,
      });
    }
  };

  if (!audioFile) {
    return (
      <section style={styles.card}>
        <p style={styles.emptyText}>选择音乐后会出现播放器。</p>
      </section>
    );
  }

  return (
    <section style={styles.card}>
      <div style={styles.header}>
        <div>
          <p style={styles.label}>当前音乐</p>
          <p style={styles.fileName}>{fileLabel}</p>
        </div>

        <div style={styles.timeBox}>
          {formatTime(playback.currentTime)} /{" "}
          {formatTime(playback.duration)}
        </div>
      </div>

      <div style={styles.controls}>
        <button
          type="button"
          style={styles.playButton}
          onClick={handlePlayPause}
          disabled={isDecoding || !hasDecodedAudio}
          aria-label={playback.isPlaying ? "暂停" : "播放"}
        >
          {playback.isPlaying ? "II" : "▶"}
        </button>

        <span style={styles.controlTime}>
          {formatTime(playback.currentTime)} /{" "}
          {formatTime(playback.duration)}
        </span>

        <input
          type="range"
          min={0}
          max={Math.max(playback.duration, 0)}
          step={0.01}
          value={Math.min(
            playback.currentTime,
            playback.duration || 0,
          )}
          onChange={handleSeekChange}
          disabled={isDecoding || !hasDecodedAudio}
          style={styles.progress}
        />
      </div>

      {isDecoding && (
        <p style={styles.emptyText}>正在解码音频…</p>
      )}

      {playerError && (
        <p style={styles.errorText}>{playerError}</p>
      )}
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  card: {
    width: "100%",
    maxWidth: "520px",
    padding: "18px",
    border: "1px solid rgba(116, 139, 181, 0.16)",
    borderRadius: "22px",
    background: "rgba(255, 255, 255, 0.64)",
    boxShadow: "0 18px 60px rgba(74, 107, 163, 0.08)",
    backdropFilter: "blur(20px)",
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "14px",
    marginBottom: "12px",
  },

  label: {
    margin: "0 0 5px",
    color: "var(--text-tertiary)",
    fontSize: "11px",
  },

  fileName: {
    margin: 0,
    color: "var(--text-secondary)",
    fontSize: "14px",
    lineHeight: 1.5,
    wordBreak: "break-word",
  },

  timeBox: {
    flexShrink: 0,
    color: "var(--text-tertiary)",
    fontSize: "12px",
    lineHeight: 1.5,
  },

  controls: {
    display: "grid",
    gridTemplateColumns: "44px 112px 1fr",
    alignItems: "center",
    gap: "12px",
    minHeight: "64px",
    padding: "12px 16px",
    borderRadius: "999px",
    background: "rgba(245, 246, 248, 0.86)",
  },

  playButton: {
    width: "36px",
    height: "36px",
    border: "none",
    borderRadius: "999px",
    padding: 0,
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: "19px",
    lineHeight: "36px",
    cursor: "pointer",
    textAlign: "center",
  },

  controlTime: {
    color: "var(--text-primary)",
    fontSize: "22px",
    lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
  },

  progress: {
    width: "100%",
    accentColor: "var(--accent)",
  },

  errorText: {
    margin: "10px 0 0",
    color: "#c2410c",
    fontSize: "12px",
    lineHeight: 1.6,
  },

  emptyText: {
    margin: "10px 0 0",
    color: "var(--text-tertiary)",
    fontSize: "13px",
    lineHeight: 1.6,
    textAlign: "center",
  },
};
