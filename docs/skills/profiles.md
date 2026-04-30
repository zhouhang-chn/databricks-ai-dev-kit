# Persona profiles

Source: [`install.sh`](../../install.sh) (`PROFILE_*` and `CORE_SKILLS` variables)

`install.sh` does not install everything by default — it asks the user which persona profile to use and installs the matching subset. Profiles are an `install.sh`-only concept; `install_skills.sh` takes explicit skill names instead.

## How profiles compose

```
<installed skills> = CORE_SKILLS  ∪  PROFILE_<persona>  [for each --skills-profile]
```

Multiple profiles are additive. Specifying `--skills-profile data-engineer,ai-ml-engineer` installs the union of both. Core skills are always added.

`--skills <names>` overrides profile selection entirely.

## Core skills (always installed)

These ship with every `install.sh` run:

| Skill | Why it's core |
|-------|---------------|
| `databricks-config` | Workspace switching / profile authentication — needed before any other skill can act |
| `databricks-docs` | The fallback skill that answers "I don't know how this Databricks feature works" via `llms.txt` |
| `databricks-python-sdk` | The SDK + Connect + REST API reference; nearly every other skill assumes it |
| `databricks-unity-catalog` | System tables + volume operations; broadly applicable governance / observability |

Enforced unconditionally — there is no flag to opt out.

## Profile: `data-engineer`

Pipelines, Spark, batch + streaming, Jobs, governance, IRC.

```
databricks-spark-declarative-pipelines    # SDP / DLT
databricks-spark-structured-streaming     # streaming patterns
databricks-jobs                            # Lakeflow Jobs
databricks-bundles                         # DABs
databricks-dbsql                           # SQL warehouses, materialized views
databricks-iceberg                         # managed Iceberg, UniForm, IRC
databricks-zerobus-ingest                  # gRPC ingestion
spark-python-data-source                   # custom Python data sources
databricks-metric-views                    # governed metrics
databricks-synthetic-data-gen              # test data
```

Plus the four core skills → 14 skills total.

## Profile: `analyst`

Read-side: dashboards, SQL, NL exploration.

```
databricks-aibi-dashboards    # AI/BI dashboards
databricks-dbsql              # SQL features (overlaps with data-engineer)
databricks-genie              # Genie Spaces
databricks-metric-views       # metric views
```

Plus core → 8 skills total.

## Profile: `ai-ml-engineer`

Agents, RAG, evaluation, Vector Search, MLflow tracing/eval.

Databricks side:

```
databricks-agent-bricks                    # KAs, Genie Spaces, MAS
databricks-ai-functions                    # ai_classify, ai_extract, etc.
databricks-vector-search                   # VS endpoints + indexes
databricks-model-serving                   # MLflow models, agents on serving
databricks-genie                           # Genie Spaces (overlaps with analyst)
databricks-unstructured-pdf-generation     # synthetic PDFs for RAG
databricks-mlflow-evaluation               # mlflow.genai.evaluate, scorers
databricks-synthetic-data-gen              # test data (overlaps with data-engineer)
databricks-jobs                            # job-driven evaluation runs
```

Plus the entire MLflow skill set (always added with `ai-ml-engineer`):

```
agent-evaluation
analyze-mlflow-chat-session
analyze-mlflow-trace
instrumenting-with-mlflow-tracing
mlflow-onboarding
querying-mlflow-metrics
retrieving-mlflow-traces
searching-mlflow-docs
```

Plus core → 17 skills total.

## Profile: `app-developer`

Apps + Lakebase + deployment.

```
databricks-app-python              # Dash, Streamlit, FastAPI, etc.
databricks-app-apx                 # APX framework (React/Next.js)
databricks-lakebase-autoscale      # Lakebase Autoscale (managed Postgres)
databricks-lakebase-provisioned    # Lakebase Provisioned
databricks-model-serving           # serving for app backends
databricks-dbsql                   # SQL queries from apps
databricks-jobs                    # background work from apps
databricks-bundles                 # deploy via DABs
```

Plus core → 10 skills total.

> The `databricks-app-apx` skill is the only APX skill; it lives in `databricks-solutions/apx`, not this repo. The installer fetches it over HTTPS and cannot install from `--local`.

## Profile: `all`

Every Databricks + MLflow + APX skill. 35 total. This is the default if no `--skills-profile` is given and the user picks "all" in the interactive prompt.

## Choosing profiles

A few practical rules:

- **Combining profiles is safe.** Skills appear in multiple profiles; the installer dedupes.
- **`databricks-jobs` shows up everywhere.** It's the orchestration substrate for nearly every persona — there's no smaller subset that drops it.
- **Don't ship `all` to end users by default.** 35 skills + 35 trigger descriptions in the agent's context window adds up fast. Pick the persona that matches the user's actual work.
- **Override with `--skills` when you know exactly what you want.** Skipping the profile abstraction is fine — every skill name is a valid argument to `install.sh --skills` and `install_skills.sh`.

## Adding a new skill to a profile

When you add a new Databricks skill to `databricks-skills/`:

1. Pick the profile(s) that should include it.
2. Append the skill name to the matching `PROFILE_*` variable in `install.sh`.
3. If it doesn't fit any persona, leave it out of all profiles — it will still be available via `--skills` and `--skills-profile all`.
4. Update the skill counts in the `--list-skills` handler block in `install.sh` (currently hand-written: "All 34 skills (default)", "Pipelines, Spark, Jobs, Streaming (14 skills)", etc.).

There is **no automated check** that `PROFILE_*` arrays cover every skill or that the counts match. Stay on top of these by hand.
