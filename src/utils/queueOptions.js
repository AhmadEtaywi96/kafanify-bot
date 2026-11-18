/**
 * Shared queue (node) options used by every command that creates a queue.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export function buildQueueOptions(interaction) {
    return {
        metadata: interaction,
        // Below 100 leaves headroom so loud masters don't clip after PCM processing
        volume: 80,
        selfDeaf: true,
        leaveOnEnd: true,
        leaveOnEndCooldown: 60_000,
        leaveOnEmpty: true,
        leaveOnEmptyCooldown: 60_000,
        bufferingTimeout: 3_000,
        // Unused DSP stages: skipping them keeps the signal clean and saves CPU.
        // Volume and seeker stay enabled.
        disableBiquad: true,
        disableEqualizer: true,
        disableFilterer: true,
        disableResampler: true,
        disableCompressor: true,
        disableReverb: true,
    };
}
