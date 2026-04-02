# parachute-serve

MCP server that manages a media directory and serves files over Tailscale. Files in the `public/` subdirectory are exposed to the internet via Tailscale Funnel.

## Build & Run

```bash
npm install
npm run build
npm start
```

## Architecture

- Single-file MCP server at `src/index.ts`
- Uses stdio transport, 4 tools: serve, publish, remove, list
- `$MEDIA_DIR/` — all served files (tailnet access via `tailscale serve`)
- `$MEDIA_DIR/public/` — published files (public access via `tailscale funnel`)
- Built-in static HTTP server on port `$HTTP_PORT` (default 8484) — tailscale proxies to this because direct file serving is broken with mismatched client/daemon versions

## Environment Variables

- `MEDIA_DIR` — Path to media directory (default: `~/media/`)
- `TAILSCALE_URL` — Base URL for Tailscale (e.g. `https://parachute.taildf9ce2.ts.net`)
- `HTTP_PORT` — Port for the static file server (default: `8484`)
