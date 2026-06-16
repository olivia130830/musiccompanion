"use client";

import {
  useMemo,
  useState,
  type CSSProperties,
} from "react";

import AudioUploader from "@/components/AudioUploader";
import CurrentComment from "@/components/CurrentComment";
import MusicPlayer from "@/components/MusicPlayer";
import { demoComments } from "@/data/demoComments";
import { useCommentScheduler } from "@/hooks/useCommentScheduler";
import type { PlaybackSnapshot } from "@/types/music";

const INITIAL_PLAYBACK: PlaybackSnapshot = {
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  isSeeking: false,
};

export default function Home() {
  const [audioFile, setAudioFile] =
    useState<File | null>(null);

  const [playback, setPlayback] =
    useState<PlaybackSnapshot>(
      INITIAL_PLAYBACK,
    );

  /**
   * 每个音频文件都有自己的唯一标识。
   * 同名文件也可以通过大小和修改时间区分。
   */
  const trackKey = useMemo(() => {
    if (!audioFile) {
      return "no-track";
    }

    return [
      audioFile.name,
      audioFile.size,
      audioFile.lastModified,
    ].join("-");
  }, [audioFile]);

  const { currentComment } =
    useCommentScheduler({
      comments: demoComments,
      currentTime: playback.currentTime,
      isPlaying: playback.isPlaying,
      isSeeking: playback.isSeeking,
      trackKey,
    });

  const handleFileSelect = (file: File) => {
    setAudioFile(file);
    setPlayback(INITIAL_PLAYBACK);
  };

  return (
    <main style={styles.main}>
      <section style={styles.container}>
        <header style={styles.header}>
          <h1 style={styles.title}>
            有人和你一起听
          </h1>

          <p style={styles.subtitle}>
            音乐发生的时候，也有人听见。
          </p>
        </header>

        <p style={styles.description}>
          {!audioFile
            ? "选择一首音乐，开始一次共同聆听。"
            : "先听一会儿，它会在合适的时候说话。"}
        </p>

        <AudioUploader
          onFileSelect={handleFileSelect}
        />

        <MusicPlayer
          audioFile={audioFile}
          onPlaybackStateChange={setPlayback}
        />

        <CurrentComment
          key={currentComment?.id ?? trackKey}
          comment={currentComment}
          hasAudio={Boolean(audioFile)}
        />
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  main: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "32px 20px",
    backgroundColor: "var(--bg-primary)",
    color: "var(--text-primary)",
  },

  container: {
    width: "100%",
    maxWidth: "520px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "28px",
  },

  header: {
    textAlign: "center",
  },

  title: {
    margin: "0 0 8px",
    fontSize: "30px",
    fontWeight: 650,
    letterSpacing: "-0.02em",
  },

  subtitle: {
    margin: 0,
    color: "var(--text-secondary)",
    fontSize: "14px",
  },

  description: {
    minHeight: "21px",
    margin: 0,
    color: "var(--text-secondary)",
    fontSize: "14px",
    textAlign: "center",
  },
};