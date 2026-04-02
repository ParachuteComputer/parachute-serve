# parachute-serve

A lightweight MCP server for managing and serving media files over Tailscale.

Files are copied into a media directory and served via `tailscale serve`. Published files go into a `public/` subdirectory exposed to the internet via `tailscale funnel`.

## Setup

### 1. Install & Build

```bash
cd ~/Code/parachute-serve
npm install
npm run build
```

### 2. Configure Tailscale

```bash
# Serve all media on your tailnet
tailscale serve --bg / ~/media/

# Expose public/ to the internet
tailscale funnel --bg /public/
```

### 3. Add as MCP Server

Add to your Claude Code settings (`~/.claude.json`):

```json
{
  "mcpServers": {
    "parachute-serve": {
      "command": "node",
      "args": ["/Users/you/Code/parachute-serve/dist/index.js"],
      "env": {
        "MEDIA_DIR": "/Users/you/media",
        "TAILSCALE_URL": "https://your-machine.tail1234.ts.net"
      }
    }
  }
}
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `serve(file_path, name?)` | Copy file to media dir, return tailnet URL. Overwrites if exists. |
| `publish(name)` | Copy a served file to `public/` for internet access via Funnel. |
| `remove(name)` | Delete a file (and its public copy if published). |
| `list(prefix?)` | List files with URLs, sizes, and published status. |
