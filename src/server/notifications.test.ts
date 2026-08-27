import { describe, expect, test } from "bun:test";
import type { Snapshot } from "../shared/protocol.ts";
import {
  MAX_NOTIFICATIONS,
  NotificationInbox,
  notificationsFromTransition,
} from "./notifications.ts";

function snapshot(status: string): Snapshot {
  return {
    workspaces: [{ workspace_id: "w1", number: 1, label: "Core", focused: true, pane_count: 1, agent_status: status }],
    panes: [{
      pane_id: "p1",
      workspace_id: "w1",
      tab_id: "t1",
      focused: true,
      agent_status: status,
      terminal_title_stripped: "build",
    }],
    agents: [],
  };
}

describe("notificationsFromTransition", () => {
  test("derives notifications from the authoritative snapshot transition", () => {
    const items = notificationsFromTransition(
      { id: "local", name: "Local" },
      snapshot("working"),
      snapshot("blocked"),
      42,
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      createdAt: 42,
      deviceId: "local",
      kind: "blocked",
      title: "build",
      body: "Needs input · Core",
      paneId: "p1",
    });
  });

  test("does not notify while seeding or when the projection is unchanged", () => {
    expect(notificationsFromTransition({ id: "local", name: "Local" }, null, snapshot("done"))).toEqual([]);
    expect(notificationsFromTransition({ id: "local", name: "Local" }, snapshot("done"), snapshot("done"))).toEqual([]);
  });
});

describe("NotificationInbox", () => {
  test("stores immutable snapshots and applies inbox commands", () => {
    const inbox = new NotificationInbox();
    const item = inbox.ingest({ title: "Done", kind: "done" });
    const first = inbox.snapshot();

    inbox.markRead(item.id);
    expect(first.notifications[0].read).toBe(false);
    expect(inbox.snapshot().unread).toBe(0);

    inbox.dismiss(item.id);
    expect(inbox.snapshot().notifications).toEqual([]);
  });

  test("keeps the configured ring size", () => {
    const inbox = new NotificationInbox();
    for (let index = 0; index < MAX_NOTIFICATIONS + 1; index += 1) inbox.ingest({ title: String(index) });
    expect(inbox.snapshot().notifications).toHaveLength(MAX_NOTIFICATIONS);
    expect(inbox.snapshot().notifications[0].title).toBe(String(MAX_NOTIFICATIONS));
  });
});
