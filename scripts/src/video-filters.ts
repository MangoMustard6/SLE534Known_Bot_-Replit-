export type VideoEffect =
  | { name: "grayscale" }
  | { name: "invert" }
  | { name: "sepia" }
  | { name: "speed"; value: number }
  | {
      name: "hue";
      mode: "modulate";
      hue: number;
      saturation: number;
      lightness: number;
      colorspace: "hsl" | "hsv";
      betterfully: boolean;
    }
  | { name: "pitch"; pitches: number[] }
  | {
      name: "swirl";
      strength: number;
      xScale: number;
      yScale: number;
      xCenter: number;
      yCenter: number;
      linearFallout: boolean;
    }
  | { name: "mirrorhl" }
  | { name: "mirrorhr" };

const DEFAULT_SPEED = 1.5;

function parseModulateHue(
  rawValue?: string,
): Extract<VideoEffect, { name: "hue"; mode: "modulate" }> {
  const values = rawValue?.split(";").map((value) => value.trim()) ?? [];
  if (values.length > 5) {
    throw new Error(
      "Use hue=<normalizedHue>[;<saturation>;<lightness>;<colorspace>[;<betterfully>]].",
    );
  }

  const [rawHue, rawSaturation, rawLightness, rawColorspace, rawBetterfully] =
    values;
  const hue = rawHue ? Number(rawHue) : 0;
  if (!Number.isFinite(hue) || hue < -0.5 || hue > 0.5) {
    throw new Error("Hue must be a normalized offset between -0.5 and 0.5.");
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

  return parts.map((part) => {
    const match = /^([a-z]+)(?:([=:])(.*))?$/.exec(part);
    if (!match) {
      throw new Error(`I don't recognize the effect "${part}".`);
    }

    const [, name, separator, rawValue] = match;
    if (
      name === "grayscale" ||
      name === "invert" ||
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
        case "invert":
          return { name: "invert" };
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
        throw new Error("Use pitch=<semitone>[;<semitone>...], with 1 to 100 values.");
      }
      const rawPitches = rawValue.split(";").map((value) => value.trim());
      if (rawPitches.length < 1 || rawPitches.length > 100) {
        throw new Error("Pitch accepts between 1 and 100 semitone values.");
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
      });
      return { name, pitches };
    }

    if (name === "swirl") {
      if (separator !== "=" || rawValue === undefined) {
        throw new Error(
          "Use swirl=<strength>[;<x-scale>;<y-scale>;<x-center>;<y-center>[;<linear-fallout>]].",
        );
      }
      const values = rawValue.split(";").map((value) => value.trim());
      if (values.length > 6 || !values[0]) {
        throw new Error(
          "Use swirl=<strength>[;<x-scale>;<y-scale>;<x-center>;<y-center>[;<linear-fallout>]].",
        );
      }
      const parseSwirlNumber = (
        raw: string | undefined,
        fallback: number,
        label: string,
      ) => {
        if (raw === undefined || raw === "") return fallback;
        const value = Number(raw);
        if (!Number.isFinite(value)) {
          throw new Error(`Swirl ${label} must be a finite number.`);
        }
        return value;
      };
      const strength = parseSwirlNumber(values[0], 0, "strength");
      const xScale = parseSwirlNumber(values[1], 0.5, "x-scale");
      const yScale = parseSwirlNumber(values[2], 0.5, "y-scale");
      const xCenter = parseSwirlNumber(values[3], 0.5, "x-center");
      const yCenter = parseSwirlNumber(values[4], 0.5, "y-center");
      if (xScale <= 0 || yScale <= 0) {
        throw new Error("Swirl x-scale and y-scale must be greater than zero.");
      }

      const trueValues = new Set(["1", "true", "t", "y", "yes", "+", "on"]);
      const falseValues = new Set(["0", "false", "f", "n", "no", "-", "off"]);
      const linearValue = values[5]?.toLowerCase();
      if (
        linearValue &&
        !trueValues.has(linearValue) &&
        !falseValues.has(linearValue)
      ) {
        throw new Error("Swirl linear-fallout must be a true or false value.");
      }
      return {
        name,
        strength,
        xScale,
        yScale,
        xCenter,
        yCenter,
        linearFallout: linearValue ? trueValues.has(linearValue) : false,
      };
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
      return parseModulateHue(rawValue);
    }

    throw new Error(
      `Unknown effect "${name}". Use grayscale, invert, speed, sepia, hue, pitch, swirl, mirrorhl, or mirrorhr.`,
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
  durationSeconds?: number,
  extraFfmpegArguments: string[] = [],
): string[] {
  const expectedHueCluts = effects.filter(
    (effect) => effect.name === "hue",
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
  const remainingFfmpegArguments: string[] = [];
  const customVideoFilters: string[] = [];
  let hasCustomComplexFilter = false;

  for (let index = 0; index < extraFfmpegArguments.length; index += 1) {
    const argument = extraFfmpegArguments[index];
    const equalsIndex = argument?.indexOf("=") ?? -1;
    const option = equalsIndex < 0 ? argument : argument?.slice(0, equalsIndex);
    const inlineValue =
      equalsIndex < 0 ? undefined : argument?.slice(equalsIndex + 1);
    if (option === "-vf" || option === "-filter:v" || option === "-filter:v:0") {
      const filter = inlineValue ?? extraFfmpegArguments[index + 1];
      if (!filter) {
        throw new Error(`${option} needs a video filter value.`);
      }
      customVideoFilters.push(filter);
      if (inlineValue === undefined) index += 1;
    } else {
      if (
        option === "-filter_complex" ||
        option === "-lavfi" ||
        option === "-filter_complex_script"
      ) {
        hasCustomComplexFilter = true;
      }
      remainingFfmpegArguments.push(argument!);
    }
  }

  if (hasCustomComplexFilter) {
    if (customVideoFilters.length > 0) {
      throw new Error(
        "Use either a custom -filter_complex graph or -vf filters, not both.",
      );
    }
    const hasMap = remainingFfmpegArguments.some(
      (argument, index) =>
        argument === "-map" ||
        argument.startsWith("-map=") ||
        (index > 0 && remainingFfmpegArguments[index - 1] === "-map"),
    );
    if (!hasMap) {
      throw new Error(
        "A custom -filter_complex graph must include an explicit -map output.",
      );
    }
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      ...(processedAudioPath ? ["-i", processedAudioPath] : []),
      ...hueClutPaths.flatMap((path) => ["-i", path]),
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
      "-threads",
      "2",
    ];
    if (durationSeconds !== undefined) {
      args.push("-t", String(durationSeconds));
    }
    args.push(...remainingFfmpegArguments);
    if (outputPath.toLowerCase().endsWith(".ts")) {
      args.push("-f", "mpegts");
    } else {
      args.push("-movflags", "+faststart");
    }
    args.push(outputPath);
    return args;
  }

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
      case "invert":
        addFilter("negate");
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
        {
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
      case "swirl": {
        const dx = `(X-W*${effect.xCenter})/${effect.xScale}`;
        const dy = `(Y-H*${effect.yCenter})/${effect.yScale}`;
        const radius = `hypot(${dx},${dy})`;
        const falloutPower = effect.linearFallout ? "" : "^2";
        const attenuation =
          `(if(lt(${radius},min(W,H)),` +
          `1-${radius}/min(W,H),0)${falloutPower})`;
        const angle =
          `(atan2((Y-H*${effect.yCenter})*${effect.xScale},` +
          `(X-W*${effect.xCenter})*${effect.yScale})+` +
          `(${effect.strength})*(PI^2)*(-255/180)*${attenuation})`;
        const x = `W*${effect.xCenter}+${radius}*cos(${angle})*${effect.xScale}`;
        const y = `H*${effect.yCenter}+${radius}*sin(${angle})*${effect.yScale}`;
        addFilter(
          `format=yuv444p16le,scale=ih:ih,geq='p(${x},${y})',scale=dar*ih:ih,setsar=1:1,format=yuv420p`,
        );
        break;
      }
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

  for (const filter of customVideoFilters) {
    const nextLabel = `v${labelIndex++}`;
    graph.push(`[${currentLabel}]${filter}[${nextLabel}]`);
    currentLabel = nextLabel;
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
  ];

  args.push("-i", inputPath);
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
    "-threads",
    "2",
  );
  if (durationSeconds !== undefined) {
    args.push("-t", String(durationSeconds));
  }
  if (outputPath.toLowerCase().endsWith(".ts")) {
    args.push("-f", "mpegts");
  } else {
    args.push("-movflags", "+faststart");
  }
  args.push(...remainingFfmpegArguments);
  args.push(outputPath);

  return args;
}
