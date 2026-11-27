import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { mapsEmbed, refreshConflictBoard, refreshMapsBoard } from '../boards.js';
import { config } from '../config.js';
import { Maps, Registry } from '../db.js';
import { ticketPanel } from '../tickets.js';
import { errorEmbed, okEmbed, unEmbed } from '../theme.js';
import { audit, canManageMaps, isRobloxGameUrl, isStaff, memberOf, sendTo, splitNations, truncate, ts } from '../util.js';
import { requestPanelEmbed } from './participants.js';
import type { Command } from './types.js';

const eph = MessageFlags.Ephemeral;

// ───────────────────────── /maps ─────────────────────────
export const maps: Command = {
  data: new SlashCommandBuilder()
    .setName('maps')
    .setDescription('Recommended battle maps')
    .addSubcommand((s) => s.setName('list').setDescription('Show recommended maps'))
    .addSubcommand((s) =>
      s.setName('add').setDescription('Add a map (map managers)')
        .addStringOption((o) => o.setName('name').setDescription('Map name').setRequired(true).setMaxLength(80))
        .addStringOption((o) => o.setName('link').setDescription('roblox.com/games/… link').setRequired(true))
        .addStringOption((o) => o.setName('description').setDescription('Short description').setMaxLength(200)))
    .addSubcommand((s) =>
      s.setName('remove').setDescription('Remove a map (map managers)')
        .addStringOption((o) => o.setName('name').setDescription('Map').setRequired(true).setAutocomplete(true))),

  async execute(i) {
    const sub = i.options.getSubcommand();
    if (sub === 'list') return i.reply({ embeds: [mapsEmbed()] });

    if (!canManageMaps(memberOf(i))) return i.reply({ embeds: [errorEmbed('You don\'t have permission to manage maps.')], flags: eph });

    if (sub === 'add') {
      const name = i.options.getString('name', true).trim();
      const url = i.options.getString('link', true).trim();
      if (!isRobloxGameUrl(url)) return i.reply({ embeds: [errorEmbed('Link must be a Roblox game URL, e.g. `https://www.roblox.com/games/123/Name`.')], flags: eph });
      if (!Maps.add(name, url, i.options.getString('description'), i.user.id)) return i.reply({ embeds: [errorEmbed(`A map called **${name}** already exists.`)], flags: eph });
      await refreshMapsBoard(i.client);
      await audit(i.client, 'Map added', `**${name}** — ${url}\nBy <@${i.user.id}>`);
      return i.reply({ embeds: [okEmbed(`Added **${name}**.${config.channels.maps ? ` <#${config.channels.maps}> updated.` : ''}`)], flags: eph });
    }

    const name = i.options.getString('name', true);
    if (!Maps.remove(name)) return i.reply({ embeds: [errorEmbed(`No map called **${name}**.`)], flags: eph });
    await refreshMapsBoard(i.client);
    await audit(i.client, 'Map removed', `**${name}**\nBy <@${i.user.id}>`);
    return i.reply({ embeds: [okEmbed(`Removed **${name}**.`)], flags: eph });
  },

  async autocomplete(i) {
    const q = String(i.options.getFocused());
    return i.respond(Maps.search(q).map((m) => ({ name: m.name, value: m.name })));
  },
};

// ───────────────────────── /registry ─────────────────────────
export const registry: Command = {
  data: new SlashCommandBuilder()
    .setName('registry')
    .setDescription('Registered treaties and criminal organizations')
    .addSubcommand((s) =>
      s.setName('list').setDescription('List registry entries')
        .addStringOption((o) => o.setName('type').setDescription('Type').setRequired(true).addChoices({ name: 'Treaties', value: 'treaty' }, { name: 'Criminal organizations', value: 'crimorg' }))
        .addStringOption((o) => o.setName('nation').setDescription('Only entries involving this nation')))
    .addSubcommand((s) =>
      s.setName('revoke').setDescription('Revoke an entry (staff)')
        .addIntegerOption((o) => o.setName('id').setDescription('Registry #').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(500))),

  async execute(i) {
    if (i.options.getSubcommand() === 'revoke') {
      if (!isStaff(memberOf(i))) return i.reply({ embeds: [errorEmbed('Only DPA staff can revoke entries.')], flags: eph });
      const id = i.options.getInteger('id', true);
      const reason = i.options.getString('reason', true);
      const entry = Registry.get(id);
      if (!entry || !Registry.revoke(id, i.user.id, reason)) return i.reply({ embeds: [errorEmbed('No active entry with that number.')], flags: eph });
      await sendTo(i.client, config.channels.registry, { embeds: [unEmbed(0xc0392b).setDescription(`🚫 Registry #${id} **${entry.name}** revoked.\n**Reason:** ${reason}`)] });
      await audit(i.client, 'Registry entry revoked', `#${id} **${entry.name}** — ${reason}\nBy <@${i.user.id}>`);
      return i.reply({ embeds: [okEmbed(`Revoked #${id} **${entry.name}**.`)], flags: eph });
    }

    const type = i.options.getString('type', true) as 'treaty' | 'crimorg';
    const nation = i.options.getString('nation')?.toLowerCase();
    let entries = Registry.list(type);
    if (nation) {
      entries = entries.filter((e) => {
        const d = JSON.parse(e.data) as Record<string, string>;
        return splitNations(type === 'treaty' ? d.nations : d.operates).some((n) => n.toLowerCase() === nation);
      });
    }
    const body = entries.length
      ? entries.map((e) => {
          const d = JSON.parse(e.data) as Record<string, string>;
          return type === 'treaty'
            ? `**#${e.id} [${e.name}](${d.document})** — ${d.kind}\n${truncate(splitNations(d.nations).join(', '), 200)} • ${ts(e.approved_at, 'D')}`
            : `**#${e.id} ${e.name}** — led by ${d.leader}, operates in ${d.operates} • ${ts(e.approved_at, 'D')}`;
        }).join('\n\n')
      : '*No entries.*';
    return i.reply({ embeds: [unEmbed().setTitle(type === 'treaty' ? '📜 Treaty Registry' : '🕶️ Criminal Organization Registry').setDescription(truncate(body, 4000))] });
  },
};

// ───────────────────────── /setup ─────────────────────────
export const setup: Command = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Post or refresh the bot\'s panels (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) => o.setName('panel').setDescription('Which panel').setRequired(true).addChoices(
      { name: 'Ticket panel (posts here)', value: 'tickets' },
      { name: 'Role-request instructions (posts here)', value: 'requests' },
      { name: 'Active conflicts board', value: 'board' },
      { name: 'Maps board', value: 'maps' },
    )),
  async execute(i) {
    if (!isStaff(memberOf(i))) return i.reply({ embeds: [errorEmbed('Staff only.')], flags: eph });
    const panel = i.options.getString('panel', true);
    const ch = i.channel;
    if (panel === 'tickets' || panel === 'requests') {
      if (!ch || ch.type !== ChannelType.GuildText) return i.reply({ embeds: [errorEmbed('Run this in a text channel.')], flags: eph });
      await ch.send(panel === 'tickets' ? ticketPanel() : { embeds: [requestPanelEmbed()] });
    }
    if (panel === 'board') {
      if (!config.channels.conflictBoard) return i.reply({ embeds: [errorEmbed('Set CONFLICT_BOARD_CHANNEL_ID first.')], flags: eph });
      await refreshConflictBoard(i.client, true);
    }
    if (panel === 'maps') {
      if (!config.channels.maps) return i.reply({ embeds: [errorEmbed('Set MAPS_CHANNEL_ID first.')], flags: eph });
      await refreshMapsBoard(i.client);
    }
    return i.reply({ embeds: [okEmbed('Done.')], flags: eph });
  },
};

// ───────────────────────── /dpa-help ─────────────────────────
export const help: Command = {
  data: new SlashCommandBuilder().setName('dpa-help').setDescription('List DPA bot commands'),
  async execute(i) {
    const embed = unEmbed()
      .setTitle('🇺🇳 DPA Bot — Commands')
      .addFields(
        { name: 'Everyone', value: ['`/conflict` — details of a conflict', '`/conflicts` — list active / past conflicts', '`/participants` — representatives in a conflict', '`/request-role` — request to represent your nation', '`/maps list` — recommended maps', '`/registry list` — treaties & criminal orgs', '`/treaty view` — a treaty\'s details'].join('\n') },
        { name: 'Staff', value: ['`/start-war` — open a conflict (renames the channel)', '`/stop-war` — record the outcome & archive', '`/war ceasefire | resume` — pause / resume a conflict', '`/war add-nation | remove-nation | document | rename | side-name | set-outcome`', '`/treaty add` — register a treaty directly', '`/remove-participant` — remove a rep (reason required)', '`/registry revoke`', '`/setup` — post panels'].join('\n') },
        { name: 'Map managers', value: '`/maps add` • `/maps remove`' },
      );
    return i.reply({ embeds: [embed], flags: eph });
  },
};
