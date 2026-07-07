export type ConvertAudioFileOptions = {
  startTimeSeconds: number;
  durationSeconds: number;
  targetSampleRate?: number;
};

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary);
}

function floatTo16BitPcmBase64(samples: Float32Array<ArrayBufferLike>) {
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

function createMonoChannelBuffer(audioBuffer: AudioBuffer) {
  const length = audioBuffer.length;
  const channelCount = audioBuffer.numberOfChannels;
  const mono = new Float32Array(length);

  for (
    let channelIndex = 0;
    channelIndex < channelCount;
    channelIndex += 1
  ) {
    const channel = audioBuffer.getChannelData(channelIndex);

    for (
      let sampleIndex = 0;
      sampleIndex < length;
      sampleIndex += 1
    ) {
      mono[sampleIndex] += channel[sampleIndex] / channelCount;
    }
  }

  return mono;
}

function createAudioBufferFromMonoSamples(
  context: BaseAudioContext,
  samples: Float32Array<ArrayBufferLike>,
  sampleRate: number,
) {
  const audioBuffer = context.createBuffer(
    1,
    samples.length,
    sampleRate,
  );

  const targetChannel = audioBuffer.getChannelData(0);

  for (let index = 0; index < samples.length; index += 1) {
    targetChannel[index] = samples[index];
  }

  return audioBuffer;
}

export async function convertAudioFileSliceToPcm16Base64(
  file: File,
  options: ConvertAudioFileOptions,
) {
  const targetSampleRate = options.targetSampleRate ?? 16000;
  const audioContext = new AudioContext();

  try {
    const sourceArrayBuffer = await file.arrayBuffer();
    const decodedAudioBuffer =
      await audioContext.decodeAudioData(sourceArrayBuffer.slice(0));

    const sourceSampleRate = decodedAudioBuffer.sampleRate;
    const startTimeSeconds = Math.max(0, options.startTimeSeconds);
    const durationSeconds = Math.max(0.5, options.durationSeconds);

    const safeStartSample = Math.min(
      decodedAudioBuffer.length,
      Math.floor(startTimeSeconds * sourceSampleRate),
    );

    const safeEndSample = Math.min(
      decodedAudioBuffer.length,
      safeStartSample + Math.floor(durationSeconds * sourceSampleRate),
    );

    const sliceLength = Math.max(1, safeEndSample - safeStartSample);
    const monoSource = createMonoChannelBuffer(decodedAudioBuffer);
    const monoSlice = monoSource.slice(
      safeStartSample,
      safeStartSample + sliceLength,
    );

    const sliceDurationSeconds = monoSlice.length / sourceSampleRate;
    const targetLength = Math.max(
      1,
      Math.ceil(sliceDurationSeconds * targetSampleRate),
    );

    const offlineContext = new OfflineAudioContext(
      1,
      targetLength,
      targetSampleRate,
    );

    const sourceBuffer = createAudioBufferFromMonoSamples(
      offlineContext,
      monoSlice,
      sourceSampleRate,
    );

    const sourceNode = offlineContext.createBufferSource();
    sourceNode.buffer = sourceBuffer;
    sourceNode.connect(offlineContext.destination);
    sourceNode.start(0);

    const renderedBuffer = await offlineContext.startRendering();
    const renderedSamples = renderedBuffer.getChannelData(0);

    return floatTo16BitPcmBase64(renderedSamples);
  } finally {
    await audioContext.close();
  }
}