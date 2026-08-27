import { describe, expect, test } from "bun:test";
import type { ServerMessage } from "../shared/protocol.ts";
import type { DeviceManager } from "./devices.ts";
import type { TerminalCallbacks } from "./terminal.ts";
import { ClientSession } from "./ws.ts";

function socketHarness() {
  const messages: ServerMessage[] = [];
  const waiters = new Set<() => void>();
  const socket = {
    send(raw: string) {
      messages.push(JSON.parse(raw) as ServerMessage);
      for (const wake of waiters) wake();
    },
  } as unknown as import("bun").ServerWebSocket<unknown>;
  async function waitFor(predicate: (message: ServerMessage) => boolean): Promise<ServerMessage> {
    for (;;) {
      const match = messages.find(predicate);
      if (match) return match;
      await new Promise<void>((resolve) => {
        const wake = () => {
          waiters.delete(wake);
          resolve();
        };
        waiters.add(wake);
      });
    }
  }
  return { socket, messages, waitFor };
}

function deviceManager(devices: Record<string, object>): DeviceManager {
  return { get: (id: string) => devices[id] } as unknown as DeviceManager;
}

describe("ClientSession", () => {
  test("runs commands in browser order", async () => {
    const calls: string[] = [];
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const firstStarted = new Promise<void>((resolve) => { started = resolve; });
    const device = {
      connect: async () => {},
      client: {
        focusPane: async (paneId: string) => {
          calls.push(`${paneId}:start`);
          if (paneId === "p1") {
            started();
            await gate;
          }
          calls.push(`${paneId}:end`);
        },
      },
    };
    const harness = socketHarness();
    const session = new ClientSession(harness.socket, deviceManager({ local: device }));

    session.handle(JSON.stringify({ type: "terminal.focus", commandId: "one", target: { deviceId: "local", paneId: "p1" } }));
    session.handle(JSON.stringify({ type: "terminal.focus", commandId: "two", target: { deviceId: "local", paneId: "p2" } }));

    await firstStarted;
    await Promise.resolve();
    expect(calls).toEqual(["p1:start"]);
    release();
    await harness.waitFor((message) => message.type === "command.result" && message.commandId === "two");
    expect(calls).toEqual(["p1:start", "p1:end", "p2:start", "p2:end"]);
  });

  test("routes equal pane ids through distinct attachment leases", async () => {
    const harness = socketHarness();
    const terminals: Array<{
      deviceId: string;
      callbacks: TerminalCallbacks;
      inputs: string[];
      released: boolean;
    }> = [];
    const devices = deviceManager({
      a: { config: { id: "a", name: "A", type: "local" }, connect: async () => {}, sshArgs: () => [] },
      b: { config: { id: "b", name: "B", type: "local" }, connect: async () => {}, sshArgs: () => [] },
    });
    const session = new ClientSession(harness.socket, devices, (device, _paneId, callbacks) => {
      const terminal = { deviceId: device.id, callbacks, inputs: [] as string[], released: false };
      terminals.push(terminal);
      return {
        start: () => {},
        inputBytes: (bytes: string) => terminal.inputs.push(bytes),
        resize: () => {},
        scroll: () => {},
        release: () => { terminal.released = true; },
      };
    });

    session.handle(JSON.stringify({ type: "terminal.attach", commandId: "a1", target: { deviceId: "a", paneId: "p1" }, cols: 80, rows: 24 }));
    const first = await harness.waitFor((message) => message.type === "command.result" && message.commandId === "a1");
    session.handle(JSON.stringify({ type: "terminal.attach", commandId: "b1", target: { deviceId: "b", paneId: "p1" }, cols: 80, rows: 24 }));
    const second = await harness.waitFor((message) => message.type === "command.result" && message.commandId === "b1");
    const firstId = first.type === "command.result" && first.result.type === "terminal-attached" ? first.result.attachmentId : "";
    const secondId = second.type === "command.result" && second.result.type === "terminal-attached" ? second.result.attachmentId : "";

    expect(firstId).not.toBe(secondId);
    expect(terminals[0].released).toBe(true);

    terminals[0].callbacks.onFrame({ seq: 1, full: false, bytes: "old" });
    terminals[1].callbacks.onFrame({ seq: 1, full: false, bytes: "new" });
    session.handle(JSON.stringify({ type: "terminal.input", attachmentId: firstId, bytes: "old-input" }));
    session.handle(JSON.stringify({ type: "terminal.input", attachmentId: secondId, bytes: "new-input" }));

    const frames = harness.messages.filter((message) => message.type === "terminal.frame");
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ attachmentId: secondId, target: { deviceId: "b", paneId: "p1" }, bytes: "new" });
    expect(terminals[0].inputs).toEqual([]);
    expect(terminals[1].inputs).toEqual(["new-input"]);
  });

  test("announces an attachment before its first frame", async () => {
    const harness = socketHarness();
    const devices = deviceManager({
      local: { config: { id: "local", name: "Local", type: "local" }, connect: async () => {}, sshArgs: () => [] },
    });
    const session = new ClientSession(harness.socket, devices, (_device, _paneId, callbacks) => ({
      start: () => callbacks.onFrame({ seq: 1, full: true, bytes: "frame" }),
      inputBytes: () => {},
      resize: () => {},
      scroll: () => {},
      release: () => {},
    }));

    session.handle(JSON.stringify({ type: "terminal.attach", commandId: "attach", target: { deviceId: "local", paneId: "p1" }, cols: 80, rows: 24 }));
    await harness.waitFor((message) => message.type === "terminal.frame");

    expect(harness.messages.map((message) => message.type)).toEqual(["command.result", "terminal.frame"]);
  });

  test("routes terminal.scroll to the active attachment", async () => {
    const harness = socketHarness();
    const scrolls: Array<{ direction: string; lines: number }> = [];
    const devices = deviceManager({
      local: { config: { id: "local", name: "Local", type: "local" }, connect: async () => {}, sshArgs: () => [] },
    });
    const session = new ClientSession(harness.socket, devices, (_device, _paneId, _callbacks) => ({
      start: () => {},
      inputBytes: () => {},
      resize: () => {},
      scroll: (direction, lines) => scrolls.push({ direction, lines }),
      release: () => {},
    }));

    session.handle(JSON.stringify({ type: "terminal.attach", commandId: "attach", target: { deviceId: "local", paneId: "p1" }, cols: 80, rows: 24 }));
    const result = await harness.waitFor((message) => message.type === "command.result" && message.commandId === "attach");
    const attachmentId = result.type === "command.result" && result.result.type === "terminal-attached" ? result.result.attachmentId : "";

    session.handle(JSON.stringify({ type: "terminal.scroll", attachmentId, direction: "up", lines: 5 }));
    session.handle(JSON.stringify({ type: "terminal.scroll", attachmentId: "wrong-id", direction: "down", lines: 3 }));
    session.handle(JSON.stringify({ type: "terminal.scroll", attachmentId, direction: "down", lines: 2 }));

    expect(scrolls).toEqual([
      { direction: "up", lines: 5 },
      { direction: "down", lines: 2 },
    ]);
  });

  test("executes terminal.read through the device client", async () => {
    const harness = socketHarness();
    const device = {
      connect: async () => {},
      client: {
        readPane: async (paneId: string, lines: number) => ({ text: `pane ${paneId} lines ${lines}` }),
      },
    };
    const session = new ClientSession(harness.socket, deviceManager({ local: device }));

    session.handle(JSON.stringify({
      type: "terminal.read",
      commandId: "read-1",
      target: { deviceId: "local", paneId: "w1:p1" },
      lines: 50,
    }));

    const message = await harness.waitFor((msg) => msg.type === "command.result" && msg.commandId === "read-1");
    expect(message).toMatchObject({
      type: "command.result",
      commandId: "read-1",
      result: {
        type: "terminal-read",
        target: { deviceId: "local", paneId: "w1:p1" },
        text: "pane w1:p1 lines 50",
      },
    });
  });
});
