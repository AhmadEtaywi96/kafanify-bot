import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Platform } from 'youtubei.js';

// YouTube cookie handling.
//
// cookies.txt is the single source of truth. yt-dlp reads it on every track and writes rotated
// cookies back into it. Innertube (search/metadata) would normally keep the copy it got at
// startup forever; Google then sees an old, rotated cookie reused next to the new one and logs
// the session out after an hour or two. installCookieSync() makes Innertube send the file's
// current cookies on every request instead.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read env lazily: dotenv.config() runs after ES module imports are evaluated.
export function getCookiesPath() {
    return process.env.YT_COOKIES_PATH || path.join(__dirname, '..', '..', 'cookies.txt');
}

export function getOwnerIds() {
    return (process.env.BOT_OWNER_IDS || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
}

const REQUIRED_AUTH_COOKIES = ['SAPISID', '__Secure-3PSID'];

/**
 * Parses Netscape cookies.txt text.
 * @returns {{ ok: boolean, error?: string, youtubeCount: number, header: string | null }}
 */
export function parseCookies(text) {
    const youtube = [];
    for (let line of text.split(/\r?\n/)) {
        if (line.startsWith('#HttpOnly_')) line = line.slice('#HttpOnly_'.length);
        else if (!line.trim() || line.startsWith('#')) continue;
        const cols = line.split('\t');
        if (cols.length < 7) continue;
        if (!cols[0].endsWith('youtube.com')) continue;
        youtube.push([cols[5], cols[6].trim()]);
    }

    const header = youtube.length ? youtube.map(([k, v]) => `${k}=${v}`).join('; ') : null;
    if (!youtube.length) {
        return { ok: false, error: 'No youtube.com cookies found. Export cookies.txt (Netscape format) while on youtube.com.', youtubeCount: 0, header };
    }
    const names = new Set(youtube.map(([k]) => k));
    const missing = REQUIRED_AUTH_COOKIES.filter((n) => !names.has(n));
    if (missing.length) {
        return { ok: false, error: `Missing login cookies (${missing.join(', ')}). Make sure you are signed in to YouTube when exporting.`, youtubeCount: youtube.length, header };
    }
    return { ok: true, youtubeCount: youtube.length, header };
}

/** Reads and parses the cookies file, or returns null if it doesn't exist. */
export function readCookiesFile(file = getCookiesPath()) {
    if (!fs.existsSync(file)) return null;
    return parseCookies(fs.readFileSync(file, 'utf8'));
}

/** Replaces the cookies file atomically so yt-dlp never reads a half-written file. */
export function writeCookiesFile(text, file = getCookiesPath()) {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, file);
}

// --- Keep Innertube in sync with the file ----------------------------------------------

let cache = { mtimeMs: -1, header: null };

/** Current youtube.com cookie header from the file, re-read only when the file changes. */
export function currentCookieHeader(file = getCookiesPath()) {
    let mtimeMs;
    try {
        mtimeMs = fs.statSync(file).mtimeMs;
    } catch {
        return null; // file missing
    }
    if (mtimeMs !== cache.mtimeMs) {
        try {
            const header = parseCookies(fs.readFileSync(file, 'utf8')).header;
            if (process.env.DEBUG === '1') console.log(`[YouTube] Reloaded cookies from ${file}`);
            cache = { mtimeMs, header };
        } catch {
            // Mid-write or unreadable: keep the previous cookies for this request.
            return cache.header;
        }
    }
    return cache.header;
}

let syncInstalled = false;

/** True when Innertube is running logged in and following the cookie file. */
export function isCookieSyncActive() {
    return syncInstalled;
}

/**
 * Wraps youtubei.js's fetch so every authenticated Innertube request to youtube.com carries
 * the cookies currently in the file (youtubei.js keeps its startup copy in a private field).
 * The extractor still needs a `cookie` option at startup so Innertube treats the session as
 * logged in; only the Cookie header is swapped here.
 */
export function installCookieSync(file = getCookiesPath()) {
    if (syncInstalled) return;
    syncInstalled = true;
    const originalFetch = Platform.shim.fetch;
    Platform.shim.fetch = (input, init) => {
        try {
            const headers = init?.headers;
            if (headers instanceof Headers && headers.has('Cookie')) {
                const url = new URL(typeof input === 'string' ? input : input.url);
                if (url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com')) {
                    const header = currentCookieHeader(file);
                    if (header) headers.set('Cookie', header);
                }
            }
        } catch {
            // Never break a request because of the sync; fall through with the original headers.
        }
        return originalFetch(input, init);
    };
}

// --- Expiry alerts ---------------------------------------------------------------------

const EXPIRED_PATTERNS = [
    /sign in to confirm/i,
    /not a bot/i,
    /cookies are no longer valid/i,
    /cookies have likely been rotated/i,
];
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;
let lastAlertAt = 0;

export function looksLikeCookieFailure(error) {
    if (!error) return false;
    const text = [error.message, error.stderr, error.cause?.message, String(error)]
        .filter(Boolean)
        .join('\n');
    return EXPIRED_PATTERNS.some((re) => re.test(text));
}

/** DMs the bot owners (at most once per cooldown) when an error looks like expired cookies. */
export async function alertIfCookieFailure(client, error) {
    if (looksLikeCookieFailure(error)) await alertCookieProblem(client, "YouTube asked to confirm I'm not a bot");
}

/** DMs the bot owners about a YouTube problem, at most once per cooldown. Never throws. */
export async function alertCookieProblem(client, reason) {
    const now = Date.now();
    if (now - lastAlertAt < ALERT_COOLDOWN_MS) return;
    lastAlertAt = now;

    console.warn(`[YouTube] Cookies look expired or blocked: ${reason}`);
    const owners = getOwnerIds();
    if (!owners.length || !client?.isReady()) return;

    const message = `⚠️ **YouTube cookies look expired** (${reason}).
`
        + 'Export a fresh `cookies.txt` and upload it with `/cookies`. No restart needed.';
    for (const id of owners) {
        try {
            const user = await client.users.fetch(id);
            await user.send(message);
        } catch (err) {
            console.warn(`[YouTube] Could not DM owner ${id}: ${err.message}`);
        }
    }
}
