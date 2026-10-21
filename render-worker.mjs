// Runs outside Pi's event loop; the parent limits batch size, memory, and time.
import { parentPort, workerData } from "node:worker_threads";
import { renderMermaidASCII } from "beautiful-mermaid";

let totalBytes = 0;
for (const { id, source } of workerData) {
  try {
    const text = renderMermaidASCII(source);
    const bytes = Buffer.byteLength(text);
    if (!text.trim()) throw new Error("no flowchart nodes found");
    if (bytes > 1_000_000 || totalBytes + bytes > 2_000_000) {
      throw new Error("rendered diagram exceeds the output limit");
    }
    totalBytes += bytes;
    parentPort.postMessage({ id, text });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error) });
  }
}
