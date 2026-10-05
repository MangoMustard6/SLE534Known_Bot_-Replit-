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
| `hue` | Rotates hue by 90° by default; supports `hue=-360` through `hue=360` |
| `mirrorhl` | Mirrors the left half across the center |
| `mirrorhr` | Mirrors the right half across the center |

Examples:

```text
534!edit grayscale|sepia
534!edit speed=2|hue=45|mirrorhl
534!help
```

## Requirements

- `DISCORD_BOT_TOKEN` stored as a Replit Secret.
- A Discord bot application invited to the server with permission to read/send messages and attach files.
- The **Message Content Intent** enabled for the bot in the Discord Developer Portal.
- `ffmpeg` and `ffprobe` available on the host.

The bot accepts videos up to 25 MB and 3 minutes long, permits two simultaneous edits, and removes temporary files after each job.

## Run

```bash
pnpm --filter @workspace/scripts run bot:dev
```

The project workflow named **534 Video Bot** runs this command persistently.
