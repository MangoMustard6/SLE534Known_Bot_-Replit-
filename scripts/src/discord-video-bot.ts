import {
  AttachmentBuilder,
  Client,
  GatewayIntentBits,
  Partials,
  type Message,
} from "discord.js";
import { open, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { processAudioEffects } from "./audio-processing.js";
import { generateHueClut } from "./hue-clut.js";
import { runProcess } from "./process-runner.js";
import { buildFfmpegArguments, parseEffectChain } from "./video-filters.js";

const PREFIX = "534!";
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 25 * 1024 * 1024;
const MAX_DURATION_SECONDS = 180;
const MAX_CONCURRENT_JOBS = 2;
const ALLOWED_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".mkv",
  ".avi",
  ".3gp",
  ".wmv",
]);

let activeJobs = 0;

function usageMessage(): string {
  return [
    "Attach a video and use `534!edit` followed by effects separated with `|`.",
    "",
    "Effects: `grayscale`, `speed`, `sepia`, `hue`, `pitch`, `mirrorhl`, `mirrorhr`",
    "`speed` defaults to 1.5x; set it with `speed=2` (0.25–4).",
    "`hue` uses Hald CLUT modulation; bare `hue` is neutral. Set it with `hue=0.1;1.2;1;hsl;true` (hue -0.5–0.5, saturation/lightness 0–10x, hsl or hsv, optional betterfully rounding).",
    "`pitch=+3;0;-3` mixes three pitch-shifted audio layers using Rubber Band's R3 finer engine (semitones, -24 to +24).",
    "Output: `.mov` with FFV1 video and PCM s16le audio.",
    "",
    "Example: `534!edit grayscale|pitch=+3;0;-3|speed=1.25`",
  ].join("\n");
}

async function downloadAttachment(url: string, destination: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body) {
    throw new Error("I couldn't download that attachment. Please try again.");
  }

  const statedSize = Number(response.headers.get("content-length") ?? 0);
  if (statedSize > MAX_VIDEO_BYTES) {
    throw new Error("Videos must be 25 MB or smaller.");
  }

  const file = await open(destination, "w");
  let received = 0;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.byteLength;
      if (received > MAX_VIDEO_BYTES) {
        throw new Error("Videos must be 25 MB or smaller.");
      }
      await file.write(chunk);
    }
  } finally {
    await file.close();
  }
}

async function validateVideo(inputPath: string): Promise<boolean> {
  const { stdout: streamType } = await runProcess(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "csv=p=0",
      inputPath,
    ],
    15_000,
  );
  if (streamType.trim() !== "video") {
    throw new Error("That attachment doesn't contain a readable video.");
  }

  const { stdout: durationOutput } = await runProcess(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      inputPath,
    ],
    15_000,
  );
  const duration = Number(durationOutput.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("I couldn't read the duration of that video.");
  }
  if (duration > MAX_DURATION_SECONDS) {
    throw new Error("Videos must be 3 minutes or shorter.");
  }

  const { stdout: audioStreamType } = await runProcess(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "csv=p=0",
      inputPath,
    ],
    15_000,
  );
  return audioStreamType.trim() === "audio";
}

function isVideoAttachment(attachment: {
  contentType: string | null;
  name: string;
}): boolean {
  return (
    attachment.contentType?.startsWith("video/") === true ||
    ALLOWED_EXTENSIONS.has(extname(attachment.name).toLowerCase())
  );
}

async function editAttachment(
  attachment: {
    url: string;
    name: string;
  },
  effectInput: string,
): Promise<{ path: string; directory: string }> {
  const effects = parseEffectChain(effectInput);
  const directory = await mkdtemp(join(tmpdir(), "534-video-edit-"));
  const extension = extname(attachment.name).toLowerCase() || ".video";
  const inputPath = join(directory, `input${extension}`);
  const outputPath = join(directory, "edited.mov");

  try {
    await downloadAttachment(attachment.url, inputPath);
    const hasAudio = await validateVideo(inputPath);
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
    );
    await runProcess(
      "ffmpeg",
      buildFfmpegArguments(
        inputPath,
        outputPath,
        effects,
        processedAudioPath,
        hueClutPaths,
      ),
      240_000,
    );

    const outputSize = (await stat(outputPath)).size;
    if (outputSize > MAX_OUTPUT_BYTES) {
      throw new Error("The edited video is over Discord's 25 MB upload limit.");
    }

    return { path: outputPath, directory };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  throw new Error(
    "DISCORD_BOT_TOKEN is missing. Add it to the project's Replit Secrets.",
  );
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

client.once("clientReady", (readyClient) => {
  console.info(`534 video bot is online as ${readyClient.user.tag}.`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;

  const commandText = message.content.slice(PREFIX.length).trim();
  const [command, ...remaining] = commandText.split(/\s+/);
  if (command?.toLowerCase() !== "edit") {
    if (command?.toLowerCase() === "help") {
      await message.reply(usageMessage());
    }
    return;
  }

  const effectInput = remaining.join(" ").trim();
  if (!effectInput) {
    await message.reply(usageMessage());
    return;
  }

  let effects: ReturnType<typeof parseEffectChain>;
  try {
    effects = parseEffectChain(effectInput);
  } catch (error) {
    await message.reply(
      error instanceof Error ? error.message : "I couldn't read that effect chain.",
    );
    return;
  }

  const attachment = message.attachments.find(isVideoAttachment);
  if (!attachment) {
    await message.reply("Attach a video file to the `534!edit` message.");
    return;
  }
  if (attachment.size > MAX_VIDEO_BYTES) {
    await message.reply("Videos must be 25 MB or smaller.");
    return;
  }
  if (activeJobs >= MAX_CONCURRENT_JOBS) {
    await message.reply("I'm processing two videos right now. Please try again shortly.");
    return;
  }

  activeJobs += 1;
  let workDirectory: string | undefined;
  let status: Message | undefined;

  try {
    status = await message.reply("Editing your video…");
    const result = await editAttachment(attachment, effectInput);
    workDirectory = result.directory;
    const file = new AttachmentBuilder(result.path, { name: "edited.mov" });
    await status.edit({
      content: `Done. Applied: ${effects.map((effect) => effect.name).join(" → ")}`,
      files: [file],
    });
  } catch (error) {
    console.error(
      "Video edit failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    const failureMessage =
      error instanceof Error
        ? error.message
        : "The video couldn't be edited. Please check the file and try again.";
    if (status) {
      await status.edit({ content: failureMessage }).catch(() => undefined);
    } else {
      await message.reply(failureMessage).catch(() => undefined);
    }
  } finally {
    activeJobs -= 1;
    if (workDirectory) {
      await rm(workDirectory, { recursive: true, force: true });
    }
  }
});

client.on("error", (error) => {
  console.error("Discord client error:", error.message);
});

client.login(token).catch((error: unknown) => {
  console.error(
    "Discord login failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
});
