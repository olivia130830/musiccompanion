import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

export const TRANSCODED_AUDIO_MIME_TYPE = "audio/wav";
export const TRANSCODED_AUDIO_FILE_NAME =
  "transcoded.wav";
export const MAX_TRANSCODE_SIZE_BYTES =
  100 * 1024 * 1024;

function runAfconvert(
  inputPath: string,
  outputPath: string,
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      "afconvert",
      [
        inputPath,
        outputPath,
        "-f",
        "WAVE",
        "-d",
        "LEI16@44100",
        "-c",
        "2",
        "--no-filler",
      ],
      {
        stdio: [
          "ignore",
          "ignore",
          "pipe",
        ],
      },
    );

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          stderr.trim() ||
            `afconvert exited with code ${code}`,
        ),
      );
    });
  });
}

export async function transcodeAudioToWav(
  file: File,
) {
  const tempDir = await mkdtemp(
    join(tmpdir(), "musiccompanion-audio-"),
  );
  const inputPath = join(tempDir, "input.audio");
  const outputPath = join(tempDir, "output.wav");

  try {
    const inputBuffer = Buffer.from(
      await file.arrayBuffer(),
    );

    await writeFile(inputPath, inputBuffer);
    await runAfconvert(inputPath, outputPath);

    return await readFile(outputPath);
  } finally {
    await rm(tempDir, {
      recursive: true,
      force: true,
    });
  }
}
