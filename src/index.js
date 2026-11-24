import { Client, GatewayIntentBits, Collection } from 'discord.js';
import { Player } from 'discord-player';
import { DefaultExtractors } from '@discord-player/extractor';
import { YoutubeExtractor } from 'discord-player-youtubei';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { showPanel, refreshPanel, closePanel } from './player/nowPlaying.js';
import { getCookiesPath, readCookiesFile, installCookieSync, alertIfCookieFailure, alertCookieProblem } from './utils/cookies.js';
import { scheduleYtDlpUpdates } from './utils/ytdlp.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Max Opus bitrate supported by discord-player's encoder (it clamps to 128 kbps)
const OPUS_BITRATE = 128_000;
const DEBUG = process.env.DEBUG === '1';

process.on('unhandledRejection', (reason) => {
    console.error('[Unhandled Rejection]', reason);
    // yt-dlp failures surface here (discord-player-youtubei rethrows them inside a .catch).
    alertIfCookieFailure(client, reason).catch(() => {});
});
process.on('uncaughtException', (error) => {
    console.error('[Uncaught Exception]', error);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const player = new Player(client);

player.events.on('error', (queue, error) => {
    console.error(`[Queue Error] ${error.message}`);
    alertIfCookieFailure(client, error).catch(() => {});
});

player.events.on('playerError', (queue, error, track) => {
    console.error(`[Audio Stream Error] ${track?.title ?? ''} -> ${error.message}`);
    alertIfCookieFailure(client, error).catch(() => {});
    queue.metadata?.channel?.send(`⚠️ Could not play **${track?.title ?? 'this track'}**, skipping.`).catch(() => {});
});

// Fires for every new audio resource, including seek replays, which create a fresh encoder.
// Encode at the highest Opus bitrate so music isn't squeezed into voice quality.
player.events.on('playerTrigger', (queue) => {
    // If the source stream already died (e.g. yt-dlp failed), the encoder is gone; don't throw.
    try {
        queue.node.setBitrate(OPUS_BITRATE);
    } catch (err) {
        if (DEBUG) console.warn('[Bitrate] encoder not available:', err.message);
    }
});

// Detect YouTube blocks that discord-player reports as success:
// - Innertube refused the metadata request -> track with empty title and no duration.
// - yt-dlp exited without audio -> track "finishes" almost immediately.
const isYoutube = (track) => /youtu.?be/.test(track?.url ?? '');
const startedAt = new Map(); // guildId -> { track, at }
const MIN_PLAYBACK_MS = 1500;

player.events.on('playerStart', (queue, track) => {
    startedAt.set(queue.guild.id, { track, at: Date.now() });
    if (isYoutube(track) && !track.title && !track.durationMS) {
        console.warn(`[YouTube] Empty metadata for ${track.url}: YouTube refused the request`);
        alertCookieProblem(client, 'YouTube refused to return video info').catch(() => {});
    }
});

player.events.on('playerFinish', (queue, track) => {
    const start = startedAt.get(queue.guild.id);
    startedAt.delete(queue.guild.id);
    if (!start || start.track !== track || !isYoutube(track)) return;
    if (Date.now() - start.at >= MIN_PLAYBACK_MS) return;
    console.warn(`[YouTube] Stream produced no audio for ${track.url} (blocked, expired cookies or outdated yt-dlp)`);
    queue.metadata?.channel?.send(
        `⚠️ YouTube didn't send any audio for **${track.title || track.url}**. The cookies have probably expired; the bot owner has been notified.`
    ).catch(() => {});
    alertCookieProblem(client, 'yt-dlp got no audio from YouTube').catch(() => {});
});

// Now Playing panel lifecycle
player.events.on('playerStart', (queue) => showPanel(queue));
player.events.on('playerPause', (queue) => refreshPanel(queue));
player.events.on('playerResume', (queue) => refreshPanel(queue));
player.events.on('emptyQueue', (queue) => closePanel(queue.guild.id, '✅ Queue finished'));
player.events.on('disconnect', (queue) => closePanel(queue.guild.id, '👋 Disconnected'));
player.events.on('queueDelete', (queue) => closePanel(queue.guild.id, '👋 Disconnected'));

if (DEBUG) {
    player.events.on('debug', (queue, message) => console.log(`[Queue Debug] ${message}`));
    player.on('debug', (message) => console.log(`[Player Debug] ${message}`));
}

// YouTube first: yt-dlp gives YouTube's native Opus stream (itag 251), the cleanest source.
// The innertube methods remain as fallbacks.
// YouTube blocks datacenter IPs ("Sign in to confirm you're not a bot"), so on a server we
// authenticate with a Netscape-format cookies.txt. Without the file, behaviour is unchanged.
//
// cookies.txt is the single source of truth: yt-dlp reads it per track and saves rotated
// cookies back into it, and installCookieSync() makes Innertube send the file's current
// cookies on every request. Both clients therefore always use the same, newest cookies;
// a frozen startup copy in Innertube made Google log the session out after an hour or two.
// A file uploaded with /cookies applies to both from the next request, no restart.
const COOKIES_PATH = getCookiesPath();
const cookieInfo = readCookiesFile(COOKIES_PATH);

if (!cookieInfo) console.log('[YouTube] No cookies file found, running without authentication');
else if (!cookieInfo.ok) console.warn(`[YouTube] ${COOKIES_PATH}: ${cookieInfo.error}`);
else console.log(`[YouTube] Using cookies from ${COOKIES_PATH} (synced for yt-dlp and Innertube)`);

if (cookieInfo?.header) installCookieSync(COOKIES_PATH);

await player.extractors.register(YoutubeExtractor, {
    disableYTJSLog: true,
    // Needed at startup so Innertube runs as a logged-in session; the header itself is
    // replaced with the file's current cookies by installCookieSync().
    ...(cookieInfo?.header && { cookie: cookieInfo.header }),
    downloads: {
        trialOrder: ['yt-dlp', 'adaptive', 'sabr'],
        // Always pass the path: the file may be uploaded later via /cookies.
        ytdlp: { cookiePath: COOKIES_PATH }
    }
});

// The bot runs the yt-dlp bundled in node_modules/youtube-dl-exec, not a system install.
scheduleYtDlpUpdates();
await player.extractors.loadMulti(DefaultExtractors);

client.commands = new Collection();

// Load Commands dynamically
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = `file://${path.join(commandsPath, file)}`;
        const command = (await import(filePath)).default;
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        }
    }
}

// Load Events dynamically
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
    const filePath = `file://${path.join(eventsPath, file)}`;
    const event = (await import(filePath)).default;
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
    } else {
        client.on(event.name, (...args) => event.execute(...args));
    }
}

client.login(process.env.DISCORD_TOKEN);
