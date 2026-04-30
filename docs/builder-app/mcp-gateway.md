# MCP Gateway

The Builder App can also serve as a Streamable HTTP MCP server at `/mcp`. This is optional and disabled by default.

The implementation lives in `server/mcp_gateway.py`, and the route switch is in `server/app.py`.

## Enablement

Set:

```bash
ENABLE_MCP_GATEWAY=true
FASTMCP_STATELESS_HTTP=true
```

The deploy script adds both when called with `--enable-mcp`:

```bash
cd databricks-builder-app
./scripts/deploy.sh mcp-builder-app --profile <profile> --enable-mcp
```

For Genie Code discovery, the Databricks App name should start with `mcp-`.

## Routes

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/mcp` | MCP protocol endpoint using Streamable HTTP |
| `GET` | `/mcp` | JSON server info for simple probes without SSE accept headers |
| `GET` | `/mcp/health` | Health check with tool and skill counts |
| `GET` | `/mcp/tools` | Registered MCP tool names and short descriptions |
| `GET` | `/mcp/skills` | Available skill names and short descriptions |
| `GET` | `/mcp/info` | HTML info page |

The gateway keeps the main Builder UI at `/` and the REST API at `/api/*`.

## ASGI Wiring

When enabled, `server/app.py` creates the gateway and then replaces the exported `app` with an ASGI wrapper:

- lifespan scopes go to the main FastAPI app
- `/mcp*` HTTP and websocket scopes go to the gateway
- all other scopes go to the main FastAPI app

The inner FastMCP ASGI app needs lifespan startup for its Streamable HTTP session manager. FastAPI startup calls `start_mcp_lifespan()` with synthetic ASGI lifespan events and stores the task for shutdown.

## Middleware Stack

The gateway wraps the FastMCP HTTP app with middleware scoped only to `/mcp*`:

```text
GatewayCORSMiddleware
  PATAuthMiddleware
    MCPFallbackMiddleware
      DiagnosticRoutesMiddleware
        FastMCP http_app(path="/mcp", stateless_http=True)
```

### Gateway CORS

`GatewayCORSMiddleware` allows browser-based MCP clients such as AI Playground and Genie Code to call `/mcp*`. This is intentionally separate from the main FastAPI CORS settings.

### PAT Auth

`PATAuthMiddleware` recognizes `Authorization: Bearer dapi...` tokens and validates them by calling the workspace SCIM `/Me` endpoint. Validity is cached in memory. If no workspace host is available or validation errors, the middleware logs a warning and accepts the token.

### GET /mcp Fallback

`MCPFallbackMiddleware` makes `GET /mcp` return JSON server info unless the request asks for `text/event-stream`. This produces friendlier behavior for health probes and browsers.

### Diagnostic Routes

`DiagnosticRoutesMiddleware` handles `/mcp/health`, `/mcp/tools`, `/mcp/skills`, and `/mcp/info` before traffic reaches the MCP protocol handler.

## Tool and Skill Sources

The gateway reuses:

- the `databricks_mcp_server.server.mcp` FastMCP server
- tool registrations from `databricks-mcp-server`
- skill metadata read from the skills directory

It does not use the per-project skill enablement model from the Builder UI. It exposes the server-level tools and available skills for MCP clients.

## Client Setup

Use:

```text
https://<databricks-app-url>/mcp
```

Client notes:

| Client | Setup |
|--------|-------|
| Genie Code | Deploy with `--enable-mcp` and `mcp-` prefix, then select the app under Genie Space settings |
| AI Playground | Add the app `/mcp` URL as an MCP server |
| Generic MCP client | Configure Streamable HTTP transport pointing at `/mcp` |

## Local Testing

The local dev script does not enable the gateway by default. To test it:

```bash
cd databricks-builder-app
ENABLE_MCP_GATEWAY=true FASTMCP_STATELESS_HTTP=true uv run uvicorn server.app:app --reload --port 8000 --reload-dir server
```

Then inspect:

```bash
curl -fsS http://127.0.0.1:8000/mcp/health
curl -fsS http://127.0.0.1:8000/mcp/tools
curl -fsS http://127.0.0.1:8000/mcp/skills
```

## Troubleshooting

| Symptom | Check |
|---------|-------|
| `/mcp/health` 404s | `ENABLE_MCP_GATEWAY=true` was not set at process start |
| Genie Code cannot find the app | App name must start with `mcp-` |
| Browser MCP client blocked by CORS | Confirm request path starts with `/mcp`; main app CORS does not apply |
| `/mcp/tools` is empty | Check bundled `databricks_mcp_server` package and gateway startup logs |
| PAT rejected | Confirm token starts with `dapi` and can call `/api/2.0/preview/scim/v2/Me` on the workspace |

