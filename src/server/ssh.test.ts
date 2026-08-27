import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SSH_CONNECT_TIMEOUT_SEC,
  controlPathFor,
  quoteRemoteArg,
  sshBaseArgs,
  SshMux,
} from "./ssh.ts";

describe("sshBaseArgs", () => {
  test("uses BatchMode, keepalive, and a longer connect timeout", () => {
    const args = sshBaseArgs();
    expect(args).toContain("BatchMode=yes");
    expect(args).toContain("ServerAliveInterval=15");
    expect(args).toContain("ServerAliveCountMax=4");
    expect(args).toContain("ExitOnForwardFailure=yes");
    expect(args).toContain("StreamLocalBindUnlink=yes");
    expect(args).toContain(`ConnectTimeout=${SSH_CONNECT_TIMEOUT_SEC}`);
    expect(SSH_CONNECT_TIMEOUT_SEC).toBeGreaterThan(5);
  });
});

describe("quoteRemoteArg", () => {
  test("wraps in single quotes", () => {
    expect(quoteRemoteArg("w1:p1")).toBe("'w1:p1'");
  });

  test("escapes embedded single quotes", () => {
    expect(quoteRemoteArg("a'b")).toBe("'a'\\''b'");
  });
});

describe("SshMux", () => {
  test("control path is under tmpdir and sanitizes the device id", () => {
    const path = controlPathFor("Studio @ Home");
    expect(path.startsWith(tmpdir())).toBe(true);
    expect(path).toBe(join(tmpdir(), "herdr-web-Studio-Home-ctl.sock"));
  });

  test("slave commands reuse ControlPath and do not start a new master", () => {
    const mux = new SshMux("ww-hk", "ww-hk");
    const cmd = mux.command("herdr status server");
    expect(cmd[0]).toBe("ssh");
    expect(cmd).toContain("ControlMaster=no");
    expect(cmd).toContain(`ControlPath=${mux.controlPath}`);
    expect(cmd.at(-2)).toBe("ww-hk");
    expect(cmd.at(-1)).toBe("herdr status server");
    mux.close();
  });
});
