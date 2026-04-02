# parachute-serve

A lightweight MCP server for managing and serving media files over Tailscale.

Files are copied into `~/media/` and served directly via `tailscale serve`. Optionally publish files to Cloudflare R2 for public access.

## Setup

### 1. Install & Build

```bash
cd ~/Code/parachute-serve
npm install
npm run build
```

### 2. Configure Tailscale Serve

Point Tailscale serve at your media directory:

```bash
tailscale serve --bg /media/ ~/media/
```

This serves `~/media/` at `https://<your-machine>.<tailnet>.ts.net/media/`.

### 3. Add as MCP Server

Add to your Claude Code settings (`~/.claude/settings.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "parachute-serve": {
      "command": "node",
      "args": ["/Users/you/Code/parachute-serve/dist/index.js"],
      "env": {
        "TAILSCALE_URL": "https://your-machine.tail1234.ts.net"
      }
    }
  }
}
```

### 4. (Optional) Configure R2 Publishing

Create `~/.media/.env`:

```env
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=your_bucket
R2_PUBLIC_URL=https://media.yourdomain.com
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `serve(file_path, name?)` | Copy file to `~/media/` and return its Tailscale URL |
| `update(file_path, name)` | Overwrite an existing file in `~/media/` |
| `remove(name)` | Delete a file from `~/media/` |
| `list(prefix?)` | List files with URLs and sizes |
| `publish(name)` | Upload a served file to Cloudflare R2 |
