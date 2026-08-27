import type { Snapshot } from "../shared/protocol.ts";

type CreateResult = { root_pane: { pane_id: string } };

export function apiRequest<Result = unknown>(
  socketPath: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<Result> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let settled = false;
    const fail = (err: Error) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };
    Bun.connect({
      unix: socketPath,
      socket: {
        open(socket) {
          socket.write(JSON.stringify({ id: "hw_1", method, params }) + "\n");
        },
        data(socket, data) {
          buffer += data.toString();
          const idx = buffer.indexOf("\n");
          if (idx < 0) return;
          const line = buffer.slice(0, idx).trim();
          settled = true;
          try {
            socket.end();
          } catch {
            // already closed
          }
          try {
            const msg = JSON.parse(line) as {
              result?: unknown;
              error?: { code?: string; message?: string };
            };
            if (msg.error) {
              reject(new Error(`${msg.error.code ?? "error"}: ${msg.error.message ?? "unknown"}`));
            } else {
              resolve(msg.result as Result);
            }
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        },
        close() {
          fail(new Error("herdr socket closed without a response"));
        },
        error(_socket, err) {
          fail(err instanceof Error ? err : new Error(String(err)));
        },
        connectError(_socket, err) {
          fail(err instanceof Error ? err : new Error(String(err)));
        },
      },
    }).catch(fail);
  });
}

export class HerdrClient {
  constructor(private socketPath: string) {}

  ping() {
    return apiRequest(this.socketPath, "ping");
  }

  snapshot(): Promise<Snapshot> {
    return apiRequest<{ snapshot: Snapshot }>(this.socketPath, "session.snapshot").then((result) => result.snapshot);
  }

  focusPane(paneId: string) {
    return apiRequest(this.socketPath, "pane.focus", { pane_id: paneId });
  }

  createWorkspace(params: Record<string, unknown> = {}): Promise<CreateResult> {
    return apiRequest(this.socketPath, "workspace.create", params);
  }

  createTab(params: Record<string, unknown> = {}): Promise<CreateResult> {
    return apiRequest(this.socketPath, "tab.create", params);
  }

  readPane(paneId: string, lines = 2000): Promise<{ text: string }> {
    return apiRequest<{ read: { text: string } }>(this.socketPath, "pane.read", {
      pane_id: paneId,
      lines,
      source: "recent",
      format: "text",
    }).then((result) => result.read);
  }
}

export async function subscribeEvents(
  socketPath: string,
  subscriptions: Array<Record<string, unknown>>,
  onEvent: (msg: Record<string, unknown>) => void,
): Promise<{ close: () => void }> {
  let buffer = "";
  let acked = false;
  let socket: import("bun").Socket | null = null;

  await new Promise<void>((resolve, reject) => {
    Bun.connect({
      unix: socketPath,
      socket: {
        open(s) {
          s.write(
            JSON.stringify({ id: "hw_sub", method: "events.subscribe", params: { subscriptions } }) +
              "\n",
          );
        },
        data(s, data) {
          socket = socket ?? s;
          buffer += data.toString();
          let idx: number;
          while ((idx = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line) continue;
            if (!acked) {
              acked = true;
              try {
                const msg = JSON.parse(line) as { error?: { code?: string; message?: string } };
                if (msg.error) {
                  reject(new Error(msg.error.message ?? "subscribe failed"));
                  return;
                }
              } catch (err) {
                reject(err instanceof Error ? err : new Error(String(err)));
                return;
              }
              resolve();
              continue;
            }
            try {
              onEvent(JSON.parse(line));
            } catch {
              // malformed event line; ignore
            }
          }
        },
        close() {
          if (!acked) reject(new Error("herdr socket closed before subscribe ack"));
        },
        error(_s, err) {
          if (!acked) reject(err instanceof Error ? err : new Error(String(err)));
        },
        connectError(_s, err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      },
    }).catch(reject);
  });

  return {
    close: () => {
      try {
        socket?.end();
      } catch {
        // already gone
      }
    },
  };
}
