import { $ } from "bun";

const SERVICE_NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function validateServiceName(name: string) {
  if (!SERVICE_NAME_RE.test(name) || name.length > 63) {
    throw new Error(`Invalid service name "${name}" — use lowercase letters, numbers, and hyphens only.`);
  }
}

export interface TailscaleStatus {
  nodeName: string;
  tailnetDomain: string;
  online: boolean;
  tags: string[];
  isTagged: boolean;
}

export async function getTailscaleStatus(): Promise<TailscaleStatus> {
  const result = await $`tailscale status --json`.quiet();
  const data = JSON.parse(result.stdout.toString());
  const self = data.Self || {};
  const dnsName: string = self.DNSName || "";
  // DNSName is like "parachute.taildf9ce2.ts.net."
  const parts = dnsName.replace(/\.$/, "").split(".");
  const nodeName = parts[0] || "";
  const tailnetDomain = parts.slice(1).join(".") || "";
  const tags: string[] = self.Tags || [];

  return {
    nodeName,
    tailnetDomain,
    online: self.Online ?? false,
    tags,
    isTagged: tags.length > 0,
  };
}

export async function setupServe(port: number) {
  await $`tailscale serve --bg http://127.0.0.1:${port}`.quiet();
}

export async function exposeService(name: string, port: number): Promise<string> {
  validateServiceName(name);
  await $`tailscale serve --service=svc:${name} --https=443 http://127.0.0.1:${port}`.quiet();
  // Get the tailnet domain for URL construction
  const status = await getTailscaleStatus();
  return `https://${name}.${status.tailnetDomain}`;
}

export async function unexposeService(name: string) {
  validateServiceName(name);
  await $`tailscale serve clear svc:${name}`.quiet();
}

export async function getServeStatus(): Promise<Record<string, unknown>> {
  const result = await $`tailscale serve status --json`.quiet();
  return JSON.parse(result.stdout.toString());
}
