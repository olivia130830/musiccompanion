"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import type { PlaybackSnapshot } from "@/types/music";

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

function getAudioErrorText(audio: HTMLAudioElement | null) {
  const code = audio?.error?.code;

  if (code === MediaError.MEDIA_ERR_ABORTED) {
    return "播放被中断。";
  }

  if (code === MediaError.MEDIA_ERR_NETWORK) {
    return "音频加载失败，请重新选择文件。";
  }

  if (code === MediaError.MEDIA_ERR_DECODE) {
    return "这个音频文件无法被浏览器解码，可以换成 mp3、m4a 或 wav 再试。";
  }

  if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
    return "当前浏览器不支持这个音频格式，可以换成 mp3、m4a 或 wav。";
  }

  return "播放失败，请检查音频文件。";
}

export default function MusicPlayer({
  audioFile,
  onPlaybackStateChange,
}: MusicPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef("");
  const isSeekingRef = useRef(false);

  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playback, setPlayback] =
    useState<PlaybackSnapshot>(INITIAL_PLAYBACK);
  const [playerError, setPlayerError] = useState("");

  const fileLabel = useMemo(() => {
    if (!audioFile) {
      return "还没有选择音乐";
    }

    return audioFile.name;
  }, [audioFile]);

  useEffect(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = "";
    }

    setAudioUrl(null);
    setPlayerError("");
    setPlayback(INITIAL_PLAYBACK);
    onPlaybackStateChange(INITIAL_PLAYBACK);

    if (!audioFile) {
      return;
    }

    const nextUrl = URL.createObjectURL(audioFile);
    objectUrlRef.current = nextUrl;
    setAudioUrl(nextUrl);

    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = "";
      }
    };
  }, [audioFile, onPlaybackStateChange]);

  const updatePlayback = (nextPlayback: PlaybackSnapshot) => {
    setPlayback(nextPlayback);
    onPlaybackStateChange(nextPlayback);
  };

  const readAudioSnapshot = (): PlaybackSnapshot => {
    const audio = audioRef.current;

    if (!audio) {
      return INITIAL_PLAYBACK;
    }

    return {
      currentTime: audio.currentTime || 0,
      duration: Number.isFinite(audio.duration)
        ? audio.duration
        : 0,
      isPlaying: !audio.paused && !audio.ended,
      isSeeking: isSeekingRef.current,
    };
  };

  const handleLoadedMetadata = () => {
    setPlayerError("");
    updatePlayback(readAudioSnapshot());
  };

  const handleCanPlay = () => {
    setPlayerError("");
    updatePlayback(readAudioSnapshot());
  };

  const handleTimeUpdate = () => {
    updatePlayback(readAudioSnapshot());
  };

  const handlePlay = () => {
    setPlayerError("");
    updatePlayback(readAudioSnapshot());
  };

  const handlePause = () => {
    updatePlayback(readAudioSnapshot());
  };

  const handleEnded = () => {
    updatePlayback({
      ...readAudioSnapshot(),
      isPlaying: false,
    });
  };

  const handleSeeking = () => {
    isSeekingRef.current = true;

    updatePlayback({
      ...readAudioSnapshot(),
      isSeeking: true,
    });
  };

  const handleSeeked = () => {
    isSeekingRef.current = false;

    updatePlayback({
      ...readAudioSnapshot(),
      isSeeking: false,
    });
  };

  const handleError = () => {
    const audio = audioRef.current;

    if (!audio?.error) {
      return;
    }

    setPlayerError(getAudioErrorText(audio));

    updatePlayback({
      ...readAudioSnapshot(),
      isPlaying: false,
    });
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

      {audioUrl ? (
        <audio
          key={audioUrl}
          ref={audioRef}
          src={audioUrl}
          controls
          preload="metadata"
          style={styles.audio}
          onLoadedMetadata={handleLoadedMetadata}
          onCanPlay={handleCanPlay}
          onTimeUpdate={handleTimeUpdate}
          onPlay={handlePlay}
          onPause={handlePause}
          onEnded={handleEnded}
          onSeeking={handleSeeking}
          onSeeked={handleSeeked}
          onError={handleError}
        />
      ) : (
        <p style={styles.emptyText}>正在准备播放器…</p>
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

  audio: {
    width: "100%",
  },

  errorText: {
    margin: "10px 0 0",
    color: "#c2410c",
    fontSize: "12px",
    lineHeight: 1.6,
  },

  emptyText: {
    margin: 0,
    color: "var(--text-tertiary)",
    fontSize: "13px",
    lineHeight: 1.6,
    textAlign: "center",
  },
};