import type { ExtensionAPI, ExtensionContext, MessageEndEvent } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { diagramsIn, renderDiagrams, type Diagram } from "./diagrams.js";

// USER SETTINGS: change these defaults here.
const DEFAULT_ENABLED = true;
const MAX_DIAGRAMS = 20;
const PI_SPLIT_RATIO = 0.61; // Pi left 61%, diagrams right 39%.

const viewer = fileURLToPath(new URL("./viewer.ts", import.meta.url));
const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

export default function (pi: ExtensionAPI) {
  const caller = process.env.HERDR_PANE_ID;
  const inHerdr = process.env.HERDR_ENV === "1" && Boolean(caller);
  const key = createHash("sha256").update(caller || "outside").digest("hex").slice(0, 16);
  const directory = join(tmpdir(), `pi-diagrams-${process.pid}-${key}`);
  const stateFile = join(directory, "state.json");
  let enabled = DEFAULT_ENABLED;
  let pane: string | undefined;
  let diagrams: Diagram[] = [];
  let queue = Promise.resolve();
  let timer: ReturnType<typeof setInterval> | undefined;
  let initialized = false;
  let pollPending = false;
  let lastWarning: string | undefined;

  async function atomicFile(name: string, value: unknown) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, name);
    await writeFile(`${path}.tmp`, JSON.stringify(value), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  }

  async function initialize() {
    if (initialized) return;
    try {
      const saved = JSON.parse(await readFile(join(directory, "owner.json"), "utf8"));
      if (typeof saved.enabled === "boolean") enabled = saved.enabled;
      if (typeof saved.pane === "string") pane = saved.pane;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    initialized = true;
  }

  const saveOwner = () => atomicFile("owner.json", { pane, enabled });

  async function herdr(args: string[]) {
    const result = await pi.exec("herdr", ["pane", ...args], { timeout: 5000 });
    if (result.code !== 0) {
      if (args[0] === "process-info" && /"code"\s*:\s*"pane_not_found"/.test(result.stderr)) return null;
      throw new Error(result.stderr || "Herdr command failed");
    }
    return result.stdout.trim() ? JSON.parse(result.stdout).result : {};
  }

  async function owned(): Promise<boolean> {
    if (!pane) return false;
    const info = await herdr(["process-info", "--pane", pane]);
    if (!info) return false;
    for (const candidate of info.process_info.foreground_processes as { pid: number; argv?: string[] }[]) {
      if (candidate.argv) {
        const args = candidate.argv;
        const stateIndex = args.indexOf("--state");
        const ownerIndex = args.indexOf("--owner");
        if (/^node(?:js)?$/i.test(basename(args[0] || "")) && args[1] === viewer &&
          stateIndex >= 0 && args[stateIndex + 1] === stateFile &&
          ownerIndex >= 0 && args[ownerIndex + 1] === String(process.pid)) return true;
      } else {
        // Older Herdr versions expose only a PID. Check its command as well.
        const result = await pi.exec("ps", ["-p", String(candidate.pid), "-o", "args="], { timeout: 2000 });
        const command = result.stdout.trim();
        const executables = [process.execPath, quote(process.execPath), JSON.stringify(process.execPath), "node", "nodejs"];
        const executable = executables.find(name => command.startsWith(`${name} `));
        const scripts = [viewer, quote(viewer), JSON.stringify(viewer)];
        const states = [stateFile, quote(stateFile), JSON.stringify(stateFile)];
        if (result.code === 0 && executable && scripts.some(script => states.some(state =>
          command.slice(executable.length + 1) === `${script} --state ${state} --owner ${process.pid}`))) return true;
      }
    }
    return false;
  }

  async function closePane() {
    if (pane && await owned()) await herdr(["close", pane]);
    pane = undefined;
  }

  async function checkPane() {
    if (!pane) return;
    const ownership = await owned();
    if (ownership === false) {
      pane = undefined;
      enabled = false;
      await saveOwner();
      return;
    }
    try {
      await readFile(join(directory, "close.json"));
      if (ownership) { await closePane(); enabled = false; await saveOwner(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async function publish(ctx: ExtensionContext, message?: MessageEndEvent["message"]) {
    await checkPane();
    const replies = ctx.sessionManager.getBranch()
      .filter(entry => entry.type === "message")
      .map(entry => entry.message);
    if (message) replies.push(message);
    const unique = new Map<string, Diagram>();
    for (const reply of replies) {
      if (reply.role !== "assistant" || ["aborted", "error", "length"].includes(reply.stopReason)) continue;
      const text = reply.content.filter(block => block.type === "text").map(block => block.text).join("\n");
      for (const diagram of diagramsIn(text)) {
        unique.delete(diagram.id);
        unique.set(diagram.id, diagram);
        if (unique.size > MAX_DIAGRAMS) unique.delete(unique.keys().next().value!);
      }
    }
    diagrams = await renderDiagrams([...unique.values()], diagrams);
    await atomicFile("state.json", { sessionId: ctx.sessionManager.getSessionId(), diagrams });
    if (enabled && diagrams.length && !pane) {
      await rm(join(directory, "ready.json"), { force: true });
      await rm(join(directory, "close.json"), { force: true });
      const result = await herdr(["split", "--pane", caller!, "--direction", "right", "--ratio", String(PI_SPLIT_RATIO), "--cwd", ctx.cwd, "--no-focus"]);
      pane = result.pane.pane_id;
      await saveOwner();
      try {
        await herdr(["run", pane!, `${quote(process.execPath)} ${quote(viewer)} --state ${quote(stateFile)} --owner ${process.pid}`]);
        await herdr(["wait-output", pane!, "--match", "PINNED DIAGRAMS", "--timeout", "4000"]);
      } catch (error) {
        enabled = false;
        await closePane();
        await saveOwner();
        throw error;
      }
    }
    await saveOwner();
  }

  function guarded(ctx: ExtensionContext, action: () => Promise<void>) {
    if (!inHerdr || ctx.mode !== "tui") return Promise.resolve();
    queue = queue.then(async () => {
      await initialize();
      await action();
      lastWarning = undefined;
    }).catch(error => {
      const warning = `Diagram viewer: ${String(error)}`;
      if (warning !== lastWarning) ctx.ui.notify(warning, "warning");
      lastWarning = warning;
    });
    return queue;
  }

  pi.on("session_start", async (_event, ctx) => {
    await guarded(ctx, () => publish(ctx));
    if (inHerdr && ctx.mode === "tui" && !timer) {
      timer = setInterval(() => {
        if (pollPending) return;
        pollPending = true;
        void guarded(ctx, checkPane).finally(() => { pollPending = false; });
      }, 1000);
      timer.unref();
    }
  });
  pi.on("session_tree", (_event, ctx) => guarded(ctx, () => publish(ctx)));
  pi.on("message_end", (event, ctx) => {
    if (event.message.role === "assistant") return guarded(ctx, () => publish(ctx, event.message));
  });
  pi.registerCommand("diagram", {
    description: "Toggle the Herdr diagram viewer",
    handler: async (_args, ctx) => {
      if (!inHerdr || ctx.mode !== "tui") {
        ctx.ui.notify("The diagram viewer requires Herdr and interactive Pi.", "info");
        return;
      }
      await guarded(ctx, async () => {
        await checkPane();
        enabled = !enabled;
        if (!enabled) await closePane();
        await publish(ctx);
        ctx.ui.notify(`Diagram viewer ${enabled ? "enabled" : "disabled"}.`, "info");
      });
    },
  });
  pi.on("session_shutdown", async (event, ctx) => {
    clearInterval(timer);
    timer = undefined;
    await guarded(ctx, async () => {
      if (event.reason !== "quit") {
        if (event.reason !== "reload") await atomicFile("state.json", { sessionId: "switching", diagrams: [] });
        await saveOwner();
        return;
      }
      await closePane();
      await rm(directory, { recursive: true, force: true });
    });
  });
}
