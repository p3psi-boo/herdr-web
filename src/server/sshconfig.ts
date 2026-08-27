/**
 * Reads ~/.ssh/config (plus one level of Include files) and lists concrete
 * Host aliases as candidates for SSH devices. Wildcard/negated patterns are
 * skipped. Per ssh semantics the first value obtained for an option wins.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type SshHostEntry = {
  alias: string;
  user?: string;
  hostName?: string;
  port?: string;
};

function parseConfig(text: string, into: Map<string, SshHostEntry>): void {
  let current: SshHostEntry[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const match = line.match(/^(\S+)\s+(.*)$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === "host") {
      current = [];
      for (const alias of value.split(/\s+/)) {
        if (/[*?!]/.test(alias)) continue;
        let entry = into.get(alias);
        if (!entry) {
          entry = { alias };
          into.set(alias, entry);
        }
        current.push(entry);
      }
      continue;
    }
    for (const entry of current) {
      if (key === "hostname" && !entry.hostName) entry.hostName = value;
      else if (key === "user" && !entry.user) entry.user = value;
      else if (key === "port" && !entry.port) entry.port = value;
    }
  }
}

/** Expand `~` and resolve Include patterns relative to ~/.ssh (one level). */
function includeFiles(mainText: string, sshDir: string): string[] {
  const files: string[] = [];
  for (const rawLine of mainText.split("\n")) {
    const match = rawLine.trim().match(/^include\s+(.+)$/i);
    if (!match) continue;
    for (let pattern of match[1].trim().split(/\s+/)) {
      if (pattern.startsWith("~/") || pattern === "~") {
        pattern = join(homedir(), pattern.slice(2));
      }
      if (pattern.startsWith(sshDir)) pattern = pattern.slice(sshDir.length + 1);
      if (pattern.startsWith("/")) continue; // outside ~/.ssh, skip
      try {
        for (const hit of new Bun.Glob(pattern).scanSync({ cwd: sshDir, onlyFiles: true })) {
          files.push(join(sshDir, hit));
        }
      } catch {
        // unreadable include pattern, skip
      }
    }
  }
  return files;
}

export function listSshHosts(): SshHostEntry[] {
  const sshDir = join(homedir(), ".ssh");
  const mainPath = join(sshDir, "config");
  if (!existsSync(mainPath)) return [];
  const mainText = readFileSync(mainPath, "utf8");
  const hosts = new Map<string, SshHostEntry>();
  parseConfig(mainText, hosts);
  for (const file of includeFiles(mainText, sshDir)) {
    try {
      parseConfig(readFileSync(file, "utf8"), hosts);
    } catch {
      // unreadable include file, skip
    }
  }
  return [...hosts.values()];
}
