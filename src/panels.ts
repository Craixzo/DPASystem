import { Client, type MessageCreateOptions } from 'discord.js';
import { findOwnMessage, TITLES } from './boards.js';
import { config } from './config.js';
import { setKv } from './db.js';
import { requestPanelEmbed } from './commands/participants.js';
import { ticketPanel } from './tickets.js';

/**
 * Keeps one bot message in a channel up to date: edits the existing one if found
 * (by stored ID, or by scanning the channel for the bot's own post), otherwise posts it.
 */
async function ensurePanel(client: Client, key: string, channelId: string | undefined, title: string, payload: MessageCreateOptions) {
  if (!channelId) return;
  const existing = await findOwnMessage(client, key, channelId, title);
  if (existing) {
    await existing.edit({ embeds: payload.embeds, components: payload.components ?? [] }).catch(() => null);
    return;
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
  await ensurePanel(client, 'panel:tickets', config.channels.tickets, TITLES.tickets, ticketPanel());
  await ensurePanel(client, 'panel:requests', config.channels.roleRequests, TITLES.requests, { embeds: [requestPanelEmbed()] });
}
