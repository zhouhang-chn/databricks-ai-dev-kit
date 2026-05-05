# Next Moves Action Plan

## Purpose

This plan turns [`analysis.md`](analysis.md) and [`design.md`](design.md) into
an implementation sequence for intelligent Next Moves in
`databricks-builder-app-oai`.

The goal is to replace static follow-up buttons with context-aware,
role-aware, project-aware recommendations while preserving the current
`next_moves.updated` event contract.

## Execution Principles

- Generate Next Moves on the backend.
- Keep frontend generation as a compatibility fallback only.
- Use project context, final answer, trace summary, and recent chat history.
- Use `deepseek-v4-flash` or the configured cheap auxiliary model.
- Do not expose raw tool output in moves.
- Do not block final answer delivery on a slow metadata model call.
- Respect developer/user-preview/user/viewer role boundaries.
- Keep event fields additive.
- Use `pnpm` for client validation.

## Progress Snapshot

Last updated: 2026-05-05.

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0: Document Current State And Target | Complete | This docs set records the current static implementation and target intelligent design. |
| Phase 1: Backend Heuristic Generator | Not started | Add a deterministic generator that uses answer, question, trace, role, and project type. |
| Phase 2: Context Pack And Event Metadata | Not started | Build compact Next Move context and attach generation metadata to events. |
| Phase 3: Model-Based Generator | Not started | Add AI Gateway/OpenAI-compatible JSON generation with timeout and fallback. |
| Phase 4: Frontend Contract Cleanup | Not started | Extend types for additive fields and make frontend fallback compatibility-only. |
| Phase 5: Role And Policy Enforcement | Not started | Ensure read-only roles never receive write/deploy/delete prompts. |
| Phase 6: Tests And Evaluation Fixtures | Not started | Add unit tests and seed eval cases for common workflows. |
| Phase 7: Observability And Feedback | Not started | Add logs, metrics, and optional user feedback hooks. |

## Phase 0: Document Current State And Target

Goal: make the implementation facts and product target explicit.

Tasks:

- Add `analysis.md`.
- Add `design.md`.
- Add this action plan.
- Include current code references and identified failure modes.

Acceptance gates:

- Docs explain why current moves are static.
- Docs define the desired context-aware behavior.
- Docs define the backend service boundary.

## Phase 1: Backend Heuristic Generator

Goal: create useful Next Moves without a model dependency.

Tasks:

- Add `server/services/next_moves.py`.
- Define dataclasses:
  - `NextMoveContext`
  - `NextMoveTraceStep`
  - `NextMove`
- Implement `generate_fallback_next_moves(context)`.
- Add heuristics for:
  - catalog/schema/table discovery
  - metric answers
  - anomaly or comparison analysis
  - dashboard/app build flows
  - error and retry flows
  - user-preview/read-only flows
- Replace `_next_moves_for_message()` in `server/routers/agent.py` with the
  fallback generator.

Acceptance gates:

- A catalog discovery answer produces discovery-specific moves.
- A metric answer produces compare/segment/validate moves.
- An error answer produces recovery moves.
- Read-only roles do not receive write/deploy/delete moves.
- Existing SSE clients still receive `next_moves.updated`.

Suggested validation:

```bash
cd databricks-builder-app-oai
./.venv/bin/ruff check server/services/next_moves.py server/routers/agent.py
./.venv/bin/python -m pytest tests/test_next_moves.py -q
```

## Phase 2: Context Pack And Event Metadata

Goal: pass enough context to make moves relevant and auditable.

Tasks:

- Accumulate lightweight trace summaries in `server/routers/agent.py`:
  - tool name
  - status
  - duration
  - concise output summary
- Track final answer text and error state.
- Include project context fields already available in the agent route:
  - project type
  - status
  - release ID
  - run role
  - effective resources
  - semantic settings
  - workflows
  - memory
- Include recent messages from the current conversation.
- Add event metadata:
  - `source`
  - `model`
  - `latency_ms`
  - `fallback_reason`

Acceptance gates:

- Logs show source, latency, and fallback reason.
- Generated events include additive metadata without breaking frontend parsing.
- Context pack excludes tokens and raw tool payloads.

## Phase 3: Model-Based Generator

Goal: use the cheap auxiliary model to improve relevance beyond heuristics.

Tasks:

- Add OpenAI-compatible client creation to `next_moves.py`.
- Resolve model in this order:
  - `OPENAI_NEXT_MOVES_MODEL`
  - `OPENAI_MODEL_MINI`
  - `OPENAI_TITLE_MODEL`
  - `deepseek-v4-flash`
- Call chat completions with strict JSON instructions.
- Timeout after 1.5 to 3.0 seconds.
- Validate:
  - JSON parses
  - 1 to 5 moves
  - labels and prompts are non-empty
  - action type is allowed
  - prompts are bounded
  - no raw JSON/tool payload leakage
- Fall back to heuristics on timeout, invalid JSON, policy violation, or API
  failure.

Acceptance gates:

- Good model output is emitted as `source=model`.
- Bad model output falls back to `source=heuristic`.
- Timeout does not fail the primary answer.
- Logs expose enough detail for debugging without leaking prompt payloads.

Suggested validation:

```bash
cd databricks-builder-app-oai
./.venv/bin/python -m pytest tests/test_next_moves.py -q
```

## Phase 4: Frontend Contract Cleanup

Goal: keep the frontend as a renderer and compatibility layer.

Tasks:

- Extend `NextMove` type with optional:
  - `intent`
  - `confidence`
  - `requiresConfirmation`
  - `source`
- Accept additive fields in `storyEventsFromStreamEvent()`.
- Keep `defaultNextMoves()` only for old conversations with no generated moves.
- Stop mapping TodoWrite events directly into Next Moves unless explicitly
  marked as user-facing recommendations.
- Optionally show confirmation-sensitive moves with subtle visual treatment.

Acceptance gates:

- New fields do not break existing UI.
- Old conversations still show fallback moves.
- Todo execution steps no longer overwrite high-quality generated moves.

Suggested validation:

```bash
cd databricks-builder-app-oai/client
pnpm lint
pnpm build:typecheck
```

## Phase 5: Role And Policy Enforcement

Goal: prevent one-click prompts from suggesting actions the current role should
not take.

Tasks:

- Add policy filter in `next_moves.py`.
- For `user_preview`, `user`, and `viewer`:
  - remove write/deploy/delete/create-table suggestions
  - prefer read-only analysis moves
- For developer role:
  - allow build/deploy/write suggestions only when project policy permits
  - set `requiresConfirmation=true` for risky suggestions
- Include project write policy and release status in filtering.

Acceptance gates:

- User-preview never sees deploy/delete/write prompts.
- Developer mode can see build/release prompts when allowed.
- Risky developer prompts are flagged with `requiresConfirmation`.

## Phase 6: Tests And Evaluation Fixtures

Goal: make Next Move quality testable.

Tasks:

- Add `tests/test_next_moves.py`.
- Cover deterministic fallback cases:
  - catalog discovery
  - table discovery
  - metric answer
  - dashboard/app build
  - project release
  - tool error
  - user-preview read-only mode
- Add model-output parser tests:
  - valid JSON
  - invalid JSON
  - missing fields
  - disallowed action type
  - raw JSON leakage
  - write action in read-only role
- Add a small fixture file for future qualitative evals.

Acceptance gates:

- Unit tests pass without network access.
- Model parser and fallback behavior are covered.
- Fixtures document expected move quality for common flows.

Suggested validation:

```bash
cd databricks-builder-app-oai
./.venv/bin/ruff check server/services/next_moves.py tests/test_next_moves.py
./.venv/bin/python -m pytest tests/test_next_moves.py -q
```

## Phase 7: Observability And Feedback

Goal: make move quality debuggable and improvable.

Tasks:

- Log:
  - source
  - model
  - latency
  - fallback reason
  - move count
  - role
  - project type
- Add optional UI event for move click:
  - move ID
  - label
  - intent
  - source
  - story ID
- Consider storing click/dismiss feedback in project feedback settings.
- Add MLflow span for next-move generation if MLflow tracing is active.

Acceptance gates:

- Logs identify whether moves came from the model or fallback.
- Move clicks can be correlated with story IDs.
- No raw tool output or secrets are logged.

## Phase 8: Workflow And Memory Integration

Goal: make Next Moves project-native.

Tasks:

- Use project workflows to seed moves when a result matches a workflow stage.
- Use approved memory to bias move generation.
- Use semantic context to suggest project-specific tables, metrics, and
  glossary-aware follow-ups.
- Use release state to suggest publish/review/preview moves.

Acceptance gates:

- A project with workflows receives workflow-aware suggestions.
- A project with metric views receives metric-aware suggestions.
- Published/user-preview projects receive read-only continuation moves.

## Rollout Plan

1. Ship heuristic generator first.
2. Add model generator behind an environment flag:

```text
NEXT_MOVES_MODEL_ENABLED=true
```

3. Keep frontend fallback for compatibility.
4. Compare model and heuristic outputs in logs for a few local runs.
5. Enable model generation by default once latency and relevance are acceptable.

## Risks

| Risk | Mitigation |
|------|------------|
| Model adds latency after answer | Short timeout and heuristic fallback. |
| Suggestions are unsafe for read-only users | Policy filter after generation. |
| Suggestions are generic despite model use | Include answer, trace, project context, and recent turns. |
| Model emits invalid JSON | Strict parser and fallback. |
| Raw tool output leaks into prompts/UI | Summarize evidence before generation and validate output. |
| Frontend/backend behavior diverges | Backend owns generation; frontend fallback only for compatibility. |

## Definition Of Done

- Static backend `_next_moves_for_message()` is removed.
- Next Moves use final answer and project context.
- Generated moves vary by intent and role.
- Frontend renders additive metadata safely.
- Tests cover fallback, parsing, role policy, and representative workflows.
- Logs expose source, latency, and fallback reason.

