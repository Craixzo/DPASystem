import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { Registry, type RegistryEntry } from '../db.js';
import { Colors, errorEmbed, okEmbed, unEmbed } from '../theme.js';
import { audit, isStaff, isUrl, memberOf, sendTo, splitNations, truncate, ts } from '../util.js';
import type { Command } from './types.js';

const eph = MessageFlags.Ephemeral;

function treatyEmbed(e: RegistryEntry) {
  const d = JSON.parse(e.data) as Record<string, string>;
  const embed = unEmbed(e.status === 'revoked' ? Colors.denied : Colors.unBlue)
    .setTitle(`📜 ${e.name}`)
    .setDescription(`Registry #${e.id} • ${e.status === 'revoked' ? '🚫 Revoked' : '✅ In force'} • Registered ${ts(e.approved_at, 'D')} by <@${e.approved_by}>`)
    .addFields(
      { name: 'Type', value: d.kind || '*Unspecified*', inline: true },
      { name: 'Signed', value: d.signed || '*Unspecified*', inline: true },
      { name: 'Signatories', value: truncate(splitNations(d.nations).join(', '), 1024) },
      { name: 'Document', value: `[Open](${d.document})` },
    );
  if (d.notes) embed.addFields({ name: 'Notes', value: truncate(d.notes, 1024) });
  if (e.status === 'revoked' && e.revoke_reason) embed.addFields({ name: 'Revocation', value: `${e.revoke_reason}${e.revoked_by ? ` — <@${e.revoked_by}>` : ''}` });
  return embed;
}

export const treaty: Command = {
  data: new SlashCommandBuilder()
    .setName('treaty')
    .setDescription('Treaty registry')
    .addSubcommand((s) =>
      s.setName('add').setDescription('Register a treaty directly (staff)')
        .addStringOption((o) => o.setName('name').setDescription('Treaty name').setRequired(true).setMaxLength(100))
        .addStringOption((o) => o.setName('nations').setDescription('Signatory nations, comma-separated').setRequired(true).setMaxLength(1000))
        .addStringOption((o) => o.setName('document').setDescription('Treaty document link').setRequired(true))
        .addStringOption((o) => o.setName('type').setDescription('e.g. Defensive pact, NAP, Trade agreement, Peace treaty').setMaxLength(80))
        .addStringOption((o) => o.setName('signed').setDescription('Date signed, e.g. 26 Nov 2026').setMaxLength(40))
        .addStringOption((o) => o.setName('notes').setDescription('Notes').setMaxLength(500)))
    .addSubcommand((s) =>
      s.setName('remove').setDescription('Remove a treaty (staff)')
        .addStringOption((o) => o.setName('treaty').setDescription('Treaty').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason (posted publicly)').setRequired(true).setMaxLength(500))
        .addBooleanOption((o) => o.setName('delete_record').setDescription('Erase it entirely instead of marking it revoked (default: False)')))
    .addSubcommand((s) =>
      s.setName('view').setDescription('View a treaty')
        .addStringOption((o) => o.setName('treaty').setDescription('Treaty').setRequired(true).setAutocomplete(true))),

  async execute(i) {
    const sub = i.options.getSubcommand();

    const findTreaty = () => {
      const raw = i.options.getString('treaty', true);
      const e = /^\d+$/.test(raw) ? Registry.get(Number(raw)) : Registry.list('treaty', true).find((t) => t.name.toLowerCase() === raw.toLowerCase());
      return e?.type === 'treaty' ? e : undefined;
    };

    if (sub === 'view') {
      const e = findTreaty();
      if (!e) return i.reply({ embeds: [errorEmbed('Treaty not found.')], flags: eph });
      return i.reply({ embeds: [treatyEmbed(e)] });
    }

    if (sub === 'remove') {
      if (!isStaff(memberOf(i))) return i.reply({ embeds: [errorEmbed('Only DPA staff can remove treaties.')], flags: eph });
      const e = findTreaty();
      if (!e) return i.reply({ embeds: [errorEmbed('Treaty not found.')], flags: eph });
      const reason = i.options.getString('reason', true);
      const erase = i.options.getBoolean('delete_record') ?? false;
      if (erase) Registry.delete(e.id);
      else if (!Registry.revoke(e.id, i.user.id, reason)) return i.reply({ embeds: [errorEmbed(`**${e.name}** is already revoked. Use \`delete_record: True\` to erase it.`)], flags: eph });
      await sendTo(i.client, config.channels.treaties, {
        embeds: [unEmbed(Colors.denied).setDescription(`🚫 Treaty #${e.id} **${e.name}** ${erase ? 'removed from the registry' : 'revoked'}.\n**Reason:** ${reason}`)],
      });
      await audit(i.client, erase ? 'Treaty deleted' : 'Treaty revoked', `#${e.id} **${e.name}** — ${reason}\nBy <@${i.user.id}>`, Colors.denied);
      return i.reply({ embeds: [okEmbed(`${erase ? 'Deleted' : 'Revoked'} **${e.name}**.`)], flags: eph });
    }

    // add
    if (!isStaff(memberOf(i))) return i.reply({ embeds: [errorEmbed('Only DPA staff can register treaties directly.')], flags: eph });
    const name = i.options.getString('name', true).trim();
    const nations = splitNations(i.options.getString('nations', true));
    const document = i.options.getString('document', true).trim();
    if (nations.length < 2) return i.reply({ embeds: [errorEmbed('A treaty needs at least two signatory nations.')], flags: eph });
    if (!isUrl(document)) return i.reply({ embeds: [errorEmbed('The document must be a valid link.')], flags: eph });
    if (Registry.list('treaty').some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      return i.reply({ embeds: [errorEmbed(`An active treaty named **${name}** is already registered.`)], flags: eph });
    }

    const data = {
      name,
      nations: nations.join(', '),
      document,
      kind: i.options.getString('type') ?? '',
      signed: i.options.getString('signed') ?? '',
      notes: i.options.getString('notes') ?? '',
    };
    const id = Registry.create({ type: 'treaty', name, data: JSON.stringify(data), ticket_id: null, approved_by: i.user.id });
    const entry = Registry.get(id)!;
    await sendTo(i.client, config.channels.treaties, { embeds: [treatyEmbed(entry).setAuthor({ name: 'TREATY REGISTERED' })] });
    await audit(i.client, 'Treaty registered', `#${id} **${name}** (${nations.join(', ')})\nBy <@${i.user.id}>`, Colors.approved);
    return i.reply({ embeds: [okEmbed(`Registered **${name}** as **#${id}**.${config.channels.treaties ? ` Posted in <#${config.channels.treaties}>.` : ''}`)], flags: eph });
  },

  async autocomplete(i) {
    const q = String(i.options.getFocused()).toLowerCase();
    return i.respond(
      Registry.list('treaty', true)
        .filter((t) => t.name.toLowerCase().includes(q))
        .slice(0, 25)
        .map((t) => ({ name: truncate(`#${t.id} ${t.name}${t.status === 'revoked' ? ' (revoked)' : ''}`, 100), value: String(t.id) })),
    );
  },
};
