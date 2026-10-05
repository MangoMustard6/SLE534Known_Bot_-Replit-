# 534 Video Editing Bot

The bot uses the `534!` prefix. Send a video attachment with:

```text
534!edit grayscale|speed|sepia|hue|mirrorhl|mirrorhr
```

Effects are applied from left to right. Use `|` between effects.

| Effect | Behavior |
| --- | --- |
| `grayscale` | Removes color |
| `speed` | Speeds up to 1.5× by default; supports `speed=0.25` through `speed=4` |
| `sepia` | Applies a sepia tone |
| `hue` | Rotates hue by 90° by default; supports `hue=-360` through `hue=360`. Advanced mode uses `hue=<normalizedHue>;<saturation>;<lightness>;<colorspace>[;<betterfully>]` to generate and apply a Hald CLUT. |
| `pitch` | Mixes three Rubber Band pitch-shifted audio layers; values are semitones from -24 to +24 |
| `mirrorhl` | Mirrors the left half across the center |
| `mirrorhr` | Mirrors the right half across the center |

Examples:

```text
534!edit grayscale|sepia
534!edit speed=2|hue=45|mirrorhl
534!edit hue=0.1;1.2;1.0;hsl;true|sepia
534!edit pitch=+3;0;-3|sepia
534!help
```

Advanced `hue` uses a normalized hue offset from -0.5 to 0.5, saturation and lightness multipliers from 0 to 10, and either `hsl` or `hsv`. The optional final `betterfully` value accepts true/false (or common equivalents) and enables the script's stepped hue rounding. Omitted advanced values default to 1× saturation, 1× lightness, `hsl`, and false. The existing single-value degree syntax remains unchanged.

The three `pitch` values create three separate copies of the current audio, shift each by its semitone amount with the Rubber Band executable, then mix the copies together. Pitch shifting preserves duration.

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
