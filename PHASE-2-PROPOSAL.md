# Phase 2 proposal: live work map

## Status: deferred, not approved for implementation

The user wants to use the implemented reply-diagram viewer before deciding whether to build phase 2. Save this proposal so planning can resume if and when they choose. Do not treat this document as permission to implement it.

Phase 1 is implemented in TypeScript. See DESIGN.md for its agreed behavior. Phase 2 remains a proposal; the choices below are recommendations, not agreed requirements.

## Goal and proposed experience

Keep a diagram of the current task beside Pi, updating during work rather than waiting for a completed reply.

- Show the current goal, connected work steps and pending/active/done/blocked status.
- Update when substantial work starts, a step starts or finishes, the approach changes, a blocker appears or the task finishes.
- Keep one evolving map per active conversation branch, separate from the latest 20 unique reply diagrams. Do not add every map revision to reply history.
- Provide Work and Replies views and an explicit return-to-live action. Live updates must not change a browsed reply or its scroll position. Preserve existing newest-reply selection within Replies.
- Retain accepted progress after interruption and label the run interrupted. A response ending does not prove the task is complete.
- No map editing, map-history browser, extra pane or second model in the proposed first version.

## Recommended update mechanism

Register an `update_work_map` tool accepting a bounded replacement snapshot:

- Task title.
- Stable node IDs, short labels and statuses.
- Dependency edges referring to valid node IDs.

Add concise guidance before each agent run about when to publish updates, together with the latest map as context. The assistant calls the tool to report meaningful progress. This depends on model cooperation; it does not guarantee an update after every event. Do not inspect private thinking or parse partial streamed Mermaid.

Validate IDs, references, statuses, sizes and labels before accepting an update. Store versioned snapshots in successful tool-result details. Restore from the active conversation branch, ignoring failed results, malformed details and unexecuted tool-call arguments. Record lifecycle information separately so interruption can also be restored.

Accept updates without waiting for rendering, pane creation or Herdr commands. Coalesce pending renders and discard outdated results using branch/session generation and snapshot revision. Generate escaped Mermaid from the structured map and reuse the existing isolated renderer, bounds and source fallback.

During planning, the installed Pi extension documentation, API declarations and todo example were checked for `pi.registerTool()`, sequential execution, `before_agent_start`, `event.systemPromptOptions.promptGuidelines`, `ctx.sessionManager.getBranch()`, session events and `agent_before_settle` outcomes. Recheck these APIs against the installed Pi version before implementation.

## Preserve phase 1

Reuse the existing TypeScript viewer, snapshot file, Herdr pane and ownership checks.

- Initial Pi/viewer split remains 61/39; preserve subsequent manual resizing.
- Opening or updating must not move keyboard focus.
- `/diagram` continues to control viewing; disabled viewing still records accepted updates.
- Manual closure suppresses reopening until explicitly enabled again.
- Clear old map state on session/branch changes, reject stale asynchronous results and reuse the owned viewer pane.
- Outside interactive Herdr, do not attempt pane operations.
- Rendering or viewer failures must not interrupt Pi.

## Open decisions

1. **Update frequency:** are meaningful milestones sufficient, or should the display change after every tool call? Milestones are recommended to avoid a command log. The user has not answered this question.
2. **Default view:** when should Work become active automatically, and how should a newly captured reply diagram interact with that selection? Keep history browsing stable in either case.
3. **Task boundaries:** how should the assistant distinguish a new task from continuation of the existing map?

Resolve these before treating the proposal as an implementation specification. Do not infer approval from the earlier decision to defer phase 2 until phase 1 was reliable.

## Proposed implementation sequence

1. Agree on the open decisions and record the resulting requirements.
2. Add failing tests for a pure map model, validation, branch restoration and deterministic Mermaid generation.
3. Implement the publishing tool, concise guidance and separation between accepted state and asynchronous presentation.
4. Extend viewer snapshots and Work/Replies navigation without disrupting existing reply history.
5. Add lifecycle and regression coverage, review the changes and update documentation.
6. Run automated tests and typecheck. Arrange a live Herdr check when implementation is authorized, then commit only the relevant changes.

Likely files:

- `work-map.ts` (new): model, validation, restoration and diagram generation.
- `index.ts`: tool registration, guidance, lifecycle and publication.
- `viewer.ts`: live/reply selection and independent scrolling.
- `tests/extension.test.ts`, `tests/viewer.test.ts` and new map tests.

## Verification checklist

- Reject duplicate IDs, invalid edges, oversized snapshots and unsafe labels; escape Mermaid syntax.
- Restore only accepted updates on the active branch; isolate sessions and empty destinations.
- Tool completion does not wait for a stalled renderer or Herdr command.
- Rapid updates coalesce; outdated render results cannot replace newer/session-local state.
- Live updates preserve a browsed reply and its scroll position.
- Disabled recording, manual-close suppression, reload, abort/resume and ownership-checked cleanup still work.
- Preserve focus, creation-only ratio and manual resizing in a separately run live check.

## Saved visual draft

The browser review was ended by the user. Its HTML remains at `.lavish/diagram-pane-phase-2.html`, relative to the Pi agent directory. This Markdown proposal is the durable continuation note. Do not reopen the review session without a request.
