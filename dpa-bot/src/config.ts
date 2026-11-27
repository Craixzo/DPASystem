import 'dotenv/config';

function required(key: string): string {
  const v = process.env[key]?.trim();
  if (!v) throw new Error(`Missing required env var ${key} (see .env.example)`);
  return v;
}
function optional(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v ? v : undefined;
}
function list(key: string): string[] {
  return (process.env[key] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

const staffRoleIds = list('STAFF_ROLE_IDS');

export const config = {
  token: required('DISCORD_TOKEN'),
  guildId: required('GUILD_ID'),
  dbPath: optional('DB_PATH') ?? './data/dpa.sqlite',

  staffRoleIds,
  // Falls back to staff roles if not set
  mapManagerRoleIds: list('MAP_MANAGER_ROLE_IDS').length ? list('MAP_MANAGER_ROLE_IDS') : staffRoleIds,

  channels: {
    roleRequests: optional('ROLE_REQUEST_CHANNEL_ID'),
    roleReview: optional('ROLE_REVIEW_CHANNEL_ID'),
    ticketPanel: optional('TICKET_PANEL_CHANNEL_ID'),
    conflictBoard: optional('CONFLICT_BOARD_CHANNEL_ID'),
    conflictAnnouncements: optional('CONFLICT_ANNOUNCE_CHANNEL_ID') ?? optional('CONFLICT_BOARD_CHANNEL_ID'),
    maps: optional('MAPS_CHANNEL_ID'),
    registry: optional('REGISTRY_CHANNEL_ID'),
    log: optional('LOG_CHANNEL_ID'),
  },
  categories: {
    tickets: optional('TICKET_CATEGORY_ID'),
    conflicts: optional('CONFLICT_CATEGORY_ID'),
    // Comma-separated; the bot uses the first one with room (Discord caps categories at 50 channels)
    archive: list('ARCHIVE_CATEGORY_IDS'),
  },

  maxRepsPerNation: Number(optional('MAX_REPS_PER_NATION') ?? 2),
  deleteConflictRoleOnEnd: (optional('DELETE_CONFLICT_ROLE_ON_END') ?? 'true') !== 'false',
  iconUrl: optional('EMBED_ICON_URL'),

  // Staff pings: conflicts with no messages for this many days (0 = off), and expired ceasefires
  staffPingChannel: optional('STAFF_PING_CHANNEL_ID') ?? optional('LOG_CHANNEL_ID'),
  inactivityDays: Number(optional('INACTIVITY_DAYS') ?? 3),
};
