# Databricks Builder App OAI Docs

This directory is the documentation root for `databricks-builder-app-oai/`.
Documents directly under this folder and its feature subfolders should describe
the current source code and the product goal. Versioned folders are used for
progress tracking.

## Documentation Map

| Path | Purpose |
|---|---|
| [`planning-orchestration.md`](planning-orchestration.md) | Current plan/synthesis event contract for analysis stories. |
| [`data-visualization.md`](data-visualization.md) | Target design for chart evidence in analysis stories. |
| [`project-management/`](project-management/) | Current project model, settings, releases, roles, governance, and action plan. |
| [`next-moves/`](next-moves/) | Current backend Next Moves service design and action plan. |
| [`frontend-refactor/`](frontend-refactor/) | Story canvas and inspect-panel frontend architecture notes. |
| [`v0.1-agents-sdk-integration/`](v0.1-agents-sdk-integration/) | Historical migration track for replacing the Claude runtime with the OpenAI Agents SDK. |
| [`v0.2-business-analysis/`](v0.2-business-analysis/) | Current gap-filling track for reliable business-question answering. |

## Versioned Progress Tracks

Each `vX.Y-*` folder should contain:

- `gap-analysis.md`: what the current source does, what is missing, and why it
  matters.
- `design.md`: the target design for that phase.
- `action-plan.md`: implementation phases, acceptance gates, and validation.

The versioned folders are not the only documentation. They track progress for a
phase. The active feature docs outside versioned folders should remain aligned
with the latest source code and the current product goal.

## Source References

- App source: [`../../databricks-builder-app-oai/`](../../databricks-builder-app-oai/)
- Legacy Builder App docs: [`../builder-app/`](../builder-app/)
- v0.1 OpenAI Agents SDK migration: [`v0.1-agents-sdk-integration/`](v0.1-agents-sdk-integration/)
- v0.2 business-analysis track: [`v0.2-business-analysis/`](v0.2-business-analysis/)

## Maintenance Rules

- Use `pnpm` for frontend commands in docs and examples.
- Do not add new npm lockfiles or `npm`/`npx` command examples.
- Keep model-provider credentials separate from Databricks tool credentials.
- Mark historical docs clearly when a newer versioned track supersedes them.
- Prefer source-linked acceptance gates over broad "complete" labels.
