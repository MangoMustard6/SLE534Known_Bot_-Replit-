import { join } from "node:path";
import { availableParallelism } from "node:os";
import {
  buildAudioTempoFilter,
  type VideoEffect,
} from "./video-filters.js";
import { runProcess, timeoutWithinDeadline } from "./process-runner.js";

export type PitchProgressCallback = (
  completed: number,
  total: number,
) => Promise<void> | void;

export interface AudioProcessingOptions {
  timeoutDeadline?: number;
  inputDurationSeconds?: number;
}

const MAX_PARALLEL_PITCH_SHIFTS = Math.max(
  1,
  Math.min(3, availableParallelism() - 1),
);
let activePitchShifts = 0;
const pitchShiftWaiters: Array<() => void> = [];

async function acquirePitchShiftSlot(): Promise<void> {
  if (activePitchShifts < MAX_PARALLEL_PITCH_SHIFTS) {
    activePitchShifts += 1;
    return;
  }

  await new Promise<void>((resolve) => pitchShiftWaiters.push(resolve));
}

function releasePitchShiftSlot(): void {
  const nextWaiter = pitchShiftWaiters.shift();
  if (nextWaiter) {
    nextWaiter();
  } else {
    activePitchShifts -= 1;
  }
}

async function withPitchShiftSlot<T>(work: () => Promise<T>): Promise<T> {
  await acquirePitchShiftSlot();
  try {
    return await work();
  } finally {
    releasePitchShiftSlot();
  }
}

export async function processAudioEffects(
  inputPath: string,
  directory: string,
  effects: VideoEffect[],
  hasAudio: boolean,
  onPitchProgress?: PitchProgressCallback,
  options: AudioProcessingOptions = {},
): Promise<string | undefined> {
  const processTimeout = (defaultTimeoutMs: number) =>
    timeoutWithinDeadline(
      options.timeoutDeadline === undefined
        ? defaultTimeoutMs
        : 600_000,
      options.timeoutDeadline,
    );
  const audioEffects = effects.filter(
    (effect) => effect.name === "speed" || effect.name === "pitch",
  );
  if (audioEffects.length === 0) return undefined;

  if (!hasAudio) {
    if (audioEffects.some((effect) => effect.name === "pitch")) {
      throw new Error("This video has no audio track to pitch-shift.");
    }
    return undefined;
  }

  const originalAudio = join(directory, "audio-original.wav");
  await runProcess(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-map",
      "0:a:0",
      "-vn",
      "-ac",
      "2",
      "-ar",
      "48000",
      "-c:a",
      "pcm_s16le",
      ...(options.inputDurationSeconds === undefined
        ? []
        : ["-t", String(options.inputDurationSeconds)]),
      originalAudio,
    ],
    processTimeout(60_000),
  );

  let currentAudio = originalAudio;
  for (const [effectIndex, effect] of audioEffects.entries()) {
    if (effect.name === "speed") {
      const nextAudio = join(directory, `audio-speed-${effectIndex}.wav`);
      await runProcess(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-i",
          currentAudio,
          "-af",
          buildAudioTempoFilter(effect.value),
          "-ac",
          "2",
          "-ar",
          "48000",
          "-c:a",
          "pcm_s16le",
          nextAudio,
        ],
        processTimeout(240_000),
      );
      currentAudio = nextAudio;
      continue;
    }

    if (effect.name === "pitch") {
      if (effect.pitches.length < 1 || effect.pitches.length > 100) {
        throw new Error("Pitch accepts between 1 and 100 semitone values.");
      }

      const pitchLayers = effect.pitches.map((_, layerIndex) =>
        join(directory, `audio-pitch-${effectIndex}-${layerIndex}.wav`),
      );
      const progressInterval = Math.max(1, Math.ceil(pitchLayers.length / 10));
      let completedLayers = 0;
      let progressQueue = Promise.resolve();
      let firstPitchFailure: unknown;

      const reportProgress = (completed: number) => {
        if (!onPitchProgress) return;
        progressQueue = progressQueue
          .then(() => onPitchProgress(completed, pitchLayers.length))
          .then(() => undefined)
          .catch((error: unknown) => {
            console.warn(
              "Couldn't update pitch progress:",
              error instanceof Error ? error.message : "Unknown error",
            );
          });
      };

      reportProgress(0);
      const layerResults = await Promise.allSettled(
        effect.pitches.map(async (pitch, layerIndex) => {
          try {
            await withPitchShiftSlot(async () => {
              if (firstPitchFailure !== undefined) return;
              await runProcess(
                "rubberband",
                [
                  "--fine",
                  "--pitch",
                  String(pitch),
                  currentAudio,
                  pitchLayers[layerIndex],
                ],
                processTimeout(240_000),
              );
            });
            if (firstPitchFailure !== undefined) return;

            completedLayers += 1;
            if (
              completedLayers === pitchLayers.length ||
              completedLayers % progressInterval === 0
            ) {
              reportProgress(completedLayers);
              await progressQueue;
            }
          } catch (error) {
            firstPitchFailure ??= error;
            throw error;
          }
        }),
      );
      await progressQueue;

      const failedLayer = layerResults.find(
        (result) => result.status === "rejected",
      );
      if (failedLayer?.status === "rejected") {
        throw failedLayer.reason;
      }

      const mixedAudio = join(directory, `audio-pitch-mix-${effectIndex}.wav`);
      const mixInputs = pitchLayers
        .map((_, layerIndex) => `[${layerIndex}:a:0]`)
        .join("");
      const mixGraph = `${mixInputs}amix=inputs=${pitchLayers.length}:duration=longest:dropout_transition=0:normalize=0[mix]`;
      const mixTimeoutMs = Math.min(
        600_000,
        120_000 + Math.max(0, pitchLayers.length - 3) * 5_000,
      );
      await runProcess(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          ...pitchLayers.flatMap((path) => ["-i", path]),
          "-filter_complex",
          mixGraph,
          "-map",
          "[mix]",
          "-ac",
          "2",
          "-ar",
          "48000",
          "-c:a",
          "pcm_s16le",
          mixedAudio,
        ],
        processTimeout(mixTimeoutMs),
      );
      currentAudio = mixedAudio;
    }
  }

  return currentAudio;
}
