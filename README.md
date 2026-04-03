# tailshare

Make local things reachable on your tailnet. Host files and expose dev servers with clean URLs.

```
tailshare serve photo.jpg           → https://parachute.taildf9ce2.ts.net/photo.jpg
tailshare expose 3000 --name myapp  → https://myapp.taildf9ce2.ts.net
```

## Prerequisites

1. **Tailscale** installed and logged in
2. **Bun** installed (`curl -fsSL https://bun.sh/install | bash`)
3. **Tag your node** (one-time, required for `expose`):
   - Go to [Tailscale Admin → ACLs](https://login.tailscale.com/admin/acls)
   - Add a tag definition to your ACL policy:
     ```json
     "tagOwners": {
       "tag:server": ["autogroup:admin"]
     }
     ```
   - Go to [Machines](https://login.tailscale.com/admin/machines)
   - Click your machine → Edit → add `tag:server`
   - Define your services in [Services](https://login.tailscale.com/admin/services) as needed

## Install

```bash
bun install -g github:ParachuteComputer/parachute-serve
tailshare init
```

Or clone and link:

```bash
git clone https://github.com/ParachuteComputer/parachute-serve.git
cd parachute-serve
bun install
bun link
tailshare init
```

`init` does everything: creates config, starts the daemon via launchd, configures tailscale serve, and registers the MCP server in Claude Code.

## Usage

### Host files

```bash
tailshare serve ~/path/to/photo.jpg
tailshare serve ~/path/to/file.pdf --name docs/spec.pdf
tailshare list
tailshare remove photo.jpg
```

Files are copied to `~/media/` and served at `https://<node>.<tailnet>.ts.net/<name>`.

### Expose dev servers

```bash
tailshare expose 3000 --name myapp
tailshare expose 8080 --name api
tailshare unexpose myapp
```

Each gets its own hostname: `https://<name>.<tailnet>.ts.net`. The dev server runs at `/` — no path prefix rewriting.

### Check status

```bash
tailshare status
```

Shows tailscale connection, daemon status, served files, and active services.

## MCP Tools

When used from Claude Code, the same capabilities are available as MCP tools:

| Tool | Description |
|------|-------------|
| `serve(file_path, name?)` | Copy file to media dir, return tailnet URL |
| `remove(name)` | Delete a file |
| `list(prefix?)` | List files with URLs and sizes |
| `expose(port, name)` | Expose a local port as a tailscale service |
| `unexpose(name)` | Remove a tailscale service |
| `status()` | Show everything |

## How it works

- A persistent daemon (managed by launchd) serves files from `~/media/` on port 8484
- `tailscale serve` proxies your tailnet URL to the daemon
- Dev server exposure uses Tailscale services — each service gets its own hostname and virtual IP, proxying directly to your local port (no daemon involvement)
- Config lives at `~/.tailshare/config.json`
