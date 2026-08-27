import type { ClientMessage, ServerMessage } from "../src/shared/protocol.ts";

const port = process.argv[2] ?? "7399";
const token = process.argv[3] ?? "";
const inputPane = process.argv[4];
let failures = 0;

function check(name: string, result: boolean, detail = ""): void {
  console.log(`${result ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!result) failures += 1;
}

const rejected = await fetch(`http://127.0.0.1:${port}/ws?token=wrong`);
check("bad token rejected", rejected.status === 401, `status ${rejected.status}`);

const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
const messages: ServerMessage[] = [];
const waiters = new Set<() => void>();

socket.onmessage = (event) => {
  messages.push(JSON.parse(String(event.data)) as ServerMessage);
  for (const wake of waiters) wake();
};

await new Promise<void>((resolve, reject) => {
  socket.onopen = () => resolve();
  socket.onerror = () => reject(new Error("ws connect failed"));
});

async function waitFor(predicate: (message: ServerMessage) => boolean): Promise<ServerMessage> {
  for (;;) {
    const index = messages.findIndex(predicate);
    if (index >= 0) return messages.splice(index, 1)[0];
    await new Promise<void>((resolve) => {
      const wake = () => {
        waiters.delete(wake);
        resolve();
      };
      waiters.add(wake);
    });
  }
}

function send(message: ClientMessage): void {
  socket.send(JSON.stringify(message));
}

const ready = await waitFor((message) => message.type === "gateway.ready");
if (ready.type !== "gateway.ready") throw new Error("gateway not ready");
check("gateway has local device", ready.devices.some((device) => device.id === "local"));

let initial = ready.states.find((state) => state.deviceId === "local");
if (!initial) {
  const message = await waitFor((candidate) => candidate.type === "device.state" && candidate.state.deviceId === "local");
  if (message.type === "device.state") initial = message.state;
}
if (!initial) throw new Error("device state unavailable");
check("gateway has revisioned local state", initial.revision > 0 && Array.isArray(initial.snapshot.panes), `revision=${initial.revision}`);

const paneId = inputPane ?? initial.snapshot.panes[0]?.pane_id;
if (paneId) {
  const commandId = crypto.randomUUID();
  send({ type: "terminal.attach", commandId, target: { deviceId: "local", paneId }, cols: 80, rows: 24 });
  const attached = await waitFor((message) => message.type === "command.result" && message.commandId === commandId);
  if (attached.type !== "command.result" || attached.result.type !== "terminal-attached") throw new Error("terminal not attached");
  const attachmentId = attached.result.attachmentId;
  const frame = await waitFor((message) => message.type === "terminal.frame" && message.attachmentId === attachmentId);
  const decoded = frame.type === "terminal.frame" ? Buffer.from(frame.bytes, "base64").toString("utf8") : "";
  check("attachment lease receives ANSI frame", decoded.includes("\x1b["), `attachment=${attachmentId}`);

  if (inputPane) {
    const marker = `herdr_web_test_${Date.now()}`;
    send({ type: "terminal.input", attachmentId, bytes: Buffer.from(`echo ${marker}\n`).toString("base64") });
    const echoed = await waitFor((message) => message.type === "terminal.frame" && message.attachmentId === attachmentId && Buffer.from(message.bytes, "base64").toString("utf8").includes(marker));
    check("attachment input echoes", echoed.type === "terminal.frame", marker);
  }

  send({ type: "terminal.release", attachmentId });
} else {
  check("attachment lease receives ANSI frame", false, "no pane available");
}

socket.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
