import type {
  DeviceInfo,
  NotificationKind,
  NotificationSound,
  Snapshot,
  StoredNotification,
} from "../shared/protocol.ts";

export const MAX_NOTIFICATIONS = 200;

export type IngestInput = {
  title: string;
  body?: string;
  deviceId?: string;
  deviceName?: string;
  paneId?: string;
  workspaceId?: string;
  kind?: NotificationKind;
  sound?: NotificationSound;
};

export type DeviceRef = Pick<DeviceInfo, "id" | "name">;

const KINDS: ReadonlySet<string> = new Set(["blocked", "done", "idle", "custom"]);
const SOUNDS: ReadonlySet<string> = new Set(["none", "done", "request"]);

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Parse the untrusted /api/notify JSON body into an ingest request. */
export function ingestInputFrom(body: Record<string, unknown>): IngestInput {
  return {
    title: optionalString(body.title) ?? "",
    body: optionalString(body.body),
    deviceId: optionalString(body.deviceId),
    deviceName: optionalString(body.deviceName),
    paneId: optionalString(body.paneId),
    workspaceId: optionalString(body.workspaceId),
    kind: typeof body.kind === "string" && KINDS.has(body.kind) ? (body.kind as NotificationKind) : undefined,
    sound: typeof body.sound === "string" && SOUNDS.has(body.sound) ? (body.sound as NotificationSound) : undefined,
  };
}

const finalStatuses = new Set(["blocked", "done", "idle"]);

export function shouldNotifyTransition(from: string | undefined, to: string): boolean {
  return from === "working" && finalStatuses.has(to);
}

export function kindForStatus(status: string): NotificationKind {
  if (status === "blocked" || status === "done" || status === "idle") return status;
  return "custom";
}

export function soundForKind(kind: NotificationKind): NotificationSound {
  if (kind === "blocked") return "request";
  if (kind === "done" || kind === "idle") return "done";
  return "none";
}

export function bodyForKind(kind: NotificationKind, workspaceLabel?: string): string {
  const status = kind === "blocked" ? "Needs input" : kind === "done" ? "Finished" : kind === "idle" ? "Idle" : "";
  if (!status) return workspaceLabel ?? "";
  return workspaceLabel ? `${status} · ${workspaceLabel}` : status;
}

export function notificationsFromTransition(
  device: DeviceRef,
  previous: Snapshot | null,
  next: Snapshot,
  now: number = Date.now(),
): StoredNotification[] {
  if (!previous) return [];
  const previousPanes = new Map(previous.panes.map((pane) => [pane.pane_id, pane]));
  const workspaceLabels = new Map(next.workspaces.map((workspace) => [workspace.workspace_id, workspace.label]));
  const notifications: StoredNotification[] = [];

  for (const pane of next.panes) {
    const before = previousPanes.get(pane.pane_id);
    if (!shouldNotifyTransition(before?.agent_status, pane.agent_status)) continue;
    const kind = kindForStatus(pane.agent_status);
    notifications.push({
      id: crypto.randomUUID().replaceAll("-", ""),
      createdAt: now,
      read: false,
      deviceId: device.id,
      deviceName: device.name,
      kind,
      title: pane.terminal_title_stripped || pane.terminal_title || pane.pane_id,
      body: bodyForKind(kind, workspaceLabels.get(pane.workspace_id) || pane.workspace_id),
      paneId: pane.pane_id,
      workspaceId: pane.workspace_id,
      sound: soundForKind(kind),
    });
  }

  return notifications;
}

export class NotificationInbox {
  private items: StoredNotification[] = [];
  onChange: () => void = () => {};

  snapshot(): { notifications: StoredNotification[]; unread: number } {
    return {
      notifications: [...this.items],
      unread: this.items.filter((item) => !item.read).length,
    };
  }

  add(item: StoredNotification): StoredNotification {
    this.items = [item, ...this.items].slice(0, MAX_NOTIFICATIONS);
    this.onChange();
    return item;
  }

  addAll(items: StoredNotification[]): void {
    if (items.length === 0) return;
    this.items = [...items, ...this.items].slice(0, MAX_NOTIFICATIONS);
    this.onChange();
  }

  ingest(input: IngestInput, fallbackDevice?: DeviceRef): StoredNotification {
    const title = input.title.trim();
    if (!title) throw new Error("notification requires a title");
    const kind = input.kind ?? "custom";
    const deviceId = input.deviceId?.trim() || fallbackDevice?.id || "unknown";
    const deviceName = input.deviceName?.trim() || fallbackDevice?.name || input.deviceId?.trim() || "Unknown";
    return this.add({
      id: crypto.randomUUID().replaceAll("-", ""),
      createdAt: Date.now(),
      read: false,
      deviceId,
      deviceName,
      kind,
      title,
      body: (input.body ?? "").trim(),
      paneId: input.paneId?.trim() || undefined,
      workspaceId: input.workspaceId?.trim() || undefined,
      sound: input.sound ?? soundForKind(kind),
    });
  }

  markRead(id: string): void {
    this.items = this.items.map((item) => item.id === id ? { ...item, read: true } : item);
    this.onChange();
  }

  markAllRead(): void {
    this.items = this.items.map((item) => ({ ...item, read: true }));
    this.onChange();
  }

  dismiss(id: string): void {
    this.items = this.items.filter((item) => item.id !== id);
    this.onChange();
  }

  clear(): void {
    this.items = [];
    this.onChange();
  }
}
