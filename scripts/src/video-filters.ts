export type VideoEffect =
  | { name: "grayscale" }
  | { name: "sepia" }
  | { name: "speed"; value: number }
  | { name: "hue"; mode: "rotate"; value: number }
  | {
      name: "hue";
      mode: "modulate";
      hue: number;
      saturation: number;
      lightness: number;
      colorspace: "hsl" | "hsv";
      betterfully: boolean;
    }
  | { name: "pitch"; pitches: [number, number, number] }
  | { name: "mirrorhl" }
  | { name: "mirrorhr" };

const DEFAULT_SPEED = 1.5;
const DEFAULT_HUE = 90;
const MAX_EFFECTS = 8;

function parseModulateHue(
  rawValue: string,
): Extract<VideoEffect, { name: "hue"; mode: "modulate" }> {
  const values = rawValue.split(";").map((value) => value.trim());
  if (values.length < 2 || values.length > 5) {
    throw new Error(
      "Use hue=<degrees> or hue=<normalizedHue>;<saturation>;<lightness>;<colorspace>[;<betterfully>].",
    );
  }

  const [rawHue, rawSaturation, rawLightness, rawColorspace, rawBetterfully] =
    values;
  if (!rawHue) {
    throw new Error("The modulated hue value must be between -0.5 and 0.5.");
  }

  const hue = Number(rawHue);
  if (!Number.isFinite(hue) || hue < -0.5 || hue > 0.5) {
    throw new Error("The modulated hue value must be between -0.5 and 0.5.");
  }

  const parseMultiplier = (raw: string | undefined, name: string) => {
    const value = raw ? Number(raw) : 1;
    if (!Number.isFinite(value) || value < 0 || value > 10) {
      throw new Error(`${name} must be a multiplier between 0 and 10.`);
    }
    return value;
  };

  const saturation = parseMultiplier(rawSaturation, "Saturation");
  const lightness = parseMultiplier(rawLightness, "Lightness");
  const colorspace = rawColorspace || "hsl";
  if (colorspace !== "hsl" && colorspace !== "hsv") {
    throw new Error("Hue colorspace must be hsl or hsv.");
  }

  const trueValues = new Set(["1", "true", "t", "y", "yes", "+", "on"]);
  const falseValues = new Set(["0", "false", "f", "n", "no", "-", "off"]);
  const betterfullyValue = rawBetterfully?.toLowerCase();
  if (
    betterfullyValue &&
    !trueValues.has(betterfullyValue) &&
    !falseValues.has(betterfullyValue)
  ) {
    throw new Error("betterfully must be a true or false value.");
  }

  return {
    name: "hue",
    mode: "modulate",
    hue,
    saturation,
    lightness,
    colorspace,
    betterfully: betterfullyValue
      ? trueValues.has(betterfullyValue)
      : false,
  };
}

export function parseEffectChain(input: string): VideoEffect[] {
  const parts = input.split("|").map((part) => part.trim().toLowerCase());

  if (parts.length === 0 || parts.some((part) => part.length === 0)) {
    throw new Error("Separate effects with | and do not leave an effect blank.");
  }
  if (parts.length > MAX_EFFECTS) {
    throw new Error(`Use no more than ${MAX_EFFECTS} effects in one edit.`);
  }

  return parts.map((part) => {
    const match = /^([a-z]+)(?:([=:])(.*))?$/.exec(part);
    if (!match) {
      throw new Error(`I don't recognize the effect "${part}".`);
    }

    const [, name, separator, rawValue] = match;
    if (
      name === "grayscale" ||
      name === "sepia" ||
      name === "mirrorhl" ||
      name === "mirrorhr"
    ) {
      if (rawValue !== undefined) {
        throw new Error(`The ${name} effect does not take a value.`);
      }
      switch (name) {
        case "grayscale":
          return { name: "grayscale" };
        case "sepia":
          return { name: "sepia" };
        case "mirrorhl":
          return { name: "mirrorhl" };
        case "mirrorhr":
          return { name: "mirrorhr" };
      }
    }

    if (name === "pitch") {
      if (separator !== "=" || rawValue === undefined) {
        throw new Error("Use pitch=<first>;<second>;<third> for pitch layers.");
      }
      const rawPitches = rawValue.split(";");
      if (rawPitches.length !== 3) {
        throw new Error("Pitch requires exactly three semitone values separated by semicolons.");
      }

      const pitches = rawPitches.map((rawPitch) => {
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(rawPitch)) {
          throw new Error("Each pitch value must be a number of semitones.");
        }
        const pitch = Number(rawPitch);
        if (!Number.isFinite(pitch) || pitch < -24 || pitch > 24) {
          throw new Error("Each pitch shift must be between -24 and 24 semitones.");
        }
        return pitch;
      }) as [number, number, number];
      return { name, pitches };
    }

    if (name === "speed") {
      if (rawValue === "") {
        throw new Error("Speed needs a value between 0.25 and 4.0.");
      }
      const value = rawValue === undefined ? DEFAULT_SPEED : Number(rawValue);
      if (!Number.isFinite(value) || value < 0.25 || value > 4) {
        throw new Error("Speed must be between 0.25 and 4.0.");
      }
      return { name, value };
    }

    if (name === "hue") {
      if (rawValue === "") {
        throw new Error("Hue needs a value between -360 and 360 degrees.");
      }
      if (rawValue?.includes(";")) {
        return parseModulateHue(rawValue);
      }
      const value =
        rawValue === undefined ? DEFAULT_HUE : Number(rawValue.trim());
      if (!Number.isFinite(value) || value < -360 || value > 360) {
        throw new Error("Hue must be between -360 and 360 degrees.");
      }
      return { name, mode: "rotate", value };
    }

    throw new Error(
      `Unknown effect "${name}". Use grayscale, speed, sepia, hue, pitch, mirrorhl, or mirrorhr.`,
    );
  });
}

function audioTempoFilters(speed: number): string[] {
  const filters: string[] = [];
  let remaining = speed;

  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }
  while (remaining > 2) {
    filters.push("atempo=2");
    remaining /= 2;
  }

  filters.push(`atempo=${Number(remaining.toFixed(6))}`);
  return filters;
}

export function buildAudioTempoFilter(speed: number): string {
  return audioTempoFilters(speed).join(",");
}

export function buildFfmpegArguments(
  inputPath: string,
  outputPath: string,
  effects: VideoEffect[],
  processedAudioPath?: string,
  hueClutPaths: string[] = [],
): string[] {
  const expectedHueCluts = effects.filter(
    (effect) => effect.name === "hue" && effect.mode === "modulate",
  ).length;
  if (hueClutPaths.length !== expectedHueCluts) {
    throw new Error(
      `Expected ${expectedHueCluts} generated hue CLUT file(s), received ${hueClutPaths.length}.`,
    );
  }

  const graph: string[] = [];
  let currentLabel = "0:v";
  let labelIndex = 0;
  let hueClutIndex = 0;

  const addFilter = (filter: string) => {
    const nextLabel = `v${labelIndex++}`;
    graph.push(`[${currentLabel}]${filter}[${nextLabel}]`);
    currentLabel = nextLabel;
  };

  for (const effect of effects) {
    switch (effect.name) {
      case "grayscale":
        addFilter("hue=s=0");
        break;
      case "sepia":
        addFilter(
          "colorchannelmixer=rr=0.393:rg=0.769:rb=0.189:gr=0.349:gg=0.686:gb=0.168:br=0.272:bg=0.534:bb=0.131",
        );
        break;
      case "speed":
        addFilter(`setpts=PTS/${effect.value}`);
        break;
      case "hue":
        if (effect.mode === "rotate") {
          addFilter(`hue=h=${effect.value}`);
        } else {
          const nextLabel = `v${labelIndex++}`;
          const clutInputIndex =
            1 + Number(Boolean(processedAudioPath)) + hueClutIndex++;
          graph.push(
            `[${currentLabel}][${clutInputIndex}:v]haldclut=interp=tetrahedral[${nextLabel}]`,
          );
          currentLabel = nextLabel;
        }
        break;
      case "pitch":
        break;
      case "mirrorhl":
      case "mirrorhr": {
        const index = labelIndex++;
        const half = `half${index}`;
        const keep = `keep${index}`;
        const flipInput = `flipInput${index}`;
        const flipped = `flipped${index}`;
        const nextLabel = `v${labelIndex++}`;
        const cropX = effect.name === "mirrorhl" ? "0" : "iw/2";

        graph.push(`[${currentLabel}]crop=iw/2:ih:${cropX}:0[${half}]`);
        graph.push(`[${half}]split=2[${keep}][${flipInput}]`);
        graph.push(`[${flipInput}]hflip[${flipped}]`);
        const halves =
          effect.name === "mirrorhl"
            ? `[${keep}][${flipped}]`
            : `[${flipped}][${keep}]`;
        graph.push(`${halves}hstack=inputs=2[${nextLabel}]`);
        currentLabel = nextLabel;
        break;
      }
    }
  }

  const paddedLabel = `v${labelIndex}`;
  graph.push(
    `[${currentLabel}]pad=ceil(iw/2)*2:ceil(ih/2)*2[${paddedLabel}]`,
  );

  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    inputPath,
  ];

  if (processedAudioPath) {
    args.push("-i", processedAudioPath);
  }
  args.push(...hueClutPaths.flatMap((path) => ["-i", path]));

  args.push(
    "-filter_complex_threads",
    "2",
    "-filter_complex",
    graph.join(";"),
    "-map",
    `[${paddedLabel}]`,
    "-map",
    processedAudioPath ? "1:a:0" : "0:a?",
  );

  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-threads",
    "2",
    outputPath,
  );

  return args;
}
