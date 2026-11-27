import { EmbedBuilder } from 'discord.js';
import { config } from './config.js';

// United Nations palette
export const Colors = {
  unBlue: 0x009edb, // UN brand blue (un.org)
  flagBlue: 0x5b92e5, // UN flag blue (Pantone 279)
  navy: 0x1a3a5f, // deep accent for archived/neutral
  white: 0xffffff,
  approved: 0x2e9e6b,
  denied: 0xc0392b,
  warning: 0xe8a33d,
};

export const FOOTER = 'United Nations • Department of Political Affairs';

export function unEmbed(color: number = Colors.unBlue): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(color)
    .setFooter({ text: FOOTER, iconURL: config.iconUrl })
    .setTimestamp();
}

export function errorEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder().setColor(Colors.denied).setDescription(`⛔ ${message}`);
}

export function okEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder().setColor(Colors.unBlue).setDescription(`🇺🇳 ${message}`);
}
