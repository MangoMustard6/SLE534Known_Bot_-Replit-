import { join } from "node:path";
import { processAudioEffects } from "./audio-processing.js";
import { generateHueClut } from "./hue-clut.js";
import { runProcess } from "./process-runner.js";
import {
  buildFfmpegArguments,
  parseEffectChain,
  type VideoEffect,
} from "./video-filters.js";

export const MAX_IHTX_POWERS = 10;
export const MAX_IHTX_OUTPUT_SECONDS = 180;
const MAX_IHTX_PITCH_LAYERS = 100;

export interface IhtxCommand {
  segmentSeconds: number;
  powers: number;
  effectInput: string;
  effects: VideoEffect[];
}

export type IhtxProgressCallback = (message: string) => Promise<void> | void;

export function parseIhtxCommand(input: string): IhtxCommand {
  const [rawSeconds, rawPowers, ...effectParts] = input.trim().split(/\s+/);
  const effectInput = effectParts.join(" ").trim();
  if (!rawSeconds || !rawPowers || !effectInput) {
    throw new Error(
      "Use `534!ihtx <seconds> <powers> <effects>`, for example `534!ihtx 2 4 invert|sepia`.",
    );
  }

  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(rawSeconds)) {
    throw new Error("IHTX segment time must be a number of seconds.");
  }
  const segmentSeconds = Number(rawSeconds);
  if (!Number.isFinite(segmentSeconds) || segmentSeconds < 0.1) {
    throw new Error("IHTX segment time must be at least 0.1 seconds.");
  }

  if (!/^\d+$/.test(rawPowers)) {
    throw new Error("IHTX powers must be a whole number.");
  }
  const powers = Number(rawPowers);
  if (powers < 1 || powers > MAX_IHTX_POWERS) {
    throw new Error(`IHTX powers must be between 1 and ${MAX_IHTX_POWERS}.`);
  }
  if (segmentSeconds * powers > MAX_IHTX_OUTPUT_SECONDS) {
    throw new Error(
      `IHTX output cannot exceed ${MAX_IHTX_OUTPUT_SECONDS} seconds.`,
    );
  }

  const effects = parseEffectChain(effectInput);
  const pitchLayersPerPass = effects.reduce(
    (total, effect) =>
      total + (effect.name === "pitch" ? effect.pitches.length : 0),
    0,
  );
  const totalPitchLayers =
    pitchLayersPerPass * ((powers * (powers + 1)) / 2);
  if (totalPitchLayers > MAX_IHTX_PITCH_LAYERS) {
    throw new Error(
      `IHTX can process at most ${MAX_IHTX_PITCH_LAYERS} total pitch layers across all powers.`,
    );
  }

  return { segmentSeconds, powers, effectInput, effects };
}

export async function renderIhtx(
  inputPath: string,
  outputPath: string,
  directory: string,
  hasAudio: boolean,
  command: IhtxCommand,
  onProgress?: IhtxProgressCallback,
): Promise<void> {
  const segmentPaths: string[] = [];

  for (let power = 1; power <= command.powers; power += 1) {
    const effects = Array.from({ length: power }, () => command.effects).flat();
    await onProgress?.(`IHTX: rendering progressive segment ${power}/${command.powers}…`);

    const hueClutPaths: string[] = [];
    for (const [index, effect] of effects.entries()) {
      if (effect.name === "hue") {
        hueClutPaths.push(await generateHueClut(effect, directory, index));
      }
    }

    const processedAudioPath = await processAudioEffects(
      inputPath,
      directory,
      effects,
      hasAudio,
      async (completed, total) => {
        await onProgress?.(
          `IHTX ${power}/${command.powers}: pitch layers ${completed}/${total}…`,
        );
      },
    );

    const segmentPath = join(directory, `ihtx-segment-${power}.ts`);
    await onProgress?.(
      `IHTX: encoding segment ${power}/${command.powers}…`,
    );
    await runProcess(
      "ffmpeg",
      buildFfmpegArguments(
        inputPath,
        segmentPath,
        effects,
        processedAudioPath,
        hueClutPaths,
        command.segmentSeconds,
      ),
      240_000,
    );
    segmentPaths.push(segmentPath);
  }

  await onProgress?.("IHTX: joining progressive segments…");
  await runProcess(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      `concat:${segmentPaths.join("|")}`,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    120_000,
  );
}
