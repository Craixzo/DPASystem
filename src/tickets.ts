import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  OverwriteType,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
  type Message,
  type OverwriteResolvable,
} from 'discord.js';
import { TITLES } from './boards.js';
import { config, registryChannel } from './config.js';
import { Registry, Tickets, type Ticket, type TicketType } from './db.js';
import { staffOverwrites } from './conflictOps.js';
import { Colors, errorEmbed, okEmbed, unEmbed } from './theme.js';
import { audit, dm, isStaff, isUrl, memberOf, sendTo, splitNations, truncate } from './util.js';

const eph = MessageFlags.Ephemeral;

const TYPES: Record<TicketType, { label: string; emoji: string; description: string; prefix: string }> = {
  crimorg: { label: 'Register a Criminal Organization', emoji: '🕶️', description: 'Register a non-state criminal group', prefix: 'crimorg' },
  treaty: { label: 'Register a Treaty', emoji: '📜', description: 'Nations involved + treaty document', prefix: 'treaty' },
  conflict: { label: 'Register a Conflict', emoji: '⚔️', description: 'Nations involved + ultimatum document', prefix: 'conflict' },
};

// ───────────────────────── panel ─────────────────────────
export function ticketPanel() {
  const embed = unEmbed()
    .setTitle(TITLES.tickets)
    .setDescription(
      [
        'Select a request type below to open a private ticket with DPA staff.',
        '',
        `${TYPES.crimorg.emoji} **Criminal Organization** — register a non-state criminal group.`,
        `${TYPES.treaty.emoji} **Treaty** — the nations it's between and a link to the treaty document.`,
        `${TYPES.conflict.emoji} **Conflict** — the nations it's between and the ultimatum document.`,
      ].join('\n'),
    );
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket:open')
    .setPlaceholder('Choose a request type…')
    .addOptions(
      (Object.keys(TYPES) as TicketType[]).map((k) => ({ label: TYPES[k].label, value: k, emoji: TYPES[k].emoji, description: TYPES[k].description })),
    );
  return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)] };
}

const row = (input: TextInputBuilder) => new ActionRowBuilder<TextInputBuilder>().addComponents(input);
const short = (id: string, label: string, required = true, max = 100) =>
  new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(max);
const para = (id: string, label: string, required = true, max = 1000) =>
  new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Paragraph).setRequired(required).setMaxLength(max);

function modalFor(type: TicketType): ModalBuilder {
  const m = new ModalBuilder().setCustomId(`ticket:modal:${type}`).setTitle(TYPES[type].label);
  if (type === 'crimorg') {
    m.addComponents(
      row(short('name', 'Organization name', true, 80)),
      row(short('leader', 'Leader (Roblox username)', true, 40)),
      row(short('operates', 'Nation(s) it operates in', true, 200)),
      row(para('description', 'Description & activities')),
      row(short('document', 'Charter / document link (optional)', false, 300)),
    );
  } else if (type === 'treaty') {
    m.addComponents(
      row(short('name', 'Treaty name', true, 100)),
      row(para('nations', 'Signatory nations (comma-separated)', true, 500)),
      row(short('kind', 'Type (e.g. defensive pact, NAP, trade)', true, 80)),
      row(short('document', 'Treaty document link', true, 300)),
      row(para('notes', 'Notes (optional)', false, 500)),
    );
  } else {
    m.addComponents(
      row(para('sideA', 'Aggressor nations (comma-separated)', true, 500)),
      row(para('sideB', 'Defender nations (comma-separated)', true, 500)),
      row(short('ultimatum', 'Ultimatum document link', true, 300)),
      row(para('casus', 'Casus belli / summary', true, 1000)),
      row(short('proposedName', 'Proposed conflict name (optional)', false, 90)),
    );
  }
  return m;
}

export async function handleTicketSelect(i: StringSelectMenuInteraction) {
  const type = i.values[0] as TicketType;
  const open = Tickets.openForUser(i.user.id, type);
  if (open) return i.reply({ embeds: [errorEmbed(`You already have an open ${TYPES[type].label.toLowerCase()} ticket: <#${open.channel_id}>`)], flags: eph });
  return i.showModal(modalFor(type));
}

function ticketSummary(type: TicketType, d: Record<string, string>) {
  const e = unEmbed().setTitle(`${TYPES[type].emoji} ${TYPES[type].label}`);
  if (type === 'crimorg') {
    e.addFields(
      { name: 'Organization', value: d.name, inline: true },
      { name: 'Leader', value: d.leader, inline: true },
      { name: 'Operates in', value: d.operates, inline: true },
      { name: 'Description', value: truncate(d.description, 1024) },
      { name: 'Document', value: d.document ? `[Open](${d.document})` : '*None*' },
    );
  } else if (type === 'treaty') {
    e.addFields(
      { name: 'Treaty', value: d.name, inline: true },
      { name: 'Type', value: d.kind, inline: true },
      { name: 'Signatories', value: truncate(splitNations(d.nations).join(', '), 1024) },
      { name: 'Document', value: `[Open](${d.document})` },
    );
    if (d.notes) e.addFields({ name: 'Notes', value: truncate(d.notes, 1024) });
  } else {
    e.addFields(
      { name: '🟦 Side A (aggressors)', value: truncate(splitNations(d.sideA).join(', '), 1024), inline: true },
      { name: '🟥 Side B (defenders)', value: truncate(splitNations(d.sideB).join(', '), 1024), inline: true },
      { name: 'Ultimatum', value: `[Open](${d.ultimatum})` },
      { name: 'Casus belli', value: truncate(d.casus, 1024) },
    );
    if (d.proposedName) e.addFields({ name: 'Proposed name', value: d.proposedName });
  }
  return e;
}

function ticketButtons(t: Pick<Ticket, 'id' | 'type'>, opts: { claimed?: boolean; approved?: boolean } = {}) {
  const r = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ticket:claim:${t.id}`).setLabel(opts.claimed ? 'Claimed' : 'Claim').setEmoji('🙋').setStyle(ButtonStyle.Secondary).setDisabled(!!opts.claimed),
  );
  if (t.type !== 'conflict') {
    r.addComponents(
      new ButtonBuilder().setCustomId(`ticket:approve:${t.id}`).setLabel(opts.approved ? 'Registered' : 'Approve & register').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(!!opts.approved),
    );
  }
  r.addComponents(new ButtonBuilder().setCustomId(`ticket:close:${t.id}`).setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Danger));
  return r;
}

export async function handleTicketModal(i: ModalSubmitInteraction) {
  const type = i.customId.split(':')[2] as TicketType;
  const data: Record<string, string> = {};
  for (const [id, comp] of i.fields.fields) if ('value' in comp && typeof comp.value === 'string') data[id] = comp.value.trim();

  // Validation
  const linkField = type === 'treaty' ? 'document' : type === 'conflict' ? 'ultimatum' : data.document ? 'document' : null;
  if (linkField && !isUrl(data[linkField])) return i.reply({ embeds: [errorEmbed('The document link must be a valid URL (starting with https://). Please try again.')], flags: eph });
  if (type === 'treaty' && splitNations(data.nations).length < 2) return i.reply({ embeds: [errorEmbed('A treaty needs at least two nations.')], flags: eph });
  if (type === 'conflict') {
    if (!splitNations(data.sideA).length || !splitNations(data.sideB).length) return i.reply({ embeds: [errorEmbed('Both sides need at least one nation.')], flags: eph });
  }
  if (Tickets.openForUser(i.user.id, type)) return i.reply({ embeds: [errorEmbed('You already have an open ticket of this type.')], flags: eph });

  await i.deferReply({ flags: eph });
  const guild = i.guild!;
  const overwrites: OverwriteResolvable[] = [
    { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    { id: i.user.id, type: OverwriteType.Member, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
    ...staffOverwrites(),
  ];
  if (guild.members.me) overwrites.push({ id: guild.members.me.id, type: OverwriteType.Member, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] });

  const channel = await guild.channels.create({
    name: `${TYPES[type].prefix}-${i.user.username}`.slice(0, 100),
    type: ChannelType.GuildText,
    parent: config.categories.tickets,
    topic: `${TYPES[type].label} — opened by ${i.user.tag} (${i.user.id})`,
    permissionOverwrites: overwrites,
  });
  const id = Tickets.create({ channel_id: channel.id, opener_id: i.user.id, type, data: JSON.stringify(data) });

  const hint =
    type === 'conflict'
      ? '\n\n**Staff:** once the name is agreed, run `/start-war name:<name>` here. This channel will be renamed and become the conflict channel, with both sides pre-filled from this form.'
      : '\n\n**Staff:** use **Approve & register** to add this to the official registry, then close the ticket.';
  await channel.send({
    content: `<@${i.user.id}> ${config.staffRoleIds.map((r) => `<@&${r}>`).join(' ')}`,
    allowedMentions: { users: [i.user.id], roles: config.staffRoleIds },
    embeds: [
      unEmbed().setDescription(`Thank you — a DPA officer will review your submission shortly.${hint}`),
      ticketSummary(type, data).setFooter({ text: `Ticket #${id} • United Nations • Department of Political Affairs` }),
    ],
    components: [ticketButtons({ id, type })],
  });

  // Reset the panel's dropdown so the same option can be picked again
  if (i.isFromMessage()) await i.message.edit(ticketPanel()).catch(() => null);
  await audit(i.client, 'Ticket opened', `${TYPES[type].label} — <#${channel.id}> by <@${i.user.id}>`);
  return i.editReply({ embeds: [okEmbed(`Ticket opened: <#${channel.id}>`)] });
}

export async function handleTicketButton(i: ButtonInteraction) {
  const [, action, idStr] = i.customId.split(':');
  const t = Tickets.get(Number(idStr));
  if (!t) return i.reply({ embeds: [errorEmbed('Ticket not found.')], flags: eph });
  const staff = isStaff(memberOf(i));

  if (action === 'close') {
    if (!staff && i.user.id !== t.opener_id) return i.reply({ embeds: [errorEmbed('Only staff or the ticket owner can close this.')], flags: eph });
    if (t.status !== 'open') return i.reply({ embeds: [errorEmbed(t.status === 'converted' ? 'This ticket became a conflict channel — use `/stop-war` instead.' : 'Already closed.')], flags: eph });
    return i.showModal(
      new ModalBuilder().setCustomId(`ticket:closemodal:${t.id}`).setTitle('Close ticket').addComponents(row(para('reason', 'Reason', true, 500))),
    );
  }

  if (!staff) return i.reply({ embeds: [errorEmbed('Only DPA staff can do that.')], flags: eph });

  if (action === 'claim') {
    if (t.claimed_by) return i.reply({ embeds: [errorEmbed(`Already claimed by <@${t.claimed_by}>.`)], flags: eph });
    Tickets.update(t.id, { claimed_by: i.user.id });
    await i.update({ components: [ticketButtons(t, { claimed: true, approved: !!Registry.byTicket(t.id) })] });
    return i.followUp({ embeds: [unEmbed().setDescription(`🙋 <@${i.user.id}> is handling this ticket.`)] });
  }

  if (action === 'approve') {
    if (t.type === 'conflict') return i.reply({ embeds: [errorEmbed('Conflicts are approved with `/start-war`.')], flags: eph });
    if (Registry.byTicket(t.id)) return i.reply({ embeds: [errorEmbed('Already registered.')], flags: eph });
    const d = JSON.parse(t.data) as Record<string, string>;
    const regId = Registry.create({ type: t.type, name: d.name, data: t.data, ticket_id: t.id, approved_by: i.user.id });
    await i.update({ components: [ticketButtons(t, { claimed: !!t.claimed_by, approved: true })] });

    const record = ticketSummary(t.type, d)
      .setTitle(`${TYPES[t.type].emoji} ${t.type === 'treaty' ? 'Treaty registered' : 'Criminal organization registered'}: ${d.name}`)
      .setDescription(`Registry #${regId} • Submitted by <@${t.opener_id}> • Approved by <@${i.user.id}>`);
    const posted = registryChannel(t.type);
    await sendTo(i.client, posted, { embeds: [record] });
    await i.followUp({ embeds: [okEmbed(`Registered as **#${regId}**${posted ? ` in <#${posted}>` : ''}. You can close this ticket now.`)] });
    await audit(i.client, 'Registry entry approved', `#${regId} ${t.type} **${d.name}** by <@${i.user.id}>`, Colors.approved);
  }
}

async function transcript(channel: TextChannel): Promise<AttachmentBuilder> {
  const all: Message[] = [];
  let before: string | undefined;
  while (all.length < 2000) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    all.push(...batch.values());
    before = batch.last()!.id;
  }
  const lines = all.reverse().map((m) => {
    const embeds = m.embeds.map((e) => `[embed] ${e.title ?? ''} ${e.description ?? ''} ${e.fields.map((f) => `${f.name}: ${f.value}`).join(' | ')}`).join('\n');
    const files = m.attachments.map((a) => `[file] ${a.url}`).join('\n');
    return `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content}${embeds ? `\n${embeds}` : ''}${files ? `\n${files}` : ''}`;
  });
  return new AttachmentBuilder(Buffer.from(lines.join('\n'), 'utf8'), { name: `${channel.name}-transcript.txt` });
}

export async function handleCloseModal(i: ModalSubmitInteraction) {
  const t = Tickets.get(Number(i.customId.split(':')[2]));
  if (!t || t.status !== 'open') return i.reply({ embeds: [errorEmbed('Ticket is not open.')], flags: eph });
  const reason = i.fields.getTextInputValue('reason');
  await i.reply({ embeds: [unEmbed(Colors.warning).setDescription(`🔒 Closing in 5 seconds…\n**Reason:** ${reason}`)] });
  Tickets.update(t.id, { status: 'closed', closed_at: Date.now(), closed_by: i.user.id, close_reason: reason });

  const channel = i.channel;
  if (channel instanceof TextChannel) {
    const file = await transcript(channel).catch(() => null);
    await sendTo(i.client, config.channels.log, {
      embeds: [
        unEmbed(Colors.navy).setTitle(`Ticket #${t.id} closed`).setDescription(`Type: ${TYPES[t.type].label}\nOpened by <@${t.opener_id}>\nClosed by <@${i.user.id}>\n**Reason:** ${reason}`),
      ],
      files: file ? [file] : [],
    });
    await dm(i.client, t.opener_id, unEmbed(Colors.navy).setTitle('Your DPA ticket was closed').setDescription(`**${TYPES[t.type].label}**\n**Reason:** ${reason}`));
    setTimeout(() => void channel.delete(`Ticket closed by ${i.user.tag}`).catch(() => null), 5000);
  }
}
