# `lakebase_autoscale/` — Lakebase Autoscaling

Source: [`databricks_tools_core/lakebase_autoscale/`](../../databricks-tools-core/databricks_tools_core/lakebase_autoscale/)

Lakebase Autoscaling exposes a project / branch / compute hierarchy on top of managed Postgres. Each layer has its own file:

| File | Domain |
|------|--------|
| `projects.py` | Project CRUD |
| `branches.py` | Branch CRUD (per-project) |
| `computes.py` | Endpoint (compute) CRUD (per-branch) |
| `credentials.py` | Generate short-lived DB credentials |

## Public API

### Projects

`create_project`, `get_project`, `list_projects`, `update_project`, `delete_project`. Project names are normalised to a `[a-z0-9-]+` slug via the internal `_normalize_project_name` helper.

### Branches

`create_branch`, `get_branch`, `list_branches(project_name)`, `update_branch`, `delete_branch`.

### Computes (endpoints)

`create_endpoint`, `get_endpoint`, `list_endpoints(branch_name)`, `update_endpoint`, `delete_endpoint(name, max_retries=6, retry_delay=10)`.

`delete_endpoint` retries because the API can return a transient lock during teardown.

### Credentials

`generate_credential(endpoint)` — returns short-lived Postgres credentials for the given compute endpoint.

## Conventions

- **Hierarchy is implicit in the name.** Most lookups are by name, not ID; the helpers resolve the parent at call time. Keep names unique within a parent.
- **Distinct from `lakebase/`.** This is the autoscaling product; `lakebase/` is the provisioned product. They do not share endpoints.

## Related

- MCP wrapper: [`databricks_mcp_server/tools/lakebase.py`](../../databricks-mcp-server/databricks_mcp_server/tools/lakebase.py) (autoscale paths share the same tool module)
- Skill: [`databricks-skills/databricks-lakebase-autoscale/SKILL.md`](../../databricks-skills/databricks-lakebase-autoscale/SKILL.md)
