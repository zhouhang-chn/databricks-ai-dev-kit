# Installation paths

There are two installers, plus a notebook variant for Genie Code. They overlap but have distinct sweet spots.

## `install.sh` — top-level installer (recommended)

`install.sh` (and its PowerShell equivalent `install.ps1`) is the user-facing one-liner. It installs:

1. Skills under `.claude/skills/` (subset chosen via persona profile).
2. The MCP server (cloned to `~/.ai-dev-kit/repo` by default; see `--mcp-path`).
3. Editor config (`.mcp.json`, `.cursor/mcp.json`, `~/.codeium/...`, etc.) for the tools you select.

```bash
# Default: prompts for tools and persona profile
bash <(curl -sL https://raw.githubusercontent.com/databricks-solutions/ai-dev-kit/main/install.sh)

# Pin everything via flags
bash <(curl -sL .../install.sh) \
  --profile DEFAULT \
  --skills-profile data-engineer,ai-ml-engineer \
  --tools claude,cursor \
  --force

# Skills only — skip MCP server bootstrap
bash <(curl -sL .../install.sh) --skills-only

# MCP only — skip skills
bash <(curl -sL .../install.sh) --mcp-only

# Specific skills (overrides --skills-profile)
bash <(curl -sL .../install.sh) --skills databricks-jobs,databricks-dbsql
```

Other relevant flags:

| Flag | Purpose |
|------|---------|
| `--global` | Install configs to user-scope (e.g. `~/.cursor/mcp.json`) instead of project-scope |
| `--branch <name>` | Pin to a git branch/tag (default: latest release tag) |
| `--mcp-path <path>` | Where the MCP server is cloned (default: `~/.ai-dev-kit`) |
| `--list-skills` | Print profiles and skills, exit |
| `--silent` | No stdout; errors only |

Equivalent environment variables: `DEVKIT_PROFILE`, `DEVKIT_BRANCH`, `DEVKIT_SCOPE`, `DEVKIT_TOOLS`, `DEVKIT_FORCE`, `DEVKIT_MCP_PATH`, `DEVKIT_SKILLS_PROFILE`, `DEVKIT_SKILLS`, `DEVKIT_SILENT`, plus `AIDEVKIT_HOME` for the install root.

The skills-only path of `install.sh` ultimately delegates to `install_skills.sh`, so anything in this top-level installer that touches skills is doing so through that script.

## `install_skills.sh` — skills-only

A simpler installer that does *just* skills. Use it from your project root when you don't want the kit to manage MCP / editor configs, or when you want fine-grained per-skill control.

Source: [`databricks-skills/install_skills.sh`](../../databricks-skills/install_skills.sh)

```bash
# Install all skills from this checkout (network only for MLflow + APX)
./databricks-skills/install_skills.sh --local

# Install all skills, downloading everything from GitHub
./databricks-skills/install_skills.sh

# Specific skills (no profile abstraction here — list by name)
./databricks-skills/install_skills.sh databricks-bundles agent-evaluation

# Pin sources
./databricks-skills/install_skills.sh --mlflow-version v1.0.0 --apx-version v0.5.0

# Install + upload to workspace for Genie Code (in one go)
./databricks-skills/install_skills.sh --install-to-genie --profile prod
```

Or, without cloning the repo:

```bash
curl -sSL https://raw.githubusercontent.com/databricks-solutions/ai-dev-kit/main/databricks-skills/install_skills.sh \
  | bash -s -- databricks-bundles agent-evaluation
```

### What runs vs. what downloads

| Source | `--local` flag | Default |
|--------|----------------|---------|
| Databricks skills (this repo) | Copied from `databricks-skills/` on disk | Each `SKILL.md` and listed extras downloaded via `curl` from `raw.githubusercontent.com/.../main/...` |
| MLflow skills | **Cannot use `--local`** (would fail explicitly). Always downloaded from `mlflow/skills` | Same |
| APX skills | **Cannot use `--local`**. Always downloaded from `databricks-solutions/apx`, path `skills/apx` | Same |

Default upstream refs: `MLFLOW_REPO_REF=main`, `APX_REPO_REF=main`. Override via `--mlflow-version` / `--apx-version`.

### What lands on disk

Every install puts skills under `.claude/skills/` **relative to the current working directory**. There is no global path. Run the script from your project root.

For each skill the installer fetches:

1. `SKILL.md` — required. If this download fails, the skill is removed and counted as failed.
2. The supporting files declared in `get_skill_extra_files` / `get_mlflow_skill_extra_files` / `get_apx_skill_extra_files`. Optional: missing files are reported with a `○` and don't fail the install.

Adding a new file alongside an existing skill **must** be reflected in those `case` arms. See [authoring.md](authoring.md).

## `--install-to-genie` — local + workspace upload

`install_skills.sh --install-to-genie` runs the normal local install, then uploads `./.claude/skills` into your workspace at `/Workspace/Users/<you>/.assistant/skills/`. From there, Genie Code and the Assistant agent mode can use the skills without any per-project install.

Mechanics:

- Requires the `databricks` CLI on PATH and a working profile (`--profile <name>` or `DATABRICKS_CONFIG_PROFILE`, default `DEFAULT`).
- Resolves the workspace user via `databricks current-user me --profile ... --output json`.
- `mkdirs` the target path; then for each skill, `mkdirs` the skill directory and `import` each `*.md` / `*.py` / `*.yaml` / `*.yml` / `*.sh` file with `--format AUTO --overwrite`.
- Skills with names starting with `.` and the `TEMPLATE` directory are skipped.
- Errors during `mkdirs`/`import` are swallowed (`2>/dev/null || true`); the installer prints `Workspace listing` at the end so you can verify.

> The local `.claude/skills/` directory is the *source of truth* for the upload. Edit it directly if you want to customise what lands in the workspace.

## `install_genie_code_skills.py` — Databricks notebook variant

For users who don't want to run anything locally. Source: [`databricks-skills/install_genie_code_skills.py`](../../databricks-skills/install_genie_code_skills.py)

Imported into a Databricks workspace as a notebook and run cell-by-cell. It uses the GitHub Trees API to discover skills across all three sources, then uploads them via the Databricks SDK to `/Workspace/Users/<you>/.assistant/skills/`.

Differences from the bash installer:

- **Discovery is dynamic**, not via the explicit `case` allowlists. Every file in the skill directory tree (excluding dotfiles and `TEMPLATE`) is uploaded.
- **No local state.** Everything downloads from GitHub at runtime; nothing lands on a local filesystem.
- Configurable subset via the `INSTALL_SKILLS` cell (default `"all"`; can be a list of skill names).
- Compatible with serverless workspaces.

## Resulting layout

After any installer:

```
<project_or_genie_workspace>/
└── .claude/skills/                              # local target
    ├── databricks-jobs/
    │   ├── SKILL.md
    │   ├── examples.md
    │   └── ...
    ├── agent-evaluation/                       # MLflow source
    ├── databricks-app-apx/                      # APX source
    └── ...

# OR

/Workspace/Users/<you>/.assistant/skills/        # Genie Code target
└── ... (same per-skill layout)
```

Most agents (Claude Code, Cursor) auto-discover `.claude/skills/`. Some agents (Cursor, Copilot) need the project's MCP/skills config updated by hand after install — `install.sh` prints reminders for these.

## Updating

Skills only ship after a tagged release. The default `--branch` is the latest release; rerunning the installer will pick up new releases. Use `--branch main` to install bleeding-edge skill content (don't combine with the MCP server install — the server expects matched releases).

`--force` re-downloads / re-copies even if a skill directory already exists. Without `--force`, existing skill directories are removed and re-created on every run anyway (`install_skills.sh::download_skill` does `rm -rf` before re-creating). The flag is more relevant for MCP server / editor config installation in `install.sh`.
