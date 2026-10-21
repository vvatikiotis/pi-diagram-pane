import assert from "node:assert/strict";
import { readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import extension from "../index.js";

let sequence = 0;

async function harness(options: { inHerdr: boolean; failAt?: string; omitReady?: boolean; quotedPs?: boolean } = { inHerdr: true }) {
  process.env.HERDR_ENV = options.inHerdr ? "1" : "0";
  process.env.HERDR_PANE_ID = `diagram-test-${process.pid}-${++sequence}`;
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const calls: string[][] = [];
  const notifications: string[] = [];
  let stateFile = "";
  let alive = false;
  let processCommand = "";
  let sessionId = "first-session";
  const entries: any[] = [];
  const pi: any = {
    on(name: string, fn: Function) { handlers.set(name, fn); },
    registerCommand(name: string, command: any) { commands.set(name, command); },
    async exec(command: string, args: string[]) {
      calls.push([command, ...args]);
      const result = (value: any) => ({ code: 0, stdout: JSON.stringify({ result: value }), stderr: "", killed: false });
      if (command === "ps") return { code: 0, stdout: processCommand, stderr: "", killed: false };
      if (args[1] === options.failAt) {
        return { code: 1, stdout: "", stderr: JSON.stringify({ error: { code: "test_failure", message: "Simulated Herdr failure" } }), killed: false };
      }
      if (args[1] === "split") { alive = true; return result({ pane: { pane_id: "test:viewer" } }); }
      if (args[1] === "run") {
        const match = args[3]!.match(/--state '([^']+)'/);
        assert(match, "viewer must receive a quoted snapshot path");
        stateFile = match[1]!;
        processCommand = options.quotedPs ? args[3]! : args[3]!.replace(/'/g, "");
        if (!options.omitReady) await writeFile(join(dirname(stateFile), "ready.json"), JSON.stringify({ pid: 999999 }));
        return result({});
      }
      if (args[1] === "process-info") {
        if (!alive) return { code: 1, stdout: "", stderr: JSON.stringify({ error: { code: "pane_not_found" } }), killed: false };
        return result({ process_info: { foreground_processes: [{ pid: 999999 }] } });
      }
      if (args[1] === "close") alive = false;
      return result({});
    },
  };
  const ctx: any = {
    mode: "tui", cwd: process.cwd(),
    sessionManager: { getSessionId: () => sessionId, getBranch: () => entries },
    ui: { notify(message: string) { notifications.push(message); } },
  };
  extension(pi);
  const emit = async (name: string, event: any = {}) => handlers.get(name)?.({ type: name, ...event }, ctx);
  const assistant = (text: string) => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop" });
  const reply = async (text: string) => {
    const message = assistant(text);
    // Pi emits message_end before appending it to the session branch.
    await emit("message_end", { message });
    entries.push({ type: "message", message });
  };
  return {
    calls, notifications, entries, ctx, emit, reply, assistant,
    toggle: () => commands.get("diagram").handler("", ctx),
    reloadRuntime() { extension(pi); },
    snapshot: async () => JSON.parse(await readFile(stateFile, "utf8")),
    statePath: () => stateFile,
    switchSession(id: string) { sessionId = id; entries.length = 0; },
    closeManually() { alive = false; },
    repurpose() { processCommand = "node important-user-process.js"; },
    async cleanup() {
      await emit("session_shutdown", { reason: "quit" });
      if (stateFile) await rm(dirname(stateFile), { recursive: true, force: true });
    },
  };
}

test("a completed reply opens a non-focusing Herdr split and displays its ASCII diagram", async () => {
  const h = await harness();
  try {
    await h.emit("session_start");
    const text = "Login:\n```text\n┌───────┐\n│ Login │\n└───────┘\n```";
    await h.emit("message_update", { message: h.assistant(text) });
    assert.equal(h.calls.filter(c => c.includes("split")).length, 0);
    await h.reply(text);
    const split = h.calls.find(c => c.includes("split"))!;
    assert(split.includes("--no-focus"));
    assert.equal(split[split.indexOf("--ratio") + 1], "0.61");
    assert.deepEqual((await h.snapshot()).diagrams.map((d: any) => d.text), ["┌───────┐\n│ Login │\n└───────┘"]);
  } finally { await h.cleanup(); }
});


test("disabling never closes a viewer pane repurposed for another process", async () => {
  const h = await harness();
  try {
    await h.reply("```mermaid\nflowchart TD\n A --> B\n```");
    h.repurpose();
    await h.toggle();
    assert.equal(h.calls.filter(c => c.includes("close")).length, 0);
  } finally { await h.cleanup(); }
});

test("manual closure disables reopening until /diagram explicitly enables it", async () => {
  const h = await harness();
  try {
    await h.reply("```mermaid\nflowchart TD\n A --> B\n```");
    h.closeManually();
    await h.reply("```mermaid\nflowchart TD\n C --> D\n```");
    assert.equal(h.calls.filter(c => c.includes("split")).length, 1);
    await h.toggle();
    assert.equal(h.calls.filter(c => c.includes("split")).length, 2);
    assert.equal((await h.snapshot()).diagrams.length, 2);
  } finally { await h.cleanup(); }
});

test("session replacement reuses the owned pane across extension runtimes", async () => {
  const h = await harness();
  try {
    await h.reply("```mermaid\nflowchart TD\n A --> B\n```");
    await h.emit("session_shutdown", { reason: "new" });
    assert.equal(h.calls.filter(c => c.includes("close")).length, 0);
    h.reloadRuntime();
    h.switchSession("new-session");
    await h.emit("session_start", { reason: "new" });
    assert.deepEqual((await h.snapshot()).diagrams, []);
    await h.reply("```mermaid\nflowchart TD\n C --> D\n```");
    assert.equal(h.calls.filter(c => c.includes("split")).length, 1);
  } finally { await h.cleanup(); }
});

test("outside Herdr /diagram explains the requirement without spawning anything", async () => {
  const h = await harness({ inHerdr: false });
  try {
    await h.emit("session_start");
    await h.reply("```mermaid\nflowchart TD\n A --> B\n```");
    await h.toggle();
    assert.equal(h.calls.length, 0);
    assert(h.notifications.some(text => /requires Herdr/.test(text)));
  } finally { await h.cleanup(); }
});

test("disabled viewing still captures, deduplicates, and restores the newest 20 diagrams", async () => {
  const h = await harness();
  try {
    await h.reply("```mermaid\nflowchart TD\n A --> B\n```");
    await h.toggle();
    for (let n = 0; n < 25; n++) {
      h.entries.push({ type: "message", message: h.assistant(`\`\`\`text\n┌─────┐\n│ ${n} │\n└─────┘\n\`\`\``) });
    }
    await h.reply("```text\n┌─────┐\n│ 24 │\n└─────┘\n```");
    assert.equal(h.calls.filter(c => c.includes("split")).length, 1);
    await h.emit("session_shutdown", { reason: "reload" });
    h.reloadRuntime();
    await h.emit("session_start", { reason: "reload" });
    await h.toggle();
    const { diagrams } = await h.snapshot();
    assert.equal(diagrams.length, 20);
    assert.match(diagrams[0].source, /│ 5 │/);
    assert.match(diagrams[19].source, /│ 24 │/);
    assert.equal(h.calls.filter(c => c.includes("split")).length, 2);
  } finally { await h.cleanup(); }
});

test("a repeated older diagram becomes the newest copy without duplicates", async () => {
  const h = await harness();
  try {
    const chart = (n: number) => `\`\`\`text\n┌─────┐\n│ ${n} │\n└─────┘\n\`\`\``;
    for (let n = 0; n < 21; n++) h.entries.push({ type: "message", message: h.assistant(chart(n)) });
    await h.emit("session_start");
    await h.reply(chart(0));
    const { diagrams } = await h.snapshot();
    assert.equal(diagrams.length, 20);
    assert.match(diagrams[19].source, /│ 0 │/);
    assert.match(diagrams[0].source, /│ 2 │/);
  } finally { await h.cleanup(); }
});

test("aborted assistant messages are not captured or restored", async () => {
  const h = await harness();
  try {
    await h.reply("```text\n┌─────┐\n│ Good │\n└─────┘\n```");
    const aborted = { ...h.assistant("```mermaid\nflowchart TD\n Bad --> Partial\n```"), stopReason: "aborted" };
    await h.emit("message_end", { message: aborted });
    h.entries.push({ type: "message", message: aborted });
    await h.emit("session_tree");
    assert.equal((await h.snapshot()).diagrams.length, 1);
  } finally { await h.cleanup(); }
});

test("quit closes our running viewer even if its startup marker is missing", async () => {
  const h = await harness();
  try {
    await h.reply("```text\n┌─────┐\n│ Test │\n└─────┘\n```");
    await rm(join(dirname(h.statePath()), "ready.json"));
    await h.emit("session_shutdown", { reason: "quit" });
    assert.equal(h.calls.filter(c => c.includes("close")).length, 1);
  } finally { await h.cleanup(); }
});

test("ownership fallback recognizes the quoted command used to launch the viewer", async () => {
  const h = await harness({ inHerdr: true, quotedPs: true });
  try {
    await h.reply("```text\n┌─────┐\n│ Test │\n└─────┘\n```");
    await h.toggle();
    assert.equal(h.calls.filter(c => c.includes("close")).length, 1);
  } finally { await h.cleanup(); }
});

test("failed startup observation closes only our process without depending on ready.json", async () => {
  const h = await harness({ inHerdr: true, failAt: "wait-output", omitReady: true });
  try {
    await h.reply("```text\n┌─────┐\n│ Test │\n└─────┘\n```");
    assert.equal(h.calls.filter(c => c.includes("close")).length, 1);
    assert.equal(h.notifications.length, 1);
  } finally { await h.cleanup(); }
});

test("failed split and run do not interrupt replies or close unrelated shell processes", async () => {
  for (const failAt of ["split", "run"]) {
    const h = await harness({ inHerdr: true, failAt });
    try {
      await h.reply("```text\n┌─────┐\n│ Test │\n└─────┘\n```");
      assert.equal(h.calls.filter(c => c.includes("close")).length, 0);
      assert.equal(h.notifications.length, 1);
    } finally { await h.cleanup(); }
  }
});

test("branch navigation replaces history, including an empty destination session", async () => {
  const h = await harness();
  try {
    const diagram = "```text\n┌───────┐\n│ Older │\n└───────┘\n```";
    await h.reply(diagram);
    h.entries.length = 0;
    h.entries.push({ type: "message", message: h.assistant("```mermaid\nflowchart TD\n X[Branch] --> Y[Only]\n```") });
    await h.emit("session_tree");
    assert.equal((await h.snapshot()).diagrams.length, 1);
    assert.match((await h.snapshot()).diagrams[0].text, /Branch/);
    h.switchSession("empty-session");
    await h.emit("session_start", { reason: "new" });
    assert.deepEqual((await h.snapshot()).diagrams, []);
    assert.equal(h.calls.filter(c => c.includes("split")).length, 1);
  } finally { await h.cleanup(); }
});

test("captures only assistant text, not user, tool, thinking, or incomplete blocks", async () => {
  const h = await harness();
  try {
    const text = "```mermaid\nflowchart TD\n A --> B\n```";
    h.entries.push({ type: "message", message: { role: "user", content: text } });
    h.entries.push({ type: "message", message: { role: "toolResult", content: [{ type: "text", text }] } });
    h.entries.push({ type: "message", message: { ...h.assistant("No diagram"), content: [{ type: "thinking", thinking: text }] } });
    await h.emit("session_start");
    await h.reply("```mermaid\nflowchart TD\n A --> B");
    assert.equal(h.calls.filter(c => c.includes("split")).length, 0);
    await h.reply(text);
    assert.equal((await h.snapshot()).diagrams.length, 1);
  } finally { await h.cleanup(); }
});

test("recognizes arrow-only ASCII and long fences, without pinning ordinary code blocks", async () => {
  const h = await harness();
  try {
    await h.reply("```text\nInput --> Check\nCheck --> Output\n````\n~~~mermaid\nflowchart TD\n A --> B\n~~~~\n```js\n// ┌────┐\n// └────┘\n```\n```text\njust prose\n```");
    const { diagrams } = await h.snapshot();
    assert.equal(diagrams.length, 2);
    assert.equal(diagrams[0].text, "Input --> Check\nCheck --> Output");
    assert.match(diagrams[1].text, /┌/);
  } finally { await h.cleanup(); }
});

test("Mermaid flowcharts render as boxes; unsupported and invalid charts retain their source", async () => {
  const h = await harness();
  try {
    await h.reply("```mermaid\nflowchart TD\n A[Login] --> B[Dashboard]\n```\n```mermaid\nsequenceDiagram\n A->>B: hello\n```\n```mermaid\nflowchart TD\n ???\n```");
    const { diagrams } = await h.snapshot();
    assert.equal(diagrams.length, 3);
    assert.match(diagrams[0].text, /┌/);
    assert.match(diagrams[0].text, /Dashboard/);
    assert.equal(diagrams[1].text, "sequenceDiagram\n A->>B: hello");
    assert.match(diagrams[2].text, /Could not render/);
    assert.match(diagrams[2].text, /flowchart TD\n \?\?\?/);
  } finally { await h.cleanup(); }
});
