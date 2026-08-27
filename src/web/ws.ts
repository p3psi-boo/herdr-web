import type {
  ClientMessage,
  CommandResult,
  ServerMessage,
  StoredNotification,
  TerminalRef,
} from "../shared/protocol.ts";
import { DEFAULT_READ_LINES, sameTerminal } from "../shared/protocol.ts";
import { useStore, type Operation } from "./store.ts";
import { TerminalController } from "./terminal-controller.ts";

type CommandMessage = Extract<ClientMessage, { commandId: string }>;
type CommandInput = CommandMessage extends infer Message
  ? Message extends CommandMessage
    ? Omit<Message, "commandId">
    : never
  : never;

const TOKEN_KEY = "herdr-web.token";

class AppClient {
  private socket: WebSocket | null = null;
  private selectionGeneration = 0;
  private createIntents = new Map<string, number>();
  private pendingCommands = new Map<string, { resolve: (result: CommandResult) => void; reject: (error: Error) => void }>();
  readonly terminal = new TerminalController((message) => this.send(message));

  async bootstrap(): Promise<void> {
    // A ?token= URL parameter is the handoff path; persist it once, then read
    // from storage only.
    const urlToken = new URL(window.location.href).searchParams.get("token");
    if (urlToken) localStorage.setItem(TOKEN_KEY, urlToken);
    if (!this.token()) {
      useStore.getState().setSession({ status: "signed-out" });
      return;
    }
    const response = await fetch("/api/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: this.token() }),
    });
    if (!response.ok) {
      this.clearToken();
      useStore.getState().setSession({ status: "signed-out" });
      return;
    }
    useStore.getState().setSession({ status: "connecting" });
    this.connect();
  }

  async login(password: string): Promise<boolean> {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!response.ok) return false;
    const body = await response.json() as { token: string };
    localStorage.setItem(TOKEN_KEY, body.token);
    useStore.getState().setSession({ status: "connecting" });
    this.connect();
    return true;
  }

  selectDevice(deviceId: string): void {
    this.selectionGeneration += 1;
    useStore.getState().selectDevice(deviceId);
    const target = useStore.getState().selection.desired;
    if (target) {
      this.focus(target);
      return;
    }
    this.terminal.select(null);
  }

  selectTerminal(target: TerminalRef): void {
    this.selectionGeneration += 1;
    useStore.getState().selectTerminal(target);
    this.focus(target);
  }

  private focus(target: TerminalRef): void {
    this.command({ type: "terminal.focus", target }, "focus-terminal");
    this.terminal.select(target);
  }

  createTerminal(): void {
    const state = useStore.getState();
    const snapshot = state.deviceStates[state.activeDeviceId]?.snapshot;
    const workspaceId = snapshot?.focused_workspace_id
      ?? snapshot?.workspaces.find((workspace) => workspace.focused)?.workspace_id
      ?? snapshot?.workspaces[0]?.workspace_id;
    const commandId = this.command(
      { type: "terminal.create", deviceId: state.activeDeviceId, workspaceId },
      "create-terminal",
    );
    this.createIntents.set(commandId, this.selectionGeneration);
    state.setOverlay({ type: "none" });
  }

  addDevice(name: string, host: string): void {
    this.command({ type: "device.add", name, host }, "device");
  }

  removeDevice(deviceId: string): void {
    this.command({ type: "device.remove", deviceId }, "device");
  }

  requestSshHosts(): void {
    this.command({ type: "ssh.hosts" }, "device");
  }

  markNotificationRead(notificationId: string): void {
    this.command({ type: "notification.read", notificationId }, "notification");
  }

  markAllNotificationsRead(): void {
    this.command({ type: "notification.read-all" }, "notification");
  }

  dismissNotification(notificationId: string): void {
    this.command({ type: "notification.dismiss", notificationId }, "notification");
  }

  clearNotifications(): void {
    this.command({ type: "notification.clear" }, "notification");
  }

  openNotification(notification: StoredNotification): void {
    this.markNotificationRead(notification.id);
    useStore.getState().setOverlay({ type: "none" });
    if (notification.paneId) {
      this.selectTerminal({ deviceId: notification.deviceId, paneId: notification.paneId });
    }
  }

  private connect(): void {
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) return;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws?token=${encodeURIComponent(this.token())}`);
    this.socket = socket;
    socket.onmessage = (event) => this.handle(JSON.parse(String(event.data)) as ServerMessage);
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.createIntents.clear();
      for (const pending of this.pendingCommands.values()) {
        pending.reject(new Error("socket disconnected"));
      }
      this.pendingCommands.clear();
      this.terminal.disconnected();
      useStore.getState().setSession({ status: "reconnecting" });
      setTimeout(() => this.connect(), 1000);
    };
  }

  private handle(message: ServerMessage): void {
    const store = useStore.getState();
    if (message.type === "gateway.ready") {
      store.setReady(message);
      this.terminal.select(useStore.getState().selection.desired);
      return;
    }
    if (message.type === "device.list" || message.type === "device.state") {
      const before = store.selection.desired;
      if (message.type === "device.list") store.setDevices(message.devices);
      else store.applyDeviceState(message.state);
      const after = useStore.getState().selection.desired;
      if (!sameTerminal(before, after)) this.terminal.select(after);
      return;
    }
    if (message.type === "ssh.hosts") {
      store.finishOperation(message.commandId);
      store.setSshHosts(message.hosts);
      return;
    }
    if (message.type === "notification.state") {
      store.setNotifications(message.notifications, message.unread);
      return;
    }
    if (message.type === "command.result") {
      store.finishOperation(message.commandId);
      const pending = this.pendingCommands.get(message.commandId);
      if (pending) {
        this.pendingCommands.delete(message.commandId);
        pending.resolve(message.result);
      }
      this.terminal.handle(message);
      if (message.result.type === "terminal-created") {
        const generation = this.createIntents.get(message.commandId);
        this.createIntents.delete(message.commandId);
        if (generation === this.selectionGeneration) this.selectTerminal(message.result.target);
      }
      return;
    }
    if (message.type === "command.failed") {
      this.createIntents.delete(message.commandId);
      const pending = this.pendingCommands.get(message.commandId);
      if (pending) {
        this.pendingCommands.delete(message.commandId);
        pending.reject(new Error(message.message));
      }
      store.failOperation(message.commandId, message.message);
      this.terminal.handle(message);
      return;
    }
    this.terminal.handle(message);
  }

  private command(message: CommandInput, operation: Operation): string {
    const commandId = crypto.randomUUID();
    useStore.getState().beginOperation(commandId, operation);
    this.send({ ...message, commandId } as ClientMessage);
    return commandId;
  }

  commandWithResult<T extends CommandResult>(message: CommandInput, operation: Operation): Promise<T> {
    const commandId = crypto.randomUUID();
    useStore.getState().beginOperation(commandId, operation);
    return new Promise<T>((resolve, reject) => {
      this.pendingCommands.set(commandId, {
        resolve: (res) => resolve(res as T),
        reject,
      });
      this.send({ ...message, commandId } as ClientMessage);
    });
  }

  async readTerminal(target: TerminalRef, lines = DEFAULT_READ_LINES): Promise<string> {
    const result = await this.commandWithResult<Extract<CommandResult, { type: "terminal-read" }>>(
      { type: "terminal.read", target, lines },
      "terminal-read",
    );
    return result.text;
  }

  private send(message: ClientMessage): void {
    this.socket?.send(JSON.stringify(message));
  }

  private token(): string {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  }

  private clearToken(): void {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export const appClient = new AppClient();
