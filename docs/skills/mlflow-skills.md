# MLflow skills

Eight skills hosted in [`github.com/mlflow/skills`](https://github.com/mlflow/skills) and downloaded by `install_skills.sh` and `install.sh`. None of them live in this repo's `databricks-skills/` directory — adding `--local` to `install_skills.sh` will fail explicitly for any of these.

All eight ship together with the `ai-ml-engineer` profile (`PROFILE_AIML_MLFLOW` in `install.sh`).

## Source

```
https://raw.githubusercontent.com/mlflow/skills/<ref>/<skill-name>/SKILL.md
```

`<ref>` defaults to `main`; pin via `--mlflow-version <branch|tag>`. Each `SKILL.md` has its own list of supporting files declared in `install_skills.sh::get_mlflow_skill_extra_files`.

## Skills

| Skill | Description (paraphrased) |
|-------|---------------------------|
| `agent-evaluation` | End-to-end agent evaluation workflow |
| `analyze-mlflow-chat-session` | Debug multi-turn conversations |
| `analyze-mlflow-trace` | Debug traces, spans, and assessments |
| `instrumenting-with-mlflow-tracing` | Add MLflow tracing to Python / TypeScript |
| `mlflow-onboarding` | Setup guide for new MLflow users |
| `querying-mlflow-metrics` | Aggregated metrics + time-series analysis |
| `retrieving-mlflow-traces` | Trace search and filtering |
| `searching-mlflow-docs` | Search MLflow documentation |

The `description` in each `SKILL.md` is the trigger — agents match user prompts against it.

## Supporting files (per skill)

The set is locked in `install_skills.sh`. If MLflow adds a new file in their repo, it won't reach users via the kit's installer until the allowlist is updated and a new release is cut.

### `agent-evaluation` (largest)

```
references/dataset-preparation.md
references/scorers-constraints.md
references/scorers.md
references/setup-guide.md
references/tracing-integration.md
references/troubleshooting.md
scripts/analyze_results.py
scripts/create_dataset_template.py
scripts/list_datasets.py
scripts/run_evaluation_template.py
scripts/setup_mlflow.py
scripts/validate_agent_tracing.py
scripts/validate_auth.py
scripts/validate_environment.py
scripts/validate_tracing_runtime.py
```

Includes both Markdown reference files and Python helper scripts. The scripts are usable; agents are expected to run them via the relevant tool (`execute_code` for the Databricks side, plain `Bash` locally).

### `analyze-mlflow-chat-session`

```
scripts/discover_schema.sh
scripts/inspect_turn.sh
```

Bash helpers — designed to be invoked by the agent through its built-in `Bash` tool, not via MCP.

### `analyze-mlflow-trace`

```
references/trace-structure.md
```

Single reference file describing the MLflow trace span/assessment shape.

### `instrumenting-with-mlflow-tracing`

```
references/advanced-patterns.md
references/distributed-tracing.md
references/feedback-collection.md
references/production.md
references/python.md
references/typescript.md
```

Per-language and per-pattern reference files.

### `querying-mlflow-metrics`

```
references/api_reference.md
scripts/fetch_metrics.py
```

### `mlflow-onboarding`, `retrieving-mlflow-traces`, `searching-mlflow-docs`

No supporting files — just `SKILL.md`.

## Relationship to `databricks-mlflow-evaluation`

`databricks-mlflow-evaluation` (in this repo) and the upstream `agent-evaluation` skill **both** cover MLflow GenAI evaluation. They are intentionally complementary:

| | `databricks-mlflow-evaluation` (this repo) | `agent-evaluation` (mlflow/skills) |
|--|---------------------------------------------|-----------------------------------|
| Focus | Databricks-side patterns: serverless runs, UC datasets, scorer plumbing inside Databricks | The MLflow workflow itself: evaluation runs, scorers, traces, regardless of compute |
| Trigger | `"mlflow.genai.evaluate"`, `@scorer`, etc. | Agent evaluation phrasing in general |
| Pairs with | `execute_code` on Databricks compute | Local MLflow + tracing setup |

Both are installed by the `ai-ml-engineer` profile. Don't drop one without checking which path your users are on.

## Updating

The kit's release process pins the MLflow ref:

- Default `MLFLOW_REPO_REF=main` means new MLflow skill content reaches users on every install run.
- Pinning to a tag (`--mlflow-version v1.0.0`) freezes content for reproducibility.

If MLflow renames a skill or removes a file, the installer's `curl -f` call will fail for that file:

- **Missing `SKILL.md`**: skill marked as failed, removed.
- **Missing optional file**: logged as `○ Optional file ... not found`, install continues.

Drift between the kit's allowlist and the upstream repo is therefore visible in installer output rather than silent.

## What this docs page does *not* cover

The skill content itself — patterns, scorer interfaces, span structures — is documented inside each skill's own `SKILL.md` and reference files. Read those after install.
