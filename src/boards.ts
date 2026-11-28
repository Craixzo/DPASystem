import { Client, EmbedBuilder, type Message } from 'discord.js';
import { config } from './config.js';
import { Conflicts, getKv, Maps, Nations, Participants, setKv, type Conflict } from './db.js';
import { Colors, unEmbed } from './theme.js';
import { inCeasefire, link, outcomeLabel, statusLabel, truncate, ts } from './util.js';

function ceasefireLine(c: Conflict): string {
  return [
    `**Ceasefire since:** ${ts(c.ceasefire_at!)}`,
    c.ceasefire_until ? ` • expires ${ts(c.ceasefire_until, 'R')}` : '',
    c.ceasefire_reason ? `\n> ${truncate(c.ceasefire_reason, 500)}` : '',
  ].join('');
}

function sideLines(c: Conflict) {
  const nations = Nations.forConflict(c.id);
  const a = nations.filter((n) => n.side === 'A').map((n) => n.nation);
  const b = nations.filter((n) => n.side === 'B').map((n) => n.nation);
  return {
    a: a.length ? a.join(', ') : '*No nations listed*',
    b: b.length ? b.join(', ') : '*No nations listed*',
  };
}

/** Full detail card used by /conflict and the start announcement. */
export function conflictEmbed(c: Conflict): EmbedBuilder {
  const sides = sideLines(c);
  const reps = Participants.forConflict(c.id);
  const repLines = (side: 'A' | 'B') => {
    const list = reps.filter((r) => r.side === side);
    return list.length ? list.map((r) => `<@${r.user_id}> — ${r.nation}`).join('\n') : '*None approved*';
  };

  const e = unEmbed(c.status === 'ended' ? Colors.navy : inCeasefire(c) ? Colors.warning : Colors.unBlue)
    .setTitle(`${c.status === 'ended' ? '📁' : inCeasefire(c) ? '🕊️' : '⚔️'} ${c.name}`)
    .setDescription(
      [
        `**Status:** ${statusLabel(c)}`,
        inCeasefire(c) ? ceasefireLine(c) : null,
        c.status === 'ended' ? `**Outcome:** ${outcomeLabel(c)}` : null,
        c.outcome_notes ? `> ${truncate(c.outcome_notes, 900)}` : null,
        `**Started:** ${ts(c.started_at)} (${ts(c.started_at, 'R')})`,
        c.ended_at ? `**Ended:** ${ts(c.ended_at)}` : null,
        c.channel_id ? `**Channel:** <#${c.channel_id}>` : null,
      ].filter(Boolean).join('\n'),
    )
    .addFields(
      { name: `🟦 ${c.side_a_name}`, value: truncate(sides.a, 1024), inline: true },
      { name: `🟥 ${c.side_b_name}`, value: truncate(sides.b, 1024), inline: true },
      {
        name: '📄 Documents',
        value: [
          `Ultimatum: ${link('View', c.ultimatum_url)}`,
          `War terms: ${link('View', c.terms_url)}`,
          `${c.side_a_name} roster: ${link('View', c.roster_a_url)}`,
          `${c.side_b_name} roster: ${link('View', c.roster_b_url)}`,
        ].join('\n'),
      },
      { name: `Representatives — ${c.side_a_name}`, value: truncate(repLines('A'), 1024), inline: true },
      { name: `Representatives — ${c.side_b_name}`, value: truncate(repLines('B'), 1024), inline: true },
    );
  return e;
}

/** Short card posted to the announcements channel when a war starts; edited when it ends. */
export function announcementEmbed(c: Conflict): EmbedBuilder {
  const sides = sideLines(c);
  const ended = c.status === 'ended';
  const cf = inCeasefire(c);
  return unEmbed(ended ? Colors.navy : cf ? Colors.warning : Colors.unBlue)
    .setAuthor({ name: ended ? 'CONFLICT CONCLUDED' : cf ? 'CEASEFIRE IN EFFECT' : 'CONFLICT DECLARED' })
    .setTitle(c.name)
    .setDescription(
      [
        ended ? `**Outcome:** ${outcomeLabel(c)}` : cf ? ceasefireLine(c) : 'The Department of Political Affairs has recognised a state of armed conflict.',
        ended && c.outcome_notes ? `> ${truncate(c.outcome_notes, 600)}` : null,
        c.channel_id ? `Channel: <#${c.channel_id}>` : null,
        `Started ${ts(c.started_at, 'R')}${c.ended_at ? ` • Ended ${ts(c.ended_at, 'R')}` : ''}`,
      ].filter(Boolean).join('\n'),
    )
    .addFields(
      { name: `🟦 ${c.side_a_name}`, value: truncate(sides.a, 1024), inline: true },
      { name: 'vs', value: '​', inline: true },
      { name: `🟥 ${c.side_b_name}`, value: truncate(sides.b, 1024), inline: true },
    );
}

function boardEmbed(): EmbedBuilder {
  const active = Conflicts.list('active', 25);
  const ended = Conflicts.list('ended', 5);

  const activeText = active.length
    ? active
        .map((c) => {
          const s = sideLines(c);
          return `${inCeasefire(c) ? '🟡 ' : ''}**${c.name}**${inCeasefire(c) ? ' *(ceasefire)*' : ''} ${c.channel_id ? `• <#${c.channel_id}>` : ''}\n🟦 ${truncate(s.a, 120)}\n🟥 ${truncate(s.b, 120)}\nStarted ${ts(c.started_at, 'R')}`;
        })
        .join('\n\n')
    : '*No active conflicts. The world is at peace — for now.*';

  const endedText = ended.length
    ? ended.map((c) => `**${c.name}** — ${outcomeLabel(c)} ${c.ended_at ? `(${ts(c.ended_at, 'D')})` : ''}`).join('\n')
    : '*None yet.*';

  return unEmbed()
    .setTitle(TITLES.conflictBoard)
    .setDescription(truncate(activeText, 4000))
    .addFields({ name: 'Recently concluded', value: truncate(endedText, 1024) });
}

export const TITLES = {
  conflictBoard: '🇺🇳 Active Conflicts Register',
  maps: '🗺️ DPA Recommended Maps',
  tickets: '🇺🇳 Department of Political Affairs — Registry Desk',
  requests: '🪪 Conflict Representation Requests',
};

/**
 * Finds the bot's existing post for `key` in `channelId` so restarts edit it instead of re-sending.
 * 1. Uses the stored message ID if it still exists.
 * 2. Otherwise scans the channel's last 100 messages for the bot's own post with this embed title
 *    (works even if the database was reset). Older duplicates found while scanning are deleted.
 */
export async function findOwnMessage(client: Client, key: string, channelId: string, title: string): Promise<Message | null> {
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch?.isTextBased()) return null;

  const stored = getKv(key);
  if (stored) {
    const [storedChannel, messageId] = stored.split(':');
    if (storedChannel === channelId) {
      const msg = await ch.messages.fetch(messageId).catch(() => null);
      if (msg) return msg;
    }
  }

  const recent = await ch.messages.fetch({ limit: 100 }).catch(() => null);
  if (!recent) return null;
  const mine = [...recent.values()]
    .filter((m) => m.author.id === client.user?.id && m.embeds[0]?.title === title)
    .sort((a, b) => b.createdTimestamp - a.createdTimestamp);
  if (!mine.length) return null;

  const [keep, ...duplicates] = mine;
  for (const d of duplicates) await d.delete().catch(() => null);
  setKv(key, `${keep.channelId}:${keep.id}`);
  return keep;
}

/**
 * Refreshes the live conflict board. With repost=true the old board is deleted and a new
 * one posted at the bottom, so it stays below any new war announcements.
 */
export async function refreshConflictBoard(client: Client, repost = false) {
  const channelId = config.channels.conflictBoard;
  if (!channelId) return;
  const existing = await findOwnMessage(client, 'board:conflicts', channelId, TITLES.conflictBoard);
  const payload = { embeds: [boardEmbed()] };

  if (existing && !repost) {
    await existing.edit(payload).catch(() => null);
    return;
  }
  if (existing) await existing.delete().catch(() => null);
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (ch?.isSendable()) {
    const msg = await ch.send(payload);
    setKv('board:conflicts', `${msg.channelId}:${msg.id}`);
  }
}

export async function updateAnnouncement(client: Client, c: Conflict) {
  if (!c.announce_channel_id || !c.announce_message_id) return;
  try {
    const ch = await client.channels.fetch(c.announce_channel_id);
    if (!ch?.isTextBased()) return;
    const msg = await ch.messages.fetch(c.announce_message_id);
    await msg.edit({ embeds: [announcementEmbed(c)] });
  } catch {
    /* announcement deleted — ignore */
  }
}

export function mapsEmbed(): EmbedBuilder {
  const maps = Maps.list();
  const body = maps.length
    ? maps.map((m, i) => `**${i + 1}. [${m.name}](${m.url})**${m.description ? `\n${truncate(m.description, 200)}` : ''}`).join('\n\n')
    : '*No maps listed yet.*';
  return unEmbed().setTitle(TITLES.maps).setDescription(truncate(body, 4000));
}

export async function refreshMapsBoard(client: Client) {
  const channelId = config.channels.maps;
  if (!channelId) return;
  const existing = await findOwnMessage(client, 'board:maps', channelId, TITLES.maps);
  const payload = { embeds: [mapsEmbed()] };
  if (existing) {
    await existing.edit(payload).catch(() => null);
    return;
  }
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (ch?.isSendable()) {
    const msg = await ch.send(payload);
    setKv('board:maps', `${msg.channelId}:${msg.id}`);
  }
}
