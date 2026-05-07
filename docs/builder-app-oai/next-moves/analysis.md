# Next Moves Analysis

## Purpose

This document analyzes the current "Next Moves" behavior in
`databricks-builder-app-oai` and defines the product gap that must be closed.

Next Moves should help the user continue the current analytical or development
workflow. They should infer likely intent from the latest question, response,
project context, execution trace, and conversation history. The current
implementation now has a backend service with heuristic and model-based
generation, but its quality still depends on the completeness of the final
answer text and evidence context passed from the agent run.

## Current Implementation Facts

Next Moves are currently produced by a backend service, with frontend fallback
for compatibility.

| Area | File | Current behavior |
|------|------|------------------|
| Backend context builder | `databricks-builder-app-oai/server/routers/agent.py` | Accumulates final text, error state, trace summaries, evidence summaries, effective resources, project semantics, workflows, memory, recent messages, role, and release metadata. |
| Backend generator | `databricks-builder-app-oai/server/services/next_moves.py` | Generates model-based moves through an OpenAI-compatible client with strict JSON parsing, validation, role filtering, fallback heuristics, and event metadata. |
| Backend event | `databricks-builder-app-oai/server/routers/agent.py` | Emits `next_moves.updated` after the primary run, including generated moves plus source/model/latency/fallback metadata. |
| Frontend fallback | `databricks-builder-app-oai/client/src/features/analysis/storyTransforms.ts` | Creates generic fallback moves only when a story completes without explicit backend moves, preserving older conversations and interrupted streams. |

The route now falls back to the structured `synthesis.appended.summary` when
normal streamed assistant text is empty. The remaining source-level gap is that
the generator still receives compact evidence strings instead of a durable
business-answer manifest.

## Remaining Product Gap

The generator is now in the right place, but move relevance still depends on the
quality of the story context. It needs durable final-answer text, structured
evidence summaries, and source/caveat metadata.

For a discovery query, useful moves should infer that the user may next want to
narrow, configure, or operationalize the result:

- Inspect schemas in these catalogs
- Find useful analytics tables
- Pin the best default catalog/schema for this project

For a metric answer, a relevant set might be:

- Compare to prior period
- Break down by segment
- Validate metric definition

For a build-oriented project answer, a relevant set might be:

- Add validation checks
- Generate deployment plan
- Preview as user

This matters because Next Moves are part of the workflow surface. If they are
based on incomplete answer/evidence context, users learn to ignore them even
when the generation service itself is working.

## Reference Principles

The local OpenAI data-agent reference emphasizes that good agent behavior comes
from layered context: table usage, curated annotations, code-derived
enrichment, institutional knowledge, memory, and runtime context. It also
emphasizes iterative exploration: users ask follow-up questions, adjust intent,
and refine direction across turns.

The project-management docs for this repository define the same direction for
Builder App projects:

- project settings should provide durable context
- project defaults should reduce repetitive user language
- workflows should encode repeated work
- memory should capture corrections and project-specific learnings
- developer/user roles should change the allowed action surface

Next Moves should be the visible UI expression of those principles.

## Target Product Behavior

Next Moves should answer:

```text
Given this user, this project, this role, this conversation, this answer, and
this execution trace, what are the most useful next actions?
```

They should be:

- relevant to the latest answer
- grounded in project context and role
- specific enough to be useful as a one-click prompt
- safe with respect to write actions and permissions
- diverse across intent types, not three variants of the same idea
- concise enough to scan quickly
- deterministic enough to test, with fallback behavior when model generation
  fails

## Intent Categories

The current `NextMoveType` allows:

- `drill`
- `compare`
- `validate`
- `explain`
- `pivot`

That set is a reasonable UI starting point, but generation should also infer a
more precise intent internally:

| Internal intent | UI action type | Example |
|-----------------|----------------|---------|
| clarify_scope | explain | "Clarify which `_dev` catalog should be used for this project." |
| inspect_metadata | drill | "Show schemas and table counts in the top matching catalogs." |
| find_data_assets | drill | "Find likely analytics tables under these schemas." |
| compare_periods | compare | "Compare this metric with the previous full month." |
| segment_result | drill | "Break this result down by region and customer segment." |
| validate_source | validate | "Check source freshness and known caveats." |
| validate_metric | validate | "Verify the governed metric definition and filters." |
| operationalize | pivot | "Save these resources as project defaults." |
| build_artifact | pivot | "Create a dashboard from this result." |
| debug_failure | validate | "Inspect the trace and retry with a narrower query." |
| ask_followup | explain | "Ask me which business unit or date range to use." |

## Input Signals To Use

### Conversation Signals

- latest user message
- previous user messages
- latest assistant answer
- current conversation title
- unresolved ambiguity from prior turns
- whether the latest turn was a follow-up, correction, discovery request,
  validation request, build request, or failure recovery

### Runtime Signals

- tool names used
- tool success/failure state
- tool result summaries
- trace duration and retries
- result type inferred from answer shape: table, list, metric, error, build
  plan, artifact, code, dashboard, data-quality report

### Project Signals

- project type: data product build, Databricks app build, analyst workspace,
  dashboard/report, or general
- status: draft, review, published, archived
- run role: developer, user preview, user, viewer
- effective resources: catalog, schema, warehouse, cluster, workspace folder
- semantic registry: metric views, preferred tables, deprecated tables,
  glossary, sample queries, caveats
- workflow templates and artifacts
- approved memory and feedback
- governance/readiness flags

## Why Not Put This Only In The Prompt?

The main agent could be asked to emit better next moves, but that creates three
problems:

1. The primary answer path becomes responsible for UI metadata.
2. The moves may appear before the final response and evidence are available.
3. The moves become harder to recover when streaming is interrupted.

The better boundary is a small, dedicated post-processing service that receives
the final story context and emits a structured `next_moves.updated` event.

The main agent can still emit domain-specific suggestions in the answer, but
the UI should get Next Moves from a purpose-built generator with a deterministic
fallback.

## Current Failure Modes

| Failure mode | Cause | User impact |
|--------------|-------|-------------|
| Weak evidence context | Evidence summaries are compact strings rather than a manifest with sources, metrics, filters, grain, caveats, and row/time bounds | Moves can suggest validation or drill-down steps without knowing what was actually proven. |
| Generic fallback still appears after interrupted/old stories | Frontend fallback preserves compatibility | Older or failed conversations can still show low-specificity moves. |
| Workflow-specific ranking is incomplete | Project workflows and memory are included but not deeply ranked | Moves may miss the next step expected by a curated project workflow. |
| Feedback loop is missing | Click/dismiss feedback is not yet stored or evaluated | Relevance cannot improve from user behavior. |

## Recommended Direction

Keep the explicit backend generator and improve its inputs in v0.2:

- persist structured conclusions into assistant messages and story metadata
- pass the persisted conclusion into `NextMoveContext.answer`
- replace compact evidence strings with a business-answer manifest summary
- add workflow-aware ranking and click/dismiss feedback later
- keep the frontend as renderer and compatibility fallback

## Non-Goals

- Do not expose raw tool outputs in next-move prompts.
- Do not let generated moves bypass tool allowlists or approval policy.
- Do not require another long-running agent run just to create moves.
- Do not rely on MLflow tracing as the only source of context; tracing is for
  debugging, while Next Moves are user-facing workflow guidance.
- Do not block final answer delivery on slow move generation.

## Success Criteria

The implementation is successful when:

- moves are clearly specific to the latest answer
- moves vary by project type and run role
- discovery, metric analysis, build, validation, and error flows produce
  different move sets
- generated prompts can be submitted directly as the next user message
- model failures still produce useful deterministic moves
- tests cover both model-output parsing and fallback behavior
- event logs include enough context to evaluate move quality later
