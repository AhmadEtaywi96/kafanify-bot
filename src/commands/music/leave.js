import { SlashCommandBuilder } from 'discord.js';
import { useQueue } from 'discord-player';

export default {
    data: new SlashCommandBuilder()
        .setName('leave')
        .setDescription('Clear the queue and leave the voice channel'),
        
    async execute(interaction) {
        // Fetch the active queue for this specific server
        const queue = useQueue(interaction.guildId);

        if (!queue || !queue.connection) {
            return interaction.reply({ content: 'I am not currently connected to a voice channel!', ephemeral: true });
        }

        // Deleting the queue automatically disconnects the bot and clears all tracks
        queue.delete();
        
        return interaction.reply('👋 Left the voice channel and cleared the queue.');
    },
};