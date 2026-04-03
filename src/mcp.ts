#!/usr/bin/env bun

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readConfig, writeConfig } from "./config.ts";
import { exposeService, unexposeService, getTailscaleStatus } from "./tailscale.ts";
import { stat, readdir, copyFile, unlink, mkdir } from "fs/promises";
import { join, basename, dirname, resolve } from "path";

const server = new McpServer({
  name: "tailshare",
  version: "1.0.0",
});

function getUrl(config: { tailscaleUrl: string }, name: string): string {
  if (config.tailscaleUrl) {
    return `${config.tailscaleUrl.replace(/\/$/, "")}/${name}`;
  }
  return `/${name}`;
}

// serve — copy file to media dir
server.tool(
  "serve",
  "Copy a file to the media directory and make it available on the tailnet. Overwrites if name exists.",
  {
    file_path: z.string().describe("Absolute path to the file to serve"),
    name: z.string().optional().describe("Name/path in media dir (e.g. 'project/image.jpg'). Defaults to original filename."),
  },
  async ({ file_path, name }) => {
    const config = await readConfig();
    const targetName = name || basename(file_path);
    const targetPath = resolve(join(config.mediaDir, targetName));

    // Prevent path traversal
    if (!targetPath.startsWith(config.mediaDir + "/")) {
      return {
        content: [{ type: "text", text: `Error: invalid name — would write outside media directory.` }],
        isError: true,
      };
    }

    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(file_path, targetPath);

    const fileStat = await stat(targetPath);
    const url = getUrl(config, targetName);

    return {
      content: [{
        type: "text",
        text: `Served: ${targetName}\nURL: ${url}\nSize: ${fileStat.size} bytes`,
      }],
    };
  }
);

// remove — delete file from media dir
server.tool(
  "remove",
  "Delete a file from the media directory",
  {
    name: z.string().describe("Name/path of the file to remove"),
  },
  async ({ name }) => {
    const config = await readConfig();
    const targetPath = resolve(join(config.mediaDir, name));

    if (!targetPath.startsWith(config.mediaDir + "/")) {
      return {
        content: [{ type: "text", text: `Error: invalid name.` }],
        isError: true,
      };
    }

    try {
      await unlink(targetPath);
    } catch {
      return {
        content: [{ type: "text", text: `Error: ${name} not found in media directory.` }],
        isError: true,
      };
    }

    return { content: [{ type: "text", text: `Removed: ${name}` }] };
  }
);

// list — list files in media dir
server.tool(
  "list",
  "List files in the media directory with URLs and sizes",
  {
    prefix: z.string().optional().describe("Filter by prefix/subdirectory"),
  },
  async ({ prefix }) => {
    const config = await readConfig();
    const files: { name: string; url: string; size: number }[] = [];

    async function walk(dir: string, rel: string) {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(join(dir, entry.name), entryRel);
        } else {
          if (prefix && !entryRel.startsWith(prefix)) continue;
          const fileStat = await stat(join(dir, entry.name));
          files.push({
            name: entryRel,
            url: getUrl(config, entryRel),
            size: fileStat.size,
          });
        }
      }
    }

    await walk(config.mediaDir, "");

    if (files.length === 0) {
      return {
        content: [{
          type: "text",
          text: prefix ? `No files matching prefix: ${prefix}` : "No files in media directory.",
        }],
      };
    }

    const listing = files
      .map((f) => `${f.name}  (${f.size} bytes)\n  ${f.url}`)
      .join("\n\n");
    return { content: [{ type: "text", text: listing }] };
  }
);

// expose — create a tailscale service for a local port
server.tool(
  "expose",
  "Expose a local port on the tailnet via a Tailscale service. Creates <name>.tailnet.ts.net → localhost:<port>.",
  {
    port: z.number().describe("Local port to expose"),
    name: z.string().describe("Service name (becomes the subdomain)"),
  },
  async ({ port, name }) => {
    const config = await readConfig();

    try {
      const url = await exposeService(name, port);

      config.services[name] = { port, createdAt: new Date().toISOString() };
      await writeConfig(config);

      return {
        content: [{ type: "text", text: `Exposed: localhost:${port}\nURL: ${url}` }],
      };
    } catch (err: any) {
      const msg = err?.stderr?.toString?.() || err?.message || String(err);
      if (msg.includes("tagged nodes")) {
        return {
          content: [{
            type: "text",
            text: `Error: This node must be tagged in the Tailscale admin console before services can be created.\nSee: https://login.tailscale.com/admin/machines`,
          }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: `Error exposing service: ${msg}` }],
        isError: true,
      };
    }
  }
);

// unexpose — remove a tailscale service
server.tool(
  "unexpose",
  "Remove a Tailscale service, making the port no longer accessible on the tailnet",
  {
    name: z.string().describe("Service name to remove"),
  },
  async ({ name }) => {
    const config = await readConfig();

    try {
      await unexposeService(name);
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Error: ${err?.stderr?.toString?.() || err?.message || String(err)}` }],
        isError: true,
      };
    }

    delete config.services[name];
    await writeConfig(config);

    return { content: [{ type: "text", text: `Unexposed: ${name}` }] };
  }
);

// status — show everything
server.tool(
  "status",
  "Show all served files, exposed services, and tailscale status",
  {},
  async () => {
    const config = await readConfig();
    const lines: string[] = [];

    // Tailscale info
    try {
      const ts = await getTailscaleStatus();
      lines.push(`Tailscale: ${ts.nodeName}.${ts.tailnetDomain} (${ts.online ? "online" : "offline"})`);
      if (!ts.isTagged) {
        lines.push("  ⚠ Node is not tagged — services require a tagged node");
      }
    } catch {
      lines.push("Tailscale: not available");
    }

    lines.push("");

    // Media files
    lines.push(`Media: ${config.mediaDir}`);
    let fileCount = 0;
    async function countFiles(dir: string) {
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) await countFiles(join(dir, entry.name));
          else fileCount++;
        }
      } catch { /* empty */ }
    }
    await countFiles(config.mediaDir);
    lines.push(`  ${fileCount} file(s)`);
    if (config.tailscaleUrl) {
      lines.push(`  URL: ${config.tailscaleUrl}`);
    }

    lines.push("");

    // Services
    const serviceNames = Object.keys(config.services);
    if (serviceNames.length > 0) {
      lines.push("Services:");
      for (const [name, svc] of Object.entries(config.services)) {
        const url = config.tailnetDomain ? `https://${name}.${config.tailnetDomain}` : name;
        lines.push(`  ${name} → localhost:${svc.port} (${url})`);
      }
    } else {
      lines.push("Services: none");
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
