"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from "react";

import type { PlaybackSnapshot } from "@/types/music";
import {
  createPlayableAudioBlob,
  getAcceptedAudioDescription,
} from "@/lib/audio/formats";

type MusicPlayerProps = {
  audioFile: File | null;
  onPlaybackStateChange: (snapshot: PlaybackSnapshot) => void;
  onPlaybackAudioChunk?: (
    samples: Float32Array,
    sampleRate: number,
  ) => void;
  onPlaybackIntent?: () => void;
  suspendForVoiceRecording?: boolean;
  playerRef?: Ref<MusicPlayerHandle>;
};

export type MusicPlayerHandle = {
  pauseForVoiceRecording: () => void;
  resumeAfterVoiceRecording: () => void;
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
  onPlaybackAudioChunk,
  onPlaybackIntent,
  suspendForVoiceRecording = false,
  playerRef,
}: MusicPlayerProps) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef =
    useRef<AudioBufferSourceNode | null>(null);
  const mediaElementRef =
    useRef<HTMLMediaElement | null>(null);
  const mediaSourceRef =
    useRef<MediaElementAudioSourceNode | null>(null);
  const mediaProcessorRef =
    useRef<ScriptProcessorNode | null>(null);
  const mediaObjectUrlRef = useRef("");
  const progressIntervalRef = useRef<number | null>(null);
  const playRequestIdRef = useRef(0);
  const startedAtRef = useRef(0);
  const pausedAtRef = useRef(0);
  const lastAudioChunkTimeRef = useRef(0);
  const resumeAfterVoiceRecordingRef = useRef(false);
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

  const cleanupMediaElement = useCallback(() => {
    const mediaElement = mediaElementRef.current;
    const mediaSource = mediaSourceRef.current;
    const mediaProcessor = mediaProcessorRef.current;

    mediaElementRef.current = null;
    mediaSourceRef.current = null;
    mediaProcessorRef.current = null;

    if (mediaElement) {
      mediaElement.onended = null;
      mediaElement.pause();
      mediaElement.removeAttribute("src");
      mediaElement.load();
    }

    if (mediaProcessor) {
      mediaProcessor.onaudioprocess = null;
      try {
        mediaProcessor.disconnect();
      } catch {}
    }

    if (mediaSource) {
      try {
        mediaSource.disconnect();
      } catch {}
    }

    if (mediaObjectUrlRef.current) {
      URL.revokeObjectURL(mediaObjectUrlRef.current);
      mediaObjectUrlRef.current = "";
    }
  }, []);

  const readPlayingTime = useCallback(() => {
    const mediaElement = mediaElementRef.current;

    if (mediaElement) {
      return Math.min(
        Number.isFinite(mediaElement.duration)
          ? mediaElement.duration
          : mediaElement.currentTime,
        Math.max(0, mediaElement.currentTime),
      );
    }

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

  const emitPlayedAudioChunk = useCallback(
    (currentTime: number) => {
      const audioBuffer = audioBufferRef.current;

      if (!audioBuffer || !onPlaybackAudioChunk) {
        lastAudioChunkTimeRef.current = currentTime;
        return;
      }

      const startSample = Math.max(
        0,
        Math.floor(
          lastAudioChunkTimeRef.current * audioBuffer.sampleRate,
        ),
      );
      const endSample = Math.min(
        audioBuffer.length,
        Math.floor(currentTime * audioBuffer.sampleRate),
      );

      if (endSample <= startSample) {
        return;
      }

      const monoSamples = new Float32Array(
        endSample - startSample,
      );

      for (
        let channelIndex = 0;
        channelIndex < audioBuffer.numberOfChannels;
        channelIndex += 1
      ) {
        const channel = audioBuffer.getChannelData(channelIndex);

        for (
          let sampleIndex = startSample;
          sampleIndex < endSample;
          sampleIndex += 1
        ) {
          monoSamples[sampleIndex - startSample] +=
            channel[sampleIndex] / audioBuffer.numberOfChannels;
        }
      }

      lastAudioChunkTimeRef.current =
        endSample / audioBuffer.sampleRate;
      onPlaybackAudioChunk(monoSamples, audioBuffer.sampleRate);
    },
    [onPlaybackAudioChunk],
  );

  const updatePlayingProgress = useCallback(() => {
    const audioBuffer = audioBufferRef.current;
    const mediaElement = mediaElementRef.current;
    const duration =
      audioBuffer?.duration ?? mediaElement?.duration ?? 0;
    const isMediaPlaying = Boolean(
      mediaElement && !mediaElement.paused && !mediaElement.ended,
    );

    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      (!sourceRef.current && !isMediaPlaying)
    ) {
      return;
    }

    const currentTime = readPlayingTime();

    pausedAtRef.current = currentTime;
    if (audioBuffer) {
      emitPlayedAudioChunk(currentTime);
    }

    updatePlayback({
      currentTime,
      duration,
      isPlaying: true,
      isSeeking: false,
    });

  }, [emitPlayedAudioChunk, readPlayingTime, updatePlayback]);

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
    const mediaElement = mediaElementRef.current;
    const duration =
      audioBuffer?.duration ?? mediaElement?.duration ?? 0;

    if (!Number.isFinite(duration) || duration <= 0) {
      return;
    }

    const currentTime = readPlayingTime();
    pausedAtRef.current = currentTime;
    if (audioBuffer) {
      emitPlayedAudioChunk(currentTime);
    }

    playRequestIdRef.current += 1;
    stopProgressLoop();
    if (mediaElement) {
      mediaElement.pause();
    } else {
      stopSource();
    }

    updatePlayback({
      currentTime,
      duration,
      isPlaying: false,
      isSeeking: false,
    });
  }, [
    emitPlayedAudioChunk,
    readPlayingTime,
    stopProgressLoop,
    stopSource,
    updatePlayback,
  ]);

  const playFrom = useCallback(
    async (startSeconds: number) => {
      const audioContext = audioContextRef.current;
      const audioBuffer = audioBufferRef.current;
      const mediaElement = mediaElementRef.current;
      const duration =
        audioBuffer?.duration ?? mediaElement?.duration ?? 0;
      const requestId = playRequestIdRef.current + 1;

      playRequestIdRef.current = requestId;

      if (
        !audioContext ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        (!audioBuffer && !mediaElement)
      ) {
        return;
      }

      await audioContext.resume();

      if (requestId !== playRequestIdRef.current) {
        return;
      }

      stopProgressLoop();
      if (mediaElement) {
        mediaElement.pause();
      } else {
        stopSource();
      }

      const safeStart = Math.min(
        Math.max(0, startSeconds),
        Math.max(0, duration - 0.01),
      );

      if (safeStart >= duration) {
        pausedAtRef.current = 0;
        updatePlayback({
          currentTime: duration,
          duration,
          isPlaying: false,
          isSeeking: false,
        });
        return;
      }

      if (mediaElement) {
        mediaElement.currentTime = safeStart;
        pausedAtRef.current = safeStart;

        try {
          await mediaElement.play();
        } catch (error) {
          setPlayerError(
            error instanceof Error
              ? `无法播放这个媒体文件：${error.message}`
              : "无法播放这个媒体文件。",
          );
          return;
        }

        if (requestId !== playRequestIdRef.current) {
          mediaElement.pause();
          return;
        }

        startProgressLoop();
        return;
      }

      if (!audioBuffer) {
        return;
      }

      const source = audioContext.createBufferSource();

      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.onended = () => {
        if (sourceRef.current !== source) {
          return;
        }

        emitPlayedAudioChunk(audioBuffer.duration);
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
      lastAudioChunkTimeRef.current = safeStart;

      source.start(0, safeStart);
      startProgressLoop();
    },
    [
      emitPlayedAudioChunk,
      startProgressLoop,
      stopProgressLoop,
      stopSource,
      updatePlayback,
    ],
  );

  const pauseForVoiceRecording = useCallback(() => {
    if (!playbackRef.current.isPlaying) return;

    resumeAfterVoiceRecordingRef.current = true;
    pausePlayback();
  }, [pausePlayback]);

  const resumeAfterVoiceRecording = useCallback(() => {
    if (!resumeAfterVoiceRecordingRef.current) return;

    resumeAfterVoiceRecordingRef.current = false;
    void playFrom(pausedAtRef.current);
  }, [playFrom]);

  useImperativeHandle(
    playerRef,
    () => ({
      pauseForVoiceRecording,
      resumeAfterVoiceRecording,
    }),
    [pauseForVoiceRecording, resumeAfterVoiceRecording],
  );

  useEffect(() => {
    playbackRef.current = playback;
  }, [playback]);

  useEffect(() => {
    if (suspendForVoiceRecording) {
      pauseForVoiceRecording();
      return;
    }

    resumeAfterVoiceRecording();
  }, [
    pauseForVoiceRecording,
    resumeAfterVoiceRecording,
    suspendForVoiceRecording,
  ]);

  useEffect(() => {
    let isCancelled = false;

    stopProgressLoop();
    stopSource();
    cleanupMediaElement();

    audioBufferRef.current = null;
    pausedAtRef.current = 0;
    startedAtRef.current = 0;
    lastAudioChunkTimeRef.current = 0;
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
      .catch(async (decodeError) => {
        if (isCancelled) {
          return;
        }

        try {
          const playableBlob = createPlayableAudioBlob(audioFile);
          const objectUrl = URL.createObjectURL(playableBlob);
          const mediaElement = document.createElement(
            playableBlob.type.startsWith("video/")
              ? "video"
              : "audio",
          );

          mediaObjectUrlRef.current = objectUrl;
          mediaElementRef.current = mediaElement;
          mediaElement.preload = "auto";
          if (mediaElement instanceof HTMLVideoElement) {
            mediaElement.playsInline = true;
          }

          await new Promise<void>((resolve, reject) => {
            const handleLoadedMetadata = () => {
              cleanupListeners();
              resolve();
            };
            const handleError = () => {
              cleanupListeners();
              reject(
                new Error(
                  mediaElement.error?.message ||
                    "浏览器无法读取这个媒体文件的音轨。",
                ),
              );
            };
            const cleanupListeners = () => {
              mediaElement.removeEventListener(
                "loadedmetadata",
                handleLoadedMetadata,
              );
              mediaElement.removeEventListener(
                "error",
                handleError,
              );
            };

            mediaElement.addEventListener(
              "loadedmetadata",
              handleLoadedMetadata,
            );
            mediaElement.addEventListener("error", handleError);
            mediaElement.src = objectUrl;
            mediaElement.load();
          });

          if (isCancelled) {
            return;
          }

          if (
            !Number.isFinite(mediaElement.duration) ||
            mediaElement.duration <= 0
          ) {
            throw new Error("没有读取到可播放的音轨时长。");
          }

          const mediaSource =
            audioContext.createMediaElementSource(mediaElement);
          const mediaProcessor =
            audioContext.createScriptProcessor(2048, 2, 1);

          mediaSource.connect(audioContext.destination);
          mediaSource.connect(mediaProcessor);
          mediaProcessor.connect(audioContext.destination);
          mediaProcessor.onaudioprocess = (event) => {
            if (
              mediaElement.paused ||
              mediaElement.ended ||
              !onPlaybackAudioChunk
            ) {
              return;
            }

            const inputBuffer = event.inputBuffer;
            const monoSamples = new Float32Array(
              inputBuffer.length,
            );

            for (
              let channelIndex = 0;
              channelIndex < inputBuffer.numberOfChannels;
              channelIndex += 1
            ) {
              const channel =
                inputBuffer.getChannelData(channelIndex);

              for (
                let sampleIndex = 0;
                sampleIndex < inputBuffer.length;
                sampleIndex += 1
              ) {
                monoSamples[sampleIndex] +=
                  channel[sampleIndex] /
                  inputBuffer.numberOfChannels;
              }
            }

            onPlaybackAudioChunk(
              monoSamples,
              inputBuffer.sampleRate,
            );
          };

          mediaSourceRef.current = mediaSource;
          mediaProcessorRef.current = mediaProcessor;
          mediaElement.onended = () => {
            if (mediaElementRef.current !== mediaElement) {
              return;
            }

            pausedAtRef.current = 0;
            stopProgressLoop();
            updatePlayback({
              currentTime: mediaElement.duration,
              duration: mediaElement.duration,
              isPlaying: false,
              isSeeking: false,
            });
          };

          setHasDecodedAudio(true);
          pausedAtRef.current = 0;
          setIsDecoding(false);
          setPlayerError("");
          updatePlayback({
            currentTime: 0,
            duration: mediaElement.duration,
            isPlaying: false,
            isSeeking: false,
          });
        } catch (mediaError) {
          if (isCancelled) {
            return;
          }

          cleanupMediaElement();
          const decodeMessage =
            decodeError instanceof Error
              ? decodeError.message
              : "音频解码失败。";
          const mediaMessage =
            mediaError instanceof Error
              ? mediaError.message
              : "媒体音轨读取失败。";

          setIsDecoding(false);
          setHasDecodedAudio(false);
          setPlayerError(
            `这个文件的音轨仍然无法解码，可以换成 ${getAcceptedAudioDescription()}。具体原因：${decodeMessage}；${mediaMessage}`,
          );
          updatePlayback(INITIAL_PLAYBACK);
        }
      });

    return () => {
      isCancelled = true;
      stopProgressLoop();
      stopSource();
      cleanupMediaElement();
    };
  }, [
    audioFile,
    cleanupMediaElement,
    onPlaybackAudioChunk,
    stopProgressLoop,
    stopSource,
    updatePlayback,
  ]);

  useEffect(() => {
    return () => {
      stopProgressLoop();
      stopSource();
      cleanupMediaElement();
      void audioContextRef.current?.close();
      audioContextRef.current = null;
    };
  }, [cleanupMediaElement, stopProgressLoop, stopSource]);

  const handlePlayPause = () => {
    if (playback.isPlaying) {
      pausePlayback();
      return;
    }

    onPlaybackIntent?.();
    void playFrom(pausedAtRef.current);
  };

  const handleSeekChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const audioBuffer = audioBufferRef.current;
    const mediaElement = mediaElementRef.current;
    const duration =
      audioBuffer?.duration ?? mediaElement?.duration ?? 0;

    if (!Number.isFinite(duration) || duration <= 0) {
      return;
    }

    const nextTime = Number(event.target.value);
    const wasPlaying = playbackRef.current.isPlaying;

    pausedAtRef.current = nextTime;
    lastAudioChunkTimeRef.current = nextTime;
    stopProgressLoop();
    if (mediaElement) {
      mediaElement.pause();
      mediaElement.currentTime = nextTime;
    } else {
      stopSource();
    }

    if (wasPlaying) {
      void playFrom(nextTime);
    } else {
      playRequestIdRef.current += 1;
      updatePlayback({
        currentTime: nextTime,
        duration,
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
          disabled={
            isDecoding ||
            !hasDecodedAudio ||
            suspendForVoiceRecording
          }
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

      {suspendForVoiceRecording && (
        <p style={styles.emptyText}>
          录音期间已自动暂停音乐，避免录入系统播放声。
        </p>
      )}

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
