# 534 Video Editing Discord Bot

A prefix-based Discord bot that edits video attachments with FFmpeg using ordered effect chains, such as `534!edit grayscale|sepia`.

## Run & Operate

- `pnpm --filter @workspace/scripts... install --frozen-lockfile` — install the bot's dependencies without installing unrelated services
- Click **Run** to start the **534 Video Bot** console workflow. A successful Discord connection logs `534 video bot is online as ...`.
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/scripts run bot:dev` — run the Discord video bot
- `pnpm --filter @workspace/scripts run typecheck` — check the bot package
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required secret: `DISCORD_BOT_TOKEN`
- Required host tools: `ffmpeg`, `ffprobe`, ImageMagick (`magick`), and `rubberband`. These are available in the current Replit environment.
- The Discord bot runs without the API server, database, or canvas preview service.
- A full workspace install currently encounters a package-firewall rejection for the unrelated API server's locked `proxy-addr@2.0.7`. The filtered bot install succeeds; resolve the API dependency separately before running that service.

## Stack

- pnpm workspaces, Node.js 20, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `scripts/src/discord-video-bot.ts` — Discord command handling and FFmpeg job lifecycle
- `scripts/src/audio-processing.ts` — speed and Rubber Band pitch processing for audio
- `scripts/src/hue-clut.ts` — generates ImageMagick Hald CLUTs for advanced hue modulation
- `scripts/src/process-runner.ts` — bounded external process execution
- `scripts/src/video-filters.ts` — effect parsing and FFmpeg filter graph generation
- `scripts/DISCORD_VIDEO_BOT.md` — command reference and setup requirements

## Architecture decisions

- The bot runs as a persistent console workflow and uses Discord's gateway through `discord.js`.
- FFmpeg is invoked with an argument array, not a shell command, and downloaded videos are size/duration limited.
- `pitch=a;b;...` accepts 1–100 semitone shifts, processes one audio copy per value with Rubber Band's R3 finer engine (`--fine` / `OptionEngineFiner`), then mixes the copies before muxing the final video.
- Every `hue` effect uses ImageMagick Hald CLUT modulation in the ordered FFmpeg filter graph; there is no legacy degree-rotation path.
- Final output is MP4 with H.264 video and AAC audio for broad playback compatibility; Discord's existing 25 MB output limit still applies.

## Product

- `534!edit` applies ordered color, invert, speed, hue, pitch-mix, and mirror effects to an attached video.
- `534!ihtx` builds progressive exports with named effects; `534!ihtxplus` adds raw FFmpeg options, optional full-length exports, signed join order, arithmetic counts/durations, and MP4/MOV/MKV/AVI/WebM/MXF output. Both stop after 600 seconds.

## User preferences

- Use the `534!` Discord command prefix.

## Gotchas
- Enable the Discord **Message Content Intent** in the Discord Developer Portal or the bot cannot read prefix commands.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
