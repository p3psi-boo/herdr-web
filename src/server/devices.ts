import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeviceInfo, DeviceState, ServerMessage, Snapshot } from "../shared/protocol.ts";
import { localHerdrSocketPath, saveDevices, type DeviceConfig } from "./config.ts";
import { HerdrClient, subscribeEvents } from "./herdr-client.ts";
import { NotificationInbox, notificationsFromTransition } from "./notifications.ts";
import { SshMux, ensureRemoteHerdr, sshBaseArgs } from "./ssh.ts";

/** Event kinds the gateway re-snapshots on; pane-status events are added per live pane. */
const SUBSCRIPTION_EVENTS = [
  "workspace.created",
  "workspace.updated",
  "workspace.renamed",
  "workspace.moved",
  "workspace.closed",
  "workspace.focused",
  "tab.created",
  "tab.closed",
  "tab.renamed",
  "tab.moved",
  "tab.focused",
  "pane.created",
  "pane.closed",
  "pane.updated",
  "pane.focused",
  "pane.moved",
  "pane.exited",
  "pane.agent_detected",
  "layout.updated",
];

const subscriptions = SUBSCRIPTION_EVENTS.map((type) => ({ type }));

export class DeviceSession {
  status: DeviceInfo["status"] = "disconnected";
  socketPath: string | null = null;
  client: HerdrClient | null = null;
  private events: { close: () => void } | null = null;
  private mux: SshMux | null = null;
  private connecting: Promise<void> | null = null;
  private refreshing: Promise<DeviceState> | null = null;
  private refreshRequested = false;
  private refreshSchedule: ReturnType<typeof setTimeout> | null = null;
  private subscribedPaneIds = new Set<string>();
  private revision = 0;
  private projection: DeviceState | null = null;
  private serializedProjection = "";
  private disposed = false;

  constructor(
    public config: DeviceConfig,
    private manager: DeviceManager,
  ) {}

  get id(): string {
    return this.config.id;
  }

  state(): DeviceState | null {
    return this.projection;
  }

  sshArgs(): string[] {
    return this.mux ? this.mux.slaveArgs() : sshBaseArgs();
  }

  async connect(): Promise<void> {
    if (this.disposed) throw new Error(`device ${this.id} is disposed`);
    if (this.status === "connected") return;
    if (this.connecting) return this.connecting;
    this.connecting = this.open().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async open(): Promise<void> {
    this.setStatus("connecting");
    try {
      this.socketPath = this.config.type === "ssh" ? await this.openSsh() : localHerdrSocketPath();
      this.client = new HerdrClient(this.socketPath);
      await this.client.ping();
      this.setStatus("connected");
    } catch (error) {
      this.close();
      this.setStatus("disconnected");
      throw error;
    }
  }

  private async openSsh(): Promise<string> {
    const mux = new SshMux(this.config.host!, this.id, () => this.disconnect());
    this.mux = mux;
    await mux.start();
    await ensureRemoteHerdr(mux);
    const home = await mux.exec('printf %s "$HOME/.config/herdr/herdr.sock"');
    if (home.code !== 0) throw new Error(home.stderr);
    const localPath = join(tmpdir(), `herdr-web-${this.id}.sock`);
    await mux.forward(localPath, home.stdout);
    return localPath;
  }

  async refresh(): Promise<DeviceState> {
    if (this.refreshing) {
      this.refreshRequested = true;
      return this.refreshing;
    }
    this.refreshing = this.refreshLoop().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async refreshLoop(): Promise<DeviceState> {
    await this.connect();
    let state: DeviceState;
    do {
      this.refreshRequested = false;
      const snapshot = await this.client!.snapshot();
      await this.subscribe(snapshot);
      state = this.publish(snapshot);
    } while (this.refreshRequested);
    return state;
  }

  private publish(snapshot: Snapshot): DeviceState {
    if (this.disposed) throw new Error(`device ${this.id} is disposed`);
    const serializedProjection = JSON.stringify(snapshot);
    if (this.projection && serializedProjection === this.serializedProjection) return this.projection;
    const previous = this.projection?.snapshot ?? null;
    const state = { deviceId: this.id, revision: ++this.revision, snapshot };
    this.projection = state;
    this.serializedProjection = serializedProjection;
    this.manager.publish(this.config, previous, state);
    return state;
  }

  private async subscribe(snapshot: Snapshot): Promise<void> {
    const paneIds = new Set(snapshot.panes.map((pane) => pane.pane_id));
    const unchanged = this.events && paneIds.size === this.subscribedPaneIds.size && [...paneIds].every((id) => this.subscribedPaneIds.has(id));
    if (unchanged || !this.socketPath) return;
    this.events?.close();
    this.subscribedPaneIds = paneIds;
    const desired = [...subscriptions, ...[...paneIds].map((paneId) => ({ type: "pane.agent_status_changed", pane_id: paneId }))];
    this.events = await subscribeEvents(this.socketPath, desired, () => {
      this.scheduleRefresh();
    });
  }

  private scheduleRefresh(): void {
    if (this.refreshSchedule) return;
    this.refreshSchedule = setTimeout(() => {
      this.refreshSchedule = null;
      void this.refresh().catch(() => this.disconnect());
    }, 0);
  }

  private setStatus(status: DeviceInfo["status"]): void {
    if (this.status === status) return;
    this.status = status;
    this.manager.broadcastDevices();
  }

  private disconnect(): void {
    this.close();
    this.setStatus("disconnected");
  }

  private close(): void {
    this.events?.close();
    this.events = null;
    this.subscribedPaneIds.clear();
    this.client = null;
    this.mux?.close();
    this.mux = null;
    if (this.config.type === "ssh" && this.socketPath) rmSync(this.socketPath, { force: true });
    this.socketPath = null;
  }

  dispose(): void {
    this.disposed = true;
    if (this.refreshSchedule) clearTimeout(this.refreshSchedule);
    this.refreshSchedule = null;
    this.close();
    this.setStatus("disconnected");
  }
}

export class DeviceManager {
  private sessions = new Map<string, DeviceSession>();
  private reconnectTimer: ReturnType<typeof setInterval>;
  readonly inbox = new NotificationInbox();
  broadcast: (message: ServerMessage) => void = () => {};

  constructor(configs: DeviceConfig[]) {
    this.inbox.onChange = () => this.broadcast({ type: "notification.state", ...this.inbox.snapshot() });
    for (const config of configs) this.sessions.set(config.id, new DeviceSession(config, this));
    for (const session of this.sessions.values()) void session.refresh().catch(() => {});
    this.reconnectTimer = setInterval(() => this.reconnect(), 30_000);
  }

  list(): DeviceInfo[] {
    return [...this.sessions.values()].map((session) => ({ ...session.config, status: session.status }));
  }

  states(): DeviceState[] {
    const states: DeviceState[] = [];
    for (const session of this.sessions.values()) {
      const state = session.state();
      if (state) states.push(state);
    }
    return states;
  }

  get(id: string): DeviceSession | undefined {
    return this.sessions.get(id);
  }

  publish(config: DeviceConfig, previous: Snapshot | null, state: DeviceState): void {
    this.inbox.addAll(notificationsFromTransition(config, previous, state.snapshot));
    this.broadcast({ type: "device.state", state });
  }

  add(config: DeviceConfig): void {
    if (this.sessions.has(config.id)) throw new Error(`duplicate device id: ${config.id}`);
    const session = new DeviceSession(config, this);
    this.sessions.set(config.id, session);
    this.persist();
    this.broadcastDevices();
    void session.refresh().catch(() => {});
  }

  remove(id: string): void {
    if (id === "local") throw new Error("the local device cannot be removed");
    const session = this.sessions.get(id);
    if (!session) throw new Error(`unknown device: ${id}`);
    session.dispose();
    this.sessions.delete(id);
    this.persist();
    this.broadcastDevices();
  }

  broadcastDevices(): void {
    this.broadcast({ type: "device.list", devices: this.list() });
  }

  disposeAll(): void {
    clearInterval(this.reconnectTimer);
    for (const session of this.sessions.values()) session.dispose();
  }

  private persist(): void {
    saveDevices([...this.sessions.values()].map((session) => session.config));
  }

  private reconnect(): void {
    for (const session of this.sessions.values()) {
      if (session.status === "disconnected") void session.refresh().catch(() => {});
    }
  }
}
