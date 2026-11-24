# Kafanify Bot

Discord music bot. Node ≥ 20, ES modules (`"type": "module"`), discord.js 14.28, discord-player 7.2.
YouTube playback via `discord-player-youtubei` (download order: yt-dlp → adaptive → sabr), plus `@discord-player/extractor` `DefaultExtractors`.

## Running

- `npm start` (or `npm run dev`) — runs `node src/index.js`.
- `npm run deploy` — registers slash commands **to the `GUILD_ID` server only**. Rerun after adding a command or changing any command's `data`.
- `DEBUG=1` — enables discord-player debug logging.
- No tests or linter. Check syntax with `node --check <file>`.

## Config

- `.env`: `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`.
- Optional `YT_COOKIES_PATH` (default `./cookies.txt`, Netscape format). Needed on servers/datacenter IPs, where YouTube answers "Sign in to confirm you're not a bot".
- `cookies.txt` is the single source of truth. yt-dlp reads it per track and writes rotated cookies back into it. Innertube gets the cookie at startup (so it runs logged in), and `installCookieSync()` swaps the `Cookie` header on every youtube.com request for the file's current cookies. A new file applies to both without a restart. If the bot started with no file, restart it once after the first upload.
- `YTDLP_AUTO_UPDATE=0` disables the yt-dlp self-update (at startup + every 24 h). `YTDLP_CHANNEL=nightly|stable` picks the update channel.
- The bot uses the yt-dlp **bundled** at `node_modules/youtube-dl-exec/bin/yt-dlp`, not a system install. To update it manually, run `node_modules/youtube-dl-exec/bin/yt-dlp -U`.
- `BOT_OWNER_IDS`: comma-separated Discord user IDs. They can use `/cookies` and get a DM when YouTube cookies look expired.
- `.env` and `cookies.txt` are gitignored. Never commit them or print their values.

## File map

| Path | Role |
|---|---|
| `src/index.js` | Client (intents: Guilds, GuildVoiceStates), `Player`, extractor + cookie setup, Opus bitrate on `playerTrigger`, Now Playing panel lifecycle events, dynamic loading of commands and events |
| `src/deploy-commands.js` | Slash command registration (guild-scoped) |
| `src/commands/music/play.js` | `/play <query>` |
| `src/commands/music/play-me.js` | `/play-me <query>`: sets `queue.playMeHost` / `queue.playMeChannel`; bot leaves when that user leaves |
| `src/commands/music/join.js`, `leave.js` | Join / leave voice |
| `src/commands/music/cookies.js` | `/cookies <file>` (owner only): validates and atomically replaces cookies.txt; applies from the next track, no restart |
| `src/utils/cookies.js` | Cookie path, parser/validator, atomic write, Innertube cookie sync (`installCookieSync`), expired-cookie owner DM (30 min cooldown) |
| `src/utils/ytdlp.js` | Self-update of the bundled yt-dlp |
| `src/commands/music/nowplaying.js` | Reposts the panel in the current channel (sets `queue.metadata = interaction`) |
| `src/events/interactionCreate.js` | Routes `np:*` buttons and modals to `player/controls.js`, then slash commands |
| `src/events/voiceStateUpdate.js` | `/play-me` host-left logic |
| `src/utils/queueOptions.js` | `buildQueueOptions()`: shared queue options (volume 80, 60 s leave cooldowns, short `bufferingTimeout` for seeks, unused DSP stages disabled). Use it in every command that creates a queue |
| `src/player/nowPlaying.js` | Now Playing panel: build / show / refresh / close |
| `src/player/controls.js` | Panel button and modal handlers |

## Conventions

- **New command:** add a file in `src/commands/music/` with `export default { data: SlashCommandBuilder, execute(interaction) }`, then run `npm run deploy`. It is loaded automatically.
- **New event:** add a file in `src/events/` with `export default { name, once?, execute }`. It is loaded automatically.
- **Ephemeral replies:** use `flags: MessageFlags.Ephemeral`. Older commands still use the deprecated `ephemeral: true`.
- **Slow work:** call `deferReply()` / `deferUpdate()` first. Interactions must be answered within 3 s.
- `queue.metadata` is the interaction that created the queue. The panel posts to `queue.metadata.channel`.

## Now Playing panel (`src/player/nowPlaying.js`)

- Built with **Components V2** (`MessageFlags.IsComponentsV2`): `ContainerBuilder`, `TextDisplayBuilder`, `SeparatorBuilder`, `MediaGalleryBuilder`.
  - V2 messages cannot have `content` or `embeds`, and every edit must also be a V2 payload. A V2 message cannot be converted back to embeds.
  - The accent color is green while playing, yellow when paused, blurple when ended.
- **Lifecycle** (wired in `src/index.js`):
  - `playerStart` → `showPanel()` deletes the old panel and posts a new one.
  - `playerPause` / `playerResume` → `refreshPanel()`.
  - `emptyQueue` / `disconnect` / `queueDelete` → `closePanel()` freezes the panel with a status and no buttons.
- **Refresh timer:** every 5 s (`UPDATE_INTERVAL_MS`).
  - **Don't go below about 5 s.** 1 s was tried and the panel got stuck: Discord limits message edits to about 5 per 5 s per channel.
  - The loop skips a tick while an edit is still in flight, and backs off (`BACKOFF_TICKS`) after a slow or 429 edit.
  - The `lastRender` dedupe skips edits that wouldn't change anything.
- **Button custom IDs:** `np:<action>[:<arg>]`.
  - Actions: `seek:±ms`, `toggle`, `prev`, `skip`, `vol:±10`, `goto`, `stop`, `leave`.
  - `goto` opens the modal `np:goto` (text input id `time`). `parseTime()` accepts `2` (minutes), `2.5`, `1:30` (m:ss) and `1:02:30` (h:mm:ss).
- **Adding a button:**
  1. Add the button in `buildPanel()`. An action row holds at most 5 buttons.
  2. Add a `case` in `handlePlayerButton()` in `controls.js`.
  3. Access is already checked by `checkAccess()`: the queue must exist and the user must be in the bot's voice channel.
  4. After updating the panel from an interaction (`updatePanel` / `updateDeferred`), call `markRendered()` so the timer doesn't re-send the same content. The existing helpers already do this.
- **Live tracks** (`track.live`, or no duration): seek and Go to are disabled, and the progress bar shows 🔴 LIVE. Check with `canSeek(queue)`.

## Gotchas

- Never give a client a frozen copy of the YouTube cookies. yt-dlp saves rotated cookies, and a client still sending the old ones gets the session logged out. Innertube's cookies come from the file through `installCookieSync()`.
- YouTube blocks often look like success: empty title/duration means Innertube was refused; a track that "finishes" within 1.5 s means yt-dlp got no audio. `index.js` detects both and alerts the owners.
- A seek recreates the audio resource and fires `playerTrigger` again, so the Opus bitrate (128 kbps, discord-player's max) is reapplied there. `setBitrate` can throw if the stream already died; it is wrapped in try/catch.
- Backward seeks restart the stream and can take a moment, so seek handlers call `deferUpdate()` before seeking.
- Panels are tracked in an in-memory `Map` keyed by guild ID. After a bot restart, old panel messages are no longer tracked.
