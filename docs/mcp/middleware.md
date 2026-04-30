# Middleware

Source: [`middleware.py`](../../databricks-mcp-server/databricks_mcp_server/middleware.py)

There is exactly one middleware: `TimeoutHandlingMiddleware`. Its responsibilities are larger than the name suggests — it is the single place all tool errors are converted to a shape the agent can act on.

## What it does

For every tool call, in order:

1. **Run the tool** via `await call_next(context)`.
2. **Backfill `structured_content`** if FastMCP didn't.
3. **Catch `TimeoutError`** and raise it as a `ToolError` with `action_required` text.
4. **Re-raise `CancelledError`** untouched so the MCP SDK's cancel handler runs.
5. **Catch every other `Exception`** and raise it as a structured `ToolError`.

## 1. `structured_content` backfill

When a tool's return type annotation is something like `-> Dict[str, Any]`, FastMCP generates an `outputSchema` for the tool. The MCP SDK then *requires* `structured_content` to be set on the response — if it isn't, validation fails with "outputSchema defined but no structured output."

FastMCP doesn't always populate `structured_content` automatically. The middleware patches that up: if the tool returned exactly one `TextContent` block whose body parses as a JSON object, the middleware copies the parsed dict into `structured_content`. Non-JSON / non-dict bodies are left alone.

This backfill is the reason most tools return a `Dict[str, Any]` instead of bare strings — going through JSON gives the client both the human-readable text *and* the structured payload at no extra cost.

## 2. Timeouts → "do not retry" responses

When a tool exceeds its `@mcp.tool(timeout=...)` window (or otherwise raises `TimeoutError`), the middleware emits a structured error:

```json
{
  "error": true,
  "error_type": "timeout",
  "tool": "manage_pipeline",
  "message": "Operation timed out after 300 seconds",
  "action_required": "Operation may still be in progress. Do NOT retry the same call. Use the appropriate get/status tool to check current state."
}
```

It is wrapped in a `ToolError` (not returned as a regular result) so the MCP SDK marks the response with `isError=True`. That bypasses outputSchema validation — important because the tool's normal output shape never matches an error envelope.

The `action_required` text is critical for agent behaviour. Without it, agents interpret a timeout as a failed call and retry with the same arguments, which can create duplicate jobs / pipelines / endpoints. With it, the model is told to call `manage_pipeline(action="get")` (or similar) to check current state instead.

> For timeouts to actually fire on sync tool bodies, the server must wrap them in `asyncio.to_thread()` — that's the `_patch_tool_decorator_for_async` patch in `server.py`. Without that wrapper, blocking sync code never yields and the timeout cannot be raised.

## 3. Cancellation

The middleware re-raises `anyio.get_cancelled_exc_class()` instead of catching it. Returning a `ToolResult` after a cancellation would tell the MCP SDK to call `message.respond()` — but the cancellation handler may already have responded, triggering an assertion crash. See modelcontextprotocol/python-sdk#1153.

## 4. Generic exception catch

Anything else raised from a tool is logged with full traceback to stderr, then re-raised as:

```json
{
  "error": true,
  "error_type": "ValueError",          // or whatever exception class was raised
  "tool": "execute_sql",
  "message": "Table not found: ..."
}
```

Two consequences:

- **The MCP server never crashes from a tool exception.** It logs and returns a structured failure. Operators can keep the server up across user errors.
- **The agent gets typed errors.** The `error_type` field lets the model distinguish between `SQLExecutionError`, `JobError`, `TimeoutError`, and the generic SDK exceptions, and choose a recovery path.

## What the middleware does *not* do

- It does not retry.
- It does not enforce idempotency — that lives inside individual tools (e.g. `manage_jobs(action="create")` checks for an existing job by name before creating).
- It does not modify successful return values beyond the `structured_content` backfill.

## Related

- [architecture.md](architecture.md) — why the `to_thread` wrapper is required for timeouts to work at all
- [tools.md](tools.md) — every `@mcp.tool` declares its own `timeout=` value
