import { useEffect, useRef, useState, useCallback } from "react";
import type { TerminalRef } from "../../shared/protocol.ts";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon } from "../icons.tsx";
import { useStore } from "../store.ts";
import { appClient } from "../ws.ts";

type Match = {
  lineIndex: number;
  matchStart: number;
  matchEnd: number;
};

export function TerminalSearch() {
  const target = useStore((state) => state.selection.desired);
  const isOpen = useStore((state) => state.overlay.type === "terminal-search");
  const setOverlay = useStore((state) => state.setOverlay);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [regexError, setRegexError] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const cachedLinesRef = useRef<{ target: TerminalRef | null; lines: string[] }>({
    target: null,
    lines: [],
  });

  const close = useCallback(() => {
    setOverlay({ type: "none" });
    appClient.terminal.focus();
  }, [setOverlay]);

  // Focus the input when the overlay opens (stays mounted, so autoFocus won't fire).
  useEffect(() => {
    if (!isOpen) return;
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, [isOpen]);

  // Browser-level guard: swallow Cmd/Ctrl+F app-wide so the native find bar
  // never competes with terminal search.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        useStore.getState().setOverlay({ type: "terminal-search" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Invalidate cache if active target changes
  useEffect(() => {
    cachedLinesRef.current = { target: null, lines: [] };
    setMatches([]);
    setCurrentIndex(0);
  }, [target?.deviceId, target?.paneId]);

  const scrollToMatch = useCallback((match: Match, totalLines: number) => {
    if (!target) return;
    const state = useStore.getState();
    const activeDevice = state.deviceStates[target.deviceId];
    const currentPane = activeDevice?.snapshot.panes.find((p) => p.pane_id === target.paneId);
    const currentOffset = currentPane?.scroll?.offset_from_bottom ?? 0;
    const maxOffset = currentPane?.scroll?.max_offset_from_bottom ?? Math.max(0, totalLines - 24);
    const rows = currentPane?.scroll?.viewport_rows ?? 24;

    // Line 0 is oldest, totalLines - 1 is bottom
    const lineOffsetFromBottom = totalLines - 1 - match.lineIndex;
    const targetOffset = Math.max(
      0,
      Math.min(maxOffset, lineOffsetFromBottom - Math.floor(rows / 2)),
    );

    appClient.terminal.scrollToOffset(targetOffset, currentOffset);
  }, [target]);

  const performSearch = useCallback(
    async (searchQuery: string, isCaseSensitive: boolean, isRegex: boolean) => {
      if (!target || !searchQuery) {
        setMatches([]);
        setCurrentIndex(0);
        setRegexError(false);
        return;
      }

      let lines = cachedLinesRef.current.lines;
      if (
        !cachedLinesRef.current.target ||
        cachedLinesRef.current.target.deviceId !== target.deviceId ||
        cachedLinesRef.current.target.paneId !== target.paneId ||
        lines.length === 0
      ) {
        setIsLoading(true);
        try {
          const text = await appClient.readTerminal(target);
          lines = text.split("\n");
          cachedLinesRef.current = { target, lines };
        } catch {
          lines = [];
        } finally {
          setIsLoading(false);
        }
      }

      let regex: RegExp;
      try {
        if (isRegex) {
          regex = new RegExp(searchQuery, isCaseSensitive ? "g" : "gi");
        } else {
          // Escape regex special chars for plain string search
          const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          regex = new RegExp(escaped, isCaseSensitive ? "g" : "gi");
        }
        setRegexError(false);
      } catch {
        setRegexError(true);
        setMatches([]);
        setCurrentIndex(0);
        return;
      }

      const found: Match[] = [];
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        regex.lastIndex = 0;
        let result: RegExpExecArray | null;
        while ((result = regex.exec(line)) !== null) {
          found.push({
            lineIndex,
            matchStart: result.index,
            matchEnd: result.index + result[0].length,
          });
          if (result[0].length === 0) {
            regex.lastIndex += 1;
          }
        }
      }

      setMatches(found);
      if (found.length > 0) {
        // Find match closest to bottom or keep index 0
        const defaultIndex = found.length - 1;
        setCurrentIndex(defaultIndex);
        scrollToMatch(found[defaultIndex], lines.length);
      } else {
        setCurrentIndex(0);
      }
    },
    [target, scrollToMatch],
  );

  useEffect(() => {
    if (!isOpen) return;
    void performSearch(query, caseSensitive, useRegex);
  }, [isOpen, query, caseSensitive, useRegex, performSearch]);

  const goToNext = useCallback(() => {
    if (matches.length === 0) return;
    const nextIndex = (currentIndex + 1) % matches.length;
    setCurrentIndex(nextIndex);
    scrollToMatch(matches[nextIndex], cachedLinesRef.current.lines.length);
  }, [currentIndex, matches, scrollToMatch]);

  const goToPrev = useCallback(() => {
    if (matches.length === 0) return;
    const prevIndex = (currentIndex - 1 + matches.length) % matches.length;
    setCurrentIndex(prevIndex);
    scrollToMatch(matches[prevIndex], cachedLinesRef.current.lines.length);
  }, [currentIndex, matches, scrollToMatch]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        goToPrev();
      } else {
        goToNext();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="absolute end-3 top-3 z-30 flex animate-fade-in items-center gap-1.5 rounded-xl border border-ink/10 bg-surface/95 p-1.5 text-[13px] shadow-popover backdrop-blur-md">
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder="Find in terminal… (Enter / Shift+Enter)"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-56 rounded-lg border border-transparent bg-canvas/80 px-2.5 py-1 font-mono text-[12px] text-ink outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent placeholder:text-ink-tertiary"
      />

      <div className="flex min-w-[4.5rem] items-center justify-center text-[11px] font-medium tabular-nums text-ink-secondary">
        {isLoading ? (
          <span className="text-ink-tertiary">Loading…</span>
        ) : regexError ? (
          <span className="text-danger">Invalid regex</span>
        ) : query ? (
          matches.length > 0 ? (
            `${currentIndex + 1} of ${matches.length}`
          ) : (
            <span className="text-ink-tertiary">No results</span>
          )
        ) : (
          <span className="text-ink-tertiary">0 results</span>
        )}
      </div>

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          title="Match Case (Aa)"
          onClick={() => setCaseSensitive(!caseSensitive)}
          className={`flex size-6 items-center justify-center rounded text-[11px] font-semibold transition ${
            caseSensitive
              ? "bg-accent text-accent-fg"
              : "text-ink-secondary hover:bg-surface-hover hover:text-ink"
          }`}
        >
          Aa
        </button>

        <button
          type="button"
          title="Use Regular Expression (.*)"
          onClick={() => setUseRegex(!useRegex)}
          className={`flex size-6 items-center justify-center rounded font-mono text-[11px] font-bold transition ${
            useRegex
              ? "bg-accent text-accent-fg"
              : "text-ink-secondary hover:bg-surface-hover hover:text-ink"
          }`}
        >
          .*
        </button>

        <button
          type="button"
          title="Previous Match (Shift+Enter)"
          disabled={matches.length === 0}
          onClick={goToPrev}
          className="flex size-6 items-center justify-center rounded text-ink-secondary transition hover:bg-surface-hover hover:text-ink disabled:opacity-30"
        >
          <ChevronUpIcon className="size-3.5" />
        </button>

        <button
          type="button"
          title="Next Match (Enter)"
          disabled={matches.length === 0}
          onClick={goToNext}
          className="flex size-6 items-center justify-center rounded text-ink-secondary transition hover:bg-surface-hover hover:text-ink disabled:opacity-30"
        >
          <ChevronDownIcon className="size-3.5" />
        </button>

        <button
          type="button"
          title="Close (Esc)"
          onClick={close}
          className="flex size-6 items-center justify-center rounded text-ink-secondary transition hover:bg-surface-hover hover:text-ink"
        >
          <CloseIcon className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
