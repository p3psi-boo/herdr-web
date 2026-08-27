import { useEffect } from "react";
import type { StoredNotification } from "../../shared/protocol.ts";
import { appClient } from "../ws.ts";
import { useStore } from "../store.ts";
import { BellFillIcon, BellIcon, CloseIcon, StatusDot } from "../icons.tsx";
import { DrawerLayer, focusRing, tap } from "../ui.tsx";

export const NOTIFICATIONS_PANEL_ID = "herdr-notifications";

function relativeTime(ts: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - ts) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function NotificationButton() {
  const unread = useStore((s) => s.unread);
  const notifications = useStore((s) => s.notifications);
  const open = useStore((state) => state.overlay.type === "notifications");
  const setOverlay = useStore((state) => state.setOverlay);
  const hasBlocked = notifications.some((n) => !n.read && n.kind === "blocked");
  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={NOTIFICATIONS_PANEL_ID}
        aria-label={label}
        onClick={() => setOverlay(open ? { type: "none" } : { type: "notifications" })}
        className={`flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[15px] leading-tight hover:bg-surface-hover ${tap} ${focusRing} ${
          open ? "text-accent" : "text-ink-secondary"
        }`}
      >
        <span className="relative size-4 shrink-0">
          <span
            className={`absolute inset-0 flex items-center justify-center transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none ${
              open ? "scale-100 opacity-100 blur-0" : "scale-[0.25] opacity-0 blur-[4px]"
            }`}
          >
            <BellFillIcon className="size-4" />
          </span>
          <span
            className={`flex items-center justify-center transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none ${
              open ? "scale-[0.25] opacity-0 blur-[4px]" : "scale-100 opacity-100 blur-0"
            }`}
          >
            <BellIcon className="size-4" />
          </span>
        </span>
        <span>Notifications</span>
        {unread > 0 && (
          <span
            className={`ms-auto min-w-4 rounded-full px-1.5 text-center text-[11px] font-semibold leading-4 text-accent-fg tabular-nums ${
              hasBlocked ? "bg-danger" : "bg-accent"
            }`}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      <span className="sr-only" role="status">
        {unread > 0 ? `${unread} unread notifications` : ""}
      </span>
    </div>
  );
}

export function NotificationDrawer() {
  const open = useStore((state) => state.overlay.type === "notifications");
  const notifications = useStore((s) => s.notifications);
  const unread = useStore((s) => s.unread);
  const setOverlay = useStore((state) => state.setOverlay);
  const titleId = `${NOTIFICATIONS_PANEL_ID}-title`;

  // Hand focus to the drawer container when it opens (Escape dismissal and
  // backdrop click live inside DrawerLayer).
  useEffect(() => {
    if (!open) return;
    document.getElementById(NOTIFICATIONS_PANEL_ID)?.focus();
  }, [open]);

  return (
    <DrawerLayer
      id={NOTIFICATIONS_PANEL_ID}
      open={open}
      onDismiss={() => setOverlay({ type: "none" })}
      labelledBy={titleId}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-1 px-2 pt-2">
          <h2 id={titleId} className="min-w-0 flex-1 truncate px-2 py-1 text-[15px] font-semibold text-ink">
            Notifications
          </h2>
          {notifications.length > 0 && unread > 0 && (
            <button
              type="button"
              onClick={() => appClient.markAllNotificationsRead()}
              className={`rounded-lg px-2 py-1 text-[13px] text-accent ${tap} ${focusRing}`}
            >
              Read all
            </button>
          )}
          {notifications.length > 0 && (
            <button
              type="button"
              onClick={() => appClient.clearNotifications()}
              className={`rounded-lg px-2 py-1 text-[13px] text-ink-secondary ${tap} ${focusRing}`}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            aria-label="Close notifications"
            onClick={() => setOverlay({ type: "none" })}
            className={`flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-tertiary hover:bg-surface-hover hover:text-ink ${tap} ${focusRing}`}
          >
            <CloseIcon className="size-3.5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
          {notifications.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <div className="text-[15px] font-medium text-balance text-ink">No notifications yet</div>
              <div className="mt-1 text-[13px] leading-snug text-pretty text-ink-tertiary">
                When an agent finishes or needs input, it shows up here.
              </div>
            </div>
          ) : (
            notifications.map((item) => <NotificationRow key={item.id} item={item} now={Date.now()} />)
          )}
        </div>
      </div>
    </DrawerLayer>
  );
}

function NotificationRow({ item, now }: { item: StoredNotification; now: number }) {
  return (
    <div className="group relative flex items-stretch">
      <button
        type="button"
        onClick={() => appClient.openNotification(item)}
        className={`flex min-h-12 min-w-0 flex-1 items-start gap-2.5 rounded-lg py-2 ps-2.5 pe-8 text-start ${tap} ${focusRing} hover:bg-surface-hover ${
          item.read ? "opacity-50" : ""
        }`}
      >
        <StatusDot status={item.kind === "custom" ? "unknown" : item.kind} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-[15px] font-medium text-ink">{item.title}</span>
            <span className="ms-auto shrink-0 text-[12px] text-ink-tertiary tabular-nums">
              {relativeTime(item.createdAt, now)}
            </span>
          </span>
          {item.body && (
            <span className="mt-0.5 block truncate text-[13px] text-ink-secondary">{item.body}</span>
          )}
          <span className="mt-0.5 block truncate text-[12px] text-ink-tertiary">{item.deviceName}</span>
        </span>
      </button>
      <button
        type="button"
        aria-label={`Dismiss ${item.title}`}
        onClick={() => appClient.dismissNotification(item.id)}
        className={`absolute end-1 top-1.5 flex size-7 items-center justify-center rounded-lg text-ink-tertiary hover:bg-surface-hover hover:text-ink ${tap} ${focusRing}`}
      >
        <CloseIcon className="size-3.5" />
      </button>
    </div>
  );
}
