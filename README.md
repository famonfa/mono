# Mono 🐒

Mono lives in `~/mono` (`~/avocado-workspace` is a symlink for old paths). See work as editable flows, watch Claude Code agents work and chat with them, from your Mac, the web or your phone.

## Apps

| App | What it is |
| --- | --- |
| `apps/server` | npm package `@famonfa/mono`: local server (API + live events + Agent SDK) and the `mono` / `ws` CLI. Runs Claude Code on your Mac. |
| `apps/web` | The UI (React + Vite). Served by the server; used by desktop, web and mobile. |
| `apps/desktop` | macOS app (Electron). Uses the local server and starts it if needed. |
| `apps/relay` | Multi-user public entry point: Google sign-in, invites and the tunnel to each user's Mac. |
| `apps/mobile` | iOS and Android app (Capacitor) that opens your relay, with Google sign-in through the system browser. |

In this checkout, data lives in `~/mono/data/` (not versioned; override with `MONO_DATA_DIR`). When installed from npm, it goes to `~/.mono/data/`.

## Desktop

```bash
mono                     # starts the server if needed and opens Mono (Mono.app → dev Electron → browser)
mono status              # server, service and remote connection
mono service install     # starts at login (launchd) and puts mono/ws on PATH
npm run desktop:package  # builds apps/desktop/release/mac-arm64/Mono.app → copy it to /Applications
```

## Phone, web and invites

Each person runs Mono on **their own** Mac, with their own Claude Code. A single cloud relay provides Google sign-in and access from phone or web; each user sees only their Macs.

**One-time setup (admin):**
1. The relay runs on the free Oracle VM it shares with Omno: `https://mono.155-181-39-178.sslip.io`. Deploy with `apps/relay/deploy.sh` (ssh `pelado-oracle`): it syncs `/srv/mono-relay` and, on first run, creates the `.env`, the `mono-relay` service (capped at 512 MB and 50% CPU) and its Caddy site. Omno's site is never touched. Credentials go in `/srv/mono-relay/.env`; variables are documented in `apps/relay/.env.example`.
2. Google Cloud Console → Credentials → *OAuth client ID* (Web application), with redirect `https://mono.155-181-39-178.sslip.io/_mono/auth/callback`.
3. Publish the package: `npm run release -w @famonfa/mono`. Builds `@famonfa/mono` with the compiled UI and bundled dependencies, without the Claude binary (~6 MB instead of 320 MB), and publishes it.

**Invite:** go to `https://<relay>/_mono/admin`, enter the person's Google email and send them the link. "Remove" revokes access: their session ends and their Macs disconnect.

**Each invitee, on their Mac** (the only install path):
```bash
npx @famonfa/mono            # opens Mono; first run installs to ~/.mono/runtime
npx @famonfa/mono connect    # keeps running in the background and pairs via Google
```
`npx` only bootstraps: it copies the same version to `~/.mono/runtime` and forwards commands there, since the npx cache can be cleared and the launchd service needs a fixed path.
Then use `https://mono.155-181-39-178.sslip.io` from any browser or the mobile app (`npm run mobile:ios` / `mobile:android`).

Outside the repo, Mono keeps everything in `~/.mono/` (config, connection and `data/`) and installs the `/workspace` skill for Claude Code if missing. New chats default to `defaultCwd` in `~/.mono/config.json` (home if unset).

## Development

```bash
npm install
npm run dev       # Vite with hot reload at http://localhost:4601 (uses the server API on :4600)
npm run build     # builds apps/web; the server serves it without restarting
npm run desktop   # build + Electron
launchctl kickstart -k gui/$(id -u)/com.famonfa.mono   # restart the server after changing apps/server
```

To test the relay locally without Google: `PORT=4700 SESSION_SECRET=$(openssl rand -hex 32) ADMIN_EMAILS=me@x.com DEV_LOGIN=1 npm run relay`, then `mono connect http://localhost:4700`.

## Server modules

- `store.mjs`: tasks, boards and docs in `data/tasks/<TASK>/`
- `sessions.mjs`: reads Claude Code transcripts (`~/.claude/projects`) and links them to tasks
- `chats.mjs`: sessions driven from the app via the Agent SDK (permissions, interrupt, resume)
- `refresh.mjs`: AI refresh, a headless session that reads agent activity and updates the boards
- `remote.mjs`: outbound connection to the relay; forwards requests to the local server and streams events back
- `launcher.mjs`: `mono`, `connect`, `status` and `service`
