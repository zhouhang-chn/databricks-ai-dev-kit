# Development

How to add a new tool, run tests, and debug.

## Adding a tool

Most additions should go through the consolidated `manage_<thing>(action="...")` pattern. Steps:

1. **Add the function in `databricks-tools-core`.** Tools should be a thin shape-shift around a real implementation. If the work is non-trivial, the work belongs in `databricks-tools-core`, not here.
2. **Re-export from the relevant `databricks_tools_core/<domain>/__init__.py`.**
3. **Wire the MCP tool.** Either extend an existing `manage_*` dispatcher with a new branch, or create a new module under `databricks_mcp_server/tools/<domain>.py`.
4. **If the new module is new,** add it to the `from .tools import (...)` block at the bottom of `server.py`. Without that import, `@mcp.tool` decorators don't run and the tool is invisible.
5. **Set a sensible `timeout=`.** See [conventions.md § Timeouts](conventions.md#timeouts).
6. **Track resources** when applicable: `register_deleter("<type>", <fn>)` at module level, `track_resource(...)` after a successful create, `remove_resource(...)` after a successful delete. See [manifest.md](manifest.md).
7. **Add a docstring the agent can read.** It is the only thing the agent sees besides the parameter schema. Be terse, list valid actions, and describe return shape. See `tools/jobs.py::manage_jobs` for a representative example.
8. **Update the README skills table** if a new skill should accompany the tool, and link to the relevant skill from the docstring (`See databricks-<skill> skill for ...`).

## Tool docstring style

Docstrings are part of the prompt. They should:

- Lead with a single line: what the tool does.
- List actions and what each requires (the model will branch on them).
- Document return shape per action (`Returns: create={...}, get={...}`).
- Cross-reference the matching skill: `See databricks-<skill> skill for configuration details.`
- Avoid prose. Two long sentences are worse than one short table.

## Tests

```bash
# Unit tests (no workspace needed)
cd databricks-mcp-server && uv run pytest tests -v

# Targeted modules
uv run pytest tests/test_middleware.py -v
uv run pytest tests/test_sql_output_format.py -v
uv run pytest tests/test_windows_compat.py -v
uv run pytest tests/test_workspace.py -v

# Integration (needs DATABRICKS_HOST/TOKEN or DATABRICKS_CONFIG_PROFILE)
uv run pytest tests/integration -m "integration and not slow" -v

# All integration tests including slow (10+ min)
uv run pytest tests/integration -m integration -v
```

The integration suite is large; the parallel runner from `tests/TESTING.md` shards by domain into `.test-results/<timestamp>/`.

Default test resource prefix is `ai_dev_kit_test` (configurable via `TEST_CATALOG`).

## Debugging

### Enable debug logs

```bash
DATABRICKS_MCP_DEBUG=1 ${repo}/.venv/bin/python ${repo}/databricks-mcp-server/run_server.py
```

`run_server.py` flips logging to DEBUG on stderr when this env var is set. With clients that don't show server stderr, run the server in a terminal manually and reproduce the failing call.

### Inspect a tool's registered schema

FastMCP builds the JSON schema from the Python signature. To see what the agent actually sees, dump the registered tools:

```python
from databricks_mcp_server.server import mcp
for tool in mcp._tool_manager.tools.values():
    print(tool.name, tool.parameters)
```

(Field names are FastMCP-version-dependent.)

### "Request already responded to" assertions

You almost always have a sync tool body that wasn't wrapped in `asyncio.to_thread`. The `_patch_tool_decorator_for_async` patch in `server.py` should cover this — but if you bypass `@mcp.tool` (e.g., calling FastMCP's underlying API directly), you re-introduce the bug. See [architecture.md § Why every tool runs in a thread pool](architecture.md#why-every-tool-runs-in-a-thread-pool).

### Tools hang on Windows

Symptoms: the first call returns; subsequent calls hang forever.

Most common causes:

1. The subprocess patch didn't run — confirm `sys.platform == "win32"` and that `server.py` was imported (don't construct your own FastMCP instance).
2. A library other than `databricks-sdk` is spawning subprocesses without `stdin=DEVNULL`. Add a similar patch or pass `stdin=subprocess.DEVNULL` explicitly.
3. The FastMCP "docket" worker started anyway — check that `mcp._docket_lifespan` is the no-op override.

### Stdout corruption

The MCP framing on stdio uses raw stdout for JSON-RPC. **Anything else printed to stdout breaks the protocol.** Always log to stderr (`logging.basicConfig(stream=sys.stderr)` or `logger.warning(...)`). Don't `print(...)` anywhere in tool code.

### Manifest got out of sync

The manifest is best-effort. If it shows a resource that no longer exists in the workspace, the agent calling `delete_tracked_resource(..., delete_from_databricks=True)` will fail the workspace delete (resource gone) but will still remove the manifest row. To clean up by hand: edit `.databricks-resources.json` directly. The schema is documented in [manifest.md](manifest.md).

## Lint

The MCP server follows the core ruff config (different from the Builder App):

```bash
uvx ruff@0.11.0 check \
  --select=E,F,B,PIE --ignore=E401,E402,F401,F403,B017,B904,ANN,TCH \
  --line-length=120 --target-version=py311 \
  databricks-mcp-server/

uvx ruff@0.11.0 format --check --line-length=120 --target-version=py311 \
  databricks-mcp-server/
```

CI runs the same command across `databricks-tools-core/`, `databricks-mcp-server/`, and `.test/src/` in one pass — don't drift these.
