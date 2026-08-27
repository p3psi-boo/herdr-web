import { create } from "zustand";
import type {
  DeviceInfo,
  DeviceState,
  ServerMessage,
  SshHostEntry,
  StoredNotification,
  TerminalRef,
} from "../shared/protocol.ts";
import { sameTerminal } from "../shared/protocol.ts";

export type SessionState =
  | { status: "checking-auth" }
  | { status: "signed-out" }
  | { status: "connecting" }
  | { status: "ready" }
  | { status: "reconnecting" };

export type OverlayState =
  | { type: "none" }
  | { type: "devices" }
  | { type: "add-device" }
  | { type: "notifications" }
  | { type: "terminal-search" };

export type SelectionState = {
  desired: TerminalRef | null;
  /** Set once the first frame of the desired terminal is on screen. */
  streamed: TerminalRef | null;
};

export type Operation = "create-terminal" | "focus-terminal" | "attach-terminal" | "terminal-read" | "device" | "notification";

type ReadyMessage = Extract<ServerMessage, { type: "gateway.ready" }>;

export type State = {
  session: SessionState;
  devices: DeviceInfo[];
  deviceStates: Record<string, DeviceState>;
  activeDeviceId: string;
  selection: SelectionState;
  overlay: OverlayState;
  sshHosts: SshHostEntry[];
  notifications: StoredNotification[];
  unread: number;
  operations: Record<string, Operation>;
  lastError: string | null;
  setSession: (session: SessionState) => void;
  setReady: (message: ReadyMessage) => void;
  setDevices: (devices: DeviceInfo[]) => void;
  applyDeviceState: (state: DeviceState) => void;
  selectDevice: (deviceId: string) => void;
  selectTerminal: (target: TerminalRef) => void;
  markTerminalStreamed: (target: TerminalRef | null) => void;
  setOverlay: (overlay: OverlayState) => void;
  setSshHosts: (hosts: SshHostEntry[]) => void;
  setNotifications: (notifications: StoredNotification[], unread: number) => void;
  beginOperation: (commandId: string, operation: Operation) => void;
  finishOperation: (commandId: string) => void;
  failOperation: (commandId: string, message: string) => void;
};

function terminalInState(target: TerminalRef | null, state: DeviceState | undefined): boolean {
  return Boolean(target && state?.snapshot.panes.some((pane) => pane.pane_id === target.paneId));
}

function firstTerminal(deviceId: string, state: DeviceState | undefined): TerminalRef | null {
  const paneId = state?.snapshot.focused_pane_id ?? state?.snapshot.panes[0]?.pane_id;
  return paneId ? { deviceId, paneId } : null;
}

/**
 * Keep the user's chosen pane when it belongs to this device and still exists
 * in the snapshot (or no snapshot has arrived yet); otherwise fall back to the
 * device's first pane. Shared by gateway.ready and per-device projections.
 */
function desiredPane(desired: TerminalRef | null, deviceId: string, state: DeviceState | undefined): TerminalRef | null {
  return desired?.deviceId === deviceId && (!state || terminalInState(desired, state))
    ? desired
    : firstTerminal(deviceId, state);
}

function initialDeviceId(devices: DeviceInfo[], preferred: string): string {
  if (devices.some((device) => device.id === preferred)) return preferred;
  if (devices.some((device) => device.id === "local")) return "local";
  return devices[0]?.id ?? "local";
}

function indexStates(states: DeviceState[]): Record<string, DeviceState> {
  return Object.fromEntries(states.map((state) => [state.deviceId, state]));
}

function withoutOperation(operations: Record<string, Operation>, commandId: string): Record<string, Operation> {
  const next = { ...operations };
  delete next[commandId];
  return next;
}

export const useStore = create<State>((set, get) => ({
  session: { status: "checking-auth" },
  devices: [],
  deviceStates: {},
  activeDeviceId: "local",
  selection: { desired: null, streamed: null },
  overlay: { type: "none" },
  sshHosts: [],
  notifications: [],
  unread: 0,
  operations: {},
  lastError: null,

  setSession: (session) => set({ session }),

  setReady: (message) => {
    const deviceStates = indexStates(message.states);
    const previous = get();
    const activeDeviceId = initialDeviceId(message.devices, previous.activeDeviceId);
    const activeState = deviceStates[activeDeviceId];
    const desired = desiredPane(previous.selection.desired, activeDeviceId, activeState);
    set({
      session: { status: "ready" },
      devices: message.devices,
      deviceStates,
      activeDeviceId,
      selection: { desired, streamed: null },
      notifications: message.notifications,
      unread: message.unread,
      operations: {},
      lastError: null,
    });
  },

  setDevices: (devices) => {
    const current = get().activeDeviceId;
    const activeDeviceId = initialDeviceId(devices, current);
    const deviceIds = new Set(devices.map((device) => device.id));
    const deviceStates = Object.fromEntries(Object.entries(get().deviceStates).filter(([deviceId]) => deviceIds.has(deviceId)));
    const selection = activeDeviceId === current
      ? get().selection
      : { desired: firstTerminal(activeDeviceId, deviceStates[activeDeviceId]), streamed: null };
    set({ devices, deviceStates, activeDeviceId, selection });
  },

  applyDeviceState: (state) => {
    const current = get().deviceStates[state.deviceId];
    if (current && current.revision >= state.revision) return;
    const deviceStates = { ...get().deviceStates, [state.deviceId]: state };
    const selection = get().selection;
    // Only a projection of the active device may dislodge the user's choice.
    const desired = get().activeDeviceId === state.deviceId
      ? desiredPane(selection.desired, state.deviceId, state)
      : selection.desired;
    set({ deviceStates, selection: { desired, streamed: sameTerminal(desired, selection.desired) ? selection.streamed : null } });
  },

  selectDevice: (activeDeviceId) => set({
    activeDeviceId,
    selection: { desired: firstTerminal(activeDeviceId, get().deviceStates[activeDeviceId]), streamed: null },
    overlay: { type: "none" },
  }),

  selectTerminal: (desired) => {
    const streamed = sameTerminal(desired, get().selection.desired) ? get().selection.streamed : null;
    set({
      activeDeviceId: desired.deviceId,
      selection: { desired, streamed },
      overlay: { type: "none" },
    });
  },

  markTerminalStreamed: (streamed) => set((state) => ({ selection: { ...state.selection, streamed } })),
  setOverlay: (overlay) => set({ overlay }),
  setSshHosts: (sshHosts) => set({ sshHosts }),
  setNotifications: (notifications, unread) => set({ notifications, unread }),
  beginOperation: (commandId, operation) => set((state) => ({ operations: { ...state.operations, [commandId]: operation }, lastError: null })),
  finishOperation: (commandId) => set((state) => ({ operations: withoutOperation(state.operations, commandId) })),
  failOperation: (commandId, lastError) => set((state) => ({ operations: withoutOperation(state.operations, commandId), lastError })),
}));
