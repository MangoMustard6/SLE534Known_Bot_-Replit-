import { join } from "node:path";
import { runProcess } from "./process-runner.js";
import type { VideoEffect } from "./video-filters.js";

type ModulatedHueEffect = Extract<
  VideoEffect,
  { name: "hue"; mode: "modulate" }
>;

export async function generateHueClut(
  effect: ModulatedHueEffect,
  directory: string,
  effectIndex: number,
): Promise<string> {
  const outputPath = join(directory, `hue-clut-${effectIndex}.ppm`);
  const modulatedHue = effect.hue * 200 + 100;
  const modulatedSaturation =
    effect.saturation * (effect.betterfully ? 125 : 100);
  const modulatedLightness = effect.lightness * 100;
  const args = [
    "hald:6",
    "-define",
    `modulate:colorspace=${effect.colorspace}`,
    "-modulate",
    `${modulatedLightness},${modulatedSaturation},${modulatedHue}`,
  ];

  if (effect.betterfully) {
    args.push(
      "-colorspace",
      "hsl",
      "-channel",
      "r",
      "-fx",
      "round(u*6)/6",
      "+channel",
      "-colorspace",
      "srgb",
    );
  }

  args.push(outputPath);
  await runProcess("magick", args, 60_000);
  return outputPath;
}
