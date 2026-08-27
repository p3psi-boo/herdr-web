/**
 * Terminal bridge: wraps `herdr terminal session control|observe` stdio.
 * stdout is NDJSON: terminal.frame (base64 ANSI bytes) / terminal.closed.
 * stdin accepts NDJSON commands: terminal.input / terminal.resize /
 * terminal.scroll / terminal.release.
 */
import type { DeviceConfig } from "./config.ts";
import { quoteRemoteArg, sshBaseArgs } from "./ssh.ts";

export type TerminalFrame = {
  seq: number;
  full: boolean;
  bytes: string; // base64 ANSI
};

export type TerminalCallbacks = {
  onFrame: (frame: TerminalFrame) => void;
  onClosed: (reason: string) => void;
};

export class TerminalSession {
  private proc: import("bun").Subprocess | null = null;
  private released = false;
  private dead = false;

  constructor(
    private device: DeviceConfig,
    private paneId: string,
    private callbacks: TerminalCallbacks,
  ) {}

  static command(
    device: DeviceConfig,
    paneId: string,
    mode: "control" | "observe",
    cols: number,
    rows: number,
    sshArgs: string[] = sshBaseArgs(),
  ): string[] {
    const args = ["terminal", "session", mode, paneId];
    if (mode === "control") args.push("--takeover");
    args.push("--cols", String(cols), "--rows", String(rows));
    if (device.type === "ssh") {
      if (!device.host) throw new Error(`device ${device.id}: missing ssh host`);
      // pane ids look like `w1:p1`; single-quote defensively for the remote shell
      const remote = ["herdr", ...args.map(quoteRemoteArg)].join(" ");
      return ["ssh", ...sshArgs, device.host, remote];
    }
    return ["herdr", ...args];
  }

  start(mode: "control" | "observe", cols: number, rows: number, sshArgs?: string[]) {
    const cmd = TerminalSession.command(this.device, this.paneId, mode, cols, rows, sshArgs);
    this.proc = Bun.spawn(cmd, {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    void this.pumpStdout();
    void this.logStderr();
    void this.proc.exited.then((code) => {
      this.dead = true;
      if (!this.released) {
        this.callbacks.onClosed(`process exited (${code})`);
      }
    });
  }

  private async pumpStdout() {
    const reader = (this.proc!.stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (line) this.handleLine(line);
        }
      }
    } catch {
      // stream died; exited handler reports closure
    }
  }

  private async logStderr() {
    const text = await new Response(this.proc!.stderr as ReadableStream<Uint8Array>).text();
    if (text.trim()) {
      console.error(`terminal ${this.paneId} stderr:`, text.trim());
    }
  }

  private handleLine(line: string) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.type === "terminal.frame") {
      this.callbacks.onFrame({
        seq: Number(msg.seq ?? 0),
        full: Boolean(msg.full),
        bytes: String(msg.bytes ?? ""),
      });
    } else if (msg.type === "terminal.closed") {
      // ignore our own release(): the release reply must not fire onClosed,
      // it would delete a newer session for the same pane from the owner map
      if (!this.released) this.callbacks.onClosed(String(msg.reason ?? "closed"));
    }
  }

  send(command: Record<string, unknown>) {
    if (!this.proc) return;
    const stdin = this.proc.stdin;
    if (typeof stdin === "object" && "write" in stdin) {
      try {
        const line = JSON.stringify(command) + "\n";
        stdin.write(line);
        void stdin.flush();
      } catch (err) {
        console.error(`terminal ${this.paneId} stdin:`, err);
        this.dead = true;
      }
    }
  }

  inputBytes(base64: string) {
    this.send({ type: "terminal.input", bytes: base64 });
  }

  resize(cols: number, rows: number) {
    this.send({ type: "terminal.resize", cols, rows });
  }

  scroll(direction: string, lines: number) {
    this.send({ type: "terminal.scroll", direction, lines });
  }

  release() {
    if (this.released) return;
    this.released = true;
    this.send({ type: "terminal.release" });
  }
}
