import { MessageFlags } from 'discord.js';
import { useQueue } from 'discord-player';
import { buildPanel, closePanel, markRendered } from './nowPlaying.js';

const ephemeral = (interaction, content) =>
    interaction.reply({ content, flags: MessageFlags.Ephemeral });

/** Handles clicks on the Now Playing panel buttons (customId "np:<action>[:<arg>]"). */
export async function handlePlayerButton(interaction) {
    const [, action, arg] = interaction.customId.split(':');
    const queue = useQueue(interaction.guildId);

    if (!queue || !queue.currentTrack) {
        return ephemeral(interaction, 'Nothing is playing right now.');
    }

    const botChannelId = interaction.guild.members.me.voice.channelId;
    if (!botChannelId || interaction.member.voice.channelId !== botChannelId) {
        return ephemeral(interaction, 'Join my voice channel to use the controls.');
    }

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
