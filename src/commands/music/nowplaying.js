import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { useQueue } from 'discord-player';
import { showPanel } from '../../player/nowPlaying.js';

export default {
    data: new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('Show the player controls for the current track'),

    async execute(interaction) {
        const queue = useQueue(interaction.guildId);
        if (!queue || !queue.currentTrack) {
            return interaction.reply({ content: 'Nothing is playing right now.', flags: MessageFlags.Ephemeral });
        }

        // Post the panel in the channel where the command was used from now on
        queue.metadata = interaction;
        await interaction.reply({ content: '🎛️ Player controls below.', flags: MessageFlags.Ephemeral });
        await showPanel(queue);
    },
};
