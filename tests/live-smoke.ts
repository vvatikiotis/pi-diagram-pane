// Explicit opt-in integration check: creates and closes only its own Herdr pane.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../index.js";

if (process.env.HERDR_ENV !== "1" || !process.env.HERDR_PANE_ID) {
  throw new Error("Run this check inside Herdr.");
}
const runFile = promisify(execFile);
async function exec(command: string, args: string[], options?: { timeout?: number }) {
  try {
    const { stdout, stderr } = await runFile(command, args, { ...options, encoding: "utf8" });
    return { code: 0, stdout, stderr, killed: false };
  } catch (error: any) {
    return { code: typeof error.code === "number" ? error.code : 1, stdout: String(error.stdout || ""), stderr: String(error.stderr || error.message), killed: Boolean(error.killed) };
  }
}
async function herdr(...args: string[]) {
  const result = await exec("herdr", ["pane", ...args]);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.trim() ? JSON.parse(result.stdout).result : {};
}
const handlers = new Map<string, Function>();
const warnings: string[] = [];
let viewerPane: string | undefined;
const pi = {
  on(name: string, handler: Function) { handlers.set(name, handler); },
  registerCommand() {},
  async exec(command: string, args: string[], options?: { timeout?: number }) {
    const result = await exec(command, args, options);
    if (command === "herdr" && args[1] === "split" && result.code === 0) {
      viewerPane = JSON.parse(result.stdout).result.pane.pane_id;
    }
    return result;
  },
} as unknown as ExtensionAPI;
const entries: any[] = [];
const ctx = {
  mode: "tui", cwd: process.cwd(),
  sessionManager: { getSessionId: () => "live-smoke", getBranch: () => entries },
  ui: { notify(message: string, level: string) { if (level === "warning") warnings.push(message); } },
};
const emit = (name: string, event: any = {}) => handlers.get(name)?.({ type: name, ...event }, ctx);
const reply = async (text: string) => {
  const message = { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" };
  await emit("message_end", { message });
  entries.push({ type: "message", message });
};
extension(pi);
try {
  const originalFocus = (await herdr("layout", "--current")).layout.focused_pane_id;
  await emit("session_start", { reason: "startup" });
  await reply("Login:\n```mermaid\nflowchart TD\n A[Login] --> B[Dashboard]\n```");
  assert.deepEqual(warnings, []);
  assert(viewerPane);
  await herdr("wait-output", viewerPane, "--match", "Dashboard", "--timeout", "5000");
  const layout = (await herdr("layout", "--current")).layout;
  assert.equal(layout.focused_pane_id, originalFocus);
  const initialSplit = layout.splits.find((s: any) => s.ratio === 0.61);
  assert(initialSplit, "initial split is 61/39");
  await herdr("resize", "--pane", viewerPane, "--direction", "left", "--amount", "0.05");
  const resized = JSON.stringify((await herdr("layout", "--current")).layout.splits);
  await reply("```text\n┌─────────┐\n│ SECOND  │\n└─────────┘\n```");
  assert.equal(JSON.stringify((await herdr("layout", "--current")).layout.splits), resized);
  await herdr("wait-output", viewerPane, "--match", "SECOND", "--timeout", "5000");
  await herdr("send-keys", viewerPane, "p");
  await herdr("wait-output", viewerPane, "--match", "Dashboard", "--source", "visible", "--timeout", "5000");
  await herdr("send-keys", viewerPane, "q");
  // Wait for the extension's ownership-checked close, not a fixed sleep.
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const result = await exec("herdr", ["pane", "get", viewerPane]);
    if (result.code !== 0 && result.stderr.includes("pane_not_found")) break;
    await delay(100);
  }
  const closed = await exec("herdr", ["pane", "get", viewerPane]);
  assert.notEqual(closed.code, 0, "q closes the owned pane");
  assert.deepEqual(warnings, []);
  console.log("PASS: real Herdr split, focus, Mermaid rendering, updates, preserved resize, previous diagram, and q cleanup.");
} finally {
  await emit("session_shutdown", { reason: "quit" });
}
