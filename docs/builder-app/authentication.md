# Authentication

The Builder App has two related auth concerns:

1. Identifying the caller for project and conversation ownership.
2. Supplying Databricks credentials to tools, Lakebase, and the Claude-compatible model endpoint.

The implementation lives primarily in `server/services/user.py`, `server/services/agent.py`, and `server/db/database.py`.

## User Identity Resolution

`get_current_user(request)` resolves identity in this order:

| Priority | Source | Typical caller |
|----------|--------|----------------|
| 1 | `X-Forwarded-Email` | M2M caller that forwards the real user identity |
| 2 | `X-Forwarded-User` | Browser request through the Databricks Apps proxy |
| 3 | `Authorization: Bearer <token>` | Another Databricks App calling this app |
| 4 | Databricks SDK `current_user.me()` | Local development only |

Bearer token identities are resolved with the Databricks SCIM `/Me` API and cached by token hash for five minutes.

In production, if no forwarded header or valid Bearer token is present, the request fails instead of falling back to an environment user.

## Local Development

With `ENV=development`, the app falls back to:

- `DATABRICKS_TOKEN` for Databricks API calls
- `DATABRICKS_HOST` for workspace URL
- Databricks SDK current user lookup for user identity

All local browser users share the same Databricks credentials because there is no Databricks Apps proxy injecting per-user headers.

## Production Browser Requests

In Databricks Apps, the proxy injects:

- `X-Forwarded-User`
- `X-Forwarded-Access-Token`
- service principal OAuth environment variables

The app uses the forwarded identity to scope projects, conversations, messages, and executions.

Resource selector endpoints such as `/api/clusters` and `/api/warehouses` call `get_current_token()`. In production that returns `None`, which lets the Databricks SDK use app service principal OAuth credentials from the environment.

Agent invocation uses `get_fmapi_token()` instead. In production this generates a fresh service principal OAuth token and passes it to both FMAPI and default Databricks tool auth unless the request provides explicit cross-workspace tool credentials.

## FMAPI Token vs Tool Token

`/api/invoke_agent` splits credentials into two roles:

| Credential role | Purpose |
|-----------------|---------|
| FMAPI host/token | Authenticates Claude-compatible requests through Databricks Foundation Model APIs |
| Databricks tools host/token | Authenticates Databricks tool operations such as SQL, jobs, volumes, and serving |

By default both point at the Builder App workspace. If the request supplies `target_databricks_host` and `target_databricks_token`, tool operations target that workspace while FMAPI remains on the Builder App workspace.

The Claude subprocess receives Anthropic-compatible environment variables:

```bash
ANTHROPIC_BASE_URL=https://<workspace-host>/serving-endpoints/anthropic
ANTHROPIC_API_KEY=<fmapi-token>
ANTHROPIC_AUTH_TOKEN=<fmapi-token>
ANTHROPIC_MODEL=<model>
ANTHROPIC_CUSTOM_HEADERS=x-databricks-use-coding-agent-mode: true
CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1
```

## Tool Auth Context

Before running the agent, `stream_agent_response()` calls:

```python
set_databricks_auth(databricks_host, databricks_token, force_token=is_cross_workspace)
```

The Databricks tools in `databricks-tools-core` use this context when creating a `WorkspaceClient`. The context is copied into the fresh agent thread with `copy_context()` so tool calls running inside the Claude Agent SDK see the same credentials.

The auth context is always cleared in a `finally` block after the agent run.

## Cross-workspace Mode

The invoke request accepts:

```json
{
  "target_databricks_host": "https://target-workspace.cloud.databricks.com",
  "target_databricks_token": "..."
}
```

When `target_databricks_host` is present:

- Databricks tools use the target host and token.
- `force_token=True` is passed to the auth context so the target token wins even if service principal OAuth variables exist.
- FMAPI still uses the Builder App workspace token, because model serving for Claude-compatible requests is tied to the app workspace.

## Lakebase Auth

The database layer supports static and dynamic auth.

Static mode:

- Set `LAKEBASE_PG_URL`.
- The URL is converted to the psycopg3 SQLAlchemy driver if needed.
- Good for simple local setups.

Dynamic OAuth mode:

- Set `LAKEBASE_ENDPOINT` and `LAKEBASE_DATABASE_NAME` for Autoscale Lakebase, or
- Set `LAKEBASE_INSTANCE_NAME` and `LAKEBASE_DATABASE_NAME` for Provisioned Lakebase.

In dynamic mode, the app:

1. Uses Databricks SDK credentials to generate a Lakebase OAuth token.
2. Builds a SQLAlchemy URL with username, host, database, and SSL settings.
3. Injects the current token into new DB connections.
4. Refreshes the token every 50 minutes.

## Security Notes

- Project and conversation authorization is enforced by querying through `Project.user_email`.
- Skill file reads are restricted to the project `.claude/skills` directory by resolving the requested path and checking it stays under the skills root.
- The MCP gateway has its own CORS and PAT validation middleware scoped only to `/mcp*`.
- The app is not a strong process isolation boundary for untrusted users. Claude Code runs with access to the project working directory and enabled tools.
