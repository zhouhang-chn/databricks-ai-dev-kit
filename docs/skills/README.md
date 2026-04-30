# Skills

A **skill** is a Markdown package — a directory with a `SKILL.md` and optional supporting files — that teaches an AI assistant how to do something. The frontmatter `description` is a **trigger**: agents that support skills (Claude Code, Cursor, Genie Code, Antigravity, …) match user prompts against descriptions and load the matching skill on demand.

The AI Dev Kit does not write skills *for* the agent at runtime. It just installs the right files into `.claude/skills/` (or the workspace `/Workspace/Users/<you>/.assistant/skills/` for Genie Code), and the host agent does the rest.

This documentation set covers **every skill the kit can install** — three sources: this repo's `databricks-skills/`, MLflow's `mlflow/skills` repo, and the APX `databricks-solutions/apx` repo.

## Contents

| Page | Topic |
|------|-------|
| [authoring.md](authoring.md) | Format, frontmatter, validation, conventions for new skills |
| [installation.md](installation.md) | The two installers (`install.sh` profile-aware top-level, `install_skills.sh` per-skill), `--install-to-genie`, and the notebook-based Genie installer |
| [profiles.md](profiles.md) | What each persona profile (`data-engineer`, `analyst`, `ai-ml-engineer`, `app-developer`) installs |
| [databricks-skills.md](databricks-skills.md) | Detailed reference for the 26 Databricks skills bundled in this repo |
| [mlflow-skills.md](mlflow-skills.md) | Detailed reference for the 8 MLflow skills fetched from `mlflow/skills` |
| [apx-skills.md](apx-skills.md) | Detailed reference for the APX skill fetched from `databricks-solutions/apx` |

## At a glance

35 skills total split across three sources:

| Source | Skills | Where it's hosted | How it's installed |
|--------|--------|-------------------|---------------------|
| **Databricks (this repo)** | 26 | `databricks-skills/<name>/` | `--local` copies from disk; default downloads via raw GitHub |
| **MLflow** | 8 | `github.com/mlflow/skills` | Always downloaded over HTTPS; cannot install `--local` |
| **APX** | 1 | `github.com/databricks-solutions/apx`, path `skills/apx` | Always downloaded over HTTPS; cannot install `--local` |

Pinning is per-source: `--mlflow-version <ref>` and `--apx-version <ref>` (default `main`). Databricks skills follow this repo's release tag.

## What a skill looks like on disk

After installation:

```
.claude/skills/
├── databricks-jobs/
│   ├── SKILL.md                 # frontmatter + body
│   ├── examples.md
│   ├── notifications-monitoring.md
│   ├── task-types.md
│   └── triggers-schedules.md
├── databricks-spark-declarative-pipelines/
│   ├── SKILL.md
│   ├── 1-ingestion-patterns.md
│   ├── 2-streaming-patterns.md
│   └── ...
├── agent-evaluation/
│   ├── SKILL.md
│   ├── references/
│   │   ├── dataset-preparation.md
│   │   └── ...
│   └── scripts/
│       ├── analyze_results.py
│       └── ...
└── ...
```

Each skill is self-contained. Adding/removing a skill is a directory move. No central registry to update on disk — `MEMORY.md`-style indexing is not used here.

## Two install targets

1. **Local agent (Claude Code, Cursor, …).** Skills live at `<project>/.claude/skills/`. Most agents auto-load skills from this path; some need their own config (covered in [installation.md](installation.md)).
2. **Workspace (Genie Code, Assistant agent mode).** Skills live at `/Workspace/Users/<you>/.assistant/skills/`. Either of two installers can put them there:
   - `install_skills.sh --install-to-genie` (runs locally, uses the `databricks` CLI to upload).
   - `install_genie_code_skills.py` (run as a Databricks notebook; no local terminal needed).

The two targets are independent — a project can use one, the other, or both.

## What this docs set is *not*

- **A copy of the SKILL.md content.** The skills already are documentation. These pages cover *what is installed where, by which installer, and from where*, plus enough framing to choose between them. For the actual skill content, read the SKILL.md (locally under `databricks-skills/`, or in `.claude/skills/` after install).
- **Authoritative trigger list.** The `description` field of each SKILL.md is the source of truth for triggers. The summaries below paraphrase but should not be relied on for what an agent will or will not load.
