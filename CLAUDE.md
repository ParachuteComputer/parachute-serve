# tailshare

CLI + MCP for making local things reachable on your tailnet. Serves files from a media directory and exposes dev servers via Tailscale services.

## Architecture

- `src/cli.ts` — CLI entry point (`tailshare` command)
- `src/daemon.ts` — persistent HTTP file server (managed by launchd)
- `src/mcp.ts` — MCP server for Claude Code (stdio transport)
- `src/config.ts` — shared config at `~/.tailshare/config.json`
- `src/tailscale.ts` — tailscale CLI wrapper
- `src/launchd.ts` — launchd plist management

## How it works

- **Files**: daemon serves `~/media/` on `:8484`, tailscale serve proxies to it
- **Dev servers**: tailscale services proxy directly to localhost ports (no daemon involvement)
- **Config**: `~/.tailshare/config.json` tracks state

## Commands

```bash
bun install
tailshare init          # one-time setup
tailshare serve <file>  # host a file
tailshare expose <port> --name foo  # expose a dev server
tailshare status        # see everything
```
