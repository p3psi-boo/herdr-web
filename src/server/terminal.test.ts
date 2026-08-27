import { describe, expect, test } from "bun:test";
import { TerminalSession } from "./terminal.ts";
import { SshMux } from "./ssh.ts";

describe("TerminalSession.command", () => {
  const device = { id: "ww-hk", name: "ww-hk", type: "ssh" as const, host: "ww-hk" };

  test("local devices invoke herdr directly", () => {
    const cmd = TerminalSession.command(
      { id: "local", name: "Local", type: "local" },
      "w1:p1",
      "observe",
      80,
      24,
    );
    expect(cmd.slice(0, 4)).toEqual(["herdr", "terminal", "session", "observe"]);
    expect(cmd).not.toContain("ssh");
  });

  test("ssh devices reuse ControlMaster args when provided", () => {
    const mux = new SshMux("ww-hk", "ww-hk");
    const cmd = TerminalSession.command(device, "w1:p1", "control", 120, 40, mux.slaveArgs());
    mux.close();
    expect(cmd[0]).toBe("ssh");
    expect(cmd).toContain("ControlMaster=no");
    expect(cmd).toContain(`ControlPath=${mux.controlPath}`);
    expect(cmd).toContain("ww-hk");
    expect(cmd.at(-1)).toContain("herdr");
    expect(cmd.at(-1)).toContain("'w1:p1'");
    expect(cmd.at(-1)).toContain("--takeover");
  });
});
