import { SlashCommandBuilder } from 'discord.js';
import { useMainPlayer } from 'discord-player';
import { buildQueueOptions } from '../../utils/queueOptions.js';

export default {
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('Summon the bot to your voice channel'),
        
    async execute(interaction) {
        const player = useMainPlayer();
        const channel = interaction.member.voice.channel;

        if (!channel) {
            return interaction.reply({ content: 'You must be in a voice channel for me to join!', ephemeral: true });
        }

        // Initialize the queue for this server
        const queue = player.nodes.create(interaction.guild, buildQueueOptions(interaction));

        try {
            // Check if the bot is already connected to a channel
            if (!queue.connection) {
                await queue.connect(channel);
            }
            return interaction.reply(`👍 Joined **${channel.name}**!`);
        } catch (error) {
            console.error(error);
            queue.delete();
            return interaction.reply({ content: 'Could not join your voice channel.', ephemeral: true });
        }
    },
};