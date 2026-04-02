# parachute-serve

MCP server that manages a central media directory (`~/media/`) and serves files over Tailscale.

## Build & Run

```bash
npm install
npm run build
npm start
```

## Architecture

- Single-file MCP server at `src/index.ts`
- Uses stdio transport
- Media files stored in `~/media/`, served via Tailscale serve
- R2 publish reads config from `~/.media/.env`

## Environment Variables

- `TAILSCALE_URL` — Base URL for Tailscale serve (e.g. `https://parachute.tail1234.ts.net`)
- R2 config in `~/.media/.env`: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`
