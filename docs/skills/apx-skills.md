# APX skills

A single skill — `databricks-app-apx` — hosted in [`github.com/databricks-solutions/apx`](https://github.com/databricks-solutions/apx) under `skills/apx`. Like the MLflow skills, it cannot be installed `--local`; the installer always downloads it.

## Source

```
https://raw.githubusercontent.com/databricks-solutions/apx/<ref>/skills/apx/SKILL.md
```

`<ref>` defaults to `main`; pin via `--apx-version <branch|tag>`.

## What APX is

APX is a Databricks-hosted framework for building React/Next.js Databricks Apps. The skill teaches an agent how to build a full-stack app with the APX scaffold — auth, backend patterns, and frontend patterns.

## What gets installed

```
.claude/skills/databricks-app-apx/
├── SKILL.md
├── backend-patterns.md
└── frontend-patterns.md
```

`install_skills.sh::get_apx_skill_extra_files` lists `backend-patterns.md` and `frontend-patterns.md` as the supporting files. Note: the `databricks-skills` repo's local `install_genie_code_skills.py` (notebook) discovers files dynamically and may upload more, including `best-practices.md` if present in the upstream repo at install time.

There is also a parallel `databricks-app-python` skill in this repo for Python-based apps (Dash, Streamlit, FastAPI, etc.). The two are mutually informative but cover different stacks.

## Profile membership

Listed in `PROFILE_APP_DEVELOPER` alongside `databricks-app-python` — installing the `app-developer` persona profile gets you both. Use `--skills databricks-app-apx` to install the APX one alone.

## Pairs with

No dedicated MCP tool — APX has its own toolchain (CLI, generators) which the agent invokes via `Bash`. The skill's role is to teach the patterns; deployment ultimately goes through `databricks bundle deploy` or the APX-specific commands.

## Updating

Same model as MLflow:

- Default `APX_REPO_REF=main`.
- Pin with `--apx-version`.
- Missing optional supporting files print `○` and don't fail the install; a missing `SKILL.md` fails the skill.
