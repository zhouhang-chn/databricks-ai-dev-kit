# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

This is a multi-package monorepo. The four top-level deliverables share code via local editable installs:

- `databricks-tools-core/` — Python library of high-level Databricks functions. Source under `databricks_tools_core/` is grouped by domain (`sql/`, `jobs/`, `unity_catalog/`, `compute/`, `spark_declarative_pipelines/`, `serving/`, `vector_search/`, `lakebase/`, `apps/`, `agent_bricks/`, `aibi_dashboards/`, `dabs/`, `pdf/`, `file/`). All functions resolve credentials through `auth.py::get_workspace_client()` (contextvars → env vars → `~/.databrickscfg` profile).
- `databricks-mcp-server/` — Thin FastMCP wrapper that exposes `databricks-tools-core` functions as MCP tools. Tool modules in `databricks_mcp_server/tools/` mostly forward to core; `manifest.py` tracks created resources in a local `.databricks-resources.json`. The server has Windows-specific subprocess patches that must run before FastMCP init (see `server.py::_patch_subprocess_stdin`).
- `databricks-builder-app/` — Full-stack web app. FastAPI backend in `server/` (routers + services), React/Vite/Tailwind/TypeScript frontend in `client/`, Alembic migrations in `alembic/`. Each user message spawns a Claude Code session via `claude-agent-sdk`, configured with the Databricks MCP server in-process. **Important:** the agent runs in a fresh event loop in a separate thread with `contextvars` copied across — this is a workaround for `claude-agent-sdk` issue #462; see `EVENT_LOOP_FIX.md`. Optionally serves `/mcp` as an MCP gateway (`mcp_gateway.py`) when deployed with `--enable-mcp`.
- `databricks-skills/` — Markdown skill packages (`<skill-name>/SKILL.md` plus optional supporting docs). Each `SKILL.md` has YAML frontmatter with `name` and `description` (the description acts as the trigger condition). `install_skills.sh` and `install_genie_code_skills.py` install them to `.claude/skills/` (and optionally upload to a workspace under `/Workspace/Users/<you>/.assistant/skills`).
- `.test/` — Skill evaluation/optimization framework using GEPA + MLflow judges. The only place `litellm` is allowed (pinned for security).

## Common Commands

### Setup
```bash
# Install MCP server + core for local dev (creates .venv at repo root)
./databricks-mcp-server/setup.sh
```

### Tests
```bash
# Core unit tests
cd databricks-tools-core && uv run pytest tests/unit -v

# Workspace-backed integration tests (need DATABRICKS_HOST/TOKEN or DATABRICKS_CONFIG_PROFILE)
cd databricks-tools-core && uv run pytest tests/integration -m "integration and not slow" -v

# MCP server tests
cd databricks-mcp-server && uv run pytest tests -v

# Validate skill structure (run when adding/editing databricks-skills/)
python .github/scripts/validate_skills.py
```

### Builder App
```bash
# Local dev: provisions Lakebase, installs deps, starts backend :8000 + frontend :3000
cd databricks-builder-app && ./scripts/start_local.sh --profile <profile>

# Deploy to Databricks (optionally with --enable-mcp gateway; name must start with mcp-)
./scripts/deploy.sh my-builder-app --profile <profile>

# Frontend: pnpm only — do not introduce npm lockfiles
cd databricks-builder-app/client && pnpm install && pnpm lint && pnpm build:typecheck
```

### Lint / Format (mirrors CI)
```bash
uvx ruff@0.11.0 check \
  --select=E,F,B,PIE --ignore=E401,E402,F401,F403,B017,B904,ANN,TCH \
  --line-length=120 --target-version=py311 \
  databricks-tools-core/ databricks-mcp-server/ .test/src/

uvx ruff@0.11.0 format --check --line-length=120 --target-version=py311 \
  databricks-tools-core/ databricks-mcp-server/ .test/src/
```

The Builder App uses a different ruff config (line-length 100, 2-space indent, single quotes, Google docstrings) defined in `databricks-builder-app/pyproject.toml` — do not apply the core ruff settings to `server/`.

## Conventions

- **Python**: PEP 8, type hints on public functions, 120-char lines for core/MCP, 100-char/2-space/single-quote for builder app `server/`. Target py311.
- **Naming**: lowercase-hyphenated directories (`databricks-tools-core`), lowercase_underscored Python packages (`databricks_tools_core`).
- **Tests**: name `test_*.py`. Mark workspace-dependent tests with `@pytest.mark.integration`; mark expensive lifecycle tests with `@pytest.mark.slow`. Default test resource prefix is `ai_dev_kit_test`.
- **Frontend**: TypeScript, ESLint, Vite, Tailwind. Use `pnpm` / `pnpm dlx` (never `npm` / `npx`).
- **Skill authoring**: each skill is a directory under `databricks-skills/` with `SKILL.md` (frontmatter `name` + `description` defining trigger). Add new skills to the README skills table. The `main` install script clones the latest release, so skill updates won't ship until a new release is cut.

## Authentication Model

Two modes, both routed through `databricks_tools_core.auth`:
- **Single-user (CLI/scripts/MCP server)**: env vars (`DATABRICKS_HOST`/`DATABRICKS_TOKEN`) or `DATABRICKS_CONFIG_PROFILE`. The MCP `manage_workspace` tool can also override at runtime via module-level globals (single-user stdio assumption).
- **Multi-user (Builder App)**: per-request credentials set on `contextvars` via `set_databricks_auth(host, token)` / `clear_databricks_auth()`. Any code calling `get_workspace_client()` picks up the current request's auth. This is why the agent thread must copy contextvars (see `EVENT_LOOP_FIX.md`).

## Contribution Notes

- External PRs are not accepted; this repo is for Databricks Field Engineers. Open issues for requests.
- Test platform changes against a live Databricks workspace before merging.
- Before browser/frontend tests, confirm both `127.0.0.1:8000` and the frontend dev server are reachable.
