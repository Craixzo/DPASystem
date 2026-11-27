import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(path.dirname(path.resolve(config.dbPath)), { recursive: true });
export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  status TEXT NOT NULL DEFAULT 'active',          -- active | ended
  channel_id TEXT,
  role_id TEXT,
  side_a_name TEXT NOT NULL DEFAULT 'Side A',
  side_b_name TEXT NOT NULL DEFAULT 'Side B',
  ultimatum_url TEXT,
  terms_url TEXT,
  roster_a_url TEXT,
  roster_b_url TEXT,
  outcome TEXT,                                   -- side_a | side_b | stalemate | white_peace | ceasefire | annulled
  outcome_notes TEXT,
  ticket_id INTEGER,
  announce_channel_id TEXT,
  announce_message_id TEXT,
  started_by TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_by TEXT,
  ended_at INTEGER
);
CREATE TABLE IF NOT EXISTS conflict_nations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conflict_id INTEGER NOT NULL REFERENCES conflicts(id) ON DELETE CASCADE,
  side TEXT NOT NULL,                             -- A | B
  nation TEXT NOT NULL COLLATE NOCASE,
  UNIQUE (conflict_id, nation)
);
CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conflict_id INTEGER NOT NULL REFERENCES conflicts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  nation TEXT NOT NULL COLLATE NOCASE,
  side TEXT NOT NULL,
  roblox TEXT NOT NULL,
  info TEXT,
  status TEXT NOT NULL DEFAULT 'pending',         -- pending | approved | denied | removed
  review_channel_id TEXT,
  review_message_id TEXT,
  reviewed_by TEXT,
  reviewed_at INTEGER,
  reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  opener_id TEXT NOT NULL,
  type TEXT NOT NULL,                             -- crimorg | treaty | conflict
  status TEXT NOT NULL DEFAULT 'open',            -- open | closed | converted
  data TEXT NOT NULL,
  claimed_by TEXT,
  created_at INTEGER NOT NULL,
  closed_at INTEGER,
  closed_by TEXT,
  close_reason TEXT
);
CREATE TABLE IF NOT EXISTS registry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                             -- treaty | crimorg
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  ticket_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active',          -- active | revoked
  approved_by TEXT NOT NULL,
  approved_at INTEGER NOT NULL,
  revoked_by TEXT,
  revoke_reason TEXT
);
CREATE TABLE IF NOT EXISTS maps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  url TEXT NOT NULL,
  description TEXT,
  added_by TEXT NOT NULL,
  added_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

// Migrations for columns added after the first release
function addColumn(table: string, column: string, def: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}
addColumn('conflicts', 'ceasefire_at', 'INTEGER');
addColumn('conflicts', 'ceasefire_until', 'INTEGER');
addColumn('conflicts', 'ceasefire_reason', 'TEXT');
addColumn('conflicts', 'ceasefire_by', 'TEXT');
addColumn('conflicts', 'ceasefire_expiry_notified', 'INTEGER NOT NULL DEFAULT 0');
addColumn('conflicts', 'last_reminded_at', 'INTEGER');

// Seed recommended maps once
if (!getKv('maps_seeded')) {
  const ins = db.prepare('INSERT OR IGNORE INTO maps (name, url, description, added_by, added_at) VALUES (?, ?, ?, ?, ?)');
  const now = Date.now();
  ins.run('Raid Grounds', 'https://www.roblox.com/games/18208629822/Raid-Grounds', null, 'system', now);
  ins.run('Multicrew Tank Combat', 'https://www.roblox.com/games/95721658376580/Multicrew-Tank-Combat', null, 'system', now);
  ins.run('Futuretops v2.09', 'https://www.roblox.com/games/5188367351/Futuretops-v2-09', null, 'system', now);
  setKv('maps_seeded', '1');
}

// ---------- Types ----------
export type Side = 'A' | 'B';
export type Outcome = 'side_a' | 'side_b' | 'stalemate' | 'white_peace' | 'ceasefire' | 'annulled';

export interface Conflict {
  id: number;
  name: string;
  status: 'active' | 'ended';
  channel_id: string | null;
  role_id: string | null;
  side_a_name: string;
  side_b_name: string;
  ultimatum_url: string | null;
  terms_url: string | null;
  roster_a_url: string | null;
  roster_b_url: string | null;
  outcome: Outcome | null;
  outcome_notes: string | null;
  ticket_id: number | null;
  announce_channel_id: string | null;
  announce_message_id: string | null;
  started_by: string;
  started_at: number;
  ended_by: string | null;
  ended_at: number | null;
  /** Set while an active conflict is under ceasefire (status stays 'active'). */
  ceasefire_at: number | null;
  ceasefire_until: number | null;
  ceasefire_reason: string | null;
  ceasefire_by: string | null;
  ceasefire_expiry_notified: number;
  last_reminded_at: number | null;
}
export interface ConflictNation { id: number; conflict_id: number; side: Side; nation: string }
export interface Participant {
  id: number;
  conflict_id: number;
  user_id: string;
  nation: string;
  side: Side;
  roblox: string;
  info: string | null;
  status: 'pending' | 'approved' | 'denied' | 'removed';
  review_channel_id: string | null;
  review_message_id: string | null;
  reviewed_by: string | null;
  reviewed_at: number | null;
  reason: string | null;
  created_at: number;
}
export type TicketType = 'crimorg' | 'treaty' | 'conflict';
export interface Ticket {
  id: number;
  channel_id: string;
  opener_id: string;
  type: TicketType;
  status: 'open' | 'closed' | 'converted';
  data: string;
  claimed_by: string | null;
  created_at: number;
  closed_at: number | null;
  closed_by: string | null;
  close_reason: string | null;
}
export interface RegistryEntry {
  id: number;
  type: 'treaty' | 'crimorg';
  name: string;
  data: string;
  ticket_id: number | null;
  status: 'active' | 'revoked';
  approved_by: string;
  approved_at: number;
  revoked_by: string | null;
  revoke_reason: string | null;
}
export interface MapEntry { id: number; name: string; url: string; description: string | null; added_by: string; added_at: number }

// ---------- KV ----------
export function getKv(key: string): string | undefined {
  return (db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined)?.value;
}
export function setKv(key: string, value: string): void {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

// ---------- Conflicts ----------
export const Conflicts = {
  get(id: number) {
    return db.prepare('SELECT * FROM conflicts WHERE id = ?').get(id) as Conflict | undefined;
  },
  byName(name: string) {
    return db.prepare('SELECT * FROM conflicts WHERE name = ?').get(name) as Conflict | undefined;
  },
  byChannel(channelId: string) {
    return db.prepare('SELECT * FROM conflicts WHERE channel_id = ?').get(channelId) as Conflict | undefined;
  },
  search(query: string, status?: 'active' | 'ended') {
    const q = `%${query}%`;
    return (status
      ? db.prepare('SELECT * FROM conflicts WHERE name LIKE ? AND status = ? ORDER BY started_at DESC LIMIT 25').all(q, status)
      : db.prepare('SELECT * FROM conflicts WHERE name LIKE ? ORDER BY status = \'active\' DESC, started_at DESC LIMIT 25').all(q)) as Conflict[];
  },
  list(status?: 'active' | 'ended', limit = 50) {
    return (status
      ? db.prepare('SELECT * FROM conflicts WHERE status = ? ORDER BY COALESCE(ended_at, started_at) DESC LIMIT ?').all(status, limit)
      : db.prepare('SELECT * FROM conflicts ORDER BY started_at DESC LIMIT ?').all(limit)) as Conflict[];
  },
  create(c: Pick<Conflict, 'name' | 'channel_id' | 'role_id' | 'side_a_name' | 'side_b_name' | 'ultimatum_url' | 'ticket_id' | 'started_by'>) {
    const r = db.prepare(`INSERT INTO conflicts (name, channel_id, role_id, side_a_name, side_b_name, ultimatum_url, ticket_id, started_by, started_at)
      VALUES (@name, @channel_id, @role_id, @side_a_name, @side_b_name, @ultimatum_url, @ticket_id, @started_by, @started_at)`)
      .run({ ...c, started_at: Date.now() });
    return Number(r.lastInsertRowid);
  },
  update(id: number, fields: Partial<Omit<Conflict, 'id'>>) {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    db.prepare(`UPDATE conflicts SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...fields, id });
  },
};

export const Nations = {
  forConflict(conflictId: number) {
    return db.prepare('SELECT * FROM conflict_nations WHERE conflict_id = ? ORDER BY side, nation').all(conflictId) as ConflictNation[];
  },
  find(conflictId: number, nation: string) {
    return db.prepare('SELECT * FROM conflict_nations WHERE conflict_id = ? AND nation = ?').get(conflictId, nation) as ConflictNation | undefined;
  },
  add(conflictId: number, side: Side, nation: string) {
    return db.prepare('INSERT OR IGNORE INTO conflict_nations (conflict_id, side, nation) VALUES (?, ?, ?)').run(conflictId, side, nation).changes > 0;
  },
  remove(conflictId: number, nation: string) {
    return db.prepare('DELETE FROM conflict_nations WHERE conflict_id = ? AND nation = ?').run(conflictId, nation).changes > 0;
  },
};

export const Participants = {
  get(id: number) {
    return db.prepare('SELECT * FROM participants WHERE id = ?').get(id) as Participant | undefined;
  },
  create(p: Pick<Participant, 'conflict_id' | 'user_id' | 'nation' | 'side' | 'roblox' | 'info'>) {
    const r = db.prepare(`INSERT INTO participants (conflict_id, user_id, nation, side, roblox, info, created_at)
      VALUES (@conflict_id, @user_id, @nation, @side, @roblox, @info, @created_at)`).run({ ...p, created_at: Date.now() });
    return Number(r.lastInsertRowid);
  },
  update(id: number, fields: Partial<Omit<Participant, 'id'>>) {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    db.prepare(`UPDATE participants SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...fields, id });
  },
  approvedCount(conflictId: number, nation: string) {
    return (db.prepare("SELECT COUNT(*) AS n FROM participants WHERE conflict_id = ? AND nation = ? AND status = 'approved'").get(conflictId, nation) as { n: number }).n;
  },
  activeForUser(conflictId: number, userId: string) {
    return db.prepare("SELECT * FROM participants WHERE conflict_id = ? AND user_id = ? AND status IN ('pending','approved')").get(conflictId, userId) as Participant | undefined;
  },
  forConflict(conflictId: number, status: Participant['status'] = 'approved') {
    return db.prepare('SELECT * FROM participants WHERE conflict_id = ? AND status = ? ORDER BY side, nation').all(conflictId, status) as Participant[];
  },
};

export const Tickets = {
  get(id: number) {
    return db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as Ticket | undefined;
  },
  byChannel(channelId: string) {
    return db.prepare("SELECT * FROM tickets WHERE channel_id = ? AND status = 'open'").get(channelId) as Ticket | undefined;
  },
  openForUser(userId: string, type: TicketType) {
    return db.prepare("SELECT * FROM tickets WHERE opener_id = ? AND type = ? AND status = 'open'").get(userId, type) as Ticket | undefined;
  },
  create(t: Pick<Ticket, 'channel_id' | 'opener_id' | 'type' | 'data'>) {
    const r = db.prepare('INSERT INTO tickets (channel_id, opener_id, type, data, created_at) VALUES (@channel_id, @opener_id, @type, @data, @created_at)')
      .run({ ...t, created_at: Date.now() });
    return Number(r.lastInsertRowid);
  },
  update(id: number, fields: Partial<Omit<Ticket, 'id'>>) {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    db.prepare(`UPDATE tickets SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...fields, id });
  },
};

export const Registry = {
  get(id: number) {
    return db.prepare('SELECT * FROM registry WHERE id = ?').get(id) as RegistryEntry | undefined;
  },
  byTicket(ticketId: number) {
    return db.prepare('SELECT * FROM registry WHERE ticket_id = ?').get(ticketId) as RegistryEntry | undefined;
  },
  create(e: Pick<RegistryEntry, 'type' | 'name' | 'data' | 'ticket_id' | 'approved_by'>) {
    const r = db.prepare('INSERT INTO registry (type, name, data, ticket_id, approved_by, approved_at) VALUES (@type, @name, @data, @ticket_id, @approved_by, @approved_at)')
      .run({ ...e, approved_at: Date.now() });
    return Number(r.lastInsertRowid);
  },
  list(type: RegistryEntry['type'], includeRevoked = false) {
    return db.prepare(`SELECT * FROM registry WHERE type = ? ${includeRevoked ? '' : "AND status = 'active'"} ORDER BY approved_at DESC LIMIT 50`).all(type) as RegistryEntry[];
  },
  revoke(id: number, by: string, reason: string) {
    return db.prepare("UPDATE registry SET status = 'revoked', revoked_by = ?, revoke_reason = ? WHERE id = ? AND status = 'active'").run(by, reason, id).changes > 0;
  },
};

export const Maps = {
  list() {
    return db.prepare('SELECT * FROM maps ORDER BY added_at ASC').all() as MapEntry[];
  },
  search(q: string) {
    return db.prepare('SELECT * FROM maps WHERE name LIKE ? ORDER BY name LIMIT 25').all(`%${q}%`) as MapEntry[];
  },
  add(name: string, url: string, description: string | null, by: string) {
    return db.prepare('INSERT OR IGNORE INTO maps (name, url, description, added_by, added_at) VALUES (?, ?, ?, ?, ?)').run(name, url, description, by, Date.now()).changes > 0;
  },
  remove(name: string) {
    return db.prepare('DELETE FROM maps WHERE name = ?').run(name).changes > 0;
  },
};
