"use client";

import {
  useRef,
  useState,
  type ChangeEvent,
} from "react";

interface AudioUploaderProps {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
}

const ACCEPTED_EXTENSIONS = [
  "mp3",
  "wav",
  "m4a",
];

const ACCEPTED_MIMES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
];

const MAX_FILE_SIZE_BYTES =
  100 * 1024 * 1024;

export default function AudioUploader({
  onFileSelect,
  disabled = false,
}: AudioUploaderProps) {
  const fileInputRef =
    useRef<HTMLInputElement | null>(
      null,
    );

  const [error, setError] =
    useState("");

  const validateFile = (
    file: File,
  ): string | null => {
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
      return "请选择MP3、WAV或M4A音频文件。";
    }

    if (
      file.type !== "" &&
      !ACCEPTED_MIMES.includes(
        file.type,
      )
    ) {
      return "这个音频文件的格式不受支持。";
    }

    if (
      file.size >
      MAX_FILE_SIZE_BYTES
    ) {
      return "音频文件不能超过100MB。";
    }

    if (file.size === 0) {
      return "这个音频文件是空的。";
    }

    return null;
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

    const validationError =
      validateFile(file);

    if (validationError) {
      setError(validationError);
      return;
    }

    onFileSelect(file);
  };

  const handleClick = () => {
    if (disabled) {
      return;
    }

    const input =
      fileInputRef.current;

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
        disabled={disabled}
        accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a"
        onChange={handleFileChange}
      />

      <button
        type="button"
        className="upload-button"
        disabled={disabled}
        onClick={handleClick}
      >
        {disabled
          ? "正在分析…"
          : "选择音乐"}
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