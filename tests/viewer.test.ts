import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { Viewer } from "../viewer.js";

test("viewer selects newest, navigates, and clears a replaced session", () => {
  const viewer = new Viewer();
  viewer.update({ sessionId: "a", diagrams: [
    { id: "one", title: "First", text: "OLDER" },
    { id: "two", title: "Second", text: "NEWER" },
  ] });
  assert.match(viewer.render(60, 12).join("\n"), /NEWER/);
  viewer.handleInput("p");
  assert.match(viewer.render(60, 12).join("\n"), /OLDER/);
  viewer.handleInput("n");
  assert.match(viewer.render(60, 12).join("\n"), /NEWER/);
  viewer.update({ sessionId: "b", diagrams: [] });
  const output = viewer.render(60, 12).join("\n");
  assert.match(output, /No diagrams/);
  assert.doesNotMatch(output, /NEWER/);
});

test("viewer scrolls without wrapping, strips controls, and requests closure", () => {
  let closed = false;
  const viewer = new Viewer(() => 7, () => { closed = true; });
  viewer.update({ sessionId: "a", diagrams: [
    { id: "one", title: "Title", text: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ\nsecond\nthird\nfourth\nfifth\nsixth\n\x1b[2JSAFE" },
  ] });
  assert.equal(viewer.render(10, 7)[3], "0123456789");
  viewer.handleInput("\x1b[C");
  assert.equal(viewer.render(10, 7)[3], "456789ABCD");
  viewer.handleInput("\x1b[H");
  viewer.handleInput("\x1b[6~");
  assert.equal(viewer.render(10, 7)[3], "fourth");
  for (let n = 0; n < 20; n++) viewer.handleInput("\x1b[B");
  assert.match(viewer.render(10, 7).join("\n"), /SAFE/);
  assert.doesNotMatch(viewer.render(10, 7).join("\n"), /\x1b/);
  viewer.handleInput("q");
  assert(closed);
});

test("preserves leading and repeated tab stops without allowing title line breaks", () => {
  const viewer = new Viewer();
  viewer.update({ sessionId: "a", diagrams: [
    { id: "one", title: "Title\n\x1b[2Jsafe", text: "\t\tBox\nA\tB" },
  ] });
  const lines = viewer.render(30, 10);
  assert.equal(lines[1], "1/1 · Title safe");
  assert.equal(lines[3], "        Box");
  assert.equal(lines[4], "A   B");
});

test("wide characters, emoji, combining marks and tiny terminal sizes fit", () => {
  const viewer = new Viewer();
  viewer.update({ sessionId: "a", diagrams: [
    { id: "one", title: "中文", text: "甲乙丙丁戊己 e\u0301 👩‍💻" },
  ] });
  for (const width of [1, 2, 5, 30]) {
    for (const height of [1, 3, 10]) {
      viewer.handleInput("\x1b[C");
      const lines = viewer.render(width, height);
      assert(lines.length <= height);
      assert(lines.every(line => visibleWidth(line) <= width));
    }
  }
});
