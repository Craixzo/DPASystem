# DPA Bot — UN Department of Political Affairs

Discord bot for running conflicts, representative requests, a registry ticket desk and a maps board. TypeScript + discord.js v14 + SQLite.

## Setup

1. Discord Developer Portal → your app → **Bot**: enable the **Server Members** intent. Invite with scopes `bot applications.commands` and permissions **Manage Channels, Manage Roles, View Channels, Send Messages, Embed Links, Attach Files, Read Message History** (or Administrator).
2. The bot's role must sit **above** the conflict roles it creates (drag it high in Server Settings → Roles).
3. `cp .env.example .env` and fill in the IDs.
4. `npm install && npm run build && npm start` — slash commands register to your guild automatically on start.
5. In Discord:
   - In your ticket channel: `/setup panel:Ticket panel`
   - In your request channel: `/setup panel:Role-request instructions`
   - `/setup panel:Active conflicts board` and `/setup panel:Maps board`

### Railway
Build `npm run build`, start `npm start`. Add a **Volume** mounted at `/data` and set `DB_PATH=/data/dpa.sqlite` — without a volume the database resets on every deploy.

## Flow

**Conflict:** member opens *Register a Conflict* ticket (both sides + ultimatum) → staff agree a name → `/start-war name:…` in the ticket. The channel is renamed, moved to the conflict category, locked to a new `⚔ <name>` role, sides are pre-filled from the ticket, an announcement is posted and the board updates.
→ Reps run `/request-role` in the request channel → staff Approve/Deny in the review channel (deny needs a reason; max 2 reps per nation, active conflicts only).
→ `/war document` files rosters/war terms. `/stop-war outcome:…` records the winner, makes the channel public + read-only, moves it to the archive category, deletes the role, and edits the announcement + board.

## Commands
| Command | Who | |
|---|---|---|
| `/start-war` | Staff | Open conflict; renames current channel (or `new_channel:True`) |
| `/stop-war` | Staff | Outcome + notes, archives channel |
| `/war add-nation / remove-nation / document / rename / side-name / set-outcome` | Staff | Manage a conflict |
| `/conflict name:` | All | Full conflict card (sides, docs, reps, outcome) |
| `/conflicts` | All | Active / concluded / all |
| `/request-role` | All | Request to represent a nation |
| `/remove-participant` | Staff | Remove a rep — reason required, DMed to them |
| `/participants` | All | Reps in a conflict (staff also see pending) |
| `/maps list / add / remove` | All / map managers | Updates the #dpa-maps post |
| `/registry list / revoke` | All / staff | Treaties & criminal orgs approved from tickets |
| `/setup` | Staff | Post panels |
| `/dpa-help` | All | Command list |

`conflict` options autocomplete and default to the conflict of the channel you're in.

## Notes
- Discord limits channel renames to ~2 per channel per 10 minutes; `/war rename` warns if it hit that.
- Ticket transcripts (.txt) are posted to `LOG_CHANNEL_ID` on close.
