# `vector_search/` — Databricks Vector Search

Source: [`databricks_tools_core/vector_search/`](../../databricks-tools-core/databricks_tools_core/vector_search/)

Endpoint and index lifecycle plus query/upsert helpers. Two files:

- `endpoints.py` — VS endpoint CRUD.
- `indexes.py` — VS index CRUD, sync, query, upsert/delete.

## Public API

### Endpoints

| Function | Notes |
|----------|-------|
| `create_vs_endpoint(name, endpoint_type="STANDARD", budget_policy_id=None)` | |
| `get_vs_endpoint(name)` | |
| `list_vs_endpoints()` | |
| `delete_vs_endpoint(name)` | |

### Indexes

| Function | Notes |
|----------|-------|
| `create_vs_index(index_name, endpoint_name, primary_key, embedding_source_column=None, embedding_model_endpoint_name=None, embedding_dimension=None, source_table=None, pipeline_type="TRIGGERED", schema=None)` | Creates either a Delta-sync index (when `source_table` is set) or a direct-access index (when `schema` is set). Raises if both / neither are given. |
| `get_vs_index(index_name)` | |
| `list_vs_indexes(endpoint_name)` | |
| `delete_vs_index(index_name)` | |
| `sync_vs_index(index_name)` | Trigger a sync for Delta-sync indexes. |
| `query_vs_index(index_name, query_text=None, query_vector=None, columns=None, num_results=10, filters=None, ...)` | One of `query_text`/`query_vector` must be set. `filters` accepts the VS filter dict. |
| `upsert_vs_data(index_name, rows)` | Direct-access only. |
| `delete_vs_data(index_name, primary_keys)` | Direct-access only. |
| `scan_vs_index(index_name, num_results=100, ...)` | Iterates rows for inspection / debugging. |

## Conventions

- **Index shape is decided at create time.** Passing `source_table` makes a Delta-sync index; passing `schema` makes a direct-access index. The two cannot be converted.
- **Embedding source.** For managed embeddings, set both `embedding_source_column` and `embedding_model_endpoint_name`. For self-managed embeddings, set the embedding column in `schema` and skip the source-column kwarg.

## Related

- MCP wrapper: [`databricks_mcp_server/tools/vector_search.py`](../../databricks-mcp-server/databricks_mcp_server/tools/vector_search.py)
- Skill: [`databricks-skills/databricks-vector-search/SKILL.md`](../../databricks-skills/databricks-vector-search/SKILL.md)
