import { Client, GatewayIntentBits, Collection } from 'discord.js';
import { Player } from 'discord-player';
import { DefaultExtractors } from '@discord-player/extractor';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
// import { YoutubeExtractor } from 'discord-player-youtubei';
import { YoutubeExtractor } from 'discord-player-youtube';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Initialize player
const player = new Player(client);

player.events.on('error', (queue, error) => {
    console.log(`[Queue Error] ${error.message}`);
});

player.events.on('playerError', (queue, error) => {
    console.log(`[Audio Stream Error] ${error.message}`);
});

player.events.on('debug', (queue, message) => {
    console.log(`[Player Debug] ${message}`);
});

// Load Extractors using the new supported method
// await player.extractors.loadMulti(DefaultExtractors); 
// await player.extractors.register(YoutubeExtractor, {});


await player.extractors.loadMulti(DefaultExtractors);

// Register the working YouTube extractor
await player.extractors.register(YoutubeExtractor, {
    disableYTJSLog: true
});

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