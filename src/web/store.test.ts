import { beforeEach, describe, expect, test } from "bun:test";
import type { DeviceState, Snapshot, TerminalRef } from "../shared/protocol.ts";
import { useStore } from "./store.ts";

function snapshot(focusedPaneId: string, paneIds: string[]): Snapshot {
  return {
    focused_workspace_id: "w1",
    focused_pane_id: focusedPaneId,
    workspaces: [{ workspace_id: "w1", number: 1, label: "one", focused: true, pane_count: paneIds.length, agent_status: "unknown" }],
    panes: paneIds.map((paneId) => ({
      pane_id: paneId,
      workspace_id: "w1",
      tab_id: paneId,
      focused: paneId === focusedPaneId,
      agent_status: "unknown",
    })),
    agents: [],
  };
}

function deviceState(deviceId: string, revision: number, focusedPaneId: string, paneIds: string[]): DeviceState {
  return { deviceId, revision, snapshot: snapshot(focusedPaneId, paneIds) };
}

function ready(states: DeviceState[]) {
  return {
    type: "gateway.ready" as const,
    devices: states.map((state) => ({ id: state.deviceId, name: state.deviceId, type: "local" as const, status: "connected" as const })),
    states,
    notifications: [],
    unread: 0,
  };
}

beforeEach(() => {
  useStore.setState({
    session: { status: "checking-auth" },
    devices: [],
    deviceStates: {},
    activeDeviceId: "local",
    selection: { desired: null, streamed: null },
    overlay: { type: "none" },
    operations: {},
    lastError: null,
  });
});

describe("application state", () => {
  test("keeps browser intent across newer focus projections and rejects stale revisions", () => {
    const store = useStore.getState();
    store.setReady(ready([deviceState("local", 1, "p1", ["p1", "p2"])]));
    const desired: TerminalRef = { deviceId: "local", paneId: "p2" };
    store.selectTerminal(desired);

    store.applyDeviceState(deviceState("local", 3, "p1", ["p1", "p2"]));
    store.applyDeviceState(deviceState("local", 2, "p1", ["p1"]));

    expect(useStore.getState().selection.desired).toEqual(desired);
    expect(useStore.getState().deviceStates.local.revision).toBe(3);
  });

  test("keeps equal pane ids isolated by device", () => {
    const store = useStore.getState();
    store.setReady(ready([
      deviceState("a", 1, "p1", ["p1"]),
      deviceState("b", 1, "p1", ["p1"]),
    ]));
    store.selectTerminal({ deviceId: "b", paneId: "p1" });
    store.markTerminalStreamed({ deviceId: "b", paneId: "p1" });
    store.applyDeviceState(deviceState("a", 2, "p1", ["p1"]));

    expect(useStore.getState().selection).toEqual({
      desired: { deviceId: "b", paneId: "p1" },
      streamed: { deviceId: "b", paneId: "p1" },
    });
  });

  test("preserves the desired terminal across gateway reconnect", () => {
    const store = useStore.getState();
    const states = [deviceState("local", 1, "p1", ["p1", "p2"])];
    store.setReady(ready(states));
    store.selectTerminal({ deviceId: "local", paneId: "p2" });
    store.setSession({ status: "reconnecting" });
    store.setReady({ ...ready(states), states: [] });
    expect(useStore.getState().selection.desired).toEqual({ deviceId: "local", paneId: "p2" });
    store.setReady(ready([deviceState("local", 2, "p1", ["p1", "p2"])]));

    expect(useStore.getState().selection).toEqual({
      desired: { deviceId: "local", paneId: "p2" },
      streamed: null,
    });
  });
});
