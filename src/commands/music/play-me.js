import { SlashCommandBuilder } from 'discord.js';
import { useMainPlayer, useQueue } from 'discord-player';
import { buildQueueOptions } from '../../utils/queueOptions.js';

export default {
    data: new SlashCommandBuilder()
        .setName('play-me')
        .setDescription('Play music that stops automatically when you leave the channel')
        .addStringOption(option => 
            option.setName('query')
                .setDescription('The YouTube URL or search term')
                .setRequired(true)
        ),
        
    async execute(interaction) {
        const player = useMainPlayer();
        const channel = interaction.member.voice.channel;

        if (!channel) {
            return interaction.reply({ content: 'You must be in a voice channel to play music!', ephemeral: true });
        }

        const query = interaction.options.getString('query', true);
        await interaction.deferReply();

        try {
            const { track } = await player.play(channel, query, {
                nodeOptions: buildQueueOptions(interaction)
            });

            // Fetch the queue we just created/added to
            const queue = useQueue(interaction.guildId);
            
            if (queue) {
                // Tag the queue with the host's ID and the text channel (so we can say goodbye)
                queue.playMeHost = interaction.user.id;
                queue.playMeChannel = interaction.channel;
            }

            return interaction.followUp(`🎵 **${track.title}** added! I am bound to you. If you leave the channel, I leave.`);
        } catch (e) {
            console.error(e);
            return interaction.followUp('Something went wrong while trying to play the track.');
        }
    },
};