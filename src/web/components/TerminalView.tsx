import { useEffect, useRef } from "react";
import { useStore } from "../store.ts";
import { appClient } from "../ws.ts";
import { sameTerminal } from "../../shared/protocol.ts";
import { TerminalSearch } from "./TerminalSearch.tsx";

export function TerminalView() {
  const container = useRef<HTMLDivElement>(null);
  // Loading until the first frame of the desired terminal is on screen:
  // attach ack alone still leaves a stale or blank canvas.
  const loading = useStore((state) =>
    Boolean(state.selection.desired) &&
    !sameTerminal(state.selection.desired, state.selection.streamed) &&
    !state.lastError,
  );

  useEffect(() => {
    void appClient.terminal.mount(container.current!);
    return () => appClient.terminal.unmount();
  }, []);

  return (
    <div className="relative h-full w-full">
      <div
        ref={container}
        className="term-surface"
        onMouseDown={() => appClient.terminal.focus()}
      />
      <TerminalSearch />
      <div role="status" className="pointer-events-none absolute inset-0">
        {loading && (
          <div className="flex h-full w-full items-center justify-center bg-terminal">
            <div className="flex animate-fade-in items-center gap-2 text-[13px] text-white/60 motion-reduce:animate-none">
              <span className="size-3.5 animate-spin rounded-full border-2 border-white/20 border-t-white/70 motion-reduce:animate-none" />
              Loading terminal…
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
