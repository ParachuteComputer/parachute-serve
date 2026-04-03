#!/usr/bin/env bun

import { readConfig, writeConfig, defaultConfig, ensureConfigDir, CONFIG_DIR, CONFIG_PATH } from "./config.ts";
import { getTailscaleStatus, setupServe, exposeService, unexposeService } from "./tailscale.ts";
import { installAgent, uninstallAgent, isAgentLoaded, restartAgent } from "./launchd.ts";
import { stat, readdir, copyFile, unlink, mkdir } from "fs/promises";
import { join, basename, resolve, dirname } from "path";
import { homedir } from "os";
import { existsSync, readFileSync } from "fs";

const args = process.argv.slice(2);
const command = args[0];

function usage() {
  console.log(`tailshare — make local things reachable on your tailnet

Usage:
  tailshare init                      Set up daemon, tailscale, and MCP
  tailshare start                     Start the daemon
  tailshare stop                      Stop the daemon
  tailshare status                    Show everything

  tailshare serve <file> [--name x]   Copy a file to media dir
  tailshare remove <name>             Remove a file from media dir
  tailshare list [prefix]             List served files

  tailshare expose <port> --name x    Expose a local port as a tailscale service
  tailshare unexpose <name>           Remove a tailscale service`);
}

function getFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

async function cmdInit() {
  console.log("Setting up tailshare...\n");

  // 1. Config directory
  await ensureConfigDir();
  console.log(`✓ Config directory: ${CONFIG_DIR}`);

  // 2. Detect tailscale
  let tailscaleUrl = "";
  let tailnetDomain = "";
  try {
    const ts = await getTailscaleStatus();
    tailscaleUrl = `https://${ts.nodeName}.${ts.tailnetDomain}`;
    tailnetDomain = ts.tailnetDomain;
    console.log(`✓ Tailscale: ${ts.nodeName}.${ts.tailnetDomain}`);
    if (!ts.isTagged) {
      console.log("  ⚠ Node is not tagged — expose (services) won't work until you tag it");
      console.log("  → https://login.tailscale.com/admin/machines");
    }
  } catch {
    console.log("✗ Tailscale not detected — install and log in first");
    process.exit(1);
  }

  // 3. Write config
  const config = {
    ...defaultConfig(),
    tailscaleUrl,
    tailnetDomain,
  };

  // Preserve existing config values if they exist
  try {
    const existing = await readConfig();
    if (existing.mediaDir) config.mediaDir = existing.mediaDir;
    if (existing.port) config.port = existing.port;
    if (existing.services) config.services = existing.services;
  } catch { /* first run */ }

  await writeConfig(config);
  console.log(`✓ Config: ${CONFIG_PATH}`);

  // 4. Ensure media directory
  await mkdir(config.mediaDir, { recursive: true });
  console.log(`✓ Media directory: ${config.mediaDir}`);

  // 5. Install and start daemon
  const daemonPath = resolve(dirname(import.meta.path), "daemon.ts");
  await installAgent(daemonPath);
  console.log(`✓ Daemon installed (launchd)`);

  // 6. Configure tailscale serve
  try {
    await setupServe(config.port);
    console.log(`✓ Tailscale serve → http://127.0.0.1:${config.port}`);
  } catch (err: any) {
    console.log(`✗ Failed to configure tailscale serve: ${err?.message || err}`);
  }

  // 7. Install MCP server in Claude Code
  const claudeConfigPath = join(homedir(), ".claude.json");
  try {
    let claudeConfig: any = {};
    if (existsSync(claudeConfigPath)) {
      claudeConfig = JSON.parse(readFileSync(claudeConfigPath, "utf-8"));
    }
    if (!claudeConfig.mcpServers) claudeConfig.mcpServers = {};

    const mcpPath = resolve(dirname(import.meta.path), "mcp.ts");
    const bunPath = Bun.which("bun") || join(homedir(), ".bun", "bin", "bun");
    claudeConfig.mcpServers["tailshare"] = {
      command: bunPath,
      args: [mcpPath],
    };

    // Remove old parachute-serve entry if present
    delete claudeConfig.mcpServers["parachute-serve"];

    const { writeFileSync } = await import("fs");
    writeFileSync(claudeConfigPath, JSON.stringify(claudeConfig, null, 2));
    console.log(`✓ MCP server registered in ~/.claude.json`);
  } catch (err: any) {
    console.log(`✗ Failed to update ~/.claude.json: ${err?.message || err}`);
  }

  console.log(`\n✓ Done! Your media is at: ${tailscaleUrl}`);
  console.log("\nRestart Claude Code to pick up the new MCP server.");
}

async function cmdStart() {
  const loaded = await isAgentLoaded();
  if (loaded) {
    await restartAgent();
    console.log("Daemon restarted.");
  } else {
    const daemonPath = resolve(dirname(import.meta.path), "daemon.ts");
    await installAgent(daemonPath);
    console.log("Daemon started.");
  }
}

async function cmdStop() {
  await uninstallAgent();
  console.log("Daemon stopped.");
}

async function cmdStatus() {
  const config = await readConfig();

  // Tailscale
  try {
    const ts = await getTailscaleStatus();
    console.log(`Tailscale: ${ts.nodeName}.${ts.tailnetDomain} (${ts.online ? "online" : "offline"})`);
    if (!ts.isTagged) console.log("  ⚠ Node not tagged — services require tagging");
  } catch {
    console.log("Tailscale: not available");
  }

  // Daemon
  const loaded = await isAgentLoaded();
  console.log(`Daemon: ${loaded ? "running" : "stopped"} (port ${config.port})`);

  // Media
  console.log(`\nMedia: ${config.mediaDir}`);
  if (config.tailscaleUrl) console.log(`URL: ${config.tailscaleUrl}`);

  let fileCount = 0;
  async function countFiles(dir: string) {
    try {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) await countFiles(join(dir, entry.name));
        else fileCount++;
      }
    } catch { /* empty */ }
  }
  await countFiles(config.mediaDir);
  console.log(`Files: ${fileCount}`);

  // Services
  const serviceNames = Object.keys(config.services);
  if (serviceNames.length > 0) {
    console.log("\nServices:");
    for (const [name, svc] of Object.entries(config.services)) {
      const url = config.tailnetDomain ? `https://${name}.${config.tailnetDomain}` : name;
      console.log(`  ${name} → localhost:${svc.port}  ${url}`);
    }
  } else {
    console.log("\nServices: none");
  }
}

async function cmdServe() {
  const filePath = args[1];
  if (!filePath) {
    console.error("Usage: tailshare serve <file> [--name <name>]");
    process.exit(1);
  }

  const config = await readConfig();
  const name = getFlag("--name") || basename(filePath);
  const absPath = resolve(filePath);
  const targetPath = resolve(join(config.mediaDir, name));

  if (!targetPath.startsWith(config.mediaDir + "/")) {
    console.error("Error: invalid name — would write outside media directory.");
    process.exit(1);
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(absPath, targetPath);

  const fileStat = await stat(targetPath);
  const url = config.tailscaleUrl ? `${config.tailscaleUrl}/${name}` : name;

  console.log(`Served: ${name}`);
  console.log(`URL: ${url}`);
  console.log(`Size: ${fileStat.size} bytes`);
}

async function cmdRemove() {
  const name = args[1];
  if (!name) {
    console.error("Usage: tailshare remove <name>");
    process.exit(1);
  }

  const config = await readConfig();
  const targetPath = resolve(join(config.mediaDir, name));

  if (!targetPath.startsWith(config.mediaDir + "/")) {
    console.error("Error: invalid name.");
    process.exit(1);
  }

  try {
    await unlink(targetPath);
    console.log(`Removed: ${name}`);
  } catch {
    console.error(`Error: ${name} not found`);
    process.exit(1);
  }
}

async function cmdList() {
  const prefix = args[1];
  const config = await readConfig();
  const files: { name: string; url: string; size: number }[] = [];

  async function walk(dir: string, rel: string) {
    try {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(join(dir, entry.name), entryRel);
        } else {
          if (prefix && !entryRel.startsWith(prefix)) continue;
          const fileStat = await stat(join(dir, entry.name));
          const url = config.tailscaleUrl ? `${config.tailscaleUrl}/${entryRel}` : entryRel;
          files.push({ name: entryRel, url, size: fileStat.size });
        }
      }
    } catch { /* empty dir */ }
  }

  await walk(config.mediaDir, "");

  if (files.length === 0) {
    console.log(prefix ? `No files matching: ${prefix}` : "No files.");
    return;
  }

  for (const f of files) {
    console.log(`${f.name}  (${f.size} bytes)`);
    console.log(`  ${f.url}`);
  }
}

async function cmdExpose() {
  const portStr = args[1];
  const name = getFlag("--name");

  if (!portStr || !name) {
    console.error("Usage: tailshare expose <port> --name <name>");
    process.exit(1);
  }

  const port = parseInt(portStr, 10);
  if (isNaN(port)) {
    console.error("Error: port must be a number");
    process.exit(1);
  }

  const config = await readConfig();

  try {
    const url = await exposeService(name, port);
    config.services[name] = { port, createdAt: new Date().toISOString() };
    await writeConfig(config);
    console.log(`Exposed: localhost:${port}`);
    console.log(`URL: ${url}`);
  } catch (err: any) {
    const msg = err?.stderr?.toString?.() || err?.message || String(err);
    if (msg.includes("tagged nodes")) {
      console.error("Error: Node must be tagged in Tailscale admin console.");
      console.error("→ https://login.tailscale.com/admin/machines");
    } else {
      console.error(`Error: ${msg}`);
    }
    process.exit(1);
  }
}

async function cmdUnexpose() {
  const name = args[1];
  if (!name) {
    console.error("Usage: tailshare unexpose <name>");
    process.exit(1);
  }

  const config = await readConfig();

  try {
    await unexposeService(name);
  } catch (err: any) {
    console.error(`Error: ${err?.stderr?.toString?.() || err?.message || String(err)}`);
    process.exit(1);
  }

  delete config.services[name];
  await writeConfig(config);
  console.log(`Unexposed: ${name}`);
}

// Dispatch
switch (command) {
  case "init":
    await cmdInit();
    break;
  case "start":
    await cmdStart();
    break;
  case "stop":
    await cmdStop();
    break;
  case "status":
    await cmdStatus();
    break;
  case "serve":
    await cmdServe();
    break;
  case "remove":
    await cmdRemove();
    break;
  case "list":
    await cmdList();
    break;
  case "expose":
    await cmdExpose();
    break;
  case "unexpose":
    await cmdUnexpose();
    break;
  default:
    usage();
    break;
}
