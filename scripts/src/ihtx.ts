import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { processAudioEffects } from "./audio-processing.js";
import { generateHueClut } from "./hue-clut.js";
import {
  IHTX_TIMEOUT_MS,
  runProcess,
  timeoutWithinDeadline,
} from "./process-runner.js";
import {
  buildFfmpegArguments,
  parseEffectChain,
  type VideoEffect,
} from "./video-filters.js";

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
  if (!Number.isSafeInteger(powers) || powers < 1) {
    throw new Error("IHTX powers must be a positive whole number.");
  }

  const effects = parseEffectChain(effectInput);

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
  const deadlineAt = Date.now() + IHTX_TIMEOUT_MS;
  let currentInputPath = inputPath;

  for (let power = 1; power <= command.powers; power += 1) {
    timeoutWithinDeadline(IHTX_TIMEOUT_MS, deadlineAt);
    const effects = command.effects;
    await onProgress?.(
      `IHTX: rendering progressive export ${power}/${command.powers}…`,
    );

    const hueClutPaths: string[] = [];
    for (const [index, effect] of effects.entries()) {
      if (effect.name === "hue") {
        hueClutPaths.push(
          await generateHueClut(effect, directory, index, deadlineAt),
        );
      }
    }

    const processedAudioPath = await processAudioEffects(
      currentInputPath,
      directory,
      effects,
      hasAudio,
      async (completed, total) => {
        await onProgress?.(
          `IHTX ${power}/${command.powers}: pitch layers ${completed}/${total}…`,
        );
      },
      {
        timeoutDeadline: deadlineAt,
        inputDurationSeconds: command.segmentSeconds,
      },
    );

    const renderedPath = join(directory, `ihtx-rendered-${power}.mp4`);
    const segmentPath = join(directory, `ihtx-segment-${power}.ts`);
    await onProgress?.(
      `IHTX: encoding segment ${power}/${command.powers}…`,
    );
    await runProcess(
      "ffmpeg",
      buildFfmpegArguments(
        currentInputPath,
        renderedPath,
        effects,
        processedAudioPath,
        hueClutPaths,
        command.segmentSeconds,
      ),
      timeoutWithinDeadline(IHTX_TIMEOUT_MS, deadlineAt),
    );

    await onProgress?.(
      `IHTX: normalizing export ${power}/${command.powers} duration…`,
    );
    await runProcess(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-stream_loop",
        "-1",
        "-i",
        renderedPath,
        "-t",
        String(command.segmentSeconds),
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-vf",
        "setpts=PTS-STARTPTS",
        ...(hasAudio ? ["-af", "asetpts=PTS-STARTPTS"] : []),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        ...(hasAudio ? ["-c:a", "aac", "-b:a", "128k"] : []),
        "-threads",
        "2",
        "-f",
        "mpegts",
        segmentPath,
      ],
      timeoutWithinDeadline(IHTX_TIMEOUT_MS, deadlineAt),
    );
    segmentPaths.push(segmentPath);
    currentInputPath = segmentPath;
  }

  await onProgress?.("IHTX: joining progressive segments…");
  const concatListPath = join(directory, "ihtx-concat.txt");
  await writeFile(
    concatListPath,
    segmentPaths
      .map((path) => `file '${path.replaceAll("'", "'\\''")}'`)
      .join("\n"),
  );
  await runProcess(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatListPath,
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
    timeoutWithinDeadline(IHTX_TIMEOUT_MS, deadlineAt),
  );
}
