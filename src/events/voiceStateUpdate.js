import { Events } from 'discord.js';
import { useQueue } from 'discord-player';

export default {
    name: Events.VoiceStateUpdate,
    execute(oldState, newState) {
        // Ignore if the user just muted/deafened themselves (their channel didn't change)
        if (oldState.channelId === newState.channelId) return;

        // Check if there is an active music queue in this server
        const queue = useQueue(oldState.guild.id);
        if (!queue) return;

        // If this queue wasn't started with /play-me, it won't have a host. Do nothing.
        if (!queue.playMeHost) return;

        // If the person who triggered this event is our designated host
        if (oldState.member.id === queue.playMeHost) {
            const botChannelId = oldState.guild.members.me.voice.channelId;
            
            // Check if the host moved to a DIFFERENT channel or disconnected entirely (null)
            if (newState.channelId !== botChannelId) {
                
                // Send a goodbye message to the text channel
                if (queue.playMeChannel) {
                    queue.playMeChannel.send(`👋 My host <@${oldState.member.id}> left, so I'm clearing the queue and heading out!`);
                }

                // Destroying the queue automatically clears all songs and disconnects the bot
                queue.delete();
            }
        }
    },
};