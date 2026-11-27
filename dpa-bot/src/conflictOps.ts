import {
  CategoryChannel,
  ChannelType,
  Client,
  Guild,
  OverwriteType,
  PermissionFlagsBits,
  type OverwriteResolvable,
  TextChannel,
} from 'discord.js';
import { announcementEmbed, conflictEmbed, refreshConflictBoard, updateAnnouncement } from './boards.js';
import { config } from './config.js';
import { Conflicts, db, type Conflict } from './db.js';
import { Colors, unEmbed } from './theme.js';
import { audit, outcomeLabel } from './util.js';

const VIEW = PermissionFlagsBits.ViewChannel;
const SEND = PermissionFlagsBits.SendMessages;
const HISTORY = PermissionFlagsBits.ReadMessageHistory;
const ATTACH = PermissionFlagsBits.AttachFiles;
const EMBED = PermissionFlagsBits.EmbedLinks;

export function staffOverwrites(): OverwriteResolvable[] {
  return config.staffRoleIds.map((id) => ({ id, type: OverwriteType.Role, allow: [VIEW, SEND, HISTORY, ATTACH, EMBED] }));
}

/** Makes a channel private to a conflict role + staff, keeping any existing member overwrites (e.g. ticket opener). */
export async function lockToConflict(channel: TextChannel, roleId: string) {
  const guild = channel.guild;
  await channel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false });
  await channel.permissionOverwrites.edit(roleId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true });
  for (const id of config.staffRoleIds) {
    await channel.permissionOverwrites.edit(id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true });
  }
  if (guild.members.me) await channel.permissionOverwrites.edit(guild.members.me, { ViewChannel: true, SendMessages: true, ManageChannels: true });
}

async function pickArchiveCategory(guild: Guild): Promise<CategoryChannel | null> {
  for (const id of config.categories.archive) {
    const cat = await guild.channels.fetch(id).catch(() => null);
    if (cat?.type === ChannelType.GuildCategory && cat.children.cache.size < 50) return cat;
  }
  return null;
}

/** Public, read-only, moved into the archive category. */
export async function archiveChannel(channel: TextChannel): Promise<string | null> {
  const guild = channel.guild;
  const overwrites: OverwriteResolvable[] = [
    {
      id: guild.roles.everyone.id,
      type: OverwriteType.Role,
      allow: [VIEW, HISTORY],
      deny: [
        SEND,
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.CreatePrivateThreads,
        PermissionFlagsBits.SendMessagesInThreads,
      ],
    },
    ...staffOverwrites(),
  ];
  if (guild.members.me) overwrites.push({ id: guild.members.me.id, type: OverwriteType.Member, allow: [VIEW, SEND, PermissionFlagsBits.ManageChannels] });

  let warning: string | null = null;
  const archive = await pickArchiveCategory(guild);
  if (archive) {
    await channel.setParent(archive.id, { lockPermissions: false });
  } else {
    warning = config.categories.archive.length
      ? 'All archive categories are full (50 channels). Add another ID to ARCHIVE_CATEGORY_IDS.'
      : 'ARCHIVE_CATEGORY_IDS is not set, so the channel was not moved.';
  }
  await channel.permissionOverwrites.set(overwrites);
  return warning;
}

/** Re-renders everything that shows this conflict. */
export async function refreshConflictViews(client: Client, conflictId: number, repostBoard = false) {
  const c = Conflicts.get(conflictId);
  if (!c) return;
  await updateAnnouncement(client, c);
  await refreshConflictBoard(client, repostBoard);
}

export async function endConflict(
  client: Client,
  c: Conflict,
  outcome: NonNullable<Conflict['outcome']>,
  notes: string | null,
  endedBy: string,
): Promise<string[]> {
  const warnings: string[] = [];
  Conflicts.update(c.id, { status: 'ended', outcome, outcome_notes: notes, ended_by: endedBy, ended_at: Date.now() });
  db.prepare("UPDATE participants SET status = 'denied', reason = 'Conflict concluded before review', reviewed_at = ? WHERE conflict_id = ? AND status = 'pending'")
    .run(Date.now(), c.id);
  const ended = Conflicts.get(c.id)!;

  if (c.channel_id) {
    const channel = await client.channels.fetch(c.channel_id).catch(() => null);
    if (channel instanceof TextChannel) {
      await channel.send({
        embeds: [
          unEmbed(Colors.navy)
            .setTitle('📁 Conflict concluded')
            .setDescription(`**Outcome:** ${outcomeLabel(ended)}${notes ? `\n> ${notes}` : ''}\n\nThis channel is now archived and read-only.`),
          conflictEmbed(ended),
        ],
      });
      try {
        const w = await archiveChannel(channel);
        if (w) warnings.push(w);
      } catch (err) {
        warnings.push(`Could not archive the channel: ${(err as Error).message}`);
      }
    } else {
      warnings.push('The conflict channel no longer exists.');
    }
  }

  if (c.role_id && config.deleteConflictRoleOnEnd) {
    const guild = await client.guilds.fetch(config.guildId);
    await guild.roles.delete(c.role_id, `Conflict "${c.name}" concluded`).catch(() => warnings.push('Could not delete the conflict role.'));
    Conflicts.update(c.id, { role_id: null });
  }

  await refreshConflictViews(client, c.id);
  await audit(client, 'Conflict concluded', `**${c.name}** — ${outcomeLabel(ended)}\nBy <@${endedBy}>`, Colors.navy);
  return warnings;
}

export async function postAnnouncement(client: Client, c: Conflict) {
  const id = config.channels.conflictAnnouncements;
  if (!id) return;
  const ch = await client.channels.fetch(id).catch(() => null);
  if (!ch?.isSendable()) return;
  const msg = await ch.send({ embeds: [announcementEmbed(c)] });
  Conflicts.update(c.id, { announce_channel_id: msg.channelId, announce_message_id: msg.id });
}
