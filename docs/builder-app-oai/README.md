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
| `v0.2-business-analysis/` | Analyst pilot track for project settings, analysis notes, and read-only analysis runs. |
| `v0.3-visual-storytelling/` | Visual narrative track for chart evidence, story conclusions, and shareable analysis output. |
| `v0.3.5-metric-view-context-engineering/` | Scenario-onboarding and semantic-layer track for deriving analysis requirements, gap-analyzing Databricks assets, and validating Metric Views. |
| `v0.4-golden-analysis-cases/` | Golden-case track for canonical question paths that consume the validated Metric View layer. |

## Versioned Progress Tracks

Each `vX.Y-*` folder should contain:

- `gap-analysis.md`: what the current source does, what is missing, and why it
  matters.
- `design.md`: the target design for that phase.
- `action-plan.md`: implementation phases, acceptance gates, and validation.

When a phase introduces progress-tracking artifacts, keep them under the
versioned folder. Current phases use `project_setting.yaml`, analysis notes,
registered Databricks resources, Metric View context, and eval artifacts as the
product contract. Older v0.2 scenario-bundle docs are retained as historical
context and should not be treated as the active architecture when newer
versioned tracks supersede them.

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
