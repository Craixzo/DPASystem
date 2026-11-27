# DPA Bot — UN Department of Political Affairs

Discord bot for running conflicts, representative requests, a registry ticket desk and a maps board. TypeScript + discord.js v14 + SQLite. Made by Craixzo with help from Claude.

## Commands
| Command | Who | |
|---|---|---|
| `/start-war` | Staff | Open conflict; renames current channel (or `new_channel:True`) |
| `/stop-war` | Staff | Outcome + notes, archives channel |
| `/war ceasefire / resume` | Staff | Pause a conflict (optional `hours`; staff pinged on expiry) / lift it |
| `/war add-nation / remove-nation / document / rename / side-name / set-outcome` | Staff | Manage a conflict |
| `/conflict name:` | All | Full conflict card (sides, docs, reps, outcome) |
| `/conflicts` | All | Active / concluded / all |
| `/request-role` | All | Request to represent a nation |
| `/remove-participant` | Staff | Remove a rep — reason required, DMed to them |
| `/participants` | All | Reps in a conflict (staff also see pending) |
| `/maps list / add / remove` | All / map managers | Updates the #dpa-maps post |
| `/registry list / revoke` | All / staff | Treaties & criminal orgs approved from tickets |
| `/treaty add / view` | Staff / All | Register a treaty directly; view one |
| `/setup` | Staff | Post panels |
| `/dpa-help` | All | Command list |

`conflict` options autocomplete and default to the conflict of the channel you're in.

## Notes
- Discord limits channel renames to ~2 per channel per 10 minutes; `/war rename` warns if it hit that.
- Every 30 min the bot pings staff (in `STAFF_PING_CHANNEL_ID`) about conflicts with no messages for `INACTIVITY_DAYS` days, and about expired ceasefires. Inactivity pings repeat at most once per `INACTIVITY_DAYS`.
- Ticket transcripts (.txt) are posted to `LOG_CHANNEL_ID` on close.
