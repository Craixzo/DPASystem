import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { conflictEmbed } from '../boards.js';
import { config } from '../config.js';
import { Conflicts, Nations, Tickets, type Conflict, type Outcome, type Side } from '../db.js';
import { endConflict, lockToConflict, postAnnouncement, refreshConflictViews } from '../conflictOps.js';
import { Colors, errorEmbed, okEmbed, unEmbed } from '../theme.js';
import {
  audit,
  channelName,
  isStaff,
  isUrl,
  memberOf,
  OUTCOME_CHOICES,
  outcomeLabel,
  resolveConflict,
  splitNations,
  truncate,
  ts,
} from '../util.js';
import { conflictAutocomplete, type Command } from './types.js';

const eph = MessageFlags.Ephemeral;

function denyIfNotStaff(i: ChatInputCommandInteraction): boolean {
  if (isStaff(memberOf(i))) return false;
  void i.reply({ embeds: [errorEmbed('Only DPA staff can use this command.')], flags: eph });
  return true;
}

// ───────────────────────── /start-war ─────────────────────────
export const startWar: Command = {
  data: new SlashCommandBuilder()
    .setName('start-war')
    .setDescription('Open a conflict. Renames this channel to the war name (run inside a conflict ticket).')
    .addStringOption((o) => o.setName('name').setDescription('Official conflict name').setRequired(true).setMaxLength(90))
    .addStringOption((o) => o.setName('side_a_nations').setDescription('Comma-separated nations on Side A (defaults to the ticket)').setMaxLength(1000))
    .addStringOption((o) => o.setName('side_b_nations').setDescription('Comma-separated nations on Side B (defaults to the ticket)').setMaxLength(1000))
    .addStringOption((o) => o.setName('side_a_name').setDescription('Label for Side A, e.g. "Northern Coalition"').setMaxLength(60))
    .addStringOption((o) => o.setName('side_b_name').setDescription('Label for Side B').setMaxLength(60))
    .addStringOption((o) => o.setName('ultimatum').setDescription('Ultimatum document link (defaults to the ticket)'))
    .addBooleanOption((o) => o.setName('new_channel').setDescription('Create a fresh channel instead of converting this one')),

  async execute(i) {
    if (denyIfNotStaff(i)) return;
    const name = i.options.getString('name', true).trim();
    if (Conflicts.byName(name)) return i.reply({ embeds: [errorEmbed(`A conflict named **${name}** already exists.`)], flags: eph });

    const ticket = Tickets.byChannel(i.channelId);
    const ticketData = ticket?.type === 'conflict' ? (JSON.parse(ticket.data) as Record<string, string>) : {};
    const sideA = splitNations(i.options.getString('side_a_nations') ?? ticketData.sideA);
    const sideB = splitNations(i.options.getString('side_b_nations') ?? ticketData.sideB);
    const ultimatum = i.options.getString('ultimatum') ?? ticketData.ultimatum ?? null;
    if (ultimatum && !isUrl(ultimatum)) return i.reply({ embeds: [errorEmbed('The ultimatum must be a valid link.')], flags: eph });
    const overlap = sideA.filter((a) => sideB.some((b) => b.toLowerCase() === a.toLowerCase()));
    if (overlap.length) return i.reply({ embeds: [errorEmbed(`A nation can't be on both sides: ${overlap.join(', ')}`)], flags: eph });

    const newChannel = i.options.getBoolean('new_channel') ?? false;
    const here = i.channel;
    if (!newChannel) {
      if (!(here instanceof TextChannel)) return i.reply({ embeds: [errorEmbed('Run this in a text channel, or set `new_channel: True`.')], flags: eph });
      if (Conflicts.byChannel(here.id)) return i.reply({ embeds: [errorEmbed('This channel already belongs to a conflict.')], flags: eph });
      const allowedParents = [config.categories.tickets, config.categories.conflicts].filter(Boolean);
      if (!ticket && !allowedParents.includes(here.parentId ?? '')) {
        return i.reply({
          embeds: [errorEmbed('This isn\'t a ticket or conflict channel. Run it inside a conflict ticket, or set `new_channel: True` to create one.')],
          flags: eph,
        });
      }
    }

    await i.deferReply({ flags: eph });
    const guild = i.guild!;

    const role = await guild.roles.create({ name: `⚔ ${name}`.slice(0, 100), mentionable: false, reason: `Conflict "${name}" started by ${i.user.tag}` });

    let channel: TextChannel;
    if (newChannel) {
      channel = await guild.channels.create({
        name: channelName(name),
        type: ChannelType.GuildText,
        parent: config.categories.conflicts,
        topic: `Conflict: ${name}`,
        permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }],
      });
    } else {
      channel = here as TextChannel;
      await channel.edit({
        name: channelName(name),
        topic: `Conflict: ${name}`,
        ...(config.categories.conflicts ? { parent: config.categories.conflicts, lockPermissions: false } : {}),
      });
    }
    await lockToConflict(channel, role.id);

    const id = Conflicts.create({
      name,
      channel_id: channel.id,
      role_id: role.id,
      side_a_name: i.options.getString('side_a_name') ?? 'Side A',
      side_b_name: i.options.getString('side_b_name') ?? 'Side B',
      ultimatum_url: ultimatum,
      ticket_id: ticket?.id ?? null,
      started_by: i.user.id,
    });
    sideA.forEach((n) => Nations.add(id, 'A', n));
    sideB.forEach((n) => Nations.add(id, 'B', n));
    if (ticket) Tickets.update(ticket.id, { status: 'converted' });
    if (ticket?.type === 'conflict') await guild.members.addRole({ user: ticket.opener_id, role: role.id }).catch(() => null);

    const c = Conflicts.get(id)!;
    await channel.send({
      content: ticket ? `<@${ticket.opener_id}>` : undefined,
      embeds: [
        unEmbed().setTitle(`⚔️ ${name} has begun`).setDescription(
          'This channel is now the official conflict channel.\n' +
            `• Staff: \`/war document\` to file rosters & war terms, \`/war add-nation\` to add belligerents.\n` +
            `• Representatives request access in <#${config.channels.roleRequests ?? i.channelId}> with \`/request-role\`.`,
        ),
        conflictEmbed(c),
      ],
    });
    await postAnnouncement(i.client, c);
    await refreshConflictViews(i.client, id, true);
    await audit(i.client, 'Conflict started', `**${name}** in <#${channel.id}> by <@${i.user.id}>`, Colors.unBlue);

    return i.editReply({ embeds: [okEmbed(`**${name}** started in <#${channel.id}>.`)] });
  },
};

// ───────────────────────── /stop-war ─────────────────────────
export const stopWar: Command = {
  data: new SlashCommandBuilder()
    .setName('stop-war')
    .setDescription('End a conflict, record the outcome, and archive its channel.')
    .addStringOption((o) => o.setName('outcome').setDescription('How the conflict ended').setRequired(true).addChoices(...OUTCOME_CHOICES))
    .addStringOption((o) => o.setName('notes').setDescription('Summary / peace terms note').setMaxLength(900))
    .addStringOption((o) => o.setName('conflict').setDescription('Defaults to this channel\'s conflict').setAutocomplete(true)),

  async execute(i) {
    if (denyIfNotStaff(i)) return;
    const c = resolveConflict(i);
    if (!c) return i.reply({ embeds: [errorEmbed('No conflict found. Pick one with the `conflict` option.')], flags: eph });
    if (c.status !== 'active') return i.reply({ embeds: [errorEmbed(`**${c.name}** has already concluded. Use \`/war set-outcome\` to correct it.`)], flags: eph });

    await i.deferReply({ flags: eph });
    const outcome = i.options.getString('outcome', true) as Outcome;
    const warnings = await endConflict(i.client, c, outcome, i.options.getString('notes'), i.user.id);
    const ended = Conflicts.get(c.id)!;
    return i.editReply({
      embeds: [okEmbed(`**${c.name}** concluded — ${outcomeLabel(ended)}.${warnings.length ? `\n⚠️ ${warnings.join('\n⚠️ ')}` : ''}`)],
    });
  },
  autocomplete: (i) => conflictAutocomplete(i, 'active'),
};

// ───────────────────────── /war … (management) ─────────────────────────
const conflictOpt = (o: import('discord.js').SlashCommandStringOption) =>
  o.setName('conflict').setDescription('Defaults to this channel\'s conflict').setAutocomplete(true);

export const war: Command = {
  data: new SlashCommandBuilder()
    .setName('war')
    .setDescription('Manage a conflict (staff)')
    .addSubcommand((s) =>
      s.setName('add-nation').setDescription('Add nation(s) to a side')
        .addStringOption((o) => o.setName('side').setDescription('Which side').setRequired(true).addChoices({ name: 'Side A', value: 'A' }, { name: 'Side B', value: 'B' }))
        .addStringOption((o) => o.setName('nations').setDescription('Comma-separated nation names').setRequired(true).setMaxLength(1000))
        .addStringOption(conflictOpt))
    .addSubcommand((s) =>
      s.setName('remove-nation').setDescription('Remove a nation from a conflict')
        .addStringOption((o) => o.setName('nation').setDescription('Nation').setRequired(true).setAutocomplete(true))
        .addStringOption(conflictOpt))
    .addSubcommand((s) =>
      s.setName('document').setDescription('File a roster or war terms document')
        .addStringOption((o) => o.setName('type').setDescription('Document type').setRequired(true).addChoices(
          { name: 'Side A roster', value: 'roster_a_url' },
          { name: 'Side B roster', value: 'roster_b_url' },
          { name: 'War terms', value: 'terms_url' },
          { name: 'Ultimatum', value: 'ultimatum_url' },
        ))
        .addStringOption((o) => o.setName('link').setDescription('Document link').setRequired(true))
        .addStringOption(conflictOpt))
    .addSubcommand((s) =>
      s.setName('rename').setDescription('Rename the conflict (and its channel/role)')
        .addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true).setMaxLength(90))
        .addStringOption(conflictOpt))
    .addSubcommand((s) =>
      s.setName('side-name').setDescription('Set a side\'s label')
        .addStringOption((o) => o.setName('side').setDescription('Which side').setRequired(true).addChoices({ name: 'Side A', value: 'A' }, { name: 'Side B', value: 'B' }))
        .addStringOption((o) => o.setName('label').setDescription('e.g. "Eastern Pact"').setRequired(true).setMaxLength(60))
        .addStringOption(conflictOpt))
    .addSubcommand((s) =>
      s.setName('set-outcome').setDescription('Change the recorded outcome of a concluded conflict')
        .addStringOption((o) => o.setName('outcome').setDescription('Outcome').setRequired(true).addChoices(...OUTCOME_CHOICES))
        .addStringOption((o) => o.setName('notes').setDescription('Summary note').setMaxLength(900))
        .addStringOption(conflictOpt)),

  async execute(i) {
    if (denyIfNotStaff(i)) return;
    const c = resolveConflict(i);
    if (!c) return i.reply({ embeds: [errorEmbed('No conflict found. Pick one with the `conflict` option.')], flags: eph });
    const sub = i.options.getSubcommand();
    const done = async (msg: string) => {
      await refreshConflictViews(i.client, c.id);
      await audit(i.client, `Conflict updated: ${sub}`, `**${c.name}** — ${msg}\nBy <@${i.user.id}>`);
      return i.reply({ embeds: [okEmbed(msg)], flags: eph });
    };

    if (sub !== 'set-outcome' && c.status !== 'active') {
      return i.reply({ embeds: [errorEmbed(`**${c.name}** is concluded and can't be edited (except \`set-outcome\`).`)], flags: eph });
    }

    switch (sub) {
      case 'add-nation': {
        const side = i.options.getString('side', true) as Side;
        const nations = splitNations(i.options.getString('nations', true));
        const added: string[] = [];
        const skipped: string[] = [];
        for (const n of nations) {
          const existing = Nations.find(c.id, n);
          if (existing) skipped.push(`${n} (already on Side ${existing.side})`);
          else if (Nations.add(c.id, side, n)) added.push(n);
        }
        return done(`Added to **${side === 'A' ? c.side_a_name : c.side_b_name}**: ${added.join(', ') || 'nothing'}${skipped.length ? `\nSkipped: ${skipped.join(', ')}` : ''}`);
      }
      case 'remove-nation': {
        const nation = i.options.getString('nation', true);
        if (!Nations.remove(c.id, nation)) return i.reply({ embeds: [errorEmbed(`**${nation}** isn't part of this conflict.`)], flags: eph });
        return done(`Removed **${nation}**. Its representatives keep access until removed with \`/remove-participant\`.`);
      }
      case 'document': {
        const type = i.options.getString('type', true) as 'roster_a_url' | 'roster_b_url' | 'terms_url' | 'ultimatum_url';
        const url = i.options.getString('link', true);
        if (!isUrl(url)) return i.reply({ embeds: [errorEmbed('That isn\'t a valid link.')], flags: eph });
        Conflicts.update(c.id, { [type]: url });
        const label = { roster_a_url: `${c.side_a_name} roster`, roster_b_url: `${c.side_b_name} roster`, terms_url: 'War terms', ultimatum_url: 'Ultimatum' }[type];
        if (c.channel_id) {
          const ch = await i.client.channels.fetch(c.channel_id).catch(() => null);
          if (ch?.isSendable()) await ch.send({ embeds: [unEmbed().setDescription(`📄 **${label}** filed by <@${i.user.id}>: [open document](${url})`)] });
        }
        return done(`Filed **${label}**.`);
      }
      case 'rename': {
        const name = i.options.getString('name', true).trim();
        const clash = Conflicts.byName(name);
        if (clash && clash.id !== c.id) return i.reply({ embeds: [errorEmbed('Another conflict already uses that name.')], flags: eph });
        Conflicts.update(c.id, { name });
        const notes: string[] = [];
        if (c.channel_id) {
          const ch = await i.client.channels.fetch(c.channel_id).catch(() => null);
          if (ch instanceof TextChannel) {
            // Discord allows ~2 renames per channel per 10 minutes; don't hang on the rate limit.
            const res = await Promise.race([
              ch.edit({ name: channelName(name), topic: `Conflict: ${name}` }).then(() => true).catch(() => false),
              new Promise<boolean>((r) => setTimeout(() => r(false), 8000)),
            ]);
            if (!res) notes.push('Channel rename is rate-limited by Discord — it will apply shortly or try again in ~10 min.');
          }
        }
        if (c.role_id) await i.guild!.roles.edit(c.role_id, { name: `⚔ ${name}`.slice(0, 100) }).catch(() => null);
        return done(`Renamed **${c.name}** → **${name}**.${notes.length ? `\n⚠️ ${notes.join(' ')}` : ''}`);
      }
      case 'side-name': {
        const side = i.options.getString('side', true) as Side;
        const label = i.options.getString('label', true);
        Conflicts.update(c.id, side === 'A' ? { side_a_name: label } : { side_b_name: label });
        return done(`Side ${side} is now labelled **${label}**.`);
      }
      case 'set-outcome': {
        if (c.status !== 'ended') return i.reply({ embeds: [errorEmbed('This conflict is still active — use `/stop-war`.')], flags: eph });
        const outcome = i.options.getString('outcome', true) as Outcome;
        const notes = i.options.getString('notes');
        Conflicts.update(c.id, { outcome, ...(notes !== null ? { outcome_notes: notes } : {}) });
        return done(`Outcome set to ${outcomeLabel(Conflicts.get(c.id)!)}.`);
      }
    }
  },

  async autocomplete(i) {
    const focused = i.options.getFocused(true);
    if (focused.name === 'conflict') return conflictAutocomplete(i);
    if (focused.name === 'nation') {
      const raw = i.options.getString('conflict');
      const c = raw ? (/^\d+$/.test(raw) ? Conflicts.get(Number(raw)) : Conflicts.byName(raw)) : Conflicts.byChannel(i.channelId);
      const nations = c ? Nations.forConflict(c.id) : [];
      const q = focused.value.toLowerCase();
      return i.respond(nations.filter((n) => n.nation.toLowerCase().includes(q)).slice(0, 25).map((n) => ({ name: `${n.nation} (Side ${n.side})`, value: n.nation })));
    }
    return i.respond([]);
  },
};

// ───────────────────────── /conflict & /conflicts ─────────────────────────
export const conflict: Command = {
  data: new SlashCommandBuilder()
    .setName('conflict')
    .setDescription('View a conflict\'s sides, documents, representatives and outcome')
    .addStringOption((o) => o.setName('name').setDescription('Conflict').setRequired(true).setAutocomplete(true))
    .addBooleanOption((o) => o.setName('private').setDescription('Only show it to you')),
  async execute(i) {
    const c = resolveConflict(i, 'name');
    if (!c) return i.reply({ embeds: [errorEmbed('Conflict not found.')], flags: eph });
    return i.reply({ embeds: [conflictEmbed(c)], flags: i.options.getBoolean('private') ? eph : undefined });
  },
  autocomplete: (i) => conflictAutocomplete(i),
};

export const conflicts: Command = {
  data: new SlashCommandBuilder()
    .setName('conflicts')
    .setDescription('List conflicts')
    .addStringOption((o) => o.setName('filter').setDescription('Which conflicts').addChoices(
      { name: 'Active', value: 'active' },
      { name: 'Concluded', value: 'ended' },
      { name: 'All', value: 'all' },
    )),
  async execute(i) {
    const filter = (i.options.getString('filter') ?? 'active') as 'active' | 'ended' | 'all';
    const list: Conflict[] = Conflicts.list(filter === 'all' ? undefined : filter, 30);
    const body = list.length
      ? list.map((c) => `${c.status === 'active' ? '🟢' : '⚫'} **${c.name}** — ${c.status === 'active' ? `since ${ts(c.started_at, 'D')}` : outcomeLabel(c)}`).join('\n')
      : '*None.*';
    const title = { active: 'Active conflicts', ended: 'Concluded conflicts', all: 'All conflicts' }[filter];
    return i.reply({ embeds: [unEmbed().setTitle(`🇺🇳 ${title}`).setDescription(truncate(body, 4000))] });
  },
};
