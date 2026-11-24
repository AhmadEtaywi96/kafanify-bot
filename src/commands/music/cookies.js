import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getOwnerIds, parseCookies, writeCookiesFile, isCookieSyncActive } from '../../utils/cookies.js';

const MAX_SIZE = 1024 * 1024; // a real cookies.txt is a few KB

export default {
    data: new SlashCommandBuilder()
        .setName('cookies')
        .setDescription('Owner only: upload a fresh YouTube cookies.txt')
        .addAttachmentOption((option) =>
            option.setName('file')
                .setDescription('cookies.txt in Netscape format, exported while signed in to YouTube')
                .setRequired(true)),

    async execute(interaction) {
        if (!getOwnerIds().includes(interaction.user.id)) {
            return interaction.reply({ content: '⛔ Only the bot owner can update the cookies.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const file = interaction.options.getAttachment('file', true);
        if (file.size > MAX_SIZE) {
            return interaction.editReply('❌ That file is too big to be a cookies.txt.');
        }

        let text;
        try {
            const res = await fetch(file.url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            text = await res.text();
        } catch (err) {
            return interaction.editReply(`❌ Could not download the attachment: ${err.message}`);
        }

        const result = parseCookies(text);
        if (!result.ok) {
            return interaction.editReply(`❌ ${result.error}`);
        }

        try {
            writeCookiesFile(text);
        } catch (err) {
            console.error('[YouTube] Failed to save cookies:', err.message);
            return interaction.editReply('❌ Could not save the file on the server. Check the bot logs.');
        }

        console.log(`[YouTube] Cookies updated via /cookies by ${interaction.user.tag} (${result.youtubeCount} youtube.com cookies)`);
        return interaction.editReply(
            `✅ Saved ${result.youtubeCount} YouTube cookies. They apply from the next track, no restart needed.`
            + (isCookieSyncActive() ? '' : '\n⚠️ The bot started without cookies, so restart it once to use them for search and video info too.'));
    },
};
