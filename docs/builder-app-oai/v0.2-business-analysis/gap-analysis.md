# v0.2 Builder Agent Gap Analysis

Date: 2026-05-09

Scope: local source and docs under `databricks-builder-app-oai/` and
`docs/builder-app-oai/`. This review does not include live AI Gateway,
Databricks workspace, browser, or load testing.

## Roadmap Pivot

The root roadmap now defines v0.2 as an analyst pilot built around Project
Settings, Analysis Notes, and a read-only Analysis Agent. That is a material
pivot from the earlier "scenario bundle as product" direction.

The original bundle-generator idea is still useful as a future scaffold: it
describes how structured business, data, analysis, and eval artifacts could be
generated from project settings. It should not be a v0.2 pilot gate. For v0.2,
the critical contract is:

```text
project_setting.yaml
-> analysis_notes
-> injected Project Management Context
-> read-only analyst run
-> settings/notes refinement
```

This keeps the pilot focused on what the current OAI app can realistically
stabilize: resource selection, business background, analyst-provided context,
reliable read-only execution, and repeatable judgement cases.

## Current Foundation

Implemented or mostly implemented in the OAI app:

- `project_setting.yaml` has a Pydantic schema, readable YAML
  renderer/parser, default file creation, get/save/parse/validate API routes,
  and a Project Management import/save/validate UI.
- Saving project settings syncs resource hints into persisted project settings:
  catalog, schema, cluster, warehouse, workspace folder, preferred tables,
  metric views, workflows, and known caveats.
- `analysis_notes` are stored in `project_setting.yaml` and mapped into
  project semantics as `known_caveats`, which the system prompt injects into
  Project Management Context.
- Project context can include resources, semantics, release state, policy, and
  read-only user-preview role.
- `AGENTS.md` is a bounded project operating-guide snapshot, not the payload
  source or a Databricks-tool gate.
- Plan and synthesis events are structured tool events, and
  `submit_conclusion` summaries persist as durable assistant text and feed
  Next Moves.
- Read-only/user-preview mode filters project-file mutation tools and blocks
  write-oriented Databricks tools by construction.

## Remaining Pilot Gates And Risks

| Priority | Gate or risk | Why it matters for v0.2 pilot |
|---|---|---|
| P0 | Live BDR workspace validation and one user-preview run still need pilot evidence. | The release gate is the real analyst path: selected resources validate or produce explicit warnings, the run uses those resources, and no writes occur. |
| P0 | The pilot readiness checklist must be filled with a trace id and tool-safety evidence. | `scripts/v02_pilot_readiness.py` exists, but the release decision still needs a concrete BDR run record. |
| P1 | Legacy reference artifacts can still be mistaken for the v0.2 runtime contract. | This can pull pilot work back toward generated bundles instead of settings and notes. |
| P1 | Source-code and Databricks metadata enrichment are not implemented as bounded preparation steps. | Useful, but deferrable to v0.2.x because selected project settings already name the pilot resources. |
| P1 | SQL safety remains partly prefix-based, including `WITH` as read-only. | Important for later serving; for pilot, mitigate with read-only role, selected resources, schema inspection gates, and analyst review. |
| P2 | Chart evidence is designed but not implemented. | Valuable for v0.3 storytelling, not required to stabilize v0.2. |

## Reframed v0.2 Target

v0.2 should be tagged only when an internal analyst can use the OAI app to run
the BDR routing pilot with stable project context and predictable read-only
behavior.

The exit path is:

1. `project_setting.yaml` is the authoritative editable payload for business
   background, analysis notes, and Databricks resources.
2. Project settings and analysis notes are always injected into agent context
   for developer and user-preview runs.
3. The BDR pilot has a validated project setting with selected cluster,
   warehouse, workspace source, input schema/table, and output schema.
4. User-preview/read-only runs can consume the same project settings and notes
   without mutating project files or Databricks resources.
5. Missing-context feedback is captured as analysis-note updates or explicit
   project-setting changes.

## Role Of The Bundle Generator

Keep the bundle-generator design as a future option, but demote it from v0.2
exit criteria.

For v0.2:

- `business_context.yaml`, `data_context.yaml`, `analysis_context.yaml`, and
  `evals.yaml` are reference fixtures and golden-case scaffolding.
- They can help analysts and developers reason about the BDR pilot.
- They should not be required for runtime retrieval or analyst pilot success.

For future releases:

- The generator can reappear as a way to materialize structured notes,
  reusable templates, or golden analysis cases from stabilized settings.
- Any generator must preserve analyst-authored notes and golden cases rather
  than overwriting them.

For v0.4:

- Manual analyst traces and Golden Analysis Cases can provide canonical paths,
  scoring anchors, and fast-path execution for well-known questions.

## Recommended Priorities

1. Freeze the v0.2 pilot contract around `project_setting.yaml`,
   `analysis_notes`, read-only agent context, and feedback capture.
2. Use the pilot readiness checklist script in the action plan as the release
   evidence record.
3. Treat the BDR routing pilot reference bundle as documentation and
   v0.4 scaffolding, not as a runtime dependency.
4. Validate that the Analysis Agent receives settings/notes and uses configured
   resources before broad discovery.
5. Run read-only/user-preview smoke tests against the BDR project and confirm
   no project files or Databricks resources are mutated.
6. Defer manual analyst traces, golden cases, bundle generation, partial
   regeneration, broad metadata enrichment, parser-based SQL safety, and chart
   evidence until later roadmap phases or concrete pilot blockers.

## Validation Still Needed

- Project-setting save/parse/validate regression tests remain green.
- Analysis notes are persisted, reloaded, mapped to project semantics, and
  visible in prompt context.
- BDR pilot `project_setting.yaml` validates against accessible Databricks
  resources in the target workspace.
- Read-only/user-preview runs receive read-oriented tools only.
- At least one pilot read-only run uses the configured resources and notes,
  produces a useful answer, and emits missing-context feedback when context is
  insufficient.
