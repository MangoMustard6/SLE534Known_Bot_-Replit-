import { join } from "node:path";
import {
  buildAudioTempoFilter,
  type VideoEffect,
} from "./video-filters.js";
import { runProcess } from "./process-runner.js";

export async function processAudioEffects(
  inputPath: string,
  directory: string,
  effects: VideoEffect[],
  hasAudio: boolean,
): Promise<string | undefined> {
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
      originalAudio,
    ],
    60_000,
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
        240_000,
      );
      currentAudio = nextAudio;
      continue;
    }

    if (effect.name === "pitch") {
      if (effect.pitches.length < 1 || effect.pitches.length > 100) {
        throw new Error("Pitch accepts between 1 and 100 semitone values.");
      }

      const pitchLayers: string[] = [];
      for (const [layerIndex, pitch] of effect.pitches.entries()) {
        const layerPath = join(
          directory,
          `audio-pitch-${effectIndex}-${layerIndex}.wav`,
        );
        await runProcess(
          "rubberband",
          ["--fine", "--pitch", String(pitch), currentAudio, layerPath],
          240_000,
        );
        pitchLayers.push(layerPath);
      }

      const mixedAudio = join(directory, `audio-pitch-mix-${effectIndex}.wav`);
      const mixInputs = pitchLayers
        .map((_, layerIndex) => `[${layerIndex}:a:0]`)
        .join("");
      const mixGraph = `${mixInputs}amix=inputs=${pitchLayers.length}:duration=longest:dropout_transition=0:normalize=1[mix]`;
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
        mixTimeoutMs,
      );
      currentAudio = mixedAudio;
    }
  }

  return currentAudio;
}
