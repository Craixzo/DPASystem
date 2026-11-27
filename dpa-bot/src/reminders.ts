import { Client, SnowflakeUtil, TextChannel } from 'discord.js';
import { config } from './config.js';
import { Conflicts, type Conflict } from './db.js';
import { Colors, unEmbed } from './theme.js';
import { inCeasefire, sendTo, ts } from './util.js';

const CHECK_EVERY_MS = 30 * 60 * 1000; // 30 minutes
const DAY = 86_400_000;

function staffPing() {
  return {
    content: config.staffRoleIds.map((r) => `<@&${r}>`).join(' ') || undefined,
    allowedMentions: { roles: config.staffRoleIds },
  };
}

async function lastActivity(client: Client, c: Conflict): Promise<number> {
  let last = Math.max(c.started_at, c.ceasefire_at ?? 0);
  if (c.channel_id) {
    const ch = await client.channels.fetch(c.channel_id).catch(() => null);
    if (ch instanceof TextChannel && ch.lastMessageId) {
      last = Math.max(last, Number(SnowflakeUtil.timestampFrom(ch.lastMessageId)));
    }
  }
  return last;
}

async function checkConflicts(client: Client) {
  const now = Date.now();
  for (const c of Conflicts.list('active', 200)) {
    // 1) Expired ceasefire
    if (inCeasefire(c) && c.ceasefire_until && c.ceasefire_until <= now && !c.ceasefire_expiry_notified) {
      await sendTo(client, config.staffPingChannel, {
        ...staffPing(),
        embeds: [
          unEmbed(Colors.warning)
            .setTitle('🕊️ Ceasefire expired')
            .setDescription(
              `The ceasefire in **${c.name}**${c.channel_id ? ` (<#${c.channel_id}>)` : ''} expired ${ts(c.ceasefire_until, 'R')}.\n` +
                'Run `/war resume` to lift it, `/war ceasefire` again to extend it, or `/stop-war` to conclude the conflict.',
            ),
        ],
      });
      Conflicts.update(c.id, { ceasefire_expiry_notified: 1 });
    }

    // 2) Inactivity
    if (config.inactivityDays > 0) {
      const threshold = config.inactivityDays * DAY;
      const last = await lastActivity(client, c);
      const quietFor = now - last;
      const sinceReminder = c.last_reminded_at ? now - c.last_reminded_at : Infinity;
      if (quietFor >= threshold && sinceReminder >= threshold) {
        await sendTo(client, config.staffPingChannel, {
          ...staffPing(),
          embeds: [
            unEmbed(Colors.warning)
              .setTitle('⏰ Inactive conflict')
              .setDescription(
                `**${c.name}**${c.channel_id ? ` (<#${c.channel_id}>)` : ''} has had no activity since ${ts(last)} (${ts(last, 'R')}).\n` +
                  `Status: ${inCeasefire(c) ? '🟡 Ceasefire' : '🟢 Active'}\n` +
                  'Check in with the belligerents, or conclude it with `/stop-war`.',
              ),
          ],
        });
        Conflicts.update(c.id, { last_reminded_at: now });
      }
    }
  }
}

export function startReminders(client: Client) {
  const run = () => checkConflicts(client).catch((e) => console.warn('[reminders]', e));
  setTimeout(run, 60_000); // first check a minute after startup
  setInterval(run, CHECK_EVERY_MS);
}
