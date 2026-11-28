import { Client, type MessageCreateOptions } from 'discord.js';
import { config } from './config.js';
import { getKv, setKv } from './db.js';
import { requestPanelEmbed } from './commands/participants.js';
import { ticketPanel } from './tickets.js';

/**
 * Keeps one bot message in a channel up to date: edits it if it still exists,
 * posts it if it's missing or the channel ID changed. Runs on every startup.
 */
async function ensurePanel(client: Client, key: string, channelId: string | undefined, payload: MessageCreateOptions) {
  if (!channelId) return;
  const stored = getKv(key);
  if (stored) {
    const [storedChannel, messageId] = stored.split(':');
    if (storedChannel === channelId) {
      try {
        const ch = await client.channels.fetch(channelId);
        if (ch?.isTextBased()) {
          const msg = await ch.messages.fetch(messageId);
          await msg.edit({ embeds: payload.embeds, components: payload.components ?? [] });
          return;
        }
      } catch {
        /* message was deleted — post a new one below */
      }
    }
  }
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch?.isSendable()) {
    console.warn(`[panels] can't post ${key}: channel ${channelId} not found or no permission`);
    return;
  }
  const msg = await ch.send(payload);
  setKv(key, `${msg.channelId}:${msg.id}`);
}

export async function ensurePanels(client: Client) {
  await ensurePanel(client, 'panel:tickets', config.channels.tickets, ticketPanel());
  await ensurePanel(client, 'panel:requests', config.channels.roleRequests, { embeds: [requestPanelEmbed()] });
}
