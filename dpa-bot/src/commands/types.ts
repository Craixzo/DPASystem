import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { Conflicts } from '../db.js';
import { truncate } from '../util.js';

export interface Command {
  data: { name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  execute(interaction: ChatInputCommandInteraction): Promise<unknown>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<unknown>;
}

/** Shared autocomplete for any `conflict` option. Value sent back is the conflict id. */
export async function conflictAutocomplete(interaction: AutocompleteInteraction, status?: 'active' | 'ended') {
  const focused = interaction.options.getFocused();
  const list = Conflicts.search(String(focused), status);
  await interaction.respond(
    list.map((c) => ({
      name: truncate(`${c.status === 'active' ? '🟢' : '⚫'} ${c.name}`, 100),
      value: String(c.id),
    })),
  );
}
