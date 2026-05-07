# Data Agent Frontend Refactor Action Plan

## Purpose

This plan applies the design in [`design.md`](design.md) to
`databricks-builder-app-oai`, using
[`../refer/data_agent_frontend_design_architecture_v3.pdf`](../refer/data_agent_frontend_design_architecture_v3.pdf)
as the source architecture reference.

## Progress Snapshot

Last updated: 2026-05-07.

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0: Design Grounding | Complete | PDF principles mapped to the OAI Builder App architecture. |
| Phase 1: Story Object Foundation | Complete | Added typed AnalysisStory, EvidenceBlock, Trace, NextMove, stream adapters, and reducers. |
| Phase 2: Story Canvas UI | Complete | Replaced the message-list center with StoryCanvas while preserving chat persistence and streaming controls. |
| Phase 3: Right Inspect Surface | Complete | Added trace/evidence/context panel for the active story on large screens. |
| Phase 4: Runtime Boundary Cleanup | Pending | Extract streaming controller from ProjectPage into hooks/controllers. |
| Phase 5: Object-Level AI Actions | Pending | Convert next moves and evidence actions into typed AnalysisAction events. |
| Phase 6: Saved Stories And Dashboard Path | Pending | Add saved story and pin-to-canvas flows. |
| Phase 7: Performance And Mobile | Pending | Virtualize large story lists and add mobile inspect sheet. |

## Phase 0: Design Grounding

Tasks:

- Extract the PDF's product object model and shell layout.
- Record design decisions and non-goals.
- Keep implementation compatible with the existing SSE and message APIs.

Acceptance gates:

- A design doc exists and names the frontend layers.
- The first implementation slice is explicitly scoped.

## Phase 1: Story Object Foundation

Tasks:

- Add `features/analysis/types.ts`.
- Add `features/analysis/storyTransforms.ts`.
- Define `AnalysisStory`, `EvidenceBlock`, `AnalysisStep`, `NextMove`,
  `AnalysisContext`, and `AnalysisEvent`.
- Add helpers to derive stories from persisted chat messages.
- Add helpers to update a running story from SSE events.

Acceptance gates:

- Persisted conversations can be rendered as stories without backend changes.
- Streaming events can update one active story deterministically.

## Phase 2: Story Canvas UI

Tasks:

- Add `StoryCard`.
- Add `StoryCanvas`.
- Use StoryCanvas as the center workspace in `ProjectPage`.
- Keep the existing composer and stop/reconnect behavior.
- Convert next-move clicks into composer prompts.

Acceptance gates:

- A user prompt immediately creates a running StoryCard.
- Assistant text appears as story conclusion.
- Tool calls/results appear as trace/evidence.
- Existing saved conversations still show useful story cards.

## Phase 3: Right Inspect Surface

Tasks:

- Add `RightInspectPanel`.
- Show active story trace, evidence, context, and next moves.
- Keep it read-only and separate from the composer.
- Hide or collapse it on narrower screens.

Acceptance gates:

- Selecting a story updates the inspect panel.
- Trace and evidence are visible without expanding the story body.

## Phase 4: Runtime Boundary Cleanup

Tasks:

- Extract SSE lifecycle from `ProjectPage` into a hook.
- Keep the hook API story/event oriented.
- Keep backend calls isolated in `lib/api.ts`.

Acceptance gates:

- `ProjectPage` becomes primarily composition and state wiring.
- Agent runtime changes do not require editing StoryCard.

## Phase 5: Object-Level AI Actions

Tasks:

- Add typed `AnalysisAction`.
- Convert Next Moves into action events.
- Add evidence-level actions such as explain, validate, drill, compare.

Acceptance gates:

- Agent-suggested actions and user-clicked actions use the same type system.
- Action events can be logged for feedback/evaluation.

## Phase 6: Saved Stories And Dashboard Path

Tasks:

- Add save story action.
- Add pin story to canvas.
- Add dashboard draft object from selected stories.

Acceptance gates:

- A story can become a reusable asset.
- Multiple stories can be grouped for a dashboard path.

## Phase 7: Performance And Mobile

Tasks:

- Virtualize long story lists.
- Lazy-render heavy evidence blocks.
- Add mobile inspect sheet.
- Add skeleton states for slow agent runs.

Acceptance gates:

- Large conversations remain responsive.
- Mobile keeps the same center-canvas and inspect mental model.

## Validation

```bash
cd databricks-builder-app-oai/client
pnpm lint
pnpm build:typecheck
```
