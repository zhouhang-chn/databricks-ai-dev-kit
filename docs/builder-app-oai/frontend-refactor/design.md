# Data Agent Frontend Refactor Design

## Summary

`databricks-builder-app-oai` should evolve from a chat-centered builder UI into
an analysis workspace whose center object is an `AnalysisStory`. The referenced
PDF argues that a data agent should not be "chat plus charts"; each agent answer
should become a reusable, inspectable mini analysis story with conclusion,
evidence, trace, next moves, and context.

This design applies that architecture to the current OAI Builder App without
breaking the existing FastAPI/SSE contract. The first refactor slice keeps
conversations, messages, executions, and project settings intact, but introduces
a frontend Story / Canvas layer and Right Inspect surface that can later absorb
charts, filters, saved stories, dashboards, and object-level AI.

## Source Principles From The PDF

- BI provides the stable skeleton: governed metrics, filters, dashboards,
  reproducibility, sharing, and auditability.
- The agent reduces friction around discovery, explanation, drill-down,
  validation, and asset creation.
- The page center should move from a message list to `StoryCard` objects.
- Layout should follow a stable shell:
  - left rail: navigation and saved assets
  - center canvas: questions, stories, evidence, next moves, composer
  - right inspect: filters, trace, evidence, metadata, artifacts
- Frontend state should separate workspace/story state, conversation state, and
  UI state.
- Components should emit typed analysis actions/events instead of directly
  orchestrating SQL or backend execution.

## Target Architecture

```text
App Shell
  - routing, auth, layout, navigation

AI Surface
  - global composer
  - object-level follow-up actions
  - user-preview role switch

Story / Canvas Layer
  - AnalysisStory
  - StoryCard
  - EvidenceBlock
  - Trace
  - NextMoves

Application State
  - workspace/story state
  - conversation/message state
  - UI/inspect state

Event Bus / Controller
  - typed AnalysisEvent reducer
  - SSE event to AnalysisEvent adapter
  - user next-move to prompt/action adapter

Runtime Boundary
  - existing invoke_agent and stream_progress APIs
  - future RunAnalysisRequest API can be added without changing StoryCard
```

## Frontend Object Model

```ts
type AnalysisStory = {
  id: string
  conversationId?: string
  question: string
  status: "planning" | "running" | "done" | "error"
  conclusion?: string
  evidence: EvidenceBlock[]
  trace: AnalysisStep[]
  nextMoves: NextMove[]
  context: AnalysisContext
  createdAt: string
  updatedAt: string
}

type EvidenceBlock = {
  id: string
  type: "text" | "table" | "chart" | "tool_result" | "error"
  title: string
  content: string
  isError?: boolean
}

type AnalysisStep = {
  id: string
  label: string
  status: "running" | "done" | "error"
  detail?: string
}

type NextMove = {
  id: string
  label: string
  prompt: string
  actionType: "drill" | "compare" | "validate" | "explain" | "pivot"
}
```

The current backend still persists chat messages. The frontend can derive
initial stories from message pairs, then update live stories from SSE events.
That makes the refactor reversible and avoids a backend migration for the first
slice.

## Component Boundaries

```text
ProjectPage
  - owns API calls and SSE lifecycle for now
  - maps messages/SSE events into AnalysisStory state

features/analysis/
  types.ts
  storyTransforms.ts
  components/
    StoryCanvas.tsx
    StoryCard.tsx
    RightInspectPanel.tsx
```

`StoryCard` displays an analysis object. It must not call backend APIs.

`StoryCanvas` owns ordering, active-story selection, and empty/running states.

`RightInspectPanel` shows trace, evidence, context, and artifacts for the active
story. It is not a second chat stream.

`ProjectPage` remains the temporary controller because it already owns streaming,
conversation selection, reconnect, and stop behavior. Later phases should move
that controller into a hook.

## Event Mapping

Existing SSE events are mapped into story events:

| SSE event | Story update |
|-----------|--------------|
| `conversation.created` | attach conversation ID to active running story |
| `text_delta` | append to story conclusion |
| `text` | append a complete conclusion block |
| `tool_use` | append running trace step |
| `tool_result` | mark trace done and append evidence block |
| `thinking` | append trace detail |
| `todos` | convert to next moves when possible |
| `result` | mark story done |
| `error` | mark story error and append error evidence |

## UX Shape

Desktop:

- Existing left rail remains for conversations and skills.
- Center becomes StoryCanvas.
- Right Inspect is visible on large screens and collapses naturally on smaller
  widths.
- Composer stays below the center canvas.
- Header keeps resource chips, project-management controls, and role switch.

Mobile:

- StoryCanvas remains the main view.
- Right Inspect can later become a sheet; first slice hides it below large
  breakpoints.

## Migration Strategy

1. Add story types and reducers.
2. Add StoryCanvas, StoryCard, and RightInspectPanel.
3. Derive stories from persisted messages on conversation load.
4. Create a running story when a prompt is sent.
5. Update running story from current SSE events.
6. Preserve message persistence and existing reconnect behavior.
7. Later, add backend-native story persistence and RunAnalysis APIs.

## Non-Goals For This Slice

- No charting library selection.
- No new backend persistence tables.
- No dashboard composer.
- No drag-and-drop canvas.
- No object-level AI beyond next-move prompt buttons.
- No replacement of existing conversation/execution APIs.

## Follow-Up Architecture Work

- Extract ProjectPage streaming controller into `useAgentRunController`.
- Add a persistent `stories` table or store stories in execution/message
  metadata.
- Add typed backend `RunAnalysisRequest` and `AnalysisEvent` stream.
- Add chart/table evidence renderers.
- Add saved stories and dashboard composer.
- Add inspect sheet for mobile.
- Add analytics for next-move clicks, abandoned runs, and story saves.
