export type DeviceStatus = "disconnected" | "connecting" | "connected";

export type DeviceInfo = {
  id: string;
  name: string;
  type: "local" | "ssh";
  host?: string;
  status: DeviceStatus;
};

export type SshHostEntry = {
  alias: string;
  user?: string;
  hostName?: string;
  port?: string;
};

export type WorkspaceInfo = {
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  pane_count: number;
  agent_status: string;
};

export type PaneInfo = {
  pane_id: string;
  workspace_id: string;
  tab_id: string;
  focused: boolean;
  cwd?: string;
  terminal_title?: string;
  terminal_title_stripped?: string;
  agent_status: string;
  scroll?: {
    max_offset_from_bottom: number;
    offset_from_bottom: number;
    viewport_rows: number;
  };
};

export type AgentInfo = {
  agent_id?: string;
  pane_id?: string;
  workspace_id?: string;
  name?: string;
  title?: string;
  agent?: string;
  agent_status?: string;
  state_labels?: string[];
};

export type Snapshot = {
  version?: string;
  protocol?: number;
  focused_workspace_id?: string;
  focused_pane_id?: string;
  workspaces: WorkspaceInfo[];
  panes: PaneInfo[];
  agents: AgentInfo[];
};

export type TerminalRef = {
  deviceId: string;
  paneId: string;
};

export function sameTerminal(left: TerminalRef | null, right: TerminalRef | null): boolean {
  return left?.deviceId === right?.deviceId && left?.paneId === right?.paneId;
}

/** Default line count for `terminal.read` snapshots. */
export const DEFAULT_READ_LINES = 2000;

export type DeviceState = {
  deviceId: string;
  revision: number;
  snapshot: Snapshot;
};

export type NotificationKind = "blocked" | "done" | "idle" | "custom";
export type NotificationSound = "none" | "done" | "request";

export type StoredNotification = {
  id: string;
  createdAt: number;
  read: boolean;
  deviceId: string;
  deviceName: string;
  kind: NotificationKind;
  title: string;
  body: string;
  paneId?: string;
  workspaceId?: string;
  sound: NotificationSound;
};

export type CommandResult =
  | { type: "completed" }
  | { type: "terminal-created"; target: TerminalRef }
  | { type: "terminal-attached"; attachmentId: string; target: TerminalRef }
  | { type: "terminal-read"; target: TerminalRef; text: string };

type Command<T extends string> = { type: T; commandId: string };

export type ClientMessage =
  | (Command<"device.add"> & { name: string; host: string })
  | (Command<"device.remove"> & { deviceId: string })
  | Command<"ssh.hosts">
  | (Command<"terminal.create"> & { deviceId: string; workspaceId?: string })
  | (Command<"terminal.focus"> & { target: TerminalRef })
  | (Command<"terminal.attach"> & { target: TerminalRef; cols: number; rows: number })
  | (Command<"terminal.read"> & { target: TerminalRef; lines?: number })
  | (Command<"notification.read"> & { notificationId: string })
  | Command<"notification.read-all">
  | (Command<"notification.dismiss"> & { notificationId: string })
  | Command<"notification.clear">
  | { type: "terminal.release"; attachmentId: string }
  | { type: "terminal.input"; attachmentId: string; bytes: string }
  | { type: "terminal.resize"; attachmentId: string; cols: number; rows: number }
  | { type: "terminal.scroll"; attachmentId: string; direction: "up" | "down"; lines: number };

export type ServerMessage =
  | {
      type: "gateway.ready";
      devices: DeviceInfo[];
      states: DeviceState[];
      notifications: StoredNotification[];
      unread: number;
    }
  | { type: "device.list"; devices: DeviceInfo[] }
  | { type: "device.state"; state: DeviceState }
  | { type: "ssh.hosts"; commandId: string; hosts: SshHostEntry[] }
  | { type: "command.result"; commandId: string; result: CommandResult }
  | { type: "command.failed"; commandId: string; message: string }
  | { type: "notification.state"; notifications: StoredNotification[]; unread: number }
  | {
      type: "terminal.frame";
      attachmentId: string;
      target: TerminalRef;
      seq: number;
      full: boolean;
      bytes: string;
    }
  | { type: "terminal.closed"; attachmentId: string; target: TerminalRef; reason: string };
