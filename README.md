# Embedify

A Telegram bot that watches approved groups and replies to social links with embed-friendly URLs, for example rewriting `x.com` posts to `fixupx.com` so Telegram can actually preview them.

The rewrite engine is platform-agnostic so a Discord adapter can be added later without changing the rules.

## Features

- Host-swap and regex replacement rules
- Global rules plus per-group/channel toggles and local-only rules
- Built-in toggles for X/Twitter, Instagram, TikTok, Reddit, Bluesky, Threads, and Pixiv
- In-Telegram Mini App dashboard (same kind of popup BotFather uses)
- Auto HTTPS tunnel on startup (no domain required)
- Group approval before the bot will rewrite anything
- SQLite storage (`node:sqlite`, Node 22+)
- PM2-ready: single fork process, graceful shutdown, restart on crash

## Requirements

- Node.js 22.5 or newer (24 is ideal)
- [PM2](https://pm2.keymetrics.io/) for production: `npm i -g pm2`
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

**Privacy mode must be disabled** or the bot cannot see normal group messages:

1. Open [@BotFather](https://t.me/BotFather)
2. `/setprivacy` → choose this bot → **Disable**
3. `/setjoingroups` → Enable (if you want others to add it)

You can confirm with `getMe`: `can_read_all_group_messages` should be `true`.

## Setup

```bash
cp .env.example .env
```

Fill in:

```
TELEGRAM_TOKEN=123456:ABC...
TELEGRAM_ADMIN_IDS=123456789
```

`TELEGRAM_ADMIN_IDS` is a comma-separated list of Telegram user IDs that can manage global rules.

The Mini App needs public HTTPS. **By default the bot opens a Cloudflare quick tunnel on startup** (Windows and Linux), so you do not need a domain. The first run downloads `cloudflared` once; later starts reuse it. Each boot gets a new `*.trycloudflare.com` URL and the Telegram Dashboard button is updated automatically.

Optional overrides:

- `WEBAPP_URL` — use your own HTTPS origin instead of a tunnel
- `WEBAPP_TUNNEL=0` — do not open a tunnel (in-chat menus still work)

```bash
npm install
```

### Development

```bash
npm run dev
```

### Production with PM2

Telegram long polling should run as **one process** (`fork` mode, `instances: 1`). Clustering would fight over the same update stream.

```bash
npm run pm2:start
npm run pm2:logs
```

Useful commands:

| Script | What it does |
| --- | --- |
| `npm run pm2:start` | Build and start under PM2 |
| `npm run pm2:reload` | Rebuild and zero-downtime reload |
| `npm run pm2:restart` | Rebuild and restart |
| `npm run pm2:stop` | Stop |
| `npm run pm2:delete` | Remove from PM2 |
| `npm run pm2:logs` | Tail logs |

Persist across reboots (Linux/macOS):

```bash
pm2 startup
pm2 save
```

On Windows, PM2 works but reboot persistence is limited; Task Scheduler or a service wrapper is more reliable there.

Logs live in `logs/out.log` and `logs/error.log`. The SQLite database is `data/embedify.db`.

## Usage

The config UI is a **Telegram Mini App**. On startup the bot publishes it through a Cloudflare tunnel, then private chats get a **Dashboard** menu button (the same popup style as BotFather). `/start` also offers Open dashboard.

- **Rules** — create, toggle, edit, or delete global rules
- **Chats** — approve/pause a group or channel, then manage that chat
- In a chat, toggle global rules off for that chat only, or add **local** rules that never appear elsewhere

In a group or channel, `/rules` sends a link that opens the Mini App for that chat.

If the tunnel cannot start, the older in-chat button menus still work as a fallback.

| Command | Who | Effect |
| --- | --- | --- |
| `/start` | Private chat | Open the Mini App |
| `/approve` | Chat admin or bot owner | Allow rewriting |
| `/disable` | Chat admin or bot owner | Pause rewriting |
| `/status` | Anyone | Show whether the bot is active |
| `/rules` | Chat admin or bot owner | Open this chat in the Mini App |

The bot also sends an approve button when it is added to a group or channel.

Private chats rewrite links immediately so you can test rules without a group.

## Built-in rules

Enabled by default: X → FixupX, Instagram → DDInstagram, TikTok → VxTikTok.

Disabled until you turn them on: Reddit, Bluesky, Threads, Pixiv.

Built-in rules can be edited. **Reset to default** restores the original match/rewrite.

## Custom rules

**Host swap** is the usual path: match one or more hostnames and replace the host, optionally stripping `?utm=` tracking.

**Regex** is for full control. The pattern is a JavaScript regex (no surrounding slashes). Replacement supports `$1`, `$2`, …

## Architecture

```
src/rewrite.ts   URL extraction + rule engine (reusable for Discord)
src/rules.ts     Built-in rule definitions
src/db.ts        SQLite persistence
src/web/         Mini App HTTP API and Cloudflare tunnel
public/          Mini App UI
src/bot/         grammY Telegram adapter, group gates
```

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE).
