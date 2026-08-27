import type { MouseEvent } from "react";
import { appClient } from "../ws.ts";
import { useStore } from "../store.ts";
import { DevicesPopover } from "./DevicesPopover.tsx";
import { NotificationButton } from "./NotificationCenter.tsx";
import { ChevronIcon, PlusIcon, SearchIcon, StatusDot } from "../icons.tsx";
import { Group, Hairline, RowButton, SectionLabel, focusRing, tap } from "../ui.tsx";

export function Sidebar() {
  const activeDeviceId = useStore((state) => state.activeDeviceId);
  const snapshot = useStore((state) => state.deviceStates[state.activeDeviceId]?.snapshot);
  const activePaneId = useStore((state) => state.selection.desired?.paneId);
  const creatingTerminal = useStore((state) => Object.values(state.operations).includes("create-terminal"));
  const workspaces = snapshot?.workspaces ?? [];
  const panes = snapshot?.panes ?? [];

  const pickPane = (paneId: string) => {
    appClient.selectTerminal({ deviceId: activeDeviceId, paneId });
  };

  const keepTermFocus = (e: MouseEvent) => {
    e.preventDefault();
  };

  const agents = panes.filter((p) => p.agent_status !== "unknown");

  return (
    <aside className="relative z-20 flex w-64 shrink-0 flex-col">
      <div className="space-y-2 p-3">
        <Group>
          <RowButton className="text-ink" disabled={creatingTerminal} onClick={() => appClient.createTerminal()}>
            <PlusIcon className="size-4 shrink-0 text-ink-secondary" />
            {creatingTerminal ? "Creating Terminal…" : "New Terminal"}
          </RowButton>
          <Hairline />
          <RowButton className="text-ink-secondary">
            <SearchIcon className="size-4 shrink-0" />
            Search
          </RowButton>
          <Hairline />
          <NotificationButton />
        </Group>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <SectionLabel>Spaces</SectionLabel>
        <Group>
          {workspaces.length === 0 ? (
            <div className="px-2.5 py-3 text-[15px] text-ink-tertiary">No spaces</div>
          ) : (
            workspaces.map((ws, wi) => {
              const wsPanes = panes.filter((p) => p.workspace_id === ws.workspace_id);
              return (
                <div key={ws.workspace_id}>
                  {wi > 0 && <Hairline />}
                  <RowButton
                    onMouseDown={keepTermFocus}
                    onClick={() => {
                      const first = wsPanes[0];
                      if (first) pickPane(first.pane_id);
                    }}
                  >
                    <StatusDot status={ws.agent_status} />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {ws.label || ws.workspace_id}
                    </span>
                    <span className="tabular-nums text-[13px] text-ink-tertiary">{ws.pane_count}</span>
                  </RowButton>
                  {wsPanes.map((pane) => (
                    <div key={pane.pane_id}>
                      <Hairline />
                      <RowButton
                        active={pane.pane_id === activePaneId}
                        onMouseDown={keepTermFocus}
                        onClick={() => pickPane(pane.pane_id)}
                        className="ps-7"
                      >
                        <StatusDot status={pane.agent_status} />
                        <span className="min-w-0 flex-1 truncate text-[14px]">
                          {pane.terminal_title_stripped || pane.terminal_title || pane.pane_id}
                        </span>
                      </RowButton>
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </Group>

        <SectionLabel>Agents</SectionLabel>
        <Group>
          {agents.length === 0 ? (
            <div className="px-2.5 py-3 text-[15px] leading-snug text-ink-tertiary text-pretty">
              No agents running
            </div>
          ) : (
            agents.map((pane, i) => (
              <div key={pane.pane_id}>
                {i > 0 && <Hairline />}
                <RowButton
                  active={pane.pane_id === activePaneId}
                  onMouseDown={keepTermFocus}
                  onClick={() => pickPane(pane.pane_id)}
                >
                  <StatusDot status={pane.agent_status} />
                  <span className="min-w-0 flex-1 truncate">
                    {pane.terminal_title_stripped || pane.terminal_title || pane.pane_id}
                  </span>
                </RowButton>
              </div>
            ))
          )}
        </Group>
      </div>

      <div className="p-3">
        <Group>
          <DevicesButton />
        </Group>
      </div>
    </aside>
  );
}

function DevicesButton() {
  const devices = useStore((s) => s.devices);
  const activeDeviceId = useStore((s) => s.activeDeviceId);
  const open = useStore((state) => state.overlay.type === "devices" || state.overlay.type === "add-device");
  const setOverlay = useStore((state) => state.setOverlay);
  const active = devices.find((d) => d.id === activeDeviceId);

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOverlay(open ? { type: "none" } : { type: "devices" })}
        className={`flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[15px] leading-tight text-ink hover:bg-surface-hover ${tap} ${focusRing}`}
      >
        <StatusDot status={active?.status ?? "disconnected"} />
        <span className="min-w-0 flex-1 truncate">{active?.name ?? "Devices"}</span>
        <ChevronIcon
          className={`size-4 shrink-0 text-ink-tertiary transition-transform duration-150 ease-out motion-reduce:transition-none ${
            open ? "rotate-180" : "rotate-0"
          }`}
        />
      </button>
      <DevicesPopover />
    </div>
  );
}
