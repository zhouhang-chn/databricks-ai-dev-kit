# `agent_bricks/` — Knowledge Assistants, MAS, Genie Spaces

Source: [`databricks_tools_core/agent_bricks/`](../../databricks-tools-core/databricks_tools_core/agent_bricks/)

Agent Bricks is unique in this package: instead of a flat function surface, it exposes a single **`AgentBricksManager` class** that wraps the three Agent Bricks tile types. The class abstracts away the (still-evolving) underlying APIs.

Files:

- `manager.py` — `AgentBricksManager` plus a `TileExampleQueue` background worker for batch question creation.
- `models.py` — Enums (`TileType`, `EndpointStatus`, `Permission`), ID dataclasses (`KAIds`, `MASIds`, `GenieIds`), TypedDicts for API payloads.

## `AgentBricksManager`

The manager has three method families, prefixed by tile type:

| Prefix | Tile type | Common methods |
|--------|-----------|----------------|
| `ka_*` | Knowledge Assistant | `ka_create`, `ka_get`, `ka_update`, `ka_create_or_update`, `ka_sync_sources`, `ka_reconcile_model`, `ka_wait_until_ready`, `ka_wait_until_active`, `ka_wait_until_endpoint_online`, `ka_create_example`, `ka_list_examples`, `ka_delete_example`, `ka_add_examples_batch`, `ka_list_evaluation_runs`, `ka_get_knowledge_sources_from_volumes`, … |
| `mas_*` | Multi-Agent Supervisor | `mas_create`, `mas_get`, `mas_update`, `mas_create_example`, `mas_list_examples`, `mas_update_example`, `mas_delete_example`, `mas_add_examples_batch`, `mas_list_evaluation_runs`, … |
| `genie_*` | Genie Space | `genie_create`, `genie_update`, `genie_delete`, `genie_export`, `genie_import`, `genie_update_with_serialized_space`, `genie_list_questions`, `genie_list_instructions`, `genie_update_sample_questions`, `genie_add_sample_questions_batch`, `genie_add_curated_question`, … |

Cross-cutting helpers on the same class:

| Method | Notes |
|--------|-------|
| `list_all_agent_bricks(tile_type=None, page_size=100)` | Lists tiles of any type; filter with `TileType`. |
| `find_by_name(name)` / `mas_find_by_name(name)` / `genie_find_by_name(display_name)` | Returns the corresponding `*Ids` dataclass or `None`. |
| `delete(tile_id)` | Tile-type-agnostic delete. |
| `share(tile_id, changes)` | Permission changes; takes a list of change dicts. |
| `sanitize_name(name)` | Normalises display names into safe slugs. |

## `TileExampleQueue`

Background worker for adding examples / curated questions to KA, MAS, or Genie tiles in batch without blocking the caller. `get_tile_example_queue()` returns a process-wide singleton.

## Conventions

- **Names are matched, IDs are returned.** All lookups happen via `find_by_name` variants returning structured `*Ids` objects. Most `_create` methods return one of these dataclasses too.
- **`*_create_or_update` style.** Where it exists (e.g. `ka_create_or_update`), prefer it over checking existence + branching yourself.
- **Wait helpers are non-raising on terminal failure.** `ka_wait_until_ready` etc. return `bool` for completion within timeout — they raise `TimeoutError` only on timeout.

## Related

- MCP wrappers: [`databricks_mcp_server/tools/agent_bricks.py`](../../databricks-mcp-server/databricks_mcp_server/tools/agent_bricks.py), [`tools/genie.py`](../../databricks-mcp-server/databricks_mcp_server/tools/genie.py)
- Skills: [`databricks-agent-bricks`](../../databricks-skills/databricks-agent-bricks/), [`databricks-genie`](../../databricks-skills/databricks-genie/)
