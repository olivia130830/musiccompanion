export const ACCEPTED_AUDIO_EXTENSIONS = [
  ".mp3",
  ".m4a",
  ".mp4",
  ".aac",
  ".wav",
  ".flac",
  ".ogg",
  ".oga",
  ".opus",
  ".webm",
];

export const ACCEPTED_AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/flac",
  "audio/x-flac",
  "audio/ogg",
  "audio/opus",
  "audio/webm",
  "video/mp4",
  "video/webm",
];

export const AUDIO_FILE_ACCEPT = [
  "audio/*",
  ...ACCEPTED_AUDIO_EXTENSIONS,
].join(",");

export function getFileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");

  if (dotIndex < 0) {
    return "";
  }

  return fileName.slice(dotIndex).toLowerCase();
}

export function isSupportedAudioFile(file: File) {
  const mimeType = file.type.toLowerCase();
  const extension = getFileExtension(file.name);

  return (
    ACCEPTED_AUDIO_MIME_TYPES.includes(mimeType) ||
    ACCEPTED_AUDIO_EXTENSIONS.includes(extension)
  );
}

export function inferAudioMimeType(file: File) {
  const mimeType = file.type.toLowerCase();

  if (ACCEPTED_AUDIO_MIME_TYPES.includes(mimeType)) {
    return mimeType;
  }

  const extension = getFileExtension(file.name);

  if (extension === ".mp3") {
    return "audio/mpeg";
  }

  if (extension === ".m4a" || extension === ".mp4") {
    return "audio/mp4";
  }

  if (extension === ".aac") {
    return "audio/aac";
  }

  if (extension === ".wav") {
    return "audio/wav";
  }

  if (extension === ".flac") {
    return "audio/flac";
  }

  if (extension === ".ogg" || extension === ".oga") {
    return "audio/ogg";
  }

  if (extension === ".opus") {
    return "audio/opus";
  }

  if (extension === ".webm") {
    return "audio/webm";
  }

  return "";
}

export function createPlayableAudioBlob(file: File) {
  const inferredMimeType = inferAudioMimeType(file);

  if (!inferredMimeType || file.type === inferredMimeType) {
    return file;
  }

  return file.slice(0, file.size, inferredMimeType);
}

export function getAcceptedAudioDescription() {
  return ACCEPTED_AUDIO_EXTENSIONS.join(" ");
}
