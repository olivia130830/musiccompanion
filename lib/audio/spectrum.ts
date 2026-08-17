const SPECTRUM_FFT_SIZE = 4096;
const SPECTRUM_MIN_FREQUENCY = 20;
const SPECTRUM_MAX_FREQUENCY = 8000;
const LOW_BASS_MIN_FREQUENCY = 40;
const LOW_BASS_MAX_FREQUENCY = 120;
const UPPER_MID_MIN_FREQUENCY = 2000;
const UPPER_MID_MAX_FREQUENCY = 5000;

function runFft(real: Float64Array, imaginary: Float64Array) {
  const length = real.length;

  for (let index = 1, reversed = 0; index < length; index += 1) {
    let bit = length >> 1;

    while (reversed & bit) {
      reversed ^= bit;
      bit >>= 1;
    }

    reversed ^= bit;

    if (index < reversed) {
      [real[index], real[reversed]] = [
        real[reversed],
        real[index],
      ];
      [imaginary[index], imaginary[reversed]] = [
        imaginary[reversed],
        imaginary[index],
      ];
    }
  }

  for (
    let blockLength = 2;
    blockLength <= length;
    blockLength <<= 1
  ) {
    const angle = (-2 * Math.PI) / blockLength;
    const baseReal = Math.cos(angle);
    const baseImaginary = Math.sin(angle);

    for (
      let blockStart = 0;
      blockStart < length;
      blockStart += blockLength
    ) {
      let rotationReal = 1;
      let rotationImaginary = 0;
      const halfLength = blockLength >> 1;

      for (let offset = 0; offset < halfLength; offset += 1) {
        const evenIndex = blockStart + offset;
        const oddIndex = evenIndex + halfLength;
        const oddReal =
          real[oddIndex] * rotationReal -
          imaginary[oddIndex] * rotationImaginary;
        const oddImaginary =
          real[oddIndex] * rotationImaginary +
          imaginary[oddIndex] * rotationReal;

        real[oddIndex] = real[evenIndex] - oddReal;
        imaginary[oddIndex] =
          imaginary[evenIndex] - oddImaginary;
        real[evenIndex] += oddReal;
        imaginary[evenIndex] += oddImaginary;

        const nextRotationReal =
          rotationReal * baseReal -
          rotationImaginary * baseImaginary;

        rotationImaginary =
          rotationReal * baseImaginary +
          rotationImaginary * baseReal;
        rotationReal = nextRotationReal;
      }
    }
  }
}

export function calculateBandShares({
  samples,
  sampleRate,
  start,
  end,
}: {
  samples: Float32Array;
  sampleRate: number;
  start: number;
  end: number;
}) {
  const availableLength = end - start;

  if (availableLength < 256) {
    return {
      lowBassShare: null,
      upperMidShare: null,
    };
  }

  let fftSize = Math.min(SPECTRUM_FFT_SIZE, availableLength);

  fftSize = 2 ** Math.floor(Math.log2(fftSize));

  const frameStart =
    start + Math.floor((availableLength - fftSize) / 2);
  const real = new Float64Array(fftSize);
  const imaginary = new Float64Array(fftSize);

  for (let index = 0; index < fftSize; index += 1) {
    const window =
      0.5 -
      0.5 * Math.cos((2 * Math.PI * index) / (fftSize - 1));

    real[index] = samples[frameStart + index] * window;
  }

  runFft(real, imaginary);

  const maxFrequency = Math.min(
    SPECTRUM_MAX_FREQUENCY,
    sampleRate / 2,
  );
  let totalPower = 0;
  let lowBassPower = 0;
  let upperMidPower = 0;

  for (let bin = 1; bin < fftSize / 2; bin += 1) {
    const frequency = (bin * sampleRate) / fftSize;

    if (
      frequency < SPECTRUM_MIN_FREQUENCY ||
      frequency > maxFrequency
    ) {
      continue;
    }

    const power =
      real[bin] * real[bin] +
      imaginary[bin] * imaginary[bin];

    totalPower += power;

    if (
      frequency >= LOW_BASS_MIN_FREQUENCY &&
      frequency <= LOW_BASS_MAX_FREQUENCY
    ) {
      lowBassPower += power;
    }

    if (
      frequency >= UPPER_MID_MIN_FREQUENCY &&
      frequency <= UPPER_MID_MAX_FREQUENCY
    ) {
      upperMidPower += power;
    }
  }

  if (totalPower <= Number.EPSILON) {
    return {
      lowBassShare: 0,
      upperMidShare: 0,
    };
  }

  return {
    lowBassShare: lowBassPower / totalPower,
    upperMidShare: upperMidPower / totalPower,
  };
}
