import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { mapsEmbed, refreshMapsBoard } from '../boards.js';
import { config, registryChannel } from '../config.js';
import { Maps, Registry } from '../db.js';
import { errorEmbed, okEmbed, unEmbed } from '../theme.js';
import { audit, canUseMaps, isRobloxGameUrl, isStaff, memberOf, sendTo, splitNations, truncate, ts } from '../util.js';
import type { Command } from './types.js';

const eph = MessageFlags.Ephemeral;

// ───────────────────────── /maps ─────────────────────────
export const maps: Command = {
  data: new SlashCommandBuilder()
    .setName('maps')
    .setDescription('Recommended battle maps')
    .addSubcommand((s) => s.setName('list').setDescription('Show recommended maps'))
    .addSubcommand((s) =>
      s.setName('add').setDescription('Add a map')
        .addStringOption((o) => o.setName('name').setDescription('Map name').setRequired(true).setMaxLength(80))
        .addStringOption((o) => o.setName('link').setDescription('roblox.com/games/… link').setRequired(true))
        .addStringOption((o) => o.setName('description').setDescription('Short description').setMaxLength(200)))
    .addSubcommand((s) =>
      s.setName('remove').setDescription('Remove a map')
        .addStringOption((o) => o.setName('name').setDescription('Map').setRequired(true).setAutocomplete(true))),

  async execute(i) {
    if (!canUseMaps(memberOf(i))) return i.reply({ embeds: [errorEmbed('You don\'t have permission to use this command.')], flags: eph });
    const sub = i.options.getSubcommand();
    if (sub === 'list') return i.reply({ embeds: [mapsEmbed()] });

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
    if (!canUseMaps(memberOf(i))) return i.respond([]);
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
      await sendTo(i.client, registryChannel(entry.type), { embeds: [unEmbed(0xc0392b).setDescription(`🚫 Registry #${id} **${entry.name}** revoked.\n**Reason:** ${reason}`)] });
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

// ───────────────────────── /dpa-help ─────────────────────────
export const help: Command = {
  data: new SlashCommandBuilder().setName('dpa-help').setDescription('List DPA bot commands'),
  async execute(i) {
    const embed = unEmbed()
      .setTitle('🇺🇳 DPA Bot — Commands')
      .addFields(
        { name: 'Everyone', value: ['`/conflict` — details of a conflict', '`/conflicts` — list active / past conflicts', '`/participants` — representatives in a conflict', '`/request-role` — request to represent your nation', '`/registry list` — treaties & criminal orgs', '`/treaty view` — a treaty\'s details'].join('\n') },
        { name: 'Staff', value: ['`/start-war` — open a conflict (renames the channel)', '`/stop-war` — record the outcome & archive', '`/war ceasefire | resume` — pause / resume a conflict', '`/war add-nation | remove-nation | document | rename | side-name | set-outcome`', '`/treaty add | remove` — register or remove a treaty', '`/remove-participant` — remove a rep (reason required)', '`/registry revoke`'].join('\n') },
        { name: 'Map roles', value: '`/maps list` • `/maps add` • `/maps remove`' },
      );
    return i.reply({ embeds: [embed], flags: eph });
  },
};
