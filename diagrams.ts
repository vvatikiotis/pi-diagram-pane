import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";

export interface Diagram {
  id: string;
  title: string;
  kind: "ascii" | "mermaid";
  source: string;
  text: string;
}

export function* diagramsIn(markdown: string): Generator<Diagram> {
  markdown = markdown.replace(/\r\n/g, "\n");
  const fences = /^ {0,3}(`{3,}|~{3,})([^\n]*)\n/gm;
  let match: RegExpExecArray | null;
  while ((match = fences.exec(markdown))) {
    const closing = new RegExp(`^ {0,3}${match[1]![0]}{${match[1]!.length},}[ \\t]*$`, "gm");
    closing.lastIndex = fences.lastIndex;
    const end = closing.exec(markdown);
    if (!end) break; // Incomplete streamed/aborted fence is not a diagram.
    const source = markdown.slice(fences.lastIndex, end.index).replace(/\n$/, "");
    fences.lastIndex = closing.lastIndex;
    const language = match[2]!.trim().split(/\s/)[0]!.toLowerCase();
    const lines = source.split("\n");
    const boxes = lines.filter(line => /[┌┐└┘╭╮╰╯╔╗╚╝]|\+[-=]{3,}/.test(line)).length >= 2;
    const arrows = lines.length <= 40 && lines.filter(line => /--+>|──+[>▶]|[→▼↓]/.test(line)).length >= 2;
    const ascii = /^(text|txt|ascii|plain|diagram|art)?$/.test(language) && (boxes || arrows);
    if (!ascii && language !== "mermaid") continue;
    const before = markdown.slice(0, match.index).trimEnd().split("\n").slice(-3).reverse()
      .find(line => /^\s*#+\s|:\s*$/.test(line)) || "Diagram";
    yield {
      id: createHash("sha256").update(source).digest("hex"),
      title: before.replace(/^#+\s*/, "").replace(/:$/, "").slice(0, 80),
      kind: language === "mermaid" ? "mermaid" : "ascii", source, text: source,
    };
  }
}

// Render only retained, uncached flowcharts. One bounded worker batch keeps
// Mermaid parsing/layout off Pi's event loop, including malformed input.
export async function renderDiagrams(diagrams: Diagram[], previous: Diagram[]): Promise<Diagram[]> {
  const cache = new Map(previous.map(diagram => [`${diagram.kind}:${diagram.id}`, diagram.text]));
  const output = diagrams.map(diagram => ({ ...diagram, text: cache.get(`${diagram.kind}:${diagram.id}`) ?? diagram.source }));
  const pending: Diagram[] = [];
  for (const diagram of output) {
    if (cache.has(`${diagram.kind}:${diagram.id}`) || diagram.kind !== "mermaid" || !/^(graph|flowchart)\b/i.test(diagram.source.trimStart())) continue;
    if (diagram.source.length > 20000 || diagram.source.split("\n").length > 200) {
      diagram.text = `Could not render diagram: chart exceeds the rendering limit\n\n${diagram.source}`;
    } else pending.push(diagram);
  }
  if (!pending.length) return output;
  await new Promise<void>(resolve => {
    const results = new Map<string, { text?: string; error?: string }>();
    const worker = new Worker(new URL("./render-worker.mjs", import.meta.url), {
      workerData: pending.map(({ id, source }) => ({ id, source })),
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    let finished = false;
    const finish = (reason: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      for (const diagram of pending) {
        const result = results.get(diagram.id);
        diagram.text = result?.text || `Could not render diagram: ${result?.error || reason}\n\n${diagram.source}`;
      }
      void worker.terminate();
      resolve();
    };
    const timeout = setTimeout(() => finish("rendering timed out"), 3000);
    worker.on("message", (result: { id: string; text?: string; error?: string }) => {
      results.set(result.id, result);
      if (results.size === pending.length) finish("");
    });
    worker.on("error", error => finish(error.message));
    worker.on("exit", () => finish("renderer exited"));
  });
  return output;
}
