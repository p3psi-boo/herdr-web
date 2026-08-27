import { useEffect } from "react";
import { Login } from "./components/Login.tsx";
import { NotificationDrawer } from "./components/NotificationCenter.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { TerminalView } from "./components/TerminalView.tsx";
import { useStore } from "./store.ts";
import { appClient } from "./ws.ts";

export default function App() {
  const session = useStore((state) => state.session);
  const target = useStore((state) => state.selection.desired);
  const notificationsOpen = useStore((state) => state.overlay.type === "notifications");
  const lastError = useStore((state) => state.lastError);

  useEffect(() => {
    void appClient.bootstrap();
  }, []);

  if (session.status === "signed-out") return <Login />;
  if (session.status !== "ready") {
    const message = session.status === "checking-auth" ? "Checking session…" : "Connecting to gateway…";
    return (
      <div className="flex h-full items-center justify-center bg-canvas">
        <div className="flex animate-fade-in items-center gap-2 text-[13px] text-ink-tertiary motion-reduce:animate-none">
          <span className="size-3.5 animate-spin rounded-full border-2 border-ink/15 border-t-ink/50 motion-reduce:animate-none" />
          {message}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full gap-3 p-3">
      <Sidebar />
      <div className="relative min-w-0 flex-1 overflow-hidden rounded-[20px]">
        <div
          role={lastError ? "alert" : undefined}
          aria-hidden={lastError ? undefined : true}
          inert={lastError ? undefined : true}
          className={`absolute inset-x-3 top-3 z-10 rounded-xl bg-danger px-3 py-2 text-[13px] text-white shadow-sheet transition-[opacity,transform] ease-out motion-reduce:transition-none motion-reduce:transform-none ${
            lastError ? "translate-y-0 opacity-100 duration-200" : "pointer-events-none -translate-y-1 opacity-0 duration-150"
          }`}
        >
          {lastError}
        </div>
        <main className="h-full overflow-hidden bg-terminal p-3" inert={notificationsOpen || undefined}>
          <div className="h-full min-h-0 min-w-0 overflow-hidden">
            {target ? (
              <TerminalView />
            ) : (
              <div className="flex h-full items-center justify-center text-[15px] text-white/40">
                No pane selected
              </div>
            )}
          </div>
        </main>
        <NotificationDrawer />
      </div>
    </div>
  );
}
