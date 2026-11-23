import {
    ActionRowBuilder,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { useQueue } from 'discord-player';
import { buildPanel, canSeek, closePanel, markRendered } from './nowPlaying.js';

const GOTO_INPUT_ID = 'time';

const ephemeral = (interaction, content) =>
    interaction.reply({ content, flags: MessageFlags.Ephemeral });

/** Returns the queue if the user may control it, otherwise replies with the reason and returns null. */
async function checkAccess(interaction) {
    const queue = useQueue(interaction.guildId);
    if (!queue || !queue.currentTrack) {
        await ephemeral(interaction, 'Nothing is playing right now.');
        return null;
    }

    const botChannelId = interaction.guild.members.me.voice.channelId;
    if (!botChannelId || interaction.member.voice.channelId !== botChannelId) {
        await ephemeral(interaction, 'Join my voice channel to use the controls.');
        return null;
    }
    return queue;
}

/** Handles clicks on the Now Playing panel buttons (customId "np:<action>[:<arg>]"). */
export async function handlePlayerButton(interaction) {
    const [, action, arg] = interaction.customId.split(':');
    const queue = await checkAccess(interaction);
    if (!queue) return;

    switch (action) {
        case 'seek': {
            // Backward seeks restart the stream and can take a moment, so acknowledge first.
            await interaction.deferUpdate();
            const timestamp = queue.node.getTimestamp();
            if (!timestamp) return;
            const total = timestamp.total.value;
            const target = Math.max(0, Math.min(timestamp.current.value + Number(arg), total - 1000));
            await queue.node.seek(target);
            return updateDeferred(interaction, queue);
        }

        case 'goto':
            if (!canSeek(queue)) return ephemeral(interaction, "This track can't be seeked.");
            return interaction.showModal(buildGotoModal(queue));

        case 'vol': {
            const volume = Math.max(0, Math.min(100, queue.node.volume + Number(arg)));
            queue.node.setVolume(volume);
            return updatePanel(interaction, queue);
        }

        case 'toggle':
            if (queue.node.isPaused()) queue.node.resume();
            else queue.node.pause();
            return updatePanel(interaction, queue);

        case 'prev':
            if (queue.history.isEmpty()) return ephemeral(interaction, 'There is no previous track.');
            await interaction.deferUpdate();
            await queue.history.back();
            return; // playerStart posts a new panel for the previous track

        case 'skip':
            if (queue.tracks.size === 0) return ephemeral(interaction, 'There is nothing to skip to.');
            await interaction.deferUpdate();
            queue.node.skip();
            return; // playerStart posts a new panel for the next track

        case 'stop':
            await interaction.deferUpdate();
            // Close first so the "Stopped by" status wins over the emptyQueue handler's text
            await closePanel(interaction.guildId, `⏹️ Stopped by ${interaction.user.displayName}`);
            queue.tracks.clear();
            queue.node.stop();
            return;

        case 'leave':
            await interaction.deferUpdate();
            await closePanel(interaction.guildId, `👋 ${interaction.user.displayName} disconnected me`);
            return queue.delete();

        default:
            return ephemeral(interaction, 'Unknown control.');
    }
}

/** Handles the "Go to" modal submitted from the panel (customId "np:goto"). */
export async function handlePlayerModal(interaction) {
    if (interaction.customId !== 'np:goto') return ephemeral(interaction, 'Unknown control.');

    const queue = await checkAccess(interaction);
    if (!queue) return;
    if (!canSeek(queue)) return ephemeral(interaction, "This track can't be seeked.");

    const input = interaction.fields.getTextInputValue(GOTO_INPUT_ID);
    const target = parseTime(input);
    const length = queue.currentTrack.duration;
    if (target === null) {
        return ephemeral(interaction, `\`${input.slice(0, 50)}\` isn't a valid time. Use minutes (\`2\`), \`m:ss\` (\`1:30\`) or \`h:mm:ss\`.`);
    }
    if (target >= queue.currentTrack.durationMS) {
        return ephemeral(interaction, `That's past the end of the track (length \`${length}\`).`);
    }

    await interaction.deferUpdate();
    await queue.node.seek(target);
    return updateDeferred(interaction, queue);
}

function buildGotoModal(queue) {
    const input = new TextInputBuilder()
        .setCustomId(GOTO_INPUT_ID)
        .setLabel(`Go to time (track length ${queue.currentTrack.duration})`.slice(0, 45))
        .setPlaceholder('e.g. 2  or  1:30  or  1:02:30')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(10);
    return new ModalBuilder()
        .setCustomId('np:goto')
        .setTitle('Go to time')
        .addComponents(new ActionRowBuilder().addComponents(input));
}

/**
 * Parses "2" / "2.5" (minutes), "1:30" (m:ss) or "1:02:30" (h:mm:ss) into milliseconds.
 * Returns null for anything else.
 */
export function parseTime(raw) {
    const value = raw.trim();
    if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value) * 60_000);
    if (!/^\d+(:\d{1,2}){1,2}$/.test(value)) return null;

    const parts = value.split(':').map(Number);
    if (parts.slice(1).some((n) => n >= 60)) return null;
    const seconds = parts.reduce((acc, n) => acc * 60 + n, 0);
    return seconds * 1000;
}

async function updatePanel(interaction, queue) {
    const payload = buildPanel(queue);
    await interaction.update(payload);
    markRendered(interaction.guildId, payload);
}

async function updateDeferred(interaction, queue) {
    if (!queue.currentTrack) return;
    const payload = buildPanel(queue);
    await interaction.editReply(payload).catch(() => {});
    markRendered(interaction.guildId, payload);
}
