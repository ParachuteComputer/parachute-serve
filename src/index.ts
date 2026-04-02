#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import * as http from "http";
import { homedir } from "os";

const MEDIA_DIR = process.env.MEDIA_DIR || path.join(homedir(), "media");
const PUBLIC_DIR = path.join(MEDIA_DIR, "public");
const TAILSCALE_URL = process.env.TAILSCALE_URL || "";
const HTTP_PORT = parseInt(process.env.HTTP_PORT || "8484", 10);

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

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

// Static file server
function startHttpServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${HTTP_PORT}`);
    const filePath = path.join(MEDIA_DIR, decodeURIComponent(url.pathname));

    // Prevent path traversal
    if (!filePath.startsWith(MEDIA_DIR)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    try {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        res.writeHead(403);
        res.end("Directory listing not allowed");
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      const data = await fs.readFile(filePath);
      res.writeHead(200, { "Content-Type": contentType, "Content-Length": stat.size });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  server.listen(HTTP_PORT, "127.0.0.1", () => {
    process.stderr.write(`Static file server listening on http://127.0.0.1:${HTTP_PORT}\n`);
  });
}

const mcpServer = new McpServer({
  name: "parachute-serve",
  version: "1.0.0",
});

// serve - copy file to media dir (overwrites if exists)
mcpServer.tool(
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
mcpServer.tool(
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
mcpServer.tool(
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
mcpServer.tool(
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
        if (entry.name === "public" && rel === "") continue;
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
  startHttpServer();
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
