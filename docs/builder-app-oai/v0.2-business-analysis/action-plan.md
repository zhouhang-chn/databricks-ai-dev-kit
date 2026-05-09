# v0.2 Analyst Pilot Stabilization Plan

## Purpose

This plan aligns v0.2 with the root roadmap for `databricks-builder-app-oai`.
The v0.1 OpenAI Agents SDK runtime remains the baseline. v0.2 now focuses on
stabilizing analyst pilot use around:

- `project_setting.yaml`
- analysis notes
- deterministic project-context injection
- read-only/user-preview analysis runs

The earlier scenario-bundle generator remains a useful design idea, but it is
not the v0.2 release gate. The v0.2 pilot should prove that analysts can tune
agent behavior through project settings and notes, and run one real BDR
analysis flow in a controlled read-only pilot.

## Execution Principles

- Keep existing API and SSE event shapes backward compatible where possible.
- Treat `project_setting.yaml` as the minimal user-authored payload source of
  truth: business background, analysis notes, and selected Databricks resource
  hints.
- Treat analysis notes as the primary iterative tuning surface for pilot
  analysts: metric definitions, caveats, canonical checks, rejected paths, and
  feedback should be added there first.
- Treat `AGENTS.md` only as a project operating guide for reusable mechanism
  rules, not as project payload.
- Make user-preview/read-only runs the pilot serving path.
- Keep the bundle-generator design as a future artifact/materialization path,
  not as a pilot blocker.
- Defer manual analyst trace formalization and golden cases to v0.4.
- Use `pnpm` for client commands.
- Add tests or smoke checks for each correctness-critical behavior.

## Progress Snapshot

Last updated: 2026-05-09.

| Phase | Status | Notes |
|---|---|---|
| Phase 0: Docs and Baseline Alignment | Complete | OAI docs root and v0.1 migration track exist. v0.2 docs now follow the roadmap pivot to Project Settings + Analysis Notes. |
| Phase 1: Critical Persistence Fixes | Complete | Project Management resources and structured conclusion fallback persistence are implemented with focused regression tests. |
| Phase 2: Project Setting and Analysis Notes Foundation | Complete | The OAI app implements schema parsing/rendering, default file creation, get/save/parse/validate routes, Project Management import/save/validate UI, save-time sync into project settings, prompt injection, and analyst-note UI wording. |
| Phase 3: Pilot Readiness Hardening | Local checks complete; live pilot gate pending | Runtime tests cover configured compute, schema-inspection gates, read-only tool filtering, and AGENTS.md guidance scope. `scripts/v02_pilot_readiness.py` records the live BDR pilot evidence. |
| Deferred: Manual Analyst Trace | v0.4 | Revisit formal analyst traces when building Golden Analysis Cases. |
| Deferred: Golden Cases | v0.4 | Revisit canonical cases, scoring anchors, and fast-path execution in v0.4. |
| Deferred: Bundle Generator Follow-up | Future | Keep the generator contract as future scaffolding, not as a v0.2 tagging requirement. |

## v0.2 Build Order

Build the analyst pilot before building artifact generation:

1. Lock the `project_setting.yaml` contract and Project Management UI workflow.
2. Validate that `analysis_notes` are persisted, reloaded, synced into
   semantics, and injected into the agent prompt as useful caveats/context.
3. Validate the BDR pilot resources from `project_setting.yaml` in the target
   workspace.
4. Run a read-only/user-preview smoke test and verify the agent uses configured
   resources before broad discovery.
5. Record missing-context feedback as more notes or explicit settings changes.
6. Re-run the read-only analysis flow after settings/notes updates.
7. Tag v0.2 only after one analyst can run the BDR pilot without developer
   intervention beyond normal workspace permissions.

The pilot flywheel is:

```text
project_setting.yaml
-> analysis_notes
-> read-only Analysis Agent run
-> settings/notes refinement
-> pilot smoke test
```

## Phase 0: Docs and Baseline Alignment

Goal: align docs with the roadmap pivot.

Tasks:

- Keep v0.1 docs under the runtime migration track.
- Update v0.2 gap analysis, design, and action plan to prioritize Project
  Settings + Analysis Notes.
- Make clear that bundle generation is a deferred/future option.
- Keep active validation examples on `pnpm`.

Acceptance gates:

- v0.2 docs do not describe the six-file bundle generator as the pilot exit
  criterion.
- v0.2 docs define a pilot stabilization checklist.
- Active validation examples use `pnpm`.

## Phase 1: Critical Persistence Fixes

Goal: make the current UI/runtime save the answer context users see.

Tasks:

- Project Management save payload includes catalog, schema, cluster, warehouse,
  workspace folder, and MLflow experiment.
- Structured `submit_conclusion` summaries persist as assistant-message
  content when the run produces no normal text output.
- The same conclusion summary feeds Next Moves generation.

Acceptance gates:

- Project Management resource edits survive reload and are used in later runs.
- A run that only calls `submit_conclusion` creates a useful assistant message.
- Next Moves receive the final conclusion text even when `final_text` is empty.

Suggested validation:

```bash
cd databricks-builder-app-oai
UV_CACHE_DIR=/tmp/uv-cache-ai-dev-kit uv run pytest tests/test_project_config.py tests/test_openai_runtime.py tests/test_next_moves.py -q
cd client
pnpm lint
pnpm build:typecheck
```

## Phase 2: Project Setting And Analysis Notes Foundation

Goal: make `project_setting.yaml` the stable analyst-editable project payload.

Current baseline:

- `ProjectSetting` and `DatabricksResources` models exist.
- YAML render/parse helpers exist.
- Missing files are created from project defaults.
- Get/save/parse/validate API routes exist.
- Project Management UI can import, save, and validate the YAML.
- Saving `project_setting.yaml` syncs resources, preferred tables, metric
  views, workflows, and `analysis_notes` back into persisted project settings.
- `analysis_notes` are injected through project semantics as known caveats.

Pilot contract:

- The UI and docs describe analysis notes as the analyst tuning surface.
- Tests prove notes round-trip from YAML to project settings and prompt
  context.
- The minimum supported free-form note categories for pilot are:
  - metric definitions
  - required filters
  - caveats and exclusions
  - validation checks
  - rejected paths
  - decision-owner expectations
- Keep note format intentionally free-form for v0.2; do not require analysts
  to author generated YAML artifacts.

Acceptance gates:

- `project_setting.yaml` parses and contains `business_background`.
- `analysis_notes` persist and reload.
- Saving `project_setting.yaml` updates `settings.semantics.known_caveats`.
- The validation route returns structured Databricks checks for auth, compute,
  workspace paths, workflows, schemas, tables, metric views, volumes, and
  output schema.
- Project prompt context includes the known caveats/analysis notes.

Suggested validation:

```bash
cd databricks-builder-app-oai
UV_CACHE_DIR=/tmp/uv-cache-ai-dev-kit uv run pytest tests/test_project_settings_yaml.py tests/test_project_management_frontend_contract.py tests/test_project_config.py -q
```

## Phase 3: Pilot Readiness Hardening

Goal: make one BDR analyst pilot path stable enough to use.

Tasks:

- Validate the BDR `project_setting.yaml` against the target Databricks
  workspace.
- Confirm the configured warehouse or cluster is used for SQL and schema
  inspection.
- Confirm preferred tables and metric views become schema-inspection gates
  before analytical SQL.
- Confirm user-preview/read-only runs expose no project-file mutation tools and
  block write-oriented Databricks tools.
- Confirm `AGENTS.md` remains mechanism guidance only.
- Use `scripts/v02_pilot_readiness.py` as the pilot smoke-test checklist to
  record:
  - project id
  - project setting path
  - selected resources
  - validation result
  - run role
  - trace id
  - whether any write tool was exposed or invoked

Suggested local validation:

```bash
cd databricks-builder-app-oai
UV_CACHE_DIR=/tmp/uv-cache-ai-dev-kit uv run pytest tests/test_openai_runtime.py tests/test_v02_pilot_readiness.py -q
UV_CACHE_DIR=/tmp/uv-cache-ai-dev-kit uv run python scripts/v02_pilot_readiness.py \
  --project-id bdr-routing-pilot \
  --project-setting ../docs/builder-app-oai/v0.2-business-analysis/scenario-000-bdr-routing-pilot/project_setting.yaml \
  --run-role user_preview
```

Acceptance gates:

- BDR project settings validate in the pilot workspace or list explicit
  warnings/errors for the analyst to resolve.
- A user-preview run can answer a scoped BDR pilot question using configured
  resources and analysis notes.
- The run does not mutate project files or Databricks resources.
- Missing context is returned as a clear analyst follow-up, not hidden by a
  confident answer.

## Deferred Follow-Up Work

Goal: keep future concepts visible without making them v0.2 gates.

Revisit in v0.4:

- Manual analyst trace workflow for high-value scenarios.
- Golden cases with scoring anchors and canonical execution paths.
- Fast-path execution when a user question matches a golden case.

Keep as future bundle-generator scaffolding:

- Request/result contract for creating structured business/data/analysis
  artifacts from project settings.
- Partial regeneration rules for changed settings.
- Review-state preservation and invalidation.
- Optional source-code and Databricks metadata enrichment.
- Generated eval projections from golden cases.

Do not require for v0.2:

- Six-file bundle generation.
- Runtime scenario-bundle retrieval.
- Artifact review workflow.
- Partial-regeneration engine.
- Broad metadata enrichment.

## Pilot Stabilization Checklist

Before tagging v0.2:

- Project setting schema/API/UI tests pass.
- Project settings and analysis notes round-trip through save/reload.
- BDR `project_setting.yaml` validates against the pilot workspace or records
  explicit validation warnings/errors.
- User-preview/read-only tool exposure is verified and recorded through
  `scripts/v02_pilot_readiness.py`.
- One BDR pilot read-only run uses configured resources and notes.
- Missing-context feedback has a documented path back into analysis notes.
- The docs clearly mark bundle generation as deferred.
- The docs clearly mark manual analyst traces and golden cases as v0.4 work.

## Definition Of Done

- Project resources and structured conclusions persist correctly.
- `project_setting.yaml` is the authoritative pilot payload.
- Analysis notes are the analyst tuning surface and are injected into runs.
- The BDR routing pilot can be run in read-only/user-preview mode with selected
  resources.
- Active docs and validation commands match source code and repo policy.
