"use client";

import {
  useRef,
  useState,
  type ChangeEvent,
} from "react";

interface AudioUploaderProps {
  onFileSelect: (file: File) => void;
}

const ACCEPTED_EXTENSIONS = [
  "mp3",
  "wav",
  "m4a",
];

const ACCEPTED_MIMES = [
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
];

export default function AudioUploader({
  onFileSelect,
}: AudioUploaderProps) {
  const fileInputRef =
    useRef<HTMLInputElement | null>(null);

  const [error, setError] = useState("");

  const validateFile = (
    file: File,
  ): boolean => {
    const extension =
      file.name
        .split(".")
        .pop()
        ?.toLowerCase() ?? "";

    if (
      !ACCEPTED_EXTENSIONS.includes(
        extension,
      )
    ) {
      return false;
    }

    if (
      file.type !== "" &&
      !ACCEPTED_MIMES.includes(file.type)
    ) {
      return false;
    }

    return true;
  };

  const handleFileChange = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    setError("");

    const file =
      event.currentTarget.files?.[0];

    if (!file) {
      return;
    }

    if (!validateFile(file)) {
      setError(
        "请选择 MP3、WAV 或 M4A 音频文件。",
      );
      return;
    }

    onFileSelect(file);
  };

  const handleClick = () => {
    const input = fileInputRef.current;

    if (!input) {
      return;
    }

    input.value = "";
    input.click();
  };

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a"
        onChange={handleFileChange}
      />

      <button
        type="button"
        className="upload-button"
        onClick={handleClick}
      >
        选择音乐
      </button>

      {error && (
        <p
          className="upload-error"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}