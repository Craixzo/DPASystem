import {
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  GuildMember,
  PermissionFlagsBits,
  type Interaction,
  type SendableChannels,
} from 'discord.js';
import { config } from './config.js';
import { Conflicts, type Conflict, type Outcome } from './db.js';

export function isStaff(member: GuildMember | null | undefined): boolean {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return config.staffRoleIds.some((id) => member.roles.cache.has(id));
}

/** /maps is limited to MAP_ROLE_IDS only — no staff or Administrator bypass. */
export function canUseMaps(member: GuildMember | null | undefined): boolean {
  if (!member) return false;
  return config.mapRoleIds.some((id) => member.roles.cache.has(id));
}

export function memberOf(interaction: Interaction): GuildMember | null {
  return interaction.member instanceof GuildMember ? interaction.member : null;
}

export function channelName(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 100) || 'conflict'
  );
}

export function isUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function isRobloxGameUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return /(^|\.)roblox\.com$/.test(u.hostname) && /\/games\/\d+/.test(u.pathname);
  } catch {
    return false;
  }
}

/** "Yellonia, Vaktovia;  Aurelia" -> ["Yellonia","Vaktovia","Aurelia"] */
export function splitNations(value: string | null | undefined): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  return value
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 80)
    .filter((s) => (seen.has(s.toLowerCase()) ? false : (seen.add(s.toLowerCase()), true)));
}

export const OUTCOME_CHOICES: { name: string; value: Outcome }[] = [
  { name: 'Side A victory', value: 'side_a' },
  { name: 'Side B victory', value: 'side_b' },
  { name: 'Stalemate', value: 'stalemate' },
  { name: 'White peace', value: 'white_peace' },
  { name: 'Ceasefire / negotiated settlement', value: 'ceasefire' },
  { name: 'Annulled by the DPA', value: 'annulled' },
];

export function outcomeLabel(c: Conflict): string {
  switch (c.outcome) {
    case 'side_a': return `🏆 Victory — ${c.side_a_name}`;
    case 'side_b': return `🏆 Victory — ${c.side_b_name}`;
    case 'stalemate': return '⚖️ Stalemate';
    case 'white_peace': return '🕊️ White peace';
    case 'ceasefire': return '🤝 Ceasefire / settlement';
    case 'annulled': return '🚫 Annulled by the DPA';
    default: return 'Ongoing';
  }
}

export const inCeasefire = (c: Conflict) => c.status === 'active' && !!c.ceasefire_at;

export function statusIcon(c: Conflict): string {
  if (c.status === 'ended') return '⚫';
  return inCeasefire(c) ? '🟡' : '🟢';
}

export function statusLabel(c: Conflict): string {
  if (c.status === 'ended') return '⚫ Concluded';
  return inCeasefire(c) ? '🟡 Ceasefire' : '🟢 Active';
}

export const ts = (ms: number, style: 'R' | 'f' | 'D' = 'f') => `<t:${Math.floor(ms / 1000)}:${style}>`;

export function link(label: string, url: string | null | undefined): string {
  return url ? `[${label}](${url})` : '*Not filed*';
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/**
 * Resolves a conflict from a `conflict` option (autocomplete value is the id),
 * falling back to the conflict bound to the current channel.
 */
export function resolveConflict(interaction: ChatInputCommandInteraction, optionName = 'conflict'): Conflict | undefined {
  const raw = interaction.options.getString(optionName);
  if (raw) {
    if (/^\d+$/.test(raw)) {
      const byId = Conflicts.get(Number(raw));
      if (byId) return byId;
    }
    return Conflicts.byName(raw);
  }
  return interaction.channelId ? Conflicts.byChannel(interaction.channelId) : undefined;
}

export async function sendTo(client: Client, channelId: string | undefined, payload: Parameters<SendableChannels['send']>[0]) {
  if (!channelId) return null;
  try {
    const ch = await client.channels.fetch(channelId);
    if (ch && ch.isSendable()) return await ch.send(payload);
  } catch (err) {
    console.warn(`[sendTo] failed for ${channelId}:`, (err as Error).message);
  }
  return null;
}

export async function audit(client: Client, title: string, description: string, color = 0x5b92e5) {
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp();
  await sendTo(client, config.channels.log, { embeds: [embed] });
}

export async function dm(client: Client, userId: string, embed: EmbedBuilder) {
  try {
    const user = await client.users.fetch(userId);
    await user.send({ embeds: [embed] });
    return true;
  } catch {
    return false;
  }
}
