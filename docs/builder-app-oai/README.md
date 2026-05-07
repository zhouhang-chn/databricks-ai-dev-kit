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
| `v0.2-business-analysis/` | Current gap-filling track for preparing business scenarios, runtime context assets, golden evals, and agent benchmark work. |

## Versioned Progress Tracks

Each `vX.Y-*` folder should contain:

- `gap-analysis.md`: what the current source does, what is missing, and why it
  matters.
- `design.md`: the target design for that phase.
- `action-plan.md`: implementation phases, acceptance gates, and validation.

When a phase introduces progress-tracking artifacts, keep them under the
versioned folder. For v0.2, scenario bundles are the canonical layout. A bundle
contains the scenario input, generated markdown context, YAML assets, and YAML
evals for one business scenario.

Within v0.2 scenario bundles:

- `User_Input.md` is the only human-authored seed input.
- Markdown is used for descriptive analyst context, primarily
  `Business_Scenario.md`.
- YAML is used for runtime-readable context and evals:
  `Context_Assets.yaml` and `evals.yaml`.
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
