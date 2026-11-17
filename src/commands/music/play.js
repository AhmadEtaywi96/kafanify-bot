import { SlashCommandBuilder } from 'discord.js';
import { useMainPlayer } from 'discord-player';

export default {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song from a YouTube URL')
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

        // Acknowledge the interaction immediately since fetching music might take a few seconds
        await interaction.deferReply();

        try {
            const { track } = await player.play(channel, query, {
                nodeOptions: {
                    metadata: interaction
                }
            });

            return interaction.followUp(`**${track.title}** has been added to the queue!`);
        } catch (e) {
            console.error(e);
            return interaction.followUp('Something went wrong while trying to play the track.');
        }
    },
};