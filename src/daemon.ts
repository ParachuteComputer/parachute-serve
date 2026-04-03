#!/usr/bin/env bun

import { readConfig, ensureConfigDir } from "./config.ts";
import { stat, mkdir } from "fs/promises";
import { join, extname, resolve } from "path";

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
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
};

async function main() {
  await ensureConfigDir();
  const config = await readConfig();
  const mediaDir = config.mediaDir;

  // Ensure media directory exists
  await mkdir(mediaDir, { recursive: true });

  const server = Bun.serve({
    port: config.port,
    hostname: "127.0.0.1",

    async fetch(req) {
      const url = new URL(req.url);
      const decodedPath = decodeURIComponent(url.pathname);
      const filePath = resolve(join(mediaDir, decodedPath));

      // Prevent path traversal
      if (!filePath.startsWith(mediaDir + "/") && filePath !== mediaDir) {
        return new Response("Forbidden", { status: 403 });
      }

      try {
        const fileStat = await stat(filePath);

        if (fileStat.isDirectory()) {
          return new Response("Not found", { status: 404 });
        }

        const ext = extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || "application/octet-stream";
        const file = Bun.file(filePath);

        return new Response(file, {
          headers: {
            "Content-Type": contentType,
            "Content-Length": fileStat.size.toString(),
          },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  });

  console.log(`tailshare daemon listening on http://127.0.0.1:${server.port}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
