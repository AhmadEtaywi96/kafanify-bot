import { Events, MessageFlags } from 'discord.js';
import { handlePlayerButton } from '../player/controls.js';

async function replyError(interaction) {
    const payload = { content: 'There was an error while executing this action!', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
}

export default {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (interaction.isButton() && interaction.customId.startsWith('np:')) {
            try {
                await handlePlayerButton(interaction);
            } catch (error) {
                console.error('[Player Controls]', error);
                await replyError(interaction);
            }
            return;
        }

        if (!interaction.isChatInputCommand()) return;

        const command = interaction.client.commands.get(interaction.commandName);

        if (!command) {
            console.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(error);
            await replyError(interaction);
        }
    },
};
