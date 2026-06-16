"use client";

import { useRef, useState } from "react";

interface AudioUploaderProps {
  onFileSelect: (file: File) => void;
}

/**
 * 音频文件选择器
 * - 支持 MP3、WAV、M4A
 * - 校验文件格式
 * - 显示错误提示
 * - 不负责播放
 */
export default function AudioUploader({ onFileSelect }: AudioUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>("");

  // 支持的文件类型
  const ACCEPTED_EXTENSIONS = ["mp3", "wav", "m4a"];
  const ACCEPTED_MIMES = [
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
    "audio/mp4",
    "audio/x-m4a",
  ];

  const validateFile = (file: File): boolean => {
    // 检查扩展名
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (!ACCEPTED_EXTENSIONS.includes(extension)) {
      return false;
    }

    // 检查 MIME 类型（作为辅助校验）
    if (!ACCEPTED_MIMES.includes(file.type) && file.type !== "") {
      return false;
    }

    return true;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError("");
    const files = e.currentTarget.files;

    if (!files || files.length === 0) {
      return;
    }

    const file = files[0];

    if (!validateFile(file)) {
      setError("请选择 MP3、WAV 或 M4A 音频文件。");
      return;
    }

    onFileSelect(file);
  };

  const handleClick = () => {
    // 重置 input value，允许选择同一个文件两次
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  return (
    <div style={styles.container}>
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a"
        onChange={handleFileChange}
        aria-label="选择音频文件"
      />
      <button style={styles.button} onClick={handleClick}>
        选择音乐
      </button>

      {error && <div style={styles.error}>{error}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "12px",
  },
  button: {
    padding: "10px 24px",
    backgroundColor: "var(--accent)",
    color: "var(--bg-primary)",
    borderRadius: "4px",
    fontSize: "14px",
    fontWeight: "500",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  error: {
    color: "#ff6b6b",
    fontSize: "12px",
    marginTop: "8px",
  },
};
