#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { homedir } from "os";
import { lookup } from "mime-types";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { config } from "dotenv";

const MEDIA_DIR = path.join(homedir(), "media");
const TAILSCALE_URL = process.env.TAILSCALE_URL || "";

// Load R2 config from ~/.media/.env
config({ path: path.join(homedir(), ".media", ".env") });

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

function getUrl(name: string): string {
  if (TAILSCALE_URL) {
    return `${TAILSCALE_URL.replace(/\/$/, "")}/${name}`;
  }
  return `/${name}`;
}

async function ensureMediaDir() {
  await ensureDir(MEDIA_DIR);
}

const server = new McpServer({
  name: "parachute-serve",
  version: "1.0.0",
});

// serve - copy file to ~/media/{name}
server.tool(
  "serve",
  "Copy a file to the media directory and serve it over Tailscale",
  {
    file_path: z.string().describe("Absolute path to the file to serve"),
    name: z.string().optional().describe("Name/path in media dir (e.g. 'conductor/image.jpg'). Defaults to original filename."),
  },
  async ({ file_path, name }) => {
    await ensureMediaDir();

    const targetName = name || path.basename(file_path);
    const targetPath = path.join(MEDIA_DIR, targetName);

    await ensureDir(path.dirname(targetPath));
    await fs.copyFile(file_path, targetPath);

    const url = getUrl(targetName);
    const stat = await fs.stat(targetPath);

    return {
      content: [{ type: "text", text: `Served: ${targetName}\nURL: ${url}\nSize: ${stat.size} bytes` }],
    };
  }
);

// update - overwrite an existing file
server.tool(
  "update",
  "Overwrite an existing file in the media directory",
  {
    file_path: z.string().describe("Absolute path to the new file"),
    name: z.string().describe("Name/path of the existing file in media dir"),
  },
  async ({ file_path, name }) => {
    const targetPath = path.join(MEDIA_DIR, name);

    try {
      await fs.access(targetPath);
    } catch {
      return {
        content: [{ type: "text", text: `Error: ${name} does not exist in media directory. Use 'serve' to add new files.` }],
        isError: true,
      };
    }

    await fs.copyFile(file_path, targetPath);
    const stat = await fs.stat(targetPath);

    return {
      content: [{ type: "text", text: `Updated: ${name}\nURL: ${getUrl(name)}\nSize: ${stat.size} bytes` }],
    };
  }
);

// remove - delete a file
server.tool(
  "remove",
  "Delete a file from the media directory",
  {
    name: z.string().describe("Name/path of the file to remove"),
  },
  async ({ name }) => {
    const targetPath = path.join(MEDIA_DIR, name);

    try {
      await fs.unlink(targetPath);
    } catch {
      return {
        content: [{ type: "text", text: `Error: ${name} not found in media directory.` }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: `Removed: ${name}` }],
    };
  }
);

// list - list files in media dir
server.tool(
  "list",
  "List files in the media directory",
  {
    prefix: z.string().optional().describe("Filter by prefix/subdirectory"),
  },
  async ({ prefix }) => {
    await ensureMediaDir();

    const files: { name: string; url: string; size: number }[] = [];

    async function walk(dir: string, rel: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(path.join(dir, entry.name), entryRel);
        } else {
          if (prefix && !entryRel.startsWith(prefix)) continue;
          const stat = await fs.stat(path.join(dir, entry.name));
          files.push({ name: entryRel, url: getUrl(entryRel), size: stat.size });
        }
      }
    }

    await walk(MEDIA_DIR, "");

    if (files.length === 0) {
      return { content: [{ type: "text", text: prefix ? `No files matching prefix: ${prefix}` : "No files in media directory." }] };
    }

    const listing = files.map((f) => `${f.name}  (${f.size} bytes)\n  ${f.url}`).join("\n\n");
    return { content: [{ type: "text", text: listing }] };
  }
);

// publish - upload to Cloudflare R2
server.tool(
  "publish",
  "Upload a served file from ~/media/ to Cloudflare R2 for public access",
  {
    name: z.string().describe("Name/path of the file in media dir to publish"),
  },
  async ({ name }) => {
    const targetPath = path.join(MEDIA_DIR, name);

    try {
      await fs.access(targetPath);
    } catch {
      return {
        content: [{ type: "text", text: `Error: ${name} not found in media directory. Serve it first.` }],
        isError: true,
      };
    }

    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL } = process.env;

    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
      return {
        content: [{ type: "text", text: "Error: R2 not configured yet. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME in ~/.media/.env" }],
        isError: true,
      };
    }

    const s3 = new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });

    const fileBuffer = await fs.readFile(targetPath);
    const contentType = lookup(name) || "application/octet-stream";

    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: name,
        Body: fileBuffer,
        ContentType: contentType,
      })
    );

    const publicUrl = R2_PUBLIC_URL
      ? `${R2_PUBLIC_URL.replace(/\/$/, "")}/${name}`
      : `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${name}`;

    return {
      content: [{ type: "text", text: `Published: ${name}\nPublic URL: ${publicUrl}` }],
    };
  }
);

// Start server
async function main() {
  await ensureMediaDir();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
