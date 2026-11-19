import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

const UPDATE_INTERVAL_MS = 10_000;
const COLOR_PLAYING = 0x1db954;
const COLOR_PAUSED = 0xf1c40f;
const COLOR_ENDED = 0x5865f2;

/** guildId -> { message, interval, lastRender } */
const panels = new Map();

function canSeek(queue) {
    const track = queue.currentTrack;
    return !!track && !track.live && track.durationMS > 0;
}

function progressLine(queue) {
    if (!canSeek(queue)) return '🔴 LIVE';
    return queue.node.createProgressBar({
        length: 18,
        timecodes: true,
        indicator: '🔘',
        leftChar: '▬',
        rightChar: '─',
    }) ?? '';
}

function button(id, label, style = ButtonStyle.Secondary, disabled = false) {
    return new ButtonBuilder().setCustomId(`np:${id}`).setLabel(label).setStyle(style).setDisabled(disabled);
}

/** Builds the embed + button rows for the current state of the queue. */
export function buildPanel(queue) {
    const track = queue.currentTrack;
    if (!track) return buildEndedPanel(null, '⏹️ Nothing is playing');

    const paused = queue.node.isPaused();
    const seekable = canSeek(queue);
    const next = queue.tracks.at(0);
    const queued = queue.tracks.size;

    const embed = new EmbedBuilder()
        .setColor(paused ? COLOR_PAUSED : COLOR_PLAYING)
        .setAuthor({ name: paused ? '⏸️ Paused' : '▶️ Now Playing' })
        .setTitle((track.title || 'Unknown title').slice(0, 256))
        .setURL(track.url || null)
        .setDescription(progressLine(queue))
        .addFields(
            { name: 'Artist', value: track.author || 'Unknown', inline: true },
            { name: 'Requested by', value: track.requestedBy ? `<@${track.requestedBy.id}>` : 'Unknown', inline: true },
            { name: 'Volume', value: `${queue.node.volume}%`, inline: true },
            {
                name: `Up next${queued > 1 ? ` (${queued} in queue)` : ''}`,
                value: next ? `${(next.title || 'Unknown title').slice(0, 200)} — \`${next.duration}\`` : 'Nothing queued',
            },
        );
    if (track.thumbnail) embed.setThumbnail(track.thumbnail);

    const seekRow = new ActionRowBuilder().addComponents(
        button('seek:-30000', '⏪ 30s', ButtonStyle.Secondary, !seekable),
        button('seek:-10000', '⏪ 10s', ButtonStyle.Secondary, !seekable),
        paused
            ? button('toggle', '▶️ Resume', ButtonStyle.Success)
            : button('toggle', '⏸️ Pause', ButtonStyle.Primary),
        button('seek:10000', '10s ⏩', ButtonStyle.Secondary, !seekable),
        button('seek:30000', '30s ⏩', ButtonStyle.Secondary, !seekable),
    );
    const controlRow = new ActionRowBuilder().addComponents(
        button('prev', '⏮️ Previous', ButtonStyle.Secondary, queue.history.isEmpty()),
        button('skip', '⏭️ Skip', ButtonStyle.Secondary, queued === 0),
        button('stop', '⏹️ Stop', ButtonStyle.Danger),
        button('leave', '👋 Leave', ButtonStyle.Danger),
    );

    return { embeds: [embed], components: [seekRow, controlRow] };
}

function buildEndedPanel(message, text) {
    const old = message?.embeds?.[0];
    const embed = new EmbedBuilder().setColor(COLOR_ENDED).setAuthor({ name: text });
    if (old?.title) embed.setTitle(old.title).setURL(old.url ?? null);
    if (old?.thumbnail?.url) embed.setThumbnail(old.thumbnail.url);
    return { embeds: [embed], components: [] };
}

function stopTimer(entry) {
    if (entry?.interval) clearInterval(entry.interval);
}

/** Edits the existing panel with the latest state (no-op if unchanged or missing). */
export async function refreshPanel(queue) {
    const entry = panels.get(queue.guild.id);
    if (!entry || !queue.currentTrack) return;

    let payload;
    try {
        payload = buildPanel(queue);
    } catch (error) {
        console.error('[NowPlaying] Could not build panel:', error.message);
        return;
    }
    const render = JSON.stringify(payload);
    if (render === entry.lastRender) return;

    try {
        await entry.message.edit(payload);
        entry.lastRender = render;
    } catch {
        // Message was deleted or is no longer editable: stop tracking it.
        stopTimer(entry);
        panels.delete(queue.guild.id);
    }
}

/** Posts a fresh panel for the current track, replacing any previous one. */
export async function showPanel(queue) {
    const channel = queue.metadata?.channel;
    if (!channel) return;

    const guildId = queue.guild.id;
    const previous = panels.get(guildId);
    stopTimer(previous);
    panels.delete(guildId);
    previous?.message.delete().catch(() => {});

    let payload;
    let message;
    try {
        payload = buildPanel(queue);
        message = await channel.send(payload);
    } catch (error) {
        console.error('[NowPlaying] Could not send panel:', error.message);
        return;
    }

    const entry = { message, interval: null, lastRender: JSON.stringify(payload) };
    entry.interval = setInterval(() => refreshPanel(queue), UPDATE_INTERVAL_MS);
    panels.set(guildId, entry);
}

/** Freezes the panel with a final status and disabled controls. */
export async function closePanel(guildId, text) {
    const entry = panels.get(guildId);
    if (!entry) return;
    stopTimer(entry);
    panels.delete(guildId);
    await entry.message.edit(buildEndedPanel(entry.message, text)).catch(() => {});
}

/** Lets an interaction handler adopt the message it just updated as the tracked panel state. */
export function markRendered(guildId, payload) {
    const entry = panels.get(guildId);
    if (entry) entry.lastRender = JSON.stringify(payload);
}
