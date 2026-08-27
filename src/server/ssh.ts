/**
 * Shared SSH transport for remote herdr devices.
 *
 * One ControlMaster per device: the first handshake authenticates, then
 * socket forwarding and every `herdr terminal session` reuse that connection
 * (the same multiplexing herdr --remote uses). Keepalives detect dead NATs
 * instead of leaving a zombie "connected" tunnel.
 */
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SSH_CONNECT_TIMEOUT_SEC = 15;

export function sshBaseArgs(): string[] {
  return [
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SEC}`,
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=4",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "StreamLocalBindUnlink=yes",
  ];
}

export function quoteRemoteArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function controlPathFor(deviceId: string): string {
  const safe = deviceId.replace(/[^a-zA-Z0-9._-]+/g, "-") || "device";
  return join(tmpdir(), `herdr-web-${safe}-ctl.sock`);
}

async function readPipe(stream: unknown): Promise<string> {
  if (!stream) return "";
  return new Response(stream as ReadableStream<Uint8Array>).text();
}

export class SshMux {
  readonly controlPath: string;
  private master: import("bun").Subprocess | null = null;
  private closed = false;

  constructor(
    readonly host: string,
    deviceId: string,
    private onDead: () => void = () => {},
  ) {
    this.controlPath = controlPathFor(deviceId);
  }

  slaveArgs(): string[] {
    return [...sshBaseArgs(), "-o", "ControlMaster=no", "-o", `ControlPath=${this.controlPath}`];
  }

  /** `ssh … host <remote>` argv using the multiplexed connection. */
  command(remote: string): string[] {
    return ["ssh", ...this.slaveArgs(), this.host, remote];
  }

  async start(): Promise<void> {
    if (this.closed) throw new Error("ssh mux already closed");
    rmSync(this.controlPath, { force: true });
    this.master = Bun.spawn(
      [
        "ssh",
        ...sshBaseArgs(),
        "-o",
        "ControlMaster=yes",
        "-o",
        `ControlPath=${this.controlPath}`,
        "-N",
        this.host,
      ],
      { stdout: "ignore", stderr: "pipe" },
    );
    void this.master.exited.then(() => {
      if (!this.closed) this.onDead();
    });
    await this.waitReady();
  }

  private async waitReady(): Promise<void> {
    const deadline = Date.now() + (SSH_CONNECT_TIMEOUT_SEC + 5) * 1000;
    while (Date.now() < deadline) {
      if (this.master?.exitCode !== null && this.master?.exitCode !== undefined) {
        const stderr = (await readPipe(this.master.stderr)).trim();
        throw new Error(stderr || "ssh master exited");
      }
      const check = Bun.spawn(["ssh", ...this.slaveArgs(), "-O", "check", this.host], {
        stdout: "ignore",
        stderr: "pipe",
      });
      if ((await check.exited) === 0) return;
      await Bun.sleep(100);
    }
    throw new Error("ssh master timed out");
  }

  async exec(remote: string): Promise<{ code: number; stdout: string; stderr: string }> {
    const proc = Bun.spawn(this.command(remote), { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      readPipe(proc.stdout),
      readPipe(proc.stderr),
      proc.exited,
    ]);
    return { code, stdout: stdout.trim(), stderr: stderr.trim() };
  }

  async forward(localPath: string, remotePath: string): Promise<void> {
    rmSync(localPath, { force: true });
    const spec = `${localPath}:${remotePath}`;
    const proc = Bun.spawn(
      ["ssh", ...this.slaveArgs(), "-O", "forward", "-L", spec, this.host],
      { stdout: "ignore", stderr: "pipe" },
    );
    const code = await proc.exited;
    if (code !== 0) {
      const stderr = (await readPipe(proc.stderr)).trim();
      throw new Error(stderr || "ssh forward failed");
    }
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (existsSync(localPath)) return;
      if (this.master?.exitCode !== null && this.master?.exitCode !== undefined) {
        throw new Error("ssh master died during forward");
      }
      await Bun.sleep(50);
    }
    throw new Error("ssh forward timed out");
  }

  close(): void {
    this.closed = true;
    if (this.master) {
      try {
        Bun.spawnSync(["ssh", ...this.slaveArgs(), "-O", "exit", this.host], {
          stdout: "ignore",
          stderr: "ignore",
        });
      } catch {
        // master already gone
      }
      try {
        this.master.kill();
      } catch {
        // already gone
      }
      this.master = null;
    }
    rmSync(this.controlPath, { force: true });
  }
}

function remoteServerRunning(stdout: string): boolean {
  try {
    const json = JSON.parse(stdout) as { status?: string; running?: boolean };
    if (json.running === true || json.status === "running") return true;
    if (json.status === "not_running" || json.running === false) return false;
  } catch {
    // plain-text fallback for older herdr
  }
  return /status:\s*running\b/i.test(stdout);
}

/** If the remote herdr daemon is down, start it the way `herdr --remote` would. */
export async function ensureRemoteHerdr(mux: SshMux): Promise<void> {
  const status = await mux.exec("herdr status server --json");
  if (status.code !== 0 && !status.stdout) {
    throw new Error(
      status.stderr || "herdr is not installed on the remote host (needed for herdr-web SSH)",
    );
  }
  if (remoteServerRunning(status.stdout)) return;

  const start = await mux.exec("nohup herdr server </dev/null >/dev/null 2>&1 & echo ok");
  if (start.code !== 0) {
    throw new Error(start.stderr || "failed to start remote herdr server");
  }

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await Bun.sleep(250);
    const again = await mux.exec("herdr status server --json");
    if (remoteServerRunning(again.stdout)) return;
  }
  throw new Error("remote herdr server did not start");
}
