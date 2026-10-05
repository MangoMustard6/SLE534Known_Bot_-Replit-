# 534 Video Editing Bot

The bot uses the `534!` prefix. Send a video attachment with:

```text
534!edit grayscale|invert|speed|sepia|hue|mirrorhl|mirrorhr
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
534!help
```

`hue` uses a normalized hue offset from -0.5 to 0.5, saturation and lightness multipliers from 0 to 10, and either `hsl` or `hsv`. The optional final `betterfully` value accepts true/false (or common equivalents) and enables stepped hue rounding. Omitted values default to zero hue offset, 1× saturation, 1× lightness, `hsl`, and false. Single-value degree rotations such as `hue=45` are no longer supported.

The `pitch` values create one separate copy of the current audio per value, shift each by its semitone amount with Rubber Band's R3 finer engine (`--fine`, corresponding to `OptionEngineFiner`), then mix all copies together. Provide between 1 and 100 values separated by semicolons. Pitch shifting preserves duration. R3 layers are processed in a bounded parallel pool, and the bot reports progress during larger mixes; 100 shifts on a long video can still take several minutes.

The output is an `.mp4` file with H.264 video and AAC audio for playback compatibility. The existing 25 MB Discord output limit applies.

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
