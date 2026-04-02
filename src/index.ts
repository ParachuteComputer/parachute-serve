#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { homedir } from "os";

const MEDIA_DIR = process.env.MEDIA_DIR || path.join(homedir(), "media");
const PUBLIC_DIR = path.join(MEDIA_DIR, "public");
const TAILSCALE_URL = process.env.TAILSCALE_URL || "";

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

function getUrl(name: string): string {
  if (TAILSCALE_URL) {
    return `${TAILSCALE_URL.replace(/\/$/, "")}/${name}`;
  }
  return `/${name}`;
}

function getPublicUrl(name: string): string {
  return getUrl(`public/${name}`);
}

async function isPublished(name: string): Promise<boolean> {
  try {
    await fs.access(path.join(PUBLIC_DIR, name));
    return true;
  } catch {
    return false;
  }
}

const server = new McpServer({
  name: "parachute-serve",
  version: "1.0.0",
});

// serve - copy file to media dir (overwrites if exists)
server.tool(
  "serve",
  "Copy a file to the media directory and serve it over Tailscale. Overwrites if the name already exists.",
  {
    file_path: z.string().describe("Absolute path to the file to serve"),
    name: z.string().optional().describe("Name/path in media dir (e.g. 'conductor/image.jpg'). Defaults to original filename."),
  },
  async ({ file_path, name }) => {
    const targetName = name || path.basename(file_path);
    const targetPath = path.join(MEDIA_DIR, targetName);

    await ensureDir(path.dirname(targetPath));
    await fs.copyFile(file_path, targetPath);

    const stat = await fs.stat(targetPath);
    const published = await isPublished(targetName);

    return {
      content: [{
        type: "text",
        text: `Served: ${targetName}\nURL: ${getUrl(targetName)}\nSize: ${stat.size} bytes${published ? `\nAlso published at: ${getPublicUrl(targetName)}` : ""}`,
      }],
    };
  }
);

// publish - copy from media dir to public subdir
server.tool(
  "publish",
  "Make a served file publicly accessible via Tailscale Funnel. Copies it to the public/ subdirectory.",
  {
    name: z.string().describe("Name/path of the file in media dir to publish"),
  },
  async ({ name }) => {
    const sourcePath = path.join(MEDIA_DIR, name);

    try {
      await fs.access(sourcePath);
    } catch {
      return {
        content: [{ type: "text", text: `Error: ${name} not found in media directory. Serve it first.` }],
        isError: true,
      };
    }

    const publicPath = path.join(PUBLIC_DIR, name);
    await ensureDir(path.dirname(publicPath));
    await fs.copyFile(sourcePath, publicPath);

    return {
      content: [{ type: "text", text: `Published: ${name}\nPublic URL: ${getPublicUrl(name)}` }],
    };
  }
);

// remove - delete file from media dir and public dir
server.tool(
  "remove",
  "Delete a file from the media directory (and from public/ if published)",
  {
    name: z.string().describe("Name/path of the file to remove"),
  },
  async ({ name }) => {
    const targetPath = path.join(MEDIA_DIR, name);
    const publicPath = path.join(PUBLIC_DIR, name);
    let removed = false;
    let unpublished = false;

    try {
      await fs.unlink(publicPath);
      unpublished = true;
    } catch { /* not published */ }

    try {
      await fs.unlink(targetPath);
      removed = true;
    } catch { /* not found */ }

    if (!removed && !unpublished) {
      return {
        content: [{ type: "text", text: `Error: ${name} not found in media directory.` }],
        isError: true,
      };
    }

    const parts = [`Removed: ${name}`];
    if (unpublished) parts.push("Also removed from public/");
    return { content: [{ type: "text", text: parts.join("\n") }] };
  }
);

// list - list files with published status
server.tool(
  "list",
  "List files in the media directory with URLs, sizes, and published status",
  {
    prefix: z.string().optional().describe("Filter by prefix/subdirectory"),
  },
  async ({ prefix }) => {
    await ensureDir(MEDIA_DIR);

    const files: { name: string; url: string; publicUrl?: string; size: number }[] = [];

    async function walk(dir: string, rel: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === "public" && rel === "") continue; // skip public/ subdir in listing
        const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(path.join(dir, entry.name), entryRel);
        } else {
          if (prefix && !entryRel.startsWith(prefix)) continue;
          const stat = await fs.stat(path.join(dir, entry.name));
          const published = await isPublished(entryRel);
          files.push({
            name: entryRel,
            url: getUrl(entryRel),
            publicUrl: published ? getPublicUrl(entryRel) : undefined,
            size: stat.size,
          });
        }
      }
    }

    await walk(MEDIA_DIR, "");

    if (files.length === 0) {
      return { content: [{ type: "text", text: prefix ? `No files matching prefix: ${prefix}` : "No files in media directory." }] };
    }

    const listing = files
      .map((f) => {
        let line = `${f.name}  (${f.size} bytes)`;
        line += `\n  tailnet: ${f.url}`;
        if (f.publicUrl) line += `\n  public:  ${f.publicUrl}`;
        return line;
      })
      .join("\n\n");
    return { content: [{ type: "text", text: listing }] };
  }
);

// Start server
async function main() {
  await ensureDir(MEDIA_DIR);
  await ensureDir(PUBLIC_DIR);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
