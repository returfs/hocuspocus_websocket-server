# Hocuspocus — Production Deployment & Ops

The realtime collaboration server (Yjs sync over WebSocket) for Returfs editor
extensions. It holds documents in memory and persists them to the Laravel API
(via the Database extension's `fetchDocument` / `storeDocument`). This is the
production runbook (Phase 7).

---

## 1. Build & run

```bash
pnpm install            # production deps (incl. tsx is NOT needed at runtime)
pnpm build              # tsc -> dist/  (emits runnable ESM; relative imports use .js)
node dist/index.js      # start the server
```

- `package.json` is `"type": "module"`; relative imports carry `.js` extensions so
  `node dist/index.js` resolves under Node ESM (don't strip them — `tsc` won't
  re-add them, and dev `tsx` tolerates them too).
- Dev still uses `pnpm dev` (`tsx watch src/index.ts`).

## 2. Environment

Set these on the server (Forge env / `.env`). The signing secret **must be byte-
identical** to the Laravel app's `HOCUSPOCUS_SECRET` or every collab token is
rejected.

| Var                 | Example (prod)            | Purpose                                    |
| ------------------- | ------------------------- | ------------------------------------------ |
| `APP_PORT`          | `2319`                    | Port to bind                               |
| `APP_HOST`          | `0.0.0.0`                 | Bind address (behind nginx)                |
| `APP_ENV`           | `production`              |                                            |
| `APP_DEBUG`         | `false`                   |                                            |
| `RETURFS_API_URL`   | `https://app.returfs.com` | Laravel API base for fetch/store           |
| `HOCUSPOCUS_SECRET` | `<shared secret>`         | **Must equal** Laravel `HOCUSPOCUS_SECRET` |

Laravel side (the app's `.env`):

| Var                 | Example (prod)             | Purpose                                                   |
| ------------------- | -------------------------- | --------------------------------------------------------- |
| `HOCUSPOCUS_SECRET` | `<same shared secret>`     | Signs collab tokens (`config services.hocuspocus.secret`) |
| `HOCUSPOCUS_URL`    | `wss://collab.returfs.com` | Returned by the mint endpoint / used by clients           |

Frontend (host) build env:

| Var                   | Example (prod)             | Purpose                                                |
| --------------------- | -------------------------- | ------------------------------------------------------ |
| `VITE_HOCUSPOCUS_URL` | `wss://collab.returfs.com` | WebSocket URL the editor connects to (**wss** in prod) |

There are **no hardcoded production URLs** — every URL falls back to a localhost
dev default and is overridden by the env vars above.

## 3. Forge daemon (process management + restart policy)

Configure a Forge **Daemon** (Server → Daemons):

- **Command:** `node dist/index.js`
- **Directory:** `/home/forge/<site>/marketplace/internal/services/hocuspocus`
- **User:** `forge`
- **Processes:** `1` (see Scaling below before raising this)
- Forge restarts the daemon on crash and on deploy.

Deploy hook (run in the service dir): `pnpm install && pnpm build`, then Forge
restarts the daemon (which triggers graceful shutdown — see §6).

Equivalent systemd unit if not on Forge:

```ini
[Service]
WorkingDirectory=/srv/returfs/.../services/hocuspocus
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=2
KillSignal=SIGTERM
TimeoutStopSec=15        # > the 10s graceful-flush window in index.ts
EnvironmentFile=/srv/returfs/.../services/hocuspocus/.env
```

## 4. nginx — wss / TLS reverse proxy

Terminate TLS at nginx and proxy the WebSocket upgrade to the daemon. Serve it on
its own subdomain (`collab.returfs.com`) pointing at `APP_PORT`.

```nginx
server {
    listen 443 ssl http2;
    server_name collab.returfs.com;

    ssl_certificate     /etc/letsencrypt/live/collab.returfs.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/collab.returfs.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:2319;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;      # WebSocket upgrade
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 7d;                        # long-lived WS connections
        proxy_send_timeout 7d;
    }
}
```

Clients then use `wss://collab.returfs.com` (set `VITE_HOCUSPOCUS_URL` and Laravel
`HOCUSPOCUS_URL` accordingly).

## 5. Health checks

`GET /` returns `200 OK` (Hocuspocus' default HTTP handler) — use it for Forge /
uptime / load-balancer health checks. A WebSocket upgrade to `/` is the live path.

## 6. Graceful shutdown (no data loss on deploy)

`src/index.ts` handles `SIGTERM`/`SIGINT`: it calls `server.destroy()`, which
closes connections and unloads every in-memory document — flushing the debounced
Database store so the latest edits are persisted before exit. A 10s hard timeout
forces exit if a store hangs (keep the orchestrator's stop-timeout above that,
e.g. systemd `TimeoutStopSec=15`). Without this, an abrupt kill during a deploy
could drop the last few seconds of un-stored edits.

## 7. Scaling decision

**Now: single instance.** Documents live in memory on one process and are
persisted durably to Laravel (Database extension). This is correct and simplest
for current load. Keep Forge "Processes" = 1.

**When you outgrow one instance**, two clients of the same document on _different_
instances wouldn't see each other (separate in-memory docs) and would clobber each
other on store. Options, in order of preference:

1. **`@hocuspocus/extension-redis`** (recommended) — Redis pub/sub broadcasts Yjs
   updates + awareness across all instances, so any instance can serve any
   document. Redis is already in the stack (`QUEUE_CONNECTION=redis`). Add the
   extension to `Server.configure({ extensions: [...] })`; persistence stays the
   Database extension. This gives true horizontal scale + HA.
2. **Sticky routing by document** — hash the document path at the load balancer so
   all connections for a doc land on one instance. Simpler, but no per-document HA
   and uneven load.

Until then, vertical scaling (one bigger instance) is fine — Yjs in-memory docs
are cheap and the bottleneck is the Laravel store, not the WS server.
