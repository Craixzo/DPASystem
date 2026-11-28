import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { TITLES } from '../boards.js';
import { config } from '../config.js';
import { Conflicts, Nations, Participants, type Conflict, type Participant } from '../db.js';
import { refreshConflictViews } from '../conflictOps.js';
import { Colors, errorEmbed, okEmbed, unEmbed } from '../theme.js';
import { audit, dm, isStaff, memberOf, resolveConflict, sendTo, truncate } from '../util.js';
import { conflictAutocomplete, type Command } from './types.js';

const eph = MessageFlags.Ephemeral;
const sideName = (c: Conflict, side: 'A' | 'B') => (side === 'A' ? c.side_a_name : c.side_b_name);

function reviewEmbed(p: Participant, c: Conflict, color: number = Colors.unBlue, statusLine?: string) {
  const reps = Participants.approvedCount(c.id, p.nation);
  return unEmbed(color)
    .setTitle('📨 Conflict access request')
    .setDescription(statusLine ?? '**Status:** ⏳ Pending review')
    .addFields(
      { name: 'Applicant', value: `<@${p.user_id}> (\`${p.user_id}\`)`, inline: true },
      { name: 'Roblox', value: p.roblox, inline: true },
      { name: 'Conflict', value: c.name, inline: true },
      { name: 'Nation', value: p.nation, inline: true },
      { name: 'Side', value: sideName(c, p.side), inline: true },
      { name: 'Nation reps', value: `${reps}/${config.maxRepsPerNation} approved`, inline: true },
      { name: 'Information provided', value: truncate(p.info || '*None*', 1024) },
    )
    .setFooter({ text: `Request #${p.id} • United Nations • Department of Political Affairs` });
}

function reviewButtons(id: number, disabled = false) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`req:approve:${id}`).setLabel('Approve').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`req:deny:${id}`).setLabel('Deny').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
}

// ───────────────────────── /request-role ─────────────────────────
export const requestRole: Command = {
  data: new SlashCommandBuilder()
    .setName('request-role')
    .setDescription('Request to represent your nation in an active conflict')
    .addStringOption((o) => o.setName('conflict').setDescription('Active conflict').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('nation').setDescription('Nation you represent').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('roblox_username').setDescription('Your Roblox username').setRequired(true).setMaxLength(40))
    .addStringOption((o) => o.setName('details').setDescription('Your position in the nation, group link, etc.').setRequired(true).setMaxLength(900)),

  async execute(i) {
    if (config.channels.roleRequests && i.channelId !== config.channels.roleRequests) {
      return i.reply({ embeds: [errorEmbed(`Role requests can only be made in <#${config.channels.roleRequests}>.`)], flags: eph });
    }
    const c = resolveConflict(i);
    if (!c) return i.reply({ embeds: [errorEmbed('That conflict doesn\'t exist. Pick one from the list.')], flags: eph });
    if (c.status !== 'active') return i.reply({ embeds: [errorEmbed(`**${c.name}** has concluded — you can't join a former conflict.`)], flags: eph });

    const nation = Nations.find(c.id, i.options.getString('nation', true).trim());
    if (!nation) return i.reply({ embeds: [errorEmbed(`That nation isn't a belligerent in **${c.name}**. Pick one from the list, or contact staff.`)], flags: eph });

    const existing = Participants.activeForUser(c.id, i.user.id);
    if (existing) {
      return i.reply({ embeds: [errorEmbed(`You already have ${existing.status === 'pending' ? 'a pending request' : 'access'} for **${c.name}** (representing ${existing.nation}).`)], flags: eph });
    }
    if (Participants.approvedCount(c.id, nation.nation) >= config.maxRepsPerNation) {
      return i.reply({ embeds: [errorEmbed(`**${nation.nation}** already has ${config.maxRepsPerNation} representatives in **${c.name}**.`)], flags: eph });
    }

    const id = Participants.create({
      conflict_id: c.id,
      user_id: i.user.id,
      nation: nation.nation,
      side: nation.side,
      roblox: i.options.getString('roblox_username', true).trim(),
      info: i.options.getString('details', true).trim(),
    });
    const p = Participants.get(id)!;

    const reviewChannel = config.channels.roleReview ?? config.channels.log;
    const msg = await sendTo(i.client, reviewChannel, {
      content: config.staffRoleIds.length ? config.staffRoleIds.map((r) => `<@&${r}>`).join(' ') : undefined,
      allowedMentions: { roles: config.staffRoleIds },
      embeds: [reviewEmbed(p, c)],
      components: [reviewButtons(id)],
    });
    if (msg) Participants.update(id, { review_channel_id: msg.channelId, review_message_id: msg.id });

    return i.reply({
      embeds: [okEmbed(`Request submitted to represent **${nation.nation}** (${sideName(c, nation.side)}) in **${c.name}**. You'll get a DM once staff review it.`)],
      flags: eph,
    });
  },

  async autocomplete(i) {
    const focused = i.options.getFocused(true);
    if (focused.name === 'conflict') return conflictAutocomplete(i, 'active');
    if (focused.name === 'nation') {
      const raw = i.options.getString('conflict');
      const c = raw && /^\d+$/.test(raw) ? Conflicts.get(Number(raw)) : raw ? Conflicts.byName(raw) : undefined;
      if (!c || c.status !== 'active') return i.respond([]);
      const q = focused.value.toLowerCase();
      return i.respond(
        Nations.forConflict(c.id)
          .filter((n) => n.nation.toLowerCase().includes(q))
          .slice(0, 25)
          .map((n) => {
            const count = Participants.approvedCount(c.id, n.nation);
            const full = count >= config.maxRepsPerNation;
            return { name: truncate(`${n.nation} — ${sideName(c, n.side)} (${count}/${config.maxRepsPerNation}${full ? ' FULL' : ''})`, 100), value: n.nation };
          }),
      );
    }
    return i.respond([]);
  },
};

// ───────────────────────── review buttons ─────────────────────────
export async function handleRequestButton(i: ButtonInteraction) {
  const [, action, idStr] = i.customId.split(':');
  if (!isStaff(memberOf(i))) return i.reply({ embeds: [errorEmbed('Only DPA staff can review requests.')], flags: eph });
  const p = Participants.get(Number(idStr));
  if (!p) return i.reply({ embeds: [errorEmbed('Request not found.')], flags: eph });
  const c = Conflicts.get(p.conflict_id)!;
  if (p.status !== 'pending') {
    await i.update({ components: [reviewButtons(p.id, true)] }).catch(() => null);
    return i.followUp({ embeds: [errorEmbed(`This request was already ${p.status}.`)], flags: eph });
  }

  if (action === 'deny') {
    const modal = new ModalBuilder()
      .setCustomId(`req:denymodal:${p.id}`)
      .setTitle('Deny request')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('reason').setLabel('Reason (sent to the applicant)').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500),
        ),
      );
    return i.showModal(modal);
  }

  // approve
  if (c.status !== 'active') return i.reply({ embeds: [errorEmbed('That conflict has concluded.')], flags: eph });
  if (!Nations.find(c.id, p.nation)) return i.reply({ embeds: [errorEmbed(`${p.nation} is no longer part of this conflict.`)], flags: eph });
  if (Participants.approvedCount(c.id, p.nation) >= config.maxRepsPerNation) {
    return i.reply({ embeds: [errorEmbed(`${p.nation} already has ${config.maxRepsPerNation} approved representatives. Deny this or remove someone first.`)], flags: eph });
  }
  if (!c.role_id) return i.reply({ embeds: [errorEmbed('This conflict has no access role.')], flags: eph });

  const member = await i.guild!.members.fetch(p.user_id).catch(() => null);
  if (!member) return i.reply({ embeds: [errorEmbed('The applicant is no longer in the server.')], flags: eph });
  await member.roles.add(c.role_id, `Approved for ${c.name} by ${i.user.tag}`);
  Participants.update(p.id, { status: 'approved', reviewed_by: i.user.id, reviewed_at: Date.now() });
  const updated = Participants.get(p.id)!;

  await i.update({ embeds: [reviewEmbed(updated, c, Colors.approved, `**Status:** ✅ Approved by <@${i.user.id}>`)], components: [reviewButtons(p.id, true)] });
  await dm(i.client, p.user_id, unEmbed(Colors.approved).setTitle('✅ Request approved').setDescription(`You now represent **${p.nation}** in **${c.name}**.${c.channel_id ? ` Head to <#${c.channel_id}>.` : ''}`));
  await sendTo(i.client, c.channel_id ?? undefined, { embeds: [unEmbed().setDescription(`🪪 <@${p.user_id}> joined as a representative of **${p.nation}** (${sideName(c, p.side)}).`)] });
  await refreshConflictViews(i.client, c.id);
  await audit(i.client, 'Representative approved', `<@${p.user_id}> — ${p.nation} in **${c.name}**\nBy <@${i.user.id}>`, Colors.approved);
}

export async function handleDenyModal(i: ModalSubmitInteraction) {
  if (!isStaff(memberOf(i))) return i.reply({ embeds: [errorEmbed('Only DPA staff can review requests.')], flags: eph });
  const p = Participants.get(Number(i.customId.split(':')[2]));
  if (!p || p.status !== 'pending') return i.reply({ embeds: [errorEmbed('This request is no longer pending.')], flags: eph });
  const c = Conflicts.get(p.conflict_id)!;
  const reason = i.fields.getTextInputValue('reason');
  Participants.update(p.id, { status: 'denied', reviewed_by: i.user.id, reviewed_at: Date.now(), reason });
  const updated = Participants.get(p.id)!;

  const embed = reviewEmbed(updated, c, Colors.denied, `**Status:** ❌ Denied by <@${i.user.id}>\n**Reason:** ${reason}`);
  if (i.isFromMessage()) await i.update({ embeds: [embed], components: [reviewButtons(p.id, true)] });
  else await i.reply({ embeds: [okEmbed('Denied.')], flags: eph });
  await dm(i.client, p.user_id, unEmbed(Colors.denied).setTitle('❌ Request denied').setDescription(`Your request to represent **${p.nation}** in **${c.name}** was denied.\n**Reason:** ${reason}`));
  await audit(i.client, 'Representative denied', `<@${p.user_id}> — ${p.nation} in **${c.name}**\nReason: ${reason}\nBy <@${i.user.id}>`, Colors.denied);
}

// ───────────────────────── /remove-participant ─────────────────────────
export const removeParticipant: Command = {
  data: new SlashCommandBuilder()
    .setName('remove-participant')
    .setDescription('Remove a representative from a conflict (staff)')
    .addUserOption((o) => o.setName('user').setDescription('Representative').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason (required, sent to the user)').setRequired(true).setMaxLength(500))
    .addStringOption((o) => o.setName('conflict').setDescription('Defaults to this channel\'s conflict').setAutocomplete(true)),

  async execute(i) {
    if (!isStaff(memberOf(i))) return i.reply({ embeds: [errorEmbed('Only DPA staff can use this command.')], flags: eph });
    const c = resolveConflict(i);
    if (!c) return i.reply({ embeds: [errorEmbed('No conflict found. Pick one with the `conflict` option.')], flags: eph });
    const user = i.options.getUser('user', true);
    const reason = i.options.getString('reason', true);
    const p = Participants.activeForUser(c.id, user.id);
    if (!p) return i.reply({ embeds: [errorEmbed(`${user} isn't a participant in **${c.name}**.`)], flags: eph });

    Participants.update(p.id, { status: 'removed', reviewed_by: i.user.id, reviewed_at: Date.now(), reason });
    if (c.role_id) {
      const member = await i.guild!.members.fetch(user.id).catch(() => null);
      await member?.roles.remove(c.role_id, `Removed from ${c.name}: ${reason}`).catch(() => null);
    }
    await dm(i.client, user.id, unEmbed(Colors.denied).setTitle('Removed from conflict').setDescription(`You were removed as a representative of **${p.nation}** in **${c.name}**.\n**Reason:** ${reason}`));
    await sendTo(i.client, c.channel_id ?? undefined, { embeds: [unEmbed(Colors.denied).setDescription(`🚪 ${user} was removed as a representative of **${p.nation}**.\n**Reason:** ${reason}`)] });
    await refreshConflictViews(i.client, c.id);
    await audit(i.client, 'Representative removed', `${user} — ${p.nation} in **${c.name}**\nReason: ${reason}\nBy <@${i.user.id}>`, Colors.denied);
    return i.reply({ embeds: [okEmbed(`Removed ${user} from **${c.name}**.`)], flags: eph });
  },
  autocomplete: (i) => conflictAutocomplete(i),
};

// ───────────────────────── /participants ─────────────────────────
export const participants: Command = {
  data: new SlashCommandBuilder()
    .setName('participants')
    .setDescription('List approved representatives and pending requests for a conflict')
    .addStringOption((o) => o.setName('conflict').setDescription('Defaults to this channel\'s conflict').setAutocomplete(true)),
  async execute(i) {
    const c = resolveConflict(i);
    if (!c) return i.reply({ embeds: [errorEmbed('No conflict found.')], flags: eph });
    const approved = Participants.forConflict(c.id, 'approved');
    const pending = isStaff(memberOf(i)) ? Participants.forConflict(c.id, 'pending') : [];
    const fmt = (list: Participant[]) => list.map((p) => `<@${p.user_id}> — **${p.nation}** (${sideName(c, p.side)}) • ${p.roblox}`).join('\n') || '*None*';
    const embed = unEmbed().setTitle(`🪪 Representatives — ${c.name}`).setDescription(truncate(fmt(approved), 4000));
    if (pending.length) embed.addFields({ name: 'Pending (staff only)', value: truncate(fmt(pending), 1024) });
    return i.reply({ embeds: [embed], flags: eph });
  },
  autocomplete: (i) => conflictAutocomplete(i),
};

export function requestPanelEmbed() {
  return unEmbed()
    .setTitle(TITLES.requests)
    .setDescription(
      [
        'To represent your nation in an **active** conflict, use:',
        '```/request-role conflict: nation: roblox_username: details:```',
        `• Each nation may have at most **${config.maxRepsPerNation}** representatives per conflict.`,
        '• Your nation must already be listed as a belligerent.',
        '• You cannot join a concluded conflict.',
        '• DPA staff review every request — you\'ll be DMed the result.',
      ].join('\n'),
    );
}

