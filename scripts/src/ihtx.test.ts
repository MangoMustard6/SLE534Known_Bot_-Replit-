import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseIhtxCommand,
  parseIhtxPlusCommand,
  renderIhtx,
  resolveIhtxPlusDuration,
} from "./ihtx.js";
import { runProcess } from "./process-runner.js";
import { buildFfmpegArguments } from "./video-filters.js";

test("IHTX accepts 100 pitch layers per effect across multiple powers", () => {
  const pitches = Array.from({ length: 100 }, (_, index) =>
    String((index % 49) - 24),
  ).join(";");
  const command = parseIhtxCommand(
    `0.1 25 pitch=${pitches}|pitch=${pitches}`,
  );

  assert.equal(command.powers, 25);
  assert.equal(command.effects.length, 2);
  assert.equal(command.effects[0]?.name, "pitch");
  assert.equal(command.effects[1]?.name, "pitch");
});

test("IHTXPlus parses signed exports, vidlen, no-trim, and quoted FFmpeg options", () => {
  const command = parseIhtxPlusCommand(
    '-4 vidlen true -vf "drawbox=x=1:y=2:w=30:h=20:color=red@0.5:t=fill"',
  );

  assert.equal(command.exports, -4);
  assert.equal(command.durationExpression, "vidlen");
  assert.equal(resolveIhtxPlusDuration(command, 12), 12);
  assert.equal(command.noTrim, true);
  assert.deepEqual(command.ffmpegArguments, [
    "-vf",
    "drawbox=x=1:y=2:w=30:h=20:color=red@0.5:t=fill",
  ]);
});

test("IHTXPlus evaluates arithmetic safely for exports and duration", () => {
  const command = parseIhtxPlusCommand(
    "-(2+2) vidlen/2 false format=mxf -vf hflip",
  );

  assert.equal(command.exports, -4);
  assert.equal(resolveIhtxPlusDuration(command, 12), 6);
  assert.equal(command.outputFormat, "mxf");
});

test("IHTXPlus does not expand shell syntax in FFmpeg arguments", () => {
  const command = parseIhtxPlusCommand(
    '1 2 false -vf "$(touch /tmp/534-should-not-exist)"',
  );

  assert.deepEqual(command.ffmpegArguments, [
    "-vf",
    "$(touch /tmp/534-should-not-exist)",
  ]);
});

test("IHTXPlus rejects zero exports, short durations, and unbalanced quoting", () => {
  assert.throws(() => parseIhtxPlusCommand("0 2 false -vf negate"));
  assert.throws(() => parseIhtxPlusCommand("1 0.05 false -vf negate"));
  assert.throws(() => parseIhtxPlusCommand('1 2 false -vf "negate'));
});

test("custom FFmpeg options are appended before the bot-controlled output path", () => {
  const args = buildFfmpegArguments(
    "input.mp4",
    "output.mp4",
    [],
    undefined,
    [],
    undefined,
    ["-vf", "eq=contrast=1.2"],
  );

  assert.equal(args.at(-1), "output.mp4");
  assert.ok(args.includes("-filter_complex"));
  assert.ok(args.some((argument) => argument.includes("eq=contrast=1.2")));
  assert.ok(!args.includes("-vf"));
});

test("IHTXPlus renders trimmed and full-length exports with custom FFmpeg options", async () => {
  const directory = await mkdtemp(join(tmpdir(), "534-ihtxplus-test-"));
  try {
    const inputPath = join(directory, "input.mp4");
    await runProcess(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=96x64:rate=10",
        "-t",
        "0.6",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        inputPath,
      ],
      30_000,
    );

    for (const [name, plusInput, expectedDuration] of [
      ["trimmed", "2 0.3 false -vf hflip", 0.6],
      ["full", "-2 vidlen true format=mkv -vf hflip", 1.2],
      ["webm", "1 0.6 false format=webm -vf hflip", 0.6],
      ["avi", "1 0.6 false format=avi -vf hflip", 0.6],
      ["mxf", "1 0.6 false format=mxf -vf hflip", 0.6],
    ] as const) {
      const plus = parseIhtxPlusCommand(plusInput);
      const outputPath = join(directory, `${name}.${plus.outputFormat}`);
      await renderIhtx(
        inputPath,
        outputPath,
        directory,
        false,
        {
          segmentSeconds:
            resolveIhtxPlusDuration(plus, 0.6),
          powers: Math.abs(plus.exports),
          effectInput: "",
          effects: [],
        },
        undefined,
        {
          noTrim: plus.noTrim,
          reverseJoin: plus.exports < 0,
          outputFormat: plus.outputFormat,
          ffmpegArguments: plus.ffmpegArguments,
        },
      );
      const { stdout } = await runProcess(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "default=noprint_wrappers=1:nokey=1",
          outputPath,
        ],
        15_000,
      );
      assert.ok(
        Math.abs(Number(stdout.trim()) - expectedDuration) < 0.3,
        `${name} output duration was ${stdout.trim()} seconds`,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
