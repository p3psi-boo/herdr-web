/**
 * Password login + in-memory session tokens.
 * The startup master TOKEN (printed URL) is always valid; password login
 * mints a session token that lives until the gateway restarts.
 */
import { timingSafeEqual } from "node:crypto";

const sessions = new Set<string>();

export function createSession(): string {
  const token = crypto.randomUUID().replaceAll("-", "");
  sessions.add(token);
  return token;
}

export function isSession(token: string): boolean {
  return sessions.has(token);
}

export function passwordMatches(input: string, expected: string): boolean {
  const a = Buffer.from(input, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
