import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
} from 'discord.js';

const UPDATE_INTERVAL_MS = 5_000;
/** An edit slower than this was almost certainly held back by a rate limit. */
const SLOW_EDIT_MS = 2_500;
/** Ticks to skip after a slow / rate-limited edit. */
const BACKOFF_TICKS = 1;
const BAR_LENGTH = 20;

const COLOR_PLAYING = 0x1db954;
const COLOR_PAUSED = 0xf1c40f;
const COLOR_ENDED = 0x5865f2;

const REPEAT_LABELS = ['', '🔂 Repeat track', '🔁 Repeat queue', '♾️ Autoplay'];

/** guildId -> { message, interval, lastRender, editing, skipTicks, track: { title, url, thumbnail } } */
const panels = new Map();

export function canSeek(queue) {
    const track = queue.currentTrack;
    return !!track && !track.live && track.durationMS > 0;
}

function progressLine(queue) {
    if (!canSeek(queue)) return '🔴 **LIVE**';
    const ts = queue.node.getTimestamp();
    if (!ts) return '';
    const ratio = ts.total.value > 0 ? Math.min(1, Math.max(0, ts.current.value / ts.total.value)) : 0;
    const filled = Math.round(ratio * (BAR_LENGTH - 1));
    const bar = '━'.repeat(filled) + '●' + '─'.repeat(BAR_LENGTH - 1 - filled);
    return `\`${ts.current.label}\` ${bar} \`${ts.total.label}\``;
}

function button(id, label, style = ButtonStyle.Secondary, disabled = false) {
    return new ButtonBuilder().setCustomId(`np:${id}`).setLabel(label).setStyle(style).setDisabled(disabled);
}

const text = (content) => new TextDisplayBuilder().setContent(content);
const separator = (divider = true) =>
    new SeparatorBuilder().setDivider(divider).setSpacing(SeparatorSpacingSize.Small);

function escapeMd(value) {
    return String(value).replace(/([\\*_`~|[\]])/g, '\\$1');
}

function trackInfo(track) {
    return {
        title: (track?.title || 'Unknown title').slice(0, 200),
        url: track?.url || null,
        thumbnail: track?.thumbnail || null,
    };
}

function titleLine({ title, url }) {
    return url ? `## [${escapeMd(title)}](${url})` : `## ${escapeMd(title)}`;
}

/** Builds the Components V2 payload for the current state of the queue. */
export function buildPanel(queue) {
    const track = queue.currentTrack;
    if (!track) return buildEndedPanel(null, '⏹️ Nothing is playing');

    const paused = queue.node.isPaused();
    const seekable = canSeek(queue);
    const next = queue.tracks.at(0);
    const queued = queue.tracks.size;
    const volume = queue.node.volume;
    const info = trackInfo(track);

    const container = new ContainerBuilder()
        .setAccentColor(paused ? COLOR_PAUSED : COLOR_PLAYING)
        .addTextDisplayComponents(text(paused ? '-# ⏸️ PAUSED' : '-# ▶️ NOW PLAYING'));

    if (info.thumbnail) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(info.thumbnail)),
        );
    }

    const requester = track.requestedBy ? ` · requested by <@${track.requestedBy.id}>` : '';
    container
        .addTextDisplayComponents(
            text(titleLine(info)),
            text(`**${escapeMd(track.author || 'Unknown artist')}**${requester}`),
            text(progressLine(queue)),
        )
        .addSeparatorComponents(separator())
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                button('seek:-10000', '⏪ 10s', ButtonStyle.Secondary, !seekable),
                button('prev', '⏮️', ButtonStyle.Secondary, queue.history.isEmpty()),
                paused
                    ? button('toggle', '▶️ Resume', ButtonStyle.Success)
                    : button('toggle', '⏸️ Pause', ButtonStyle.Primary),
                button('skip', '⏭️', ButtonStyle.Secondary, queued === 0),
                button('seek:10000', '10s ⏩', ButtonStyle.Secondary, !seekable),
            ),
            new ActionRowBuilder().addComponents(
                button('vol:-10', '🔉', ButtonStyle.Secondary, volume <= 0),
                button('vol:10', '🔊', ButtonStyle.Secondary, volume >= 100),
                button('goto', '⏱️ Go to', ButtonStyle.Secondary, !seekable),
                button('stop', '⏹️', ButtonStyle.Danger),
                button('leave', '👋', ButtonStyle.Danger),
            ),
        )
        .addSeparatorComponents(separator());

    const upNext = next
        ? `**Up next:** ${escapeMd((next.title || 'Unknown title').slice(0, 150))} · \`${next.duration}\``
        : '**Up next:** nothing queued';
    const status = [`🔊 ${volume}%`, `${queued} in queue`, REPEAT_LABELS[queue.repeatMode] || '']
        .filter(Boolean)
        .join(' · ');
    container.addTextDisplayComponents(text(upNext), text(`-# ${status}`));

    return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function buildEndedPanel(info, statusText) {
    const container = new ContainerBuilder()
        .setAccentColor(COLOR_ENDED)
        .addTextDisplayComponents(text(`-# ${statusText}`));
    if (info) {
        container.addTextDisplayComponents(text(titleLine(info)));
    }
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function stopTimer(entry) {
    if (entry?.interval) clearInterval(entry.interval);
}

function forget(guildId, entry) {
    stopTimer(entry);
    if (panels.get(guildId) === entry) panels.delete(guildId);
}

/** Edits the existing panel with the latest state (no-op if unchanged, busy or missing). */
export async function refreshPanel(queue) {
    const guildId = queue.guild.id;
    const entry = panels.get(guildId);
    if (!entry || !queue.currentTrack) return;

    // Never stack edits: if one is still in flight (e.g. waiting on a rate limit), skip this tick.
    if (entry.editing) return;
    if (entry.skipTicks > 0) {
        entry.skipTicks--;
        return;
    }

    let payload;
    try {
        payload = buildPanel(queue);
    } catch (error) {
        console.error('[NowPlaying] Could not build panel:', error.message);
        return;
    }
    const render = JSON.stringify(payload);
    if (render === entry.lastRender) return;

    entry.editing = true;
    const started = Date.now();
    try {
        await entry.message.edit(payload);
        entry.lastRender = render;
        entry.track = trackInfo(queue.currentTrack);
        if (Date.now() - started > SLOW_EDIT_MS) entry.skipTicks = BACKOFF_TICKS;
    } catch (error) {
        if (error?.status === 429 || error?.name === 'RateLimitError') {
            entry.skipTicks = BACKOFF_TICKS;
        } else {
            // Message was deleted or is no longer editable: stop tracking it.
            forget(guildId, entry);
        }
    } finally {
        entry.editing = false;
    }
}

/** Posts a fresh panel for the current track, replacing any previous one. */
export async function showPanel(queue) {
    const channel = queue.metadata?.channel;
    if (!channel) return;

    const guildId = queue.guild.id;
    const previous = panels.get(guildId);
    forget(guildId, previous);
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

    const entry = {
        message,
        interval: null,
        lastRender: JSON.stringify(payload),
        editing: false,
        skipTicks: 0,
        track: trackInfo(queue.currentTrack),
    };
    entry.interval = setInterval(() => refreshPanel(queue), UPDATE_INTERVAL_MS);
    panels.set(guildId, entry);
}

/** Freezes the panel with a final status and no controls. */
export async function closePanel(guildId, statusText) {
    const entry = panels.get(guildId);
    if (!entry) return;
    forget(guildId, entry);
    await entry.message.edit(buildEndedPanel(entry.track, statusText)).catch(() => {});
}

/** Lets an interaction handler adopt the message it just updated as the tracked panel state. */
export function markRendered(guildId, payload) {
    const entry = panels.get(guildId);
    if (entry) entry.lastRender = JSON.stringify(payload);
}
