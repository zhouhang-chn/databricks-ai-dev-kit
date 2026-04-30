# Repository Guidelines

## Project Structure & Module Organization

This repository packages Databricks guidance, tools, and a local builder app. Core Python APIs live in `databricks-tools-core/databricks_tools_core/`, with tests under `databricks-tools-core/tests/`. The MCP wrapper is in `databricks-mcp-server/databricks_mcp_server/`, with tests in `databricks-mcp-server/tests/`. The Builder App lives in `databricks-builder-app/`: `server/` is FastAPI, `client/src/` is React/Vite, `alembic/` holds migrations, and `scripts/` contains local/deploy helpers. Databricks skills are Markdown packages in `databricks-skills/<skill-name>/SKILL.md`; skill evaluation tooling lives under `.test/`.

## Build, Test, and Development Commands

- `./databricks-mcp-server/setup.sh`: install the MCP server and core package for local development.
- `cd databricks-tools-core && uv run pytest tests/unit -v`: run core unit tests.
- `cd databricks-tools-core && uv run pytest tests/integration -m "integration and not slow" -v`: run workspace-backed integration tests.
- `cd databricks-mcp-server && uv run pytest tests -v`: run MCP server tests.
- `cd databricks-builder-app && ./scripts/start_local.sh --profile <profile>`: provision local app dependencies and start backend `:8000` plus frontend `:3000`.
- `cd databricks-builder-app/client && pnpm install && pnpm lint && pnpm build:typecheck`: install, lint, type-check, and build the React client.
- `uvx ruff@0.11.0 check databricks-tools-core/ databricks-mcp-server/ .test/src/`: mirror CI linting; use `format --check` on the same paths for formatting.

## Coding Style & Naming Conventions

Python follows PEP 8 with type hints on public functions. CI uses Ruff with Python 3.11 targets and 120-character lines for core/MCP code; the Builder App config uses 2-space indentation and single quotes for `server/`. Use lowercase hyphenated directories such as `databricks-tools-core` and lowercase underscore Python packages such as `databricks_tools_core`. React code uses TypeScript, ESLint, Vite, and Tailwind.

## Testing Guidelines

Name Python tests `test_*.py`. Mark Databricks workspace tests with `@pytest.mark.integration`; mark expensive lifecycle tests with `@pytest.mark.slow`. Integration tests require `DATABRICKS_HOST`/`DATABRICKS_TOKEN` or `DATABRICKS_CONFIG_PROFILE`; default test resources use the `ai_dev_kit_test` prefix. Validate skills with `python .github/scripts/validate_skills.py` when adding or editing `databricks-skills/`.

## Commit & Pull Request Guidelines

Recent history uses short, imperative summaries such as `Fix ...`, `Add ...`, `Update ...`, and `Bump ...`. Keep commits focused. PRs should include a brief description, context, tests performed, and screenshots for UI changes. Contributions are primarily intended for Databricks Field Engineers; test platform API changes against a live workspace.

## Agent-Specific Instructions

Use `pnpm`, not `npm`, for frontend package commands; convert `npm` examples to `pnpm`, use `pnpm dlx` instead of `npx`, and do not introduce new npm lockfiles. Before browser or frontend tests, confirm both `127.0.0.1:8000` and the frontend server under test are reachable.
