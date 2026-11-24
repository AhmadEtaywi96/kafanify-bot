import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';

// The bot streams through the yt-dlp binary bundled with youtube-dl-exec
// (node_modules/youtube-dl-exec/bin/yt-dlp), not a system-wide yt-dlp, so `yt-dlp -U` on the
// server doesn't update it. An outdated yt-dlp fails with the same "Sign in to confirm you're
// not a bot" errors as expired cookies, so keep it current automatically.

const require = createRequire(import.meta.url);
const { YOUTUBE_DL_PATH } = require('youtube-dl-exec/src/constants.js');

const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPDATE_TIMEOUT_MS = 2 * 60 * 1000;

function run(args) {
    return new Promise((resolve, reject) => {
        execFile(YOUTUBE_DL_PATH, args, { timeout: UPDATE_TIMEOUT_MS }, (err, stdout, stderr) => {
            if (err) {
                err.message = `${err.message}\n${stderr}`.trim();
                return reject(err);
            }
            resolve(`${stdout}\n${stderr}`.trim());
        });
    });
}

/** Updates the bundled yt-dlp. Logs the result and never throws. */
export async function updateYtDlp() {
    const channel = process.env.YTDLP_CHANNEL; // e.g. "nightly" or "stable"
    try {
        const before = await run(['--version']);
        const output = await run(channel ? ['--update-to', channel] : ['-U']);
        const after = await run(['--version']);
        if (before === after) console.log(`[yt-dlp] ${after} is up to date`);
        else console.log(`[yt-dlp] Updated ${before} -> ${after}`);
        if (process.env.DEBUG === '1') console.log(`[yt-dlp] ${output}`);
    } catch (err) {
        console.warn(`[yt-dlp] Update failed (keeping the current version): ${err.message}`);
    }
}

/** Updates now (in the background) and then once a day. Disable with YTDLP_AUTO_UPDATE=0. */
export function scheduleYtDlpUpdates() {
    if (process.env.YTDLP_AUTO_UPDATE === '0') return;
    updateYtDlp();
    setInterval(updateYtDlp, UPDATE_INTERVAL_MS).unref();
}
