# Client setup

How clients launch the server. The transport is the same in every case (JSON-RPC over stdio for local clients, streamable HTTP for the gateway), but the configuration glue differs.

## Local install

Run `./databricks-mcp-server/setup.sh` from the repo root. It:

1. Verifies `uv` is installed.
2. Creates `.venv/` at the repo root, Python 3.11.
3. Installs `databricks-tools-core` and `databricks-mcp-server` as editable packages.
4. Verifies `import databricks_mcp_server` works.
5. Prints copy-pasteable `.mcp.json` / `.cursor/mcp.json` snippets pointing at `${repo}/databricks-mcp-server/run_server.py`.

After this, the entry point is always:

```
${repo}/.venv/bin/python ${repo}/databricks-mcp-server/run_server.py
```

## Authentication

The server picks up auth from one of:

- `DATABRICKS_HOST` + `DATABRICKS_TOKEN` env vars
- `DATABRICKS_CONFIG_PROFILE` env var → profile in `~/.databrickscfg`
- default profile in `~/.databrickscfg`

The `manage_workspace` tool can switch active workspace at runtime within a session — see [tools.md § `manage_workspace`](tools.md#workspace-switching--toolsworkspacepy).

## Claude Code

`.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "databricks": {
      "command": "uv",
      "args": ["run", "--directory", "/path/to/ai-dev-kit", "python", "databricks-mcp-server/run_server.py"],
      "defer_loading": true
    }
  }
}
```

`defer_loading: true` skips upfront tool registration on session start; tools are registered the first time the agent uses one. With ~25 consolidated tools this saves a noticeable amount of time on every Claude Code session start.

Equivalent CLI:

```bash
claude mcp add-json databricks '{
  "command": "/path/to/ai-dev-kit/.venv/bin/python",
  "args": ["/path/to/ai-dev-kit/databricks-mcp-server/run_server.py"]
}'
```

## Cursor

`.cursor/mcp.json` — same shape as `.mcp.json`. Cursor does not implement `defer_loading`, so omit that key.

## VS Code / GitHub Copilot, Windsurf, Antigravity, OpenCode, Codex, Gemini CLI

Each client has its own config file and slightly different field names; `install.sh` handles them in one shot. Run it from the project where you want the configs created:

```bash
bash <(curl -sL https://raw.githubusercontent.com/databricks-solutions/ai-dev-kit/main/install.sh)
```

Tool selection: `--tools cursor,gemini,antigravity,windsurf,opencode`.

## Builder App (in-process MCP)

The Builder App imports the MCP server in-process — no subprocess. The agent created for each chat message is configured with the FastMCP instance directly:

- `databricks-builder-app/server/services/agent.py` builds the `ClaudeAgentOptions.mcp_servers` mapping pointing at the same `mcp` instance from `databricks_mcp_server.server`.
- The Builder App does its own per-request auth via `set_databricks_auth(host, token)` on contextvars (see [`../tools/auth.md`](../tools/auth.md)). The MCP `manage_workspace` tool is *not* in scope here — multi-user means module-level switching is unsafe.

Because the import is in-process, the `_patch_subprocess_stdin` Windows fix and the `_patch_tool_decorator_for_async` patch from `server.py` are still applied at import time and still matter (Builder App backend is also Python).

## MCP gateway (HTTP)

Deploying the Builder App with `--enable-mcp` exposes the same FastMCP instance over **streamable HTTP** at `/mcp`:

```bash
cd databricks-builder-app
./scripts/deploy.sh mcp-builder-app --enable-mcp --profile <your-profile>
```

The gateway is at [`databricks-builder-app/server/mcp_gateway.py`](../../databricks-builder-app/server/mcp_gateway.py). MCP clients (Genie Code, AI Playground, etc.) connect to:

```
https://<your-app-url>/mcp
```

Two notes:

- The deployed app's name **must start with `mcp-`** so the gateway routes are mounted.
- Auth in this mode is via the Builder App's own auth layer (Databricks OAuth from Apps, then `set_databricks_auth` on contextvars per request) — **not** local `~/.databrickscfg`.

## Genie Code

Genie Code reads MCP servers from a workspace location. There is no local stdio process; instead, point Genie Code at the deployed gateway URL above (the `mcp-` prefixed Builder App). The skills tree under `/Workspace/Users/<you>/.assistant/skills` is uploaded separately by `databricks-skills/install_skills.sh --install-to-genie`.

## Debugging the connection

- Set `DATABRICKS_MCP_DEBUG=1` in the spawning client's env. The server's `run_server.py` flips logging to DEBUG on stderr.
- Stdio servers must keep `stdout` clean for JSON-RPC. Anything you print to stdout — directly or via a noisy library — corrupts the protocol. Always log to stderr.
- Pre-1.0 clients sometimes don't show server stderr. To capture it, run the client from a terminal and tail its log; or run the server standalone first and pipe a known JSON-RPC frame to it to confirm it boots.
