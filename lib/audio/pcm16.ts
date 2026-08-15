import decodeWebm from "@audio/decode-webm";

export type ConvertAudioFileOptions = {
  startTimeSeconds: number;
  durationSeconds?: number;
  targetSampleRate?: number;
};

export const QWEN_INPUT_SAMPLE_RATE = 16000;

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary);
}

export function float32ToPcm16Base64(
  samples: Float32Array<ArrayBufferLike>,
) {
  const outputBuffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(outputBuffer);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    const int16 =
      sample < 0 ? sample * 0x8000 : sample * 0x7fff;

    view.setInt16(index * 2, int16, true);
  }

  return arrayBufferToBase64(outputBuffer);
}

export function resampleMonoFloat32(
  samples: Float32Array<ArrayBufferLike>,
  sourceSampleRate: number,
  targetSampleRate = QWEN_INPUT_SAMPLE_RATE,
) {
  if (sourceSampleRate <= 0 || targetSampleRate <= 0) {
    throw new RangeError("音频采样率必须大于 0。");
  }

  if (!samples.length) return new Float32Array();
  if (sourceSampleRate === targetSampleRate) {
    return new Float32Array(samples);
  }

  const targetLength = Math.max(
    1,
    Math.round(
      (samples.length * targetSampleRate) / sourceSampleRate,
    ),
  );
  const output = new Float32Array(targetLength);
  const ratio = sourceSampleRate / targetSampleRate;

  for (let index = 0; index < targetLength; index += 1) {
    const sourcePosition = index * ratio;
    const lowerIndex = Math.floor(sourcePosition);
    const upperIndex = Math.min(
      samples.length - 1,
      lowerIndex + 1,
    );
    const fraction = sourcePosition - lowerIndex;

    output[index] =
      samples[lowerIndex] * (1 - fraction) +
      samples[upperIndex] * fraction;
  }

  return output;
}

function mixToMono(channelData: Float32Array[]) {
  const length = channelData[0]?.length ?? 0;
  const mono = new Float32Array(length);

  for (const channel of channelData) {
    for (let index = 0; index < length; index += 1) {
      mono[index] += channel[index] / channelData.length;
    }
  }

  return mono;
}

async function decodeWithBrowser(file: File) {
  const AudioContextConstructor =
    window.AudioContext ??
    (window as typeof window & {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;

  if (!AudioContextConstructor) {
    throw new Error("当前浏览器无法解码这种录音格式。");
  }

  const audioContext = new AudioContextConstructor();

  try {
    const audioBuffer = await audioContext.decodeAudioData(
      await file.arrayBuffer(),
    );
    const channelData = Array.from(
      { length: audioBuffer.numberOfChannels },
      (_, index) => audioBuffer.getChannelData(index),
    );

    return {
      channelData,
      sampleRate: audioBuffer.sampleRate,
    };
  } finally {
    await audioContext.close();
  }
}

async function decodeRecordedFile(file: File) {
  try {
    return await decodeWithBrowser(file);
  } catch (nativeDecodeError) {
    if (file.type.includes("webm")) {
      return decodeWebm(await file.arrayBuffer());
    }

    throw nativeDecodeError;
  }
}

export async function convertAudioFileSliceToPcm16Base64(
  file: File,
  options: ConvertAudioFileOptions,
) {
  const decoded = await decodeRecordedFile(file);
  const mono = mixToMono(decoded.channelData);
  const startSample = Math.min(
    mono.length,
    Math.floor(
      Math.max(0, options.startTimeSeconds) * decoded.sampleRate,
    ),
  );
  const availableDuration =
    (mono.length - startSample) / decoded.sampleRate;
  const durationSeconds = Math.max(
    0,
    Math.min(
      options.durationSeconds ?? availableDuration,
      availableDuration,
    ),
  );
  const endSample = Math.min(
    mono.length,
    startSample + Math.floor(durationSeconds * decoded.sampleRate),
  );
  const monoSlice = mono.slice(startSample, endSample);

  if (!monoSlice.length) {
    throw new Error("没有可转换的音频数据。");
  }

  const resampled = resampleMonoFloat32(
    monoSlice,
    decoded.sampleRate,
    options.targetSampleRate ?? QWEN_INPUT_SAMPLE_RATE,
  );

  return float32ToPcm16Base64(resampled);
}
