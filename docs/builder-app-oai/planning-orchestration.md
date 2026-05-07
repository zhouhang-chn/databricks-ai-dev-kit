# Analysis Planning & Orchestration

## Why this doc was rewritten

The first iteration of this design instructed the agent to emit a `__plan__`
JSON markdown block before tools, and asked it to thread a `step_id` argument
through every subsequent tool call. The frontend parsed the markdown into a
`PlanStep[]`, then rendered a separate flat "Execution Activity" feed of
tool_use / tool_result events.

In practice that produced exactly the failure mode it was supposed to prevent:

- Plan steps were write-once and frozen — `storyTransforms.ts` parsed the
  block into `status: 'pending'` steps and never mutated them, so the checkboxes
  were decorative.
- No tool→step link existed — the system prompt never asked for `step_id`,
  the `tool_use` reducer had no field for it, and `PlanStep.toolCalls` stayed
  empty forever.
- Re-planning was silently dropped — only the first `__plan__` block was
  parsed, so any pivot was invisible to the user.
- The "Execution Activity" rows were tool names (`read_project_file`,
  `execute_sql`) repeated N times with raw payloads dumped inline. There was no
  narrative, no grouping, no findings — just a noisy chronological feed.

The lesson: **parsing prose for structure is fragile, and a static plan next to
a flat activity stream is not a plan — it's a relabeled trace.** This doc
replaces that contract with one driven by explicit tool calls and renders the
plan itself as the primary surface, with tool calls grouped under each step.

## Reference: deep-research UIs

OpenAI Deep Research, Perplexity Pro, and Claude's research mode share three
properties this design adopts:

1. **Step = narrative, not tool.** Each row is "Comparing Q3 EU vs NA
   revenue", written by the model in the user's language. Tool calls are
   nested under the step, collapsed by default.
2. **Exactly one step is `running` at a time** with a live "thinking" line.
   Finished steps collapse to a one-line finding ("Found 12 anomaly days, all
   in week 38").
3. **The plan revises itself in place.** When the model pivots, the user sees
   the new plan replace the old one with an explicit "revised" marker — not a
   stale checklist next to a noisy feed.

## Lifecycle

We keep the five conceptual phases (**Discovery → Plan → Proceed → Track →
Synthesis**) from the original design, but only Plan, Proceed, Track, and
Synthesis are enforced by the runtime. Discovery is implicit: it's the time
before the first `update_plan(op="create")` call.

| Phase     | What happens                                                          | UI state                                |
|-----------|-----------------------------------------------------------------------|-----------------------------------------|
| Discovery | Agent reads `AGENTS.md`, lists tables, asks clarifying questions      | Spinner: "Scoping the work…"            |
| Plan      | Agent calls `update_plan(op="create", objective, steps=[...])`       | Stepper appears with all steps `pending`|
| Proceed   | Agent calls `update_plan(op="start", step_id, narrative)` + tool work | Step `running` with live narrative      |
| Track     | Tool calls between `start` and `finish` auto-attach to active step    | Tools collapsed under step              |
| Synthesis | Agent calls `submit_conclusion(summary, highlights[])`                | Stepper collapses, conclusion replaces  |

Discovery is *time-bounded by the first `update_plan` call*, not gated. If the
agent calls `update_plan(op="create")` immediately, discovery is a no-op. If
the agent does some lightweight reads first (e.g. `get_project_tree`,
`read_project_file`), those are recorded but rendered as a discreet "context
loaded" footer, not as plan steps.

## Model contract

Two new app-owned tools replace the markdown-parsing contract.

### `update_plan`

A single tool with four operations encodes every transition the UI needs:

```python
update_plan(
    op: Literal["create", "start", "finish", "revise"],
    *,
    # create / revise:
    objective: str | None = None,
    steps: list[{"id": str, "title": str}] | None = None,
    reason: str | None = None,         # revise only — why we're pivoting
    # start:
    step_id: str | None = None,
    narrative: str | None = None,      # what I'm about to do, in the user's language
    # finish:
    finding: str | None = None,        # one-line summary of what I learned
    status: Literal["done", "failed"] = "done",
)
```

Why a tool, not a JSON marker:

- It's a discrete event the runtime routes — not a streaming-text parsing
  problem. Partial JSON arriving mid-chunk is a non-issue.
- It forces the model to commit to a step transition *before* the next tool
  call. This is the missing link the original design lacked: any `tool_use`
  between `start(step_id=X)` and `finish(step_id=X)` auto-attaches to step X
  on the backend. The model never has to remember to thread `step_id` into
  every tool argument list.
- Pivots become first-class. `op="revise"` archives the prior step list with a
  visible reason, replaces it, and resets `currentStepId` to the new first
  step.

### `submit_conclusion`

```python
submit_conclusion(
    summary: str,                                     # markdown executive summary
    highlights: list[{"label": str, "value": str}],   # 0-5 KPIs
    next_steps: list[str] | None = None,              # follow-up actions
)
```

Calling this transitions the story to `done`. The stepper auto-collapses; the
final assistant text stops being the conclusion (the conclusion is now
structured), and the markdown summary is rendered with highlights as chips.

### What the agent sees in the system prompt

The prompt no longer asks for any `__plan__` markdown block. It says:

> 1. Before calling any data-fetching or write tools, call
>    `update_plan(op="create", objective, steps)`. Steps are short titles
>    (≤8 words). Aim for 2-5 steps.
> 2. Before each step, call `update_plan(op="start", step_id, narrative)`. The
>    narrative is one sentence in the user's language describing intent.
> 3. After each step, call `update_plan(op="finish", step_id, finding)`. The
>    finding is one line summarizing what you learned (not what you ran).
> 4. If you need to change the plan mid-flight, call
>    `update_plan(op="revise", steps, reason)`.
> 5. When all steps are done, call `submit_conclusion(summary, highlights)`
>    instead of writing a regular markdown response.

## Frontend data model

The story replaces its flat `activity: ActivityItem[]` with a richer
`plan.steps`:

```typescript
type PlanStepStatus = 'pending' | 'running' | 'done' | 'failed';

interface ToolCallSummary {
  toolName: string;        // raw tool name
  count: number;           // collapsed when same tool fires multiple times
  inputPreview?: string;   // 1-line input summary (SQL first line, etc.)
  resultSummary: string;   // "1 table, 24 columns" — never raw markdown
  evidenceId?: string;     // link to RightInspectPanel for the raw payload
  isError?: boolean;
}

interface PlanStep {
  id: string;
  title: string;             // from create — "Inspect sales schema"
  narrative?: string;        // from start — "Looking at sales table grain"
  finding?: string;          // from finish — "Daily grain, 18 months, no nulls"
  status: PlanStepStatus;
  toolCalls: ToolCallSummary[];
  startedAt?: string;
  finishedAt?: string;
}

interface AnalysisPlan {
  objective: string;
  steps: PlanStep[];
  currentStepId?: string;
  revisions: Array<{ steps: PlanStep[]; reason: string; revisedAt: string }>;
}

interface Conclusion {
  summary: string;
  highlights: Array<{ label: string; value: string }>;
  nextSteps?: string[];
}

interface AnalysisStory {
  // ... unchanged identity fields ...
  status: 'discovery' | 'planning' | 'running' | 'done' | 'error';
  plan?: AnalysisPlan;
  conclusion?: Conclusion;        // structured, not raw markdown
  contextLoads: ToolCallSummary[]; // utility tools fired before plan creation
  evidence: EvidenceBlock[];      // unchanged — raw payloads for inspector
}
```

`ActivityItem` is gone. There is no flat activity stream.

## Stream events

`normalize_openai_event` intercepts the two new tools and emits semantic
events instead of generic `tool_use` / `tool_result`:

| Frontend event           | Triggered by                              | Payload                              |
|--------------------------|-------------------------------------------|--------------------------------------|
| `plan.created`           | `update_plan(op="create", ...)`           | `{ objective, steps }`               |
| `plan.step_started`      | `update_plan(op="start", ...)`            | `{ step_id, narrative }`             |
| `plan.step_finished`     | `update_plan(op="finish", ...)`           | `{ step_id, finding, status }`       |
| `plan.revised`           | `update_plan(op="revise", ...)`           | `{ steps, reason }`                  |
| `synthesis.appended`     | `submit_conclusion(...)`                  | `{ summary, highlights, next_steps }`|

Generic `tool_use` / `tool_result` events for these two tools are **suppressed**
by the runtime — they should never appear in the activity stream. Every other
tool's `tool_use` is auto-routed by the reducer to `plan.currentStepId`'s
`toolCalls` (or to `contextLoads` if no plan exists yet).

## UI rendering rules

The `StoryCard` activity section is replaced by a stepper. Rules:

1. **Step rows are the primary surface.** One row per step, vertical stepper.
   - Status icon (pending circle / running spinner / done check / failed dot).
   - Title (the user-facing intent, from `create`).
   - When `running`, also show `narrative` italicized below the title.
   - When `done`, replace narrative with `finding`.
2. **Tools are nested, collapsed, and grouped by name.**
   - Same tool fired N times in one step → one row with `×N` badge, not N rows.
   - Tool result is rendered as `resultSummary` (≤80 chars), never raw payload.
   - Click expands the row to show input preview; raw payload stays in the
     existing `RightInspectPanel` evidence drawer.
3. **Utility reads are demoted.**
   - `read_project_file`, `list_project_files`, `grep_project_files`,
     `get_project_tree` — these go to `contextLoads`, rendered as a one-line
     footer on the appropriate step ("Loaded 3 project files"), not as
     first-class tool rows.
4. **Empty plan = scoping placeholder.**
   - Status `discovery` (no plan yet) shows a single "Scoping the work…" line.
   - The stepper does not render until `plan.created`.
5. **Revisions show, don't hide.**
   - When `plan.revised` fires, the prior step list is moved into
   `plan.revisions` with the reason, and a "Plan revised: <reason>" banner
   appears above the stepper. The user can expand to see the prior plan.
6. **Synthesis swaps the stepper.**
   - When `synthesis.appended` fires, the stepper collapses to a single
     "Worked through N steps" row that expands on click. The conclusion
     summary + highlights chips replace it as the primary content.

`RightInspectPanel` keeps the evidence drawer (raw tool payloads) but loses
its own duplicate plan section — there's only one plan, in the stepper.

## What this design intentionally does NOT do

These were in earlier drafts and are explicitly out of scope:

- **`__plan__` markdown block** — gone. Tool calls only.
- **`step_id` argument on every tool** — gone. Auto-attach via active step.
- **User approval gates between steps** — Phase 3 in the prior draft. Not
  built; the user can stop the run with the existing stop button.
- **DAG steps with `dependencies: string[]`** — Future extension only. Steps
  remain a linear list for now.
- **Sub-agent fan-out** — Future extension. A single step still maps to a
  single agent.
- **Workflow templates injected from `project_config.py`** — not implemented.
  The agent decides plan shape from the user request.
- **Discovery as a separate enforced state machine** — implicit only. Time
  before the first `update_plan(op="create")` is "discovery"; nothing more.

## Current Source Alignment

The structured plan and synthesis stream events are implemented in the OAI app.
The v0.2 business-analysis track adds a durability requirement: a run that only
emits `submit_conclusion` must still persist the summary as the assistant
message and feed it into replay and Next Moves. The current route now uses the
structured synthesis summary as the fallback durable answer when normal streamed
assistant text is empty.

## Implementation slice

The minimum viable change touches eight files and ships in one PR:

1. `server/services/tools/plan_tools.py` (new) — define `update_plan` and
   `submit_conclusion` as `@function_tool`s. Their bodies just return the
   structured args; the runtime intercepts the events.
2. `server/services/agent_runtime/openai_runtime.py` — register the new tools
   alongside `create_project_file_tools`, `create_databricks_tools`,
   `create_operation_tools`.
3. `server/services/agent_runtime/openai_events.py` — when a `tool_call_item`
   has `tool_name in {"update_plan", "submit_conclusion"}`, emit the matching
   semantic event and suppress the corresponding `tool_use` / `tool_result`.
4. `server/services/system_prompt.py` — delete the `__plan__` markdown
   instructions; add the five-rule tool-driven contract.
5. `client/src/features/analysis/types.ts` — expand `PlanStep`, add
   `Conclusion`, `ToolCallSummary`, `contextLoads`; remove `ActivityItem`.
6. `client/src/features/analysis/storyTransforms.ts` — new reducer cases for
   `plan.created` / `plan.step_started` / `plan.step_finished` /
   `plan.revised` / `synthesis.appended`; auto-attach generic `tool_use` to
   `plan.currentStepId`'s `toolCalls`; demote utility reads to `contextLoads`;
   delete the `__plan__` markdown parser.
7. `client/src/features/analysis/components/StoryCard.tsx` — replace
   `ActivityRow` / `Execution Activity` with the stepper.
8. `client/src/features/analysis/components/RightInspectPanel.tsx` — drop the
   duplicate plan section; keep evidence drawer.
