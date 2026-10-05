export type VideoEffect =
  | { name: "grayscale" }
  | { name: "sepia" }
  | { name: "speed"; value: number }
  | { name: "hue"; value: number }
  | { name: "pitch"; pitches: [number, number, number] }
  | { name: "mirrorhl" }
  | { name: "mirrorhr" };

const DEFAULT_SPEED = 1.5;
const DEFAULT_HUE = 90;
const MAX_EFFECTS = 8;

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
    if (name === "grayscale" || name === "sepia" || name === "mirrorhl" || name === "mirrorhr") {
      if (rawValue !== undefined) {
        throw new Error(`The ${name} effect does not take a value.`);
      }
      return { name };
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
      const value = rawValue === undefined ? DEFAULT_HUE : Number(rawValue);
      if (!Number.isFinite(value) || value < -360 || value > 360) {
        throw new Error("Hue must be between -360 and 360 degrees.");
      }
      return { name, value };
    }

    throw new Error(
      `Unknown effect "${name}". Use grayscale, speed, sepia, hue, mirrorhl, or mirrorhr.`,
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
): string[] {
  const graph: string[] = [];
  let currentLabel = "0:v";
  let labelIndex = 0;

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
        addFilter(`hue=h=${effect.value}`);
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
