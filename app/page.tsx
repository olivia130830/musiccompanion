"use client";

import { useState } from "react";
import AudioUploader from "@/components/AudioUploader";
import MusicPlayer from "@/components/MusicPlayer";

export default function Home() {
  const [audioFile, setAudioFile] = useState<File | null>(null);

  const handleFileSelect = (file: File) => {
    setAudioFile(file);
  };

  return (
    <main style={styles.main}>
      <div style={styles.container}>
        {/* 标题和副标题 */}
        <div style={styles.header}>
          <h1 style={styles.title}>有人和你一起听</h1>
          <p style={styles.subtitle}>音乐发生的时候，也有人听见。</p>
        </div>

        {/* 说明文字 */}
        <div style={styles.description}>
          {!audioFile
            ? "选择一首音乐，开始一次共同聆听。"
            : "先听一会儿，它会在合适的时候说话。"}
        </div>

        {/* 文件上传器 */}
        <AudioUploader onFileSelect={handleFileSelect} />

        {/* 音乐播放器 */}
        <MusicPlayer audioFile={audioFile} />
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
    backgroundColor: "var(--bg-primary)",
    color: "var(--text-primary)",
    minHeight: "100vh",
  },
  container: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "32px",
    width: "100%",
    maxWidth: "480px",
  },
  header: {
    textAlign: "center",
  },
  title: {
    fontSize: "28px",
    fontWeight: "600",
    margin: "0 0 8px 0",
    color: "var(--text-primary)",
  },
  subtitle: {
    fontSize: "14px",
    color: "var(--text-secondary)",
    margin: "0",
  },
  description: {
    fontSize: "14px",
    color: "var(--text-secondary)",
    textAlign: "center",
    minHeight: "20px",
  },
};
