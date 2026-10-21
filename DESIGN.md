# Diagram pane design

## Agreed

- Use a separate Herdr pane beside Pi, not an overlay inside Pi.
- Keep the conversation readable without covering it with diagrams.
- The side-by-side sample viewer meets the user's layout expectations.
- Initially split the calling Pi pane with Pi on the left at 61% and the viewer on the right at 39%.
- Apply this ratio only when creating the pane. Preserve manual resizing afterward.
- First implement pinned diagrams captured from Pi's replies.
- Add an automatic work map only after the reply-diagram viewer works reliably.
- `/diagram` toggles automatic opening of the viewer when a reply contains a diagram.
- Start enabled. Put the initial setting in a clearly marked code constant so the user can change it to disabled later.
- Disabling with `/diagram` closes the extension's viewer pane and returns the space to Pi, while retaining captured diagrams for re-enabling.
- Support Mermaid flowcharts and ASCII diagrams from replies. Render Mermaid flowcharts as boxes and arrows, preserve ASCII diagrams as written, and show unsupported Mermaid types as source text.
- Automatically show newly captured diagrams, keeping older diagrams accessible through previous/next controls.
- Capture diagrams only after an assistant reply completes, not while it streams.
- Restore captured diagrams from the active session's conversation history on restart or resume. Keep diagrams from different sessions separate.
- Keep the 20 most recent diagrams, controlled by a clearly marked `MAX_DIAGRAMS = 20` constant.
- The first viewer is read-only: previous/next diagram, scrolling, and closing. No diagram editing or opening boxes for more detail.
- Manually closing the viewer disables automatic reopening until `/diagram` enables it again.
- Outside Herdr, leave replies unchanged. `/diagram` explains that the viewer requires Herdr; do not fall back to an overlay.
- On Pi exit, close the extension-created pane only if it still runs this extension's viewer. Leave panes repurposed for another process alone.
- On session switches, reuse an existing viewer pane but replace its contents with only the new session's diagrams. Show an empty state if that session has none.

## Additional agreed behavior

- Continue capturing diagrams while disabled, without opening the viewer.
- Keep identical diagram content only once.
- Restore and show diagrams only from the active conversation branch.
- Support vertical and horizontal scrolling. Do not wrap ASCII art.
- If rendering fails, show the original source with an error notice; do not interrupt Pi.
- Keep keyboard focus in Pi when opening or updating the viewer.

## Status

The user confirmed the design and adopted the additional defaults above. The reply-diagram viewer is implemented in TypeScript, including its standalone terminal process and tests; Python is not required. The automatic work map remains deferred.

## Validation

- Test through Pi extension events and `/diagram`: capture, deduplication, active-branch history, toggling, and pane lifecycle.
- Test through viewer snapshot/key input and rendered output: navigation, scrolling, Unicode width handling, and session replacement.
- Use a separate explicit live Herdr check for actual splitting, focus, updates, resizing, navigation, and ownership-checked cleanup.

The earlier static demos have been replaced by the viewer.
