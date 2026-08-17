export const ACCEPTED_AUDIO_EXTENSIONS = [
  ".mp3",
  ".mp2",
  ".mpa",
  ".m4a",
  ".mp4",
  ".m4v",
  ".mov",
  ".aac",
  ".wav",
  ".wave",
  ".flac",
  ".ogg",
  ".oga",
  ".opus",
  ".webm",
  ".aif",
  ".aiff",
  ".aifc",
  ".caf",
  ".3gp",
  ".3g2",
  ".amr",
];

export const ACCEPTED_AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/mp2",
  "audio/x-mp2",
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
  "audio/aiff",
  "audio/x-aiff",
  "audio/x-caf",
  "audio/3gpp",
  "audio/3gpp2",
  "audio/amr",
  "video/mp4",
  "video/x-m4v",
  "video/quicktime",
  "video/webm",
  "video/ogg",
  "video/3gpp",
  "video/3gpp2",
];

export const AUDIO_FILE_ACCEPT = [
  "audio/*",
  "video/*",
  ...ACCEPTED_AUDIO_MIME_TYPES,
  ...ACCEPTED_AUDIO_EXTENSIONS,
].join(",");

const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".mp2": "audio/mp2",
  ".mpa": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".wave": "audio/wav",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/opus",
  ".webm": "audio/webm",
  ".aif": "audio/aiff",
  ".aiff": "audio/aiff",
  ".aifc": "audio/aiff",
  ".caf": "audio/x-caf",
  ".3gp": "video/3gpp",
  ".3g2": "video/3gpp2",
  ".amr": "audio/amr",
};

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
  return MIME_TYPE_BY_EXTENSION[extension] ?? "";
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
