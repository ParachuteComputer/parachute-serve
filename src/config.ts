import { homedir } from "os";
import { join } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";

export const CONFIG_DIR = join(homedir(), ".tailshare");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");
export const LOG_PATH = join(CONFIG_DIR, "daemon.log");
export const ERR_PATH = join(CONFIG_DIR, "daemon.err");
export const DEFAULT_PORT = 8484;
export const DEFAULT_MEDIA_DIR = join(homedir(), "media");

export interface ServiceEntry {
  port: number;
  createdAt: string;
}

export interface TailshareConfig {
  mediaDir: string;
  port: number;
  tailscaleUrl: string;
  tailnetDomain: string; // e.g. "taildf9ce2.ts.net"
  services: Record<string, ServiceEntry>;
}

export async function ensureConfigDir() {
  await mkdir(CONFIG_DIR, { recursive: true });
}

export function defaultConfig(): TailshareConfig {
  return {
    mediaDir: DEFAULT_MEDIA_DIR,
    port: DEFAULT_PORT,
    tailscaleUrl: "",
    tailnetDomain: "",
    services: {},
  };
}

export async function readConfig(): Promise<TailshareConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return { ...defaultConfig(), ...JSON.parse(raw) };
  } catch {
    return defaultConfig();
  }
}

export async function writeConfig(config: TailshareConfig) {
  await ensureConfigDir();
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}
