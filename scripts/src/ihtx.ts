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

export interface IhtxPlusCommand {
  exports: number;
  durationExpression: string;
  noTrim: boolean;
  outputFormat: "mp4" | "mov" | "mkv" | "avi" | "webm" | "mxf";
  ffmpegArguments: string[];
}

export interface IhtxRenderOptions {
  noTrim?: boolean;
  reverseJoin?: boolean;
  ffmpegArguments?: string[];
  outputFormat?: IhtxPlusCommand["outputFormat"];
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

function evaluateArithmetic(
  expression: string,
  variables: Record<string, number> = {},
): number {
  const tokens: string[] = [];
  const matcher =
    /\s*(?:(\d+(?:\.\d*)?|\.\d+)|(\$(?:\{[a-z]+\}|[a-z]+)|[a-z]+)|(.))/iy;
  let position = 0;
  while (position < expression.length) {
    if (/^\s*$/.test(expression.slice(position))) break;
    matcher.lastIndex = position;
    const match = matcher.exec(expression);
    if (!match) throw new Error("Invalid arithmetic expression.");
    const [, number, identifier, symbol] = match;
    if (number !== undefined) tokens.push(number);
    else if (identifier !== undefined) {
      const name = identifier
        .toLowerCase()
        .replace(/^\$?\{?/, "")
        .replace(/\}?$/, "");
      if (!/^[a-z]+$/.test(name)) {
        throw new Error("Invalid variable in arithmetic expression.");
      }
      tokens.push(name);
    }
    else if (symbol && "+-*/%()".includes(symbol)) tokens.push(symbol);
    else throw new Error("Invalid character in arithmetic expression.");
    position = matcher.lastIndex;
  }

  let index = 0;
  const parseExpression = (): number => {
    let value = parseTerm();
    while (tokens[index] === "+" || tokens[index] === "-") {
      const operator = tokens[index++];
      const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  };
  const parseTerm = (): number => {
    let value = parseUnary();
    while (
      tokens[index] === "*" ||
      tokens[index] === "/" ||
      tokens[index] === "%"
    ) {
      const operator = tokens[index++];
      const right = parseUnary();
      if ((operator === "/" || operator === "%") && right === 0) {
        throw new Error("Cannot divide by zero in an arithmetic expression.");
      }
      value =
        operator === "*"
          ? value * right
          : operator === "/"
            ? value / right
            : value % right;
    }
    return value;
  };
  const parseUnary = (): number => {
    if (tokens[index] === "+" || tokens[index] === "-") {
      const operator = tokens[index++];
      const value = parseUnary();
      return operator === "-" ? -value : value;
    }
    return parsePrimary();
  };
  const parsePrimary = (): number => {
    const token = tokens[index++];
    if (token === "(") {
      const value = parseExpression();
      if (tokens[index++] !== ")") {
        throw new Error("Unbalanced parentheses in arithmetic expression.");
      }
      return value;
    }
    if (token && (/^\d/.test(token) || /^\./.test(token))) {
      return Number(token);
    }
    if (token && Object.hasOwn(variables, token)) return variables[token]!;
    throw new Error("Unknown or missing value in arithmetic expression.");
  };

  if (tokens.length === 0) throw new Error("Arithmetic expression is empty.");
  const result = parseExpression();
  if (index !== tokens.length || !Number.isFinite(result)) {
    throw new Error("Arithmetic expression must have a finite numeric result.");
  }
  return result;
}

export function resolveIhtxPlusDuration(
  command: IhtxPlusCommand,
  inputDurationSeconds: number,
): number {
  const seconds = evaluateArithmetic(command.durationExpression, {
    vidlen: inputDurationSeconds,
  });
  if (!Number.isFinite(seconds) || seconds < 0.1) {
    throw new Error("IHTXPlus duration must resolve to at least 0.1 seconds.");
  }
  return seconds;
}

function readIhtxPlusArgument(
  input: string,
  offset: number,
): { value: string; nextOffset: number } | undefined {
  let start = offset;
  while (/\s/.test(input[start] ?? "")) start += 1;
  if (start >= input.length) return undefined;

  if (input.startsWith("$((", start)) {
    const expressionStart = start + 3;
    let nestedParentheses = 0;
    for (let index = expressionStart; index < input.length; index += 1) {
      if (input[index] === "(") {
        nestedParentheses += 1;
      } else if (input[index] === ")") {
        if (nestedParentheses > 0) {
          nestedParentheses -= 1;
        } else if (input[index + 1] === ")") {
          return {
            value: input.slice(expressionStart, index).trim(),
            nextOffset: index + 2,
          };
        }
      }
    }
    throw new Error("Unbalanced Bash arithmetic expansion in IHTXPlus.");
  }

  let end = start;
  while (end < input.length && !/\s/.test(input[end]!)) end += 1;
  return { value: input.slice(start, end), nextOffset: end };
}

function tokenizeFfmpegArguments(input: string): string[] {
  const args: string[] = [];
  let value = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  let started = false;

  const push = () => {
    if (started) args.push(value);
    value = "";
    started = false;
  };

  for (const character of input) {
    if (escaped) {
      value += character;
      started = true;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
      started = true;
    } else if (quote) {
      if (character === quote) quote = undefined;
      else value += character;
      started = true;
    } else if (character === "'" || character === '"') {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      push();
    } else if (character === "\0") {
      throw new Error("IHTXPlus FFmpeg options cannot contain null characters.");
    } else {
      value += character;
      started = true;
    }
  }

  if (escaped || quote) {
    throw new Error("IHTXPlus FFmpeg options contain an unfinished quote or escape.");
  }
  push();
  if (args.length === 0) {
    throw new Error("Add FFmpeg options after the IHTXPlus command settings.");
  }
  return args;
}

export function parseIhtxPlusCommand(input: string): IhtxPlusCommand {
  const normalizedInput = input.trim();
  const exportsArgument = readIhtxPlusArgument(normalizedInput, 0);
  const durationArgument = exportsArgument
    ? readIhtxPlusArgument(normalizedInput, exportsArgument.nextOffset)
    : undefined;
  const noTrimArgument = durationArgument
    ? readIhtxPlusArgument(normalizedInput, durationArgument.nextOffset)
    : undefined;
  const rawFfmpegArguments = noTrimArgument
    ? normalizedInput.slice(noTrimArgument.nextOffset).trim()
    : "";
  if (
    !exportsArgument?.value ||
    !durationArgument?.value ||
    !noTrimArgument?.value ||
    !rawFfmpegArguments
  ) {
    throw new Error(
      'Use `534!ihtxplus <exports> <duration-expression> <no-trim> [format=mp4|mov|mkv|avi|webm|mxf] <FFmpeg options>`, for example `534!ihtxplus -4 2 false -vf "eq=contrast=1.2"`.',
    );
  }
  const rawExports = exportsArgument.value;
  const rawDuration = durationArgument.value;
  const rawNoTrim = noTrimArgument.value;

  let exports: number;
  try {
    exports = evaluateArithmetic(rawExports);
  } catch {
    throw new Error("IHTXPlus exports must be a finite arithmetic expression.");
  }
  if (!Number.isSafeInteger(exports) || exports === 0) {
    throw new Error("IHTXPlus exports must resolve to a non-zero whole number.");
  }

  let sampleDuration: number;
  try {
    sampleDuration = evaluateArithmetic(rawDuration, { vidlen: 1 });
  } catch {
    throw new Error(
      "IHTXPlus duration must be seconds or an arithmetic expression using vidlen.",
    );
  }
  if (!Number.isFinite(sampleDuration) || sampleDuration < 0.1) {
    throw new Error("IHTXPlus duration must resolve to at least 0.1 seconds.");
  }

  const noTrimValue = rawNoTrim.toLowerCase();
  const trueValues = new Set(["1", "true", "t", "y", "yes", "+", "on"]);
  const falseValues = new Set(["0", "false", "f", "n", "no", "-", "off"]);
  if (!trueValues.has(noTrimValue) && !falseValues.has(noTrimValue)) {
    throw new Error("IHTXPlus no-trim must be true or false.");
  }

  let outputFormat: IhtxPlusCommand["outputFormat"] = "mp4";
  let ffmpegInput = rawFfmpegArguments;
  const formatMatch =
    /^format=(default|mp4|mov|mkv|avi|webm|mxf)\s+([\s\S]+)$/i.exec(
    rawFfmpegArguments,
    );
  if (formatMatch) {
    outputFormat =
      formatMatch[1]?.toLowerCase() === "default"
        ? "mp4"
        : (formatMatch[1]?.toLowerCase() as IhtxPlusCommand["outputFormat"]);
    ffmpegInput = formatMatch[2]!;
  }

  return {
    exports,
    durationExpression: rawDuration,
    noTrim: trueValues.has(noTrimValue),
    outputFormat,
    ffmpegArguments: tokenizeFfmpegArguments(ffmpegInput),
  };
}

export async function renderIhtx(
  inputPath: string,
  outputPath: string,
  directory: string,
  hasAudio: boolean,
  command: IhtxCommand,
  onProgress?: IhtxProgressCallback,
  options: IhtxRenderOptions = {},
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
        ...(options.noTrim
          ? {}
          : { inputDurationSeconds: command.segmentSeconds }),
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
        options.noTrim ? undefined : command.segmentSeconds,
        options.ffmpegArguments,
      ),
      timeoutWithinDeadline(IHTX_TIMEOUT_MS, deadlineAt),
    );

    if (options.noTrim) {
      await onProgress?.(
        `IHTX: preserving full export ${power}/${command.powers}…`,
      );
      await runProcess(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-i",
          renderedPath,
          "-map",
          "0:v:0",
          "-map",
          "0:a?",
          "-c",
          "copy",
          "-f",
          "mpegts",
          segmentPath,
        ],
        timeoutWithinDeadline(IHTX_TIMEOUT_MS, deadlineAt),
      );
      segmentPaths.push(segmentPath);
      currentInputPath = segmentPath;
      continue;
    }

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
    (options.reverseJoin ? [...segmentPaths].reverse() : segmentPaths)
      .map((path) => `file '${path.replaceAll("'", "'\\''")}'`)
      .join("\n"),
  );
  const format =
    options.outputFormat ??
    (outputPath.toLowerCase().endsWith(".mkv") ? "mkv" : "mp4");
  const transcodeOutput = format === "avi" || format === "webm" || format === "mxf";
  const concatOutputPath = transcodeOutput
    ? join(directory, "ihtx-concatenated.ts")
    : outputPath;
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
      ...(format === "mp4" || format === "mov"
        ? ["-movflags", "+faststart"]
        : []),
      concatOutputPath,
    ],
    timeoutWithinDeadline(IHTX_TIMEOUT_MS, deadlineAt),
  );

  if (transcodeOutput) {
    const outputCodecArguments =
      format === "webm"
        ? [
            "-c:v",
            "libvpx-vp9",
            "-deadline",
            "realtime",
            "-cpu-used",
            "5",
            "-crf",
            "32",
            "-b:v",
            "0",
            "-c:a",
            "libopus",
            "-b:a",
            "128k",
            "-f",
            "webm",
          ]
        : format === "avi"
          ? [
              "-c:v",
              "mpeg4",
              "-q:v",
              "4",
              "-c:a",
              "libmp3lame",
              "-b:a",
              "192k",
              "-f",
              "avi",
            ]
          : [
              "-c:v",
              "mpeg2video",
              "-r",
              "25",
              "-q:v",
              "4",
              "-pix_fmt",
              "yuv420p",
              "-c:a",
              "pcm_s16le",
              "-ar",
              "48000",
              "-f",
              "mxf",
            ];
    await onProgress?.(`IHTX: encoding final ${format.toUpperCase()} output…`);
    await runProcess(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        concatOutputPath,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        ...outputCodecArguments,
        "-threads",
        "2",
        outputPath,
      ],
      timeoutWithinDeadline(IHTX_TIMEOUT_MS, deadlineAt),
    );
  }
}
