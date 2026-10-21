# Diagram pane for Pi

Keeps diagrams from completed Pi replies in a separate Herdr pane. Pi starts with 61% of the current pane's width on the left; the viewer gets 39% on the right. Later manual resizing is preserved.

## Setup

Requires interactive Pi inside Herdr and Node.js 22.19 or newer (the same minimum as Pi). No Python is needed. The TypeScript viewer runs as a separate Node process using Pi's terminal UI library.

From this directory:

```sh
npm ci
```

Pi discovers this directory's `index.ts` automatically in your personal extensions directory. Run `/reload` in Pi after installation or code changes.

When upgrading from the Python viewer, close the old viewer with `/diagram` before `/reload`, then run `/diagram` again to enable the TypeScript viewer. This avoids leaving the old process in its pane.

## Use

Viewing starts enabled. The first captured diagram opens the pane without changing keyboard focus.

- `/diagram` disables viewing and closes the viewer, or enables it again.
- Capture continues while viewing is disabled.
- Focus the viewer to use its controls:
  - `p` / `n`: previous / next diagram (wraps around).
  - Arrow keys: scroll vertically or horizontally; `j` / `k` also scroll vertically.
  - Page Up / Page Down: scroll a page; Home: return to the top-left.
  - `q` or Esc: close the viewer and disable reopening until `/diagram`.

New diagrams become the current selection. Repeated content is kept only once, at its most recent position. The newest 20 unique diagrams are available from the active conversation branch. Session switches replace the contents, reusing the pane if it is still running our viewer. Restarting Pi restores diagrams from the conversation history, not a separate diagram archive.

ASCII diagrams are preserved without wrapping. Mermaid `graph` and `flowchart` blocks render as terminal boxes and arrows using `beautiful-mermaid`. Other Mermaid types stay as source text. Rendering errors show a notice followed by the original source. The renderer supports a subset of Mermaid syntax; flowcharts above 20,000 characters or 200 lines fall back to source. Only retained diagrams are rendered, with cached results reused. Layout runs in a worker with a 3-second batch timeout, a 128 MiB heap limit, and bounded rendered output, so a slow or malformed chart cannot block Pi's event loop. Original ASCII and source text are preserved.

The extension leaves replies unchanged. Outside Herdr, `/diagram` explains the requirement rather than opening an overlay. Pi exit closes only a pane still running the extension's viewer. Reusing that pane for another process prevents the extension from closing it.

The earlier `/diagram-demo` overlay has been replaced. If an old loaded overlay is still visible, toggle it off with `/diagram-demo` before `/reload`.

## Defaults

Clearly marked near the top of `index.ts`:

```ts
const DEFAULT_ENABLED = true;
const MAX_DIAGRAMS = 20;
const PI_SPLIT_RATIO = 0.61;
```

Changes take effect after `/reload`, except the enabled/disabled toggle is preserved across reloads and session switches within the same Pi process. Restart Pi to apply a changed `DEFAULT_ENABLED`.

## Checks

```sh
npm run typecheck
npm test
```

For an explicit live integration check inside Herdr:

```sh
npm run test:live
```

This temporarily creates its own diagram pane and checks rendering, updates, navigation, focus, manual resizing, and closing. It does not close pre-existing panes.

The automatic work map, diagram editing, and opening boxes for detail are deferred. See `DESIGN.md` for the agreed behavior.
