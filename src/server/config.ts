import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type DeviceConfig = {
  id: string;
  name: string;
  type: "local" | "ssh";
  /** ssh target, e.g. "vincent@10.10.10.87" (type === "ssh") */
  host?: string;
};

const CONFIG_PATH = join(homedir(), ".config", "herdr-web", "devices.json");

export function loadDevices(): DeviceConfig[] {
  if (!existsSync(CONFIG_PATH)) {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    const defaults: DeviceConfig[] = [{ id: "local", name: "Local", type: "local" }];
    writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2) + "\n");
    return defaults;
  }
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`invalid devices config at ${CONFIG_PATH}`);
  }
  return raw as DeviceConfig[];
}

export function saveDevices(devices: DeviceConfig[]): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(devices, null, 2) + "\n");
}

export function localHerdrSocketPath(): string {
  return process.env.HERDR_SOCKET_PATH ?? join(homedir(), ".config", "herdr", "herdr.sock");
}

export const PORT = Number(process.env.HERDR_WEB_PORT ?? 7317);
// Loopback-only by default (localhost + random token is the threat model);
// set HERDR_WEB_HOST=0.0.0.0 when running inside a container.
export const HOST = process.env.HERDR_WEB_HOST ?? "127.0.0.1";

export const TOKEN =
  process.env.HERDR_WEB_TOKEN ?? crypto.randomUUID().replaceAll("-", "");

const WEB_CONFIG_PATH = join(homedir(), ".config", "herdr-web", "config.json");

/**
 * Login password for the web UI. Env HERDR_WEB_PASSWORD wins; otherwise it is
 * read from ~/.config/herdr-web/config.json, generating and persisting a
 * random one (0600) on first run.
 */
export function loadPassword(): string {
  if (process.env.HERDR_WEB_PASSWORD) return process.env.HERDR_WEB_PASSWORD;
  if (existsSync(WEB_CONFIG_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(WEB_CONFIG_PATH, "utf8"));
      if (typeof raw?.password === "string" && raw.password.length > 0) {
        return raw.password;
      }
    } catch {
      // fall through to regenerate
    }
  }
  mkdirSync(dirname(WEB_CONFIG_PATH), { recursive: true });
  const password = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  writeFileSync(WEB_CONFIG_PATH, JSON.stringify({ password }, null, 2) + "\n", {
    mode: 0o600,
  });
  return password;
}
