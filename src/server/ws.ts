import type { ClientMessage, CommandResult, ServerMessage, TerminalRef } from "../shared/protocol.ts";
import { DEFAULT_READ_LINES } from "../shared/protocol.ts";
import type { DeviceConfig } from "./config.ts";
import type { DeviceManager } from "./devices.ts";
import { listSshHosts } from "./sshconfig.ts";
import { TerminalSession, type TerminalCallbacks } from "./terminal.ts";

type Ws = import("bun").ServerWebSocket<unknown>;

const COMMAND_TYPES = new Set([
  "device.add",
  "device.remove",
  "ssh.hosts",
  "terminal.create",
  "terminal.focus",
  "terminal.attach",
  "terminal.read",
  "notification.read",
  "notification.read-all",
  "notification.dismiss",
  "notification.clear",
]);

const CONTROL_TYPES = new Set(["terminal.input", "terminal.resize", "terminal.scroll", "terminal.release"]);

/**
 * The websocket is an authenticated but still external boundary: drop frames
 * that are not JSON objects carrying a known message type, and require the
 * commandId every command variant needs for its reply. Per-field payload
 * validation stays with each handler.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const fields = value as Record<string, unknown>;
  if (typeof fields.type !== "string") return null;
  if (COMMAND_TYPES.has(fields.type) && typeof fields.commandId !== "string") return null;
  if (!COMMAND_TYPES.has(fields.type) && !CONTROL_TYPES.has(fields.type)) return null;
  return value as ClientMessage;
}

type Attachment = {
  id: string;
  target: TerminalRef;
  session: TerminalProcess;
};

type TerminalProcess = Pick<TerminalSession, "inputBytes" | "release" | "resize" | "scroll" | "start">;
type TerminalFactory = (device: DeviceConfig, paneId: string, callbacks: TerminalCallbacks) => TerminalProcess;

export class ClientSession {
  private attachment: Attachment | null = null;
  private commands: Promise<void> = Promise.resolve();

  constructor(
    private socket: Ws,
    private devices: DeviceManager,
    private createTerminalProcess: TerminalFactory = (device, paneId, callbacks) => new TerminalSession(device, paneId, callbacks),
  ) {}

  send(message: ServerMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  ready(): void {
    this.send({
      type: "gateway.ready",
      devices: this.devices.list(),
      states: this.devices.states(),
      ...this.devices.inbox.snapshot(),
    });
  }

  handle(raw: string): void {
    const message = parseClientMessage(raw);
    if (!message) return;
    if (message.type === "terminal.input") {
      if (this.attachment?.id === message.attachmentId) this.attachment.session.inputBytes(message.bytes);
      return;
    }
    if (message.type === "terminal.resize") {
      if (this.attachment?.id === message.attachmentId) this.attachment.session.resize(message.cols, message.rows);
      return;
    }
    if (message.type === "terminal.scroll") {
      if (this.attachment?.id === message.attachmentId) this.attachment.session.scroll(message.direction, message.lines);
      return;
    }
    if (message.type === "terminal.release") {
      if (this.attachment?.id === message.attachmentId) this.release();
      return;
    }
    this.commands = this.commands.then(() => this.run(message));
  }

  private async run(message: Exclude<ClientMessage, { type: "terminal.input" | "terminal.resize" | "terminal.scroll" | "terminal.release" }>): Promise<void> {
    try {
      const result = await this.execute(message);
      if (result) this.send({ type: "command.result", commandId: message.commandId, result });
    } catch (error) {
      this.send({ type: "command.failed", commandId: message.commandId, message: String(error) });
    }
  }

  private async execute(message: Exclude<ClientMessage, { type: "terminal.input" | "terminal.resize" | "terminal.scroll" | "terminal.release" }>): Promise<CommandResult | null> {
    switch (message.type) {
      case "device.add":
        this.addDevice(message.name, message.host);
        return { type: "completed" };
      case "device.remove":
        this.devices.remove(message.deviceId);
        return { type: "completed" };
      case "ssh.hosts":
        this.send({ type: "ssh.hosts", commandId: message.commandId, hosts: listSshHosts() });
        return { type: "completed" };
      case "terminal.create":
        return this.createTerminal(message.deviceId, message.workspaceId);
      case "terminal.focus":
        await this.focusTerminal(message.target);
        return { type: "completed" };
      case "terminal.attach":
        await this.attach(message.commandId, message.target, message.cols, message.rows);
        return null;
      case "terminal.read":
        return this.readTerminal(message.target, message.lines);
      case "notification.read":
        this.devices.inbox.markRead(message.notificationId);
        return { type: "completed" };
      case "notification.read-all":
        this.devices.inbox.markAllRead();
        return { type: "completed" };
      case "notification.dismiss":
        this.devices.inbox.dismiss(message.notificationId);
        return { type: "completed" };
      case "notification.clear":
        this.devices.inbox.clear();
        return { type: "completed" };
    }
  }

  private addDevice(nameInput: string, hostInput: string): void {
    const name = nameInput.trim();
    const host = hostInput.trim();
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "ssh";
    let id = base;
    for (let number = 2; this.devices.get(id); number += 1) id = `${base}-${number}`;
    this.devices.add({ id, name, type: "ssh", host });
  }

  private async createTerminal(deviceId: string, workspaceId?: string): Promise<CommandResult> {
    const device = this.device(deviceId);
    await device.connect();
    const result = workspaceId
      ? await device.client!.createTab({ workspace_id: workspaceId, focus: true })
      : await device.client!.createWorkspace({ focus: true });
    await device.refresh();
    return { type: "terminal-created", target: { deviceId, paneId: result.root_pane.pane_id } };
  }

  private async focusTerminal(target: TerminalRef): Promise<void> {
    const device = this.device(target.deviceId);
    await device.connect();
    await device.client!.focusPane(target.paneId);
  }

  private async readTerminal(target: TerminalRef, lines = DEFAULT_READ_LINES): Promise<CommandResult> {
    const device = this.device(target.deviceId);
    await device.connect();
    const result = await device.client!.readPane(target.paneId, lines);
    return { type: "terminal-read", target, text: result.text };
  }

  private async attach(commandId: string, target: TerminalRef, cols: number, rows: number): Promise<void> {
    this.release();
    const device = this.device(target.deviceId);
    await device.connect();
    const id = crypto.randomUUID();
    const session = this.createTerminalProcess(device.config, target.paneId, {
      onFrame: (frame) => {
        if (this.attachment?.id !== id) return;
        this.send({ type: "terminal.frame", attachmentId: id, target, ...frame });
      },
      onClosed: (reason) => {
        if (this.attachment?.id !== id) return;
        this.attachment = null;
        this.send({ type: "terminal.closed", attachmentId: id, target, reason });
      },
    });
    this.attachment = { id, target, session };
    this.send({ type: "command.result", commandId, result: { type: "terminal-attached", attachmentId: id, target } });
    session.start("control", cols, rows, device.sshArgs());
  }

  release(): void {
    this.attachment?.session.release();
    this.attachment = null;
  }

  private device(id: string) {
    const device = this.devices.get(id);
    if (!device) throw new Error(`unknown device: ${id}`);
    return device;
  }
}
