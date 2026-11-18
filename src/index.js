import { Client, GatewayIntentBits, Collection } from 'discord.js';
import { Player } from 'discord-player';
import { DefaultExtractors } from '@discord-player/extractor';
import { YoutubeExtractor } from 'discord-player-youtubei';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Max Opus bitrate supported by discord-player's encoder (it clamps to 128 kbps)
const OPUS_BITRATE = 128_000;
const DEBUG = process.env.DEBUG === '1';

process.on('unhandledRejection', (reason) => {
    console.error('[Unhandled Rejection]', reason);
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
});

player.events.on('playerError', (queue, error, track) => {
    console.error(`[Audio Stream Error] ${track?.title ?? ''} -> ${error.message}`);
    queue.metadata?.channel?.send(`⚠️ Could not play **${track?.title ?? 'this track'}**, skipping.`).catch(() => {});
});

player.events.on('playerStart', (queue, track) => {
    // Encode at the highest Opus bitrate so music isn't squeezed into voice-quality
    queue.node.setBitrate(OPUS_BITRATE);
    queue.metadata?.channel?.send(`🎶 Now playing **${track.title}**`).catch(() => {});
});

if (DEBUG) {
    player.events.on('debug', (queue, message) => console.log(`[Queue Debug] ${message}`));
    player.on('debug', (message) => console.log(`[Player Debug] ${message}`));
}

// YouTube first: yt-dlp gives YouTube's native Opus stream (itag 251), the cleanest source.
// The innertube methods remain as fallbacks.
await player.extractors.register(YoutubeExtractor, {
    disableYTJSLog: true,
    downloads: {
        trialOrder: ['yt-dlp', 'adaptive', 'sabr']
    }
});
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
