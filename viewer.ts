// Standalone terminal viewer, launched in its own Herdr pane (not inside Pi's TUI).
import { ProcessTerminal, TuiAltScreen, matchesKey, sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import { realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, stripVTControlCharacters } from "node:util";

interface Snapshot {
  sessionId: string;
  diagrams: { id: string; title: string; text: string }[];
}

function clean(text: string): string {
  return stripVTControlCharacters(text)
    .replace(/[\p{Cc}\p{Cs}]/gu, char => char === "\n" || char === "\t" ? char : "")
    .split("\n").map(line => {
      return line.split("\t").reduce((expanded, part, index) =>
        expanded + (index ? " ".repeat(4 - visibleWidth(expanded) % 4) : "") + part, "");
    }).join("\n");
}

export class Viewer {
  private session: string | undefined;
  private diagrams: Snapshot["diagrams"] = [];
  private index = 0;
  private x = 0;
  private y = 0;
  private closing = false;
  private height: () => number;
  private onClose: () => void;

  constructor(height: () => number = () => 24, onClose: () => void = () => {}) {
    this.height = height;
    this.onClose = onClose;
  }

  update(snapshot: Snapshot): void {
    if (this.session !== snapshot.sessionId ||
      this.diagrams.map(d => d.id).join("\0") !== snapshot.diagrams.map(d => d.id).join("\0")) {
      this.index = Math.max(0, snapshot.diagrams.length - 1);
      this.x = this.y = 0;
    }
    this.session = snapshot.sessionId;
    this.diagrams = snapshot.diagrams;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "q") || matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      if (!this.closing) { this.closing = true; this.onClose(); }
    } else if ((matchesKey(data, "p") || matchesKey(data, "n")) && this.diagrams.length) {
      this.index = (this.index + (matchesKey(data, "n") ? 1 : -1) + this.diagrams.length) % this.diagrams.length;
      this.x = this.y = 0;
    } else if (matchesKey(data, "up") || matchesKey(data, "k")) this.y = Math.max(0, this.y - 1);
    else if (matchesKey(data, "down") || matchesKey(data, "j")) this.y++;
    else if (matchesKey(data, "left")) this.x = Math.max(0, this.x - 4);
    else if (matchesKey(data, "right")) this.x += 4;
    else if (matchesKey(data, "pageUp")) this.y = Math.max(0, this.y - Math.max(1, this.height() - 4));
    else if (matchesKey(data, "pageDown")) this.y += Math.max(1, this.height() - 4);
    else if (matchesKey(data, "home")) this.x = this.y = 0;
  }

  invalidate(): void {}

  render(width: number, height = this.height()): string[] {
    if (width <= 0 || height <= 0) return [];
    const bodyHeight = Math.max(0, height - 4);
    const diagram = this.diagrams[this.index];
    const title = diagram ? `${this.index + 1}/${this.diagrams.length} · ${clean(diagram.title).replaceAll("\n", " ")}` : "No diagrams yet";
    const lines = clean(diagram?.text ?? "Diagrams from completed replies appear here.").split("\n");
    this.y = Math.min(this.y, Math.max(0, lines.length - bodyHeight));
    this.x = Math.min(this.x, Math.max(0, lines.reduce((longest, line) => Math.max(longest, visibleWidth(line)), 0) - width));
    const body = lines.slice(this.y, this.y + bodyHeight).map(line => sliceByColumn(line, this.x, width, true));
    while (body.length < bodyHeight) body.push("");
    const footer = this.closing ? "Closing viewer..." : "p/n previous/next · arrows scroll · q close";
    return ["PINNED DIAGRAMS", title, "", ...body, footer].slice(0, height)
      .map(line => sliceByColumn(line, 0, width, true));
  }
}

async function run(stateFile: string, owner: number): Promise<void> {
  const terminal = new ProcessTerminal();
  const tui = new TuiAltScreen(terminal, false, undefined, { mouse: false });
  let previous: string | undefined;
  let polling = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval>;
  await new Promise<void>((done, fail) => {
    const stop = (error?: unknown) => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.off(signal, shutdown);
      const finish = async () => {
        try { await terminal.drainInput(); }
        finally { tui.stop(); process.stdin.pause(); }
      };
      void finish().then(() => { if (error) fail(error); else done(); }, fail);
    };
    const shutdown = () => stop();
    const viewer = new Viewer(() => terminal.rows, () => {
      void writeFile(join(dirname(stateFile), "close.json"), JSON.stringify({ pid: process.pid }), { mode: 0o600 }).catch(stop);
    });
    tui.addChild(viewer);
    tui.setLayoutRoot(viewer);
    tui.setFocus(viewer);
    const poll = async () => {
      if (polling || stopped) return;
      polling = true;
      try {
        try { process.kill(owner, 0); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") { stop(); return; }
          throw error;
        }
        const snapshot = await readFile(stateFile, "utf8");
        if (stopped) return;
        if (snapshot !== previous) {
          viewer.update(JSON.parse(snapshot));
          previous = snapshot;
          tui.requestRender();
        }
      } catch (error) {
        if (!(error instanceof SyntaxError)) stop(error);
      } finally { polling = false; }
    };
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, shutdown);
    try {
      tui.start();
      timer = setInterval(() => { void poll(); }, 200);
      void poll();
    } catch (error) { stop(error); }
  });
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const { values } = parseArgs({ options: { state: { type: "string" }, owner: { type: "string" } } });
  const owner = Number(values.owner);
  if (!values.state || !Number.isSafeInteger(owner) || owner <= 0) throw new Error("Expected --state <file> --owner <pid>");
  await run(values.state, owner);
}
