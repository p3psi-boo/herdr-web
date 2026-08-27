import { FitAddon, Ghostty, Terminal } from "ghostty-web";
import type { ClientMessage, ServerMessage, TerminalRef } from "../shared/protocol.ts";
import { sameTerminal } from "../shared/protocol.ts";
import { useStore } from "./store.ts";

type TerminalMessage = Extract<ServerMessage, { type: "terminal.frame" | "terminal.closed" | "command.result" | "command.failed" }>;

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export class TerminalController {
  private terminal: Terminal | null = null;
  private fit: FitAddon | null = null;
  private target: TerminalRef | null = null;
  private attachmentId: string | null = null;
  private attachCommandId: string | null = null;
  private streamed = false;
  private load: Promise<Ghostty> | null = null;
  private mountId = 0;
  private accumulatedScrollDelta = 0;

  constructor(private send: (message: ClientMessage) => void) {}

  async mount(container: HTMLDivElement): Promise<void> {
    const mountId = ++this.mountId;
    this.load ??= Ghostty.load("/ghostty-vt.wasm");
    const ghostty = await this.load;
    if (mountId !== this.mountId) return;
    const terminal = new Terminal({
      ghostty,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: { background: "#1c1d22", foreground: "#d8d8de", cursor: "#ececf1" },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    fit.fit();
    fit.observeResize();
    terminal.onData((data) => this.input(data));
    terminal.onResize(({ cols, rows }) => this.resize(cols, rows));
    terminal.attachCustomWheelEventHandler((event) => this.handleWheel(event));
    terminal.attachCustomKeyEventHandler((event) => this.handleKey(event));
    this.terminal = terminal;
    this.fit = fit;
    this.select(useStore.getState().selection.desired);
    this.focus();
  }

  unmount(): void {
    this.mountId += 1;
    this.release();
    this.accumulatedScrollDelta = 0;
    this.fit?.dispose();
    this.terminal?.dispose();
    this.fit = null;
    this.terminal = null;
  }

  select(target: TerminalRef | null): void {
    if (!this.terminal || !target) {
      this.target = target;
      return;
    }
    if (sameTerminal(this.target, target) && (this.attachmentId || this.attachCommandId)) {
      this.focus();
      return;
    }
    this.release();
    this.target = target;
    this.streamed = false;
    this.terminal.reset();
    const commandId = crypto.randomUUID();
    this.attachCommandId = commandId;
    useStore.getState().beginOperation(commandId, "attach-terminal");
    this.send({
      type: "terminal.attach",
      commandId,
      target,
      cols: this.terminal.cols,
      rows: this.terminal.rows,
    });
    this.focus();
  }

  disconnected(): void {
    this.attachmentId = null;
    this.attachCommandId = null;
    this.streamed = false;
    this.accumulatedScrollDelta = 0;
    useStore.getState().markTerminalStreamed(null);
  }

  handle(message: TerminalMessage): void {
    if (message.type === "command.result" && message.result.type === "terminal-attached") {
      if (message.commandId !== this.attachCommandId || !sameTerminal(message.result.target, this.target)) {
        this.send({ type: "terminal.release", attachmentId: message.result.attachmentId });
        return;
      }
      this.attachCommandId = null;
      this.attachmentId = message.result.attachmentId;
      return;
    }
    if (message.type === "command.failed" && message.commandId === this.attachCommandId) {
      this.attachCommandId = null;
      return;
    }
    if (message.type === "terminal.frame" && message.attachmentId === this.attachmentId) {
      if (message.full) this.terminal?.clear();
      this.terminal?.write(decodeBase64(message.bytes));
      if (!this.streamed) {
        this.streamed = true;
        useStore.getState().markTerminalStreamed(this.target);
      }
      return;
    }
    if (message.type === "terminal.closed" && message.attachmentId === this.attachmentId) {
      this.attachmentId = null;
      this.terminal?.write(`\r\n\x1b[2m[terminal closed: ${message.reason}]\x1b[0m\r\n`);
      useStore.getState().markTerminalStreamed(this.target);
    }
  }

  focus(): void {
    this.terminal?.focus();
  }

  private release(): void {
    if (this.attachmentId) this.send({ type: "terminal.release", attachmentId: this.attachmentId });
    this.attachmentId = null;
    this.attachCommandId = null;
    this.accumulatedScrollDelta = 0;
    useStore.getState().markTerminalStreamed(null);
  }

  private input(data: string): void {
    if (!this.attachmentId) return;
    const bytes = new TextEncoder().encode(data);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    this.send({ type: "terminal.input", attachmentId: this.attachmentId, bytes: btoa(binary) });
  }

  private resize(cols: number, rows: number): void {
    if (this.attachmentId) this.send({ type: "terminal.resize", attachmentId: this.attachmentId, cols, rows });
  }

  scroll(direction: "up" | "down", lines: number): void {
    if (!this.attachmentId || lines <= 0) return;
    this.send({
      type: "terminal.scroll",
      attachmentId: this.attachmentId,
      direction,
      lines: Math.max(1, Math.round(lines)),
    });
  }

  scrollToOffset(targetOffset: number, currentOffset: number): void {
    const delta = targetOffset - currentOffset;
    if (delta > 0) {
      this.scroll("up", delta);
    } else if (delta < 0) {
      this.scroll("down", Math.abs(delta));
    }
  }

  private handleWheel(event: WheelEvent): boolean {
    if (!this.attachmentId) return false;
    if (event.ctrlKey) return false;

    let lines = 0;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      lines = Math.round(event.deltaY);
    } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      lines = Math.round(event.deltaY * (this.terminal?.rows ?? 24));
    } else {
      const LINE_HEIGHT_PX = 18;
      if (
        (this.accumulatedScrollDelta > 0 && event.deltaY < 0) ||
        (this.accumulatedScrollDelta < 0 && event.deltaY > 0)
      ) {
        this.accumulatedScrollDelta = 0;
      }
      this.accumulatedScrollDelta += event.deltaY;
      lines = Math.trunc(this.accumulatedScrollDelta / LINE_HEIGHT_PX);
      if (lines !== 0) {
        this.accumulatedScrollDelta -= lines * LINE_HEIGHT_PX;
      }
    }

    if (lines !== 0) {
      const direction = lines < 0 ? "up" : "down";
      this.scroll(direction, Math.abs(lines));
    }
    return true;
  }

  private handleKey(event: KeyboardEvent): boolean {
    if (event.type !== "keydown" || !this.attachmentId) return false;

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      useStore.getState().setOverlay({ type: "terminal-search" });
      return true;
    }

    const pageSize = Math.max(1, (this.terminal?.rows ?? 24) - 2);
    if (event.shiftKey && (event.key === "PageUp" || event.code === "PageUp")) {
      this.scroll("up", pageSize);
      return true;
    }
    if (event.shiftKey && (event.key === "PageDown" || event.code === "PageDown")) {
      this.scroll("down", pageSize);
      return true;
    }
    if (event.shiftKey && (event.key === "ArrowUp" || event.code === "ArrowUp")) {
      this.scroll("up", 1);
      return true;
    }
    if (event.shiftKey && (event.key === "ArrowDown" || event.code === "ArrowDown")) {
      this.scroll("down", 1);
      return true;
    }
    return false;
  }
}
