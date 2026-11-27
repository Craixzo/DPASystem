# DPA Bot — UN Department of Political Affairs

Discord bot for running conflicts, representative requests, a registry ticket desk, a treaty and criminal-organization register, and a maps board.
TypeScript · discord.js v14 · SQLite · hosted on Railway.

---

## 1. Discord setup

1. **Developer Portal → your app → Bot**
   - Enable the **Server Members** intent.
   - Copy the token (goes in Railway, never in the repo).
2. **Invite** with scopes `bot applications.commands` and these permissions (or Administrator):
   Manage Channels · Manage Roles · View Channels · Send Messages · Embed Links · Attach Files · Read Message History
3. **Server Settings → Roles:** drag the bot's role **above** where conflict roles will be created, or it can't assign them.
4. Create the channels and categories listed in `variables.example` and copy their IDs (Developer Mode → right-click → Copy ID).

## 2. Railway setup

1. New service from your GitHub repo. Railway runs `npm run build`, then `npm start`.
2. **Variables → Raw Editor:** paste `variables.example`, fill in the values, save.
   The bot only reads these variables. It reads nothing from disk, so secrets never touch the repo.
3. **Add a Volume** mounted at `/data` and keep `DB_PATH=/data/dpa.sqlite`.
   Without a volume, the database is wiped on every deploy.
4. Deploy. Slash commands register to your server automatically on start.

## 3. First run in Discord

The bot can't put a dropdown or instructions in a channel until something tells it to, so run these once:

| Where | Command |
|---|---|
| Ticket channel | `/setup panel: Ticket panel` |
| Role-request channel | `/setup panel: Role-request instructions` |

The conflicts board and the maps post are created automatically on startup. `/setup` only re-creates them if someone deletes them.

---

## How it works

### Conflicts
1. A member opens a **Register a Conflict** ticket (both sides plus the ultimatum link).
2. Staff agree a name and run `/start-war name:…` in the ticket. The channel is renamed, moved to the conflict category, and locked to a new `⚔ <name>` role. Sides are filled in from the ticket, an announcement is posted, and the board updates.
3. Representatives run `/request-role` in the request channel. Staff **Approve** or **Deny** in the review channel (a denial needs a reason). Limits: 2 reps per nation, active conflicts only.
4. `/war document` files rosters and war terms.
5. Optional: `/war ceasefire` pauses the war and `/war resume` lifts the pause.
6. `/stop-war outcome:…` records the result. The channel becomes public and read-only and moves to the archive category, and the announcement and board update.

Only staff can name or rename a conflict (`/start-war`, `/war rename`).

### Tickets
Dropdown with three options: **Criminal Organization**, **Treaty**, **Conflict**.
- Treaty and criminal-organization tickets have an **Approve & register** button.
  - Treaties are posted to `TREATY_CHANNEL_ID`.
  - Criminal organizations are posted to `REGISTERED_ENTITIES_CHANNEL_ID`.
- Closing a ticket asks for a reason and saves a transcript to the log channel.

### Staff pings
Every 30 minutes the bot pings staff in `STAFF_PING_CHANNEL_ID` about:
- conflicts with no messages for `INACTIVITY_DAYS` days (repeats at most once per that period)
- ceasefires that have passed their expiry time

---

## Commands

| Command | Who | What |
|---|---|---|
| `/start-war` | Staff | Open a conflict; renames the current channel (or `new_channel: True`) |
| `/stop-war` | Staff | Record the outcome and archive the channel |
| `/war ceasefire` · `resume` | Staff | Pause / resume a conflict (optional `hours` expiry) |
| `/war add-nation` · `remove-nation` | Staff | Manage belligerents |
| `/war document` | Staff | File rosters, war terms, ultimatum |
| `/war rename` · `side-name` | Staff | Rename the conflict / label a side |
| `/war set-outcome` | Staff | Correct a concluded conflict's result |
| `/remove-participant` | Staff | Remove a rep; the reason is required and DMed to them |
| `/treaty add` · `remove` | Staff | Register or remove a treaty (`remove` revokes, or erases with `delete_record: True`) |
| `/registry revoke` | Staff | Revoke any treaty or criminal organization by number |
| `/setup` | Staff | Post the ticket panel / request instructions |
| `/maps list` · `add` · `remove` | `MAP_ROLE_IDS` only | Maps; `add`/`remove` update the #dpa-maps post |
| `/conflict` | Everyone | Full card: sides, documents, reps, outcome |
| `/conflicts` | Everyone | Active / concluded / all |
| `/participants` | Everyone | Reps in a conflict (staff also see pending) |
| `/request-role` | Everyone | Request to represent a nation |
| `/treaty view` | Everyone | One treaty's details |
| `/registry list` | Everyone | Treaties or criminal organizations, filterable by nation |
| `/dpa-help` | Everyone | Command list |

Any `conflict` option autocompletes, and defaults to the conflict of the channel you're in.

---

## Local testing (optional)
Put the variables in a `.env` file (git-ignored) and run `npm run dev:local`.

## Notes
- Discord limits channel renames to about 2 per channel per 10 minutes. `/war rename` warns if it hits that limit.
- A category holds at most 50 channels. List several IDs in `ARCHIVE_CATEGORY_IDS` and the bot moves on to the next when one fills up.
