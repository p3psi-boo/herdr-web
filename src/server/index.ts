/**
 * herdr-web gateway — single Bun process serving both the web UI and the
 * browser ⇄ herdr bridge.
 * - "/" serves the bundled React app (Bun fullstack; HMR in development)
 * - /ghostty-vt.wasm is the Ghostty VT parser used by the browser terminal
 * - POST /api/login (password → session token), POST /api/check (token check)
 * - POST /api/notify (ingest a notification), GET /api/notifications
 * - /ws upgrades to the WS bridge, token-checked via ?token= query param
 * Binds loopback by default (HERDR_WEB_HOST overrides); prints the full URL
 * and login password at startup.
 */
import homepage from "../../index.html";
import ghosttyWasm from "ghostty-web/ghostty-vt.wasm" with { type: "file" };
import { createSession, isSession, passwordMatches } from "./auth.ts";
import { HOST, PORT, TOKEN, loadDevices, loadPassword } from "./config.ts";
import { DeviceManager } from "./devices.ts";
import { ingestInputFrom } from "./notifications.ts";
import { ClientSession } from "./ws.ts";

const PASSWORD = loadPassword();
const devices = new DeviceManager(loadDevices());
const clients = new Set<ClientSession>();
devices.broadcast = (msg) => {
  for (const client of clients) client.send(msg);
};

type WsData = { session?: ClientSession };

function tokenValid(token: string | null): boolean {
  return token !== null && (token === TOKEN || isSession(token));
}

function tokenFrom(req: Request, body: Record<string, unknown> | null): string | null {
  const url = new URL(req.url);
  const query = url.searchParams.get("token");
  if (query) return query;
  const auth = req.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    const value = auth.slice(7).trim();
    if (value) return value;
  }
  return typeof body?.token === "string" ? body.token : null;
}

function unauthorized() {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const server = Bun.serve<WsData>({
  hostname: HOST,
  port: PORT,
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/": homepage,
    "/ghostty-vt.wasm": () =>
      new Response(Bun.file(ghosttyWasm), {
        headers: {
          "Content-Type": "application/wasm",
          "Cache-Control": "public, max-age=86400",
        },
      }),
    "/api/login": {
      POST: async (req: Request) => {
        const body = await readJson(req);
        const password = typeof body?.password === "string" ? body.password : "";
        if (!passwordMatches(password, PASSWORD)) {
          return Response.json({ error: "invalid_password" }, { status: 401 });
        }
        return Response.json({ token: createSession() });
      },
    },
    "/api/check": {
      POST: async (req: Request) => {
        const body = await readJson(req);
        const token = typeof body?.token === "string" ? body.token : null;
        return new Response(null, { status: tokenValid(token) ? 204 : 401 });
      },
    },
    "/api/notify": {
      POST: async (req: Request) => {
        const body = await readJson(req);
        if (!tokenValid(tokenFrom(req, body))) return unauthorized();
        if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });
        const input = ingestInputFrom(body);
        const deviceId = input.deviceId?.trim() ?? "";
        const device = deviceId ? devices.get(deviceId) : undefined;
        try {
          const item = devices.inbox.ingest(
            input,
            device ? { id: device.config.id, name: device.config.name } : undefined,
          );
          return Response.json(item, { status: 201 });
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : String(err) },
            { status: 400 },
          );
        }
      },
    },
    "/api/notifications": {
      GET: (req: Request) => {
        if (!tokenValid(tokenFrom(req, null))) return unauthorized();
        return Response.json(devices.inbox.snapshot());
      },
    },
  },
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (!tokenValid(url.searchParams.get("token"))) {
        return new Response("unauthorized", { status: 401 });
      }
      if (srv.upgrade(req, { data: {} as WsData })) return undefined;
      return new Response("websocket upgrade failed", { status: 400 });
    }
    return new Response("not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      const session = new ClientSession(ws, devices);
      clients.add(session);
      ws.data.session = session;
      session.ready();
    },
    message(ws, message) {
      const session = ws.data.session;
      if (session && typeof message === "string") void session.handle(message);
    },
    close(ws) {
      const session = ws.data.session;
      if (session) {
        session.release();
        clients.delete(session);
      }
    },
  },
});

const url = `http://${HOST}:${server.port}/?token=${TOKEN}`;
console.log(`herdr-web listening on ${url}`);
console.log(`login password: ${PASSWORD}  (stored in ~/.config/herdr-web/config.json)`);

process.on("SIGINT", () => {
  devices.disposeAll();
  process.exit(0);
});
process.on("SIGTERM", () => {
  devices.disposeAll();
  process.exit(0);
});
