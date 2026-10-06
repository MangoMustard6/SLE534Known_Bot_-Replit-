# 534 Video Editing Bot

The bot uses the `534!` prefix. Attach a video to the command, or reply to a message containing a video. If both messages have a video, the command's own attachment is used.

```text
534!edit grayscale|invert|speed|sepia|hue|mirrorhl|mirrorhr
534!ihtx 2 4 invert|sepia
```

Effects are applied from left to right. Use `|` between effects.

| Effect | Behavior |
| --- | --- |
| `grayscale` | Removes color |
| `invert` | Inverts the video colors |
| `speed` | Speeds up to 1.5× by default; supports `speed=0.25` through `speed=4` |
| `sepia` | Applies a sepia tone |
| `hue` | Uses ImageMagick Hald CLUT modulation; supports `hue=<normalizedHue>[;<saturation>;<lightness>;<colorspace>[;<betterfully>]]`. |
| `pitch` | Mixes 1–100 Rubber Band R3 finer-engine pitch-shifted audio layers (`--fine` / `OptionEngineFiner`); each value is a semitone shift from -24 to +24 |
| `swirl` | Twists pixels around a normalized center; accepts `swirl=<strength>[;<x-scale>;<y-scale>;<x-center>;<y-center>[;<linear-fallout>]]` |
| `mirrorhl` | Mirrors the left half across the center |
| `mirrorhr` | Mirrors the right half across the center |

Examples:

```text
534!edit grayscale|sepia
534!edit invert|hue=0.1;1.2;1.0;hsl;true
534!edit speed=2|hue=0.1;1.2;1.0;hsl;true|mirrorhl
534!edit hue
534!edit hue=0.1;1.2;1.0;hsl;true|sepia
534!edit pitch=+3;0;-3|sepia
534!edit swirl=180;0.5;0.5;0.5;0.5;true
534!help
```

`hue` uses a normalized hue offset from -0.5 to 0.5, saturation and lightness multipliers from 0 to 10, and either `hsl` or `hsv`. The optional final `betterfully` value accepts true/false (or common equivalents) and enables stepped hue rounding. Omitted values default to zero hue offset, 1× saturation, 1× lightness, `hsl`, and false. Single-value degree rotations such as `hue=45` are no longer supported.

The `pitch` values create one separate copy of the current audio per value, shift each by its semitone amount with Rubber Band's R3 finer engine (`--fine`, corresponding to `OptionEngineFiner`), then mix all copies together without normalization. Provide between 1 and 100 values separated by semicolons. Pitch shifting preserves duration; an unnormalized mix can clip. R3 layers are processed in a bounded parallel pool, and the bot reports progress during larger mixes.

`534!ihtx <seconds> <powers> <effects>` applies the named pipe-effect chain to each preceding export, then joins the progressive exports. Segment time must be at least 0.1 seconds and powers must be a positive whole number. IHTX has no bot-imposed export-count, total-duration, or output-file-size cap; the entire processing job has a 600-second deadline. The bot no longer imposes a combined pitch-layer cap across IHTX powers.

The output is an `.mp4` file with H.264 video and AAC audio for playback compatibility. Discord may reject a file larger than its upload limit. The source video is still limited to 25 MB and 3 minutes.

Swirl parameters are `strength;x-scale;y-scale;x-center;y-center;linear-fallout`. Scale and center default to `0.5`; fallout defaults to quadratic, and `true` selects linear fallout. Example: `swirl=180;0.5;0.5;0.5;0.5;true`.

The repository's IHTX export loop and swirl math are ported to Node.js using this bot's named effects. Arbitrary FFmpeg or Bash code execution from the source bot is not enabled in Discord commands.

## Requirements

- `DISCORD_BOT_TOKEN` stored as a Replit Secret.
- A Discord bot application invited to the server with permission to read/send messages and attach files.
- The **Message Content Intent** enabled for the bot in the Discord Developer Portal.
- `ffmpeg`, `ffprobe`, `magick` (ImageMagick), and the `rubberband` executable available on the host.

The bot accepts videos up to 25 MB and 3 minutes long, permits two simultaneous edits, and removes temporary files after each job.

## Run

```bash
pnpm --filter @workspace/scripts run bot:dev
```

The project workflow named **534 Video Bot** runs this command persistently.
