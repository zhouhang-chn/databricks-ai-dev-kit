# Databricks Builder App OAI Docs

This directory is the documentation root for `databricks-builder-app-oai/`.
Documents directly under this folder and its feature subfolders should describe
the current source code and the product goal. Versioned folders are used for
progress tracking.

## Documentation Map

| Path | Purpose |
|---|---|
| `planning-orchestration.md` | Current plan/synthesis event contract for analysis stories. |
| `data-visualization.md` | Target design for chart evidence in analysis stories. |
| `project-management/` | Current project model, settings, releases, roles, governance, and action plan. |
| `next-moves/` | Current backend Next Moves service design and action plan. |
| `frontend-refactor/` | Story canvas and inspect-panel frontend architecture notes. |
| `v0.1-agents-sdk-integration/` | Historical migration track for replacing the Claude runtime with the OpenAI Agents SDK. |
| `v0.2-business-analysis/` | Current Builder Agent track for generating scenario bundles from project settings, enriching context assets, and constructing golden evals. |

## Versioned Progress Tracks

Each `vX.Y-*` folder should contain:

- `gap-analysis.md`: what the current source does, what is missing, and why it
  matters.
- `design.md`: the target design for that phase.
- `action-plan.md`: implementation phases, acceptance gates, and validation.

When a phase introduces progress-tracking artifacts, keep them under the
versioned folder. For v0.2, scenario bundles are the canonical layout and the
Builder Agent is the primary product surface. A bundle contains the project
setting source of truth, generated structured context YAML, and a generated
eval projection for one business scenario.

Within v0.2 scenario bundles:

- `project_setting.yaml` is the minimal user-authored source of truth. It
  contains free-form business background, optional analysis notes, and
  Databricks resource hints selected by the user or UI.
- `business_context.yaml` is the structured business scenario and decision
  context generated from project settings.
- `data_context.yaml` is the structured data and metadata context generated
  from source-code and Databricks enrichment.
- `analysis_context.yaml` is the structured analysis context. It contains
  analysis principles that can be fed to the Analysis Agent on every run and
  golden cases that can be retrieved on demand.
- `evals.yaml` is a generated eval projection from canonical golden cases in
  `analysis_context.yaml`.
- A future `_shared/` folder may hold reusable cross-scenario assets once reuse
  is proven.

The versioned folders are not the only documentation. They track progress for a
phase. The active feature docs outside versioned folders should remain aligned
with the latest source code and the current product goal.

## Maintenance Rules

- Use `pnpm` for frontend commands in docs and examples.
- Do not add new npm lockfiles or `npm`/`npx` command examples.
- Keep model-provider credentials separate from Databricks tool credentials.
- Mark historical docs clearly when a newer versioned track supersedes them.
- Prefer source-linked acceptance gates over broad "complete" labels.
