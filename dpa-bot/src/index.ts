import { Client, Events, GatewayIntentBits, MessageFlags, type Interaction } from 'discord.js';
import { refreshConflictBoard, refreshMapsBoard } from './boards.js';
import { config } from './config.js';
import { conflict, conflicts, startWar, stopWar, war } from './commands/war.js';
import { handleDenyModal, handleRequestButton, participants, removeParticipant, requestRole } from './commands/participants.js';
import { help, maps, registry, setup } from './commands/misc.js';
import type { Command } from './commands/types.js';
import { handleCloseModal, handleTicketButton, handleTicketModal, handleTicketSelect } from './tickets.js';
import { errorEmbed } from './theme.js';

const commands = new Map<string, Command>(
  [startWar, stopWar, war, conflict, conflicts, requestRole, removeParticipant, participants, maps, registry, setup, help].map((c) => [c.data.name, c]),
);

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  const guild = await c.guilds.fetch(config.guildId);
  await guild.commands.set([...commands.values()].map((cmd) => cmd.data.toJSON()));
  console.log(`Registered ${commands.size} commands in ${guild.name}`);
  await refreshConflictBoard(c).catch((e) => console.warn('board refresh failed', e));
  await refreshMapsBoard(c).catch((e) => console.warn('maps refresh failed', e));
});

async function route(i: Interaction) {
  if (i.isChatInputCommand()) return commands.get(i.commandName)?.execute(i);
  if (i.isAutocomplete()) return commands.get(i.commandName)?.autocomplete?.(i);
  if (i.isStringSelectMenu() && i.customId === 'ticket:open') return handleTicketSelect(i);
  if (i.isButton()) {
    if (i.customId.startsWith('req:')) return handleRequestButton(i);
    if (i.customId.startsWith('ticket:')) return handleTicketButton(i);
  }
  if (i.isModalSubmit()) {
    if (i.customId.startsWith('ticket:modal:')) return handleTicketModal(i);
    if (i.customId.startsWith('ticket:closemodal:')) return handleCloseModal(i);
    if (i.customId.startsWith('req:denymodal:')) return handleDenyModal(i);
  }
}

client.on(Events.InteractionCreate, async (i) => {
  try {
    await route(i);
  } catch (err) {
    console.error(err);
    if (i.isRepliable()) {
      const payload = { embeds: [errorEmbed(`Something went wrong: ${(err as Error).message}`)], flags: MessageFlags.Ephemeral } as const;
      if (i.deferred || i.replied) await i.followUp(payload).catch(() => null);
      else await i.reply(payload).catch(() => null);
    }
  }
});

process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
client.login(config.token);
