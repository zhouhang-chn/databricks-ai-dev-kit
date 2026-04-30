# `file/` — Workspace files

Source: [`databricks_tools_core/file/`](../../databricks-tools-core/databricks_tools_core/file/)

Workspace **file** uploads/deletes — *not* UC Volume files (use [`unity_catalog/volume_files.py`](unity-catalog.md) for those). The single public entry point handles single files, folders, and glob patterns; notebook detection is automatic.

## Public API

| Function | Returns | Notes |
|----------|---------|-------|
| `upload_to_workspace(local_path, workspace_path, overwrite=True, ...)` | `UploadResult` \| `FolderUploadResult` | Polymorphic: detects folders, single files, and glob patterns. Notebook source is uploaded as a notebook (correct language) instead of a raw file. |
| `delete_from_workspace(workspace_path, recursive=False)` | `DeleteResult` | Refuses to delete protected paths (e.g. `/Workspace`, `/Repos`, `/Users`); see `_is_protected_path`. |

Internal building blocks worth knowing when extending the module:

- `_detect_notebook_language(local_path, content)` — extension/content sniffing returning an SDK `Language` or `None` for non-notebook files.
- `_upload_single_file`, `upload_folder`, `upload_file` — exposed in the module but the public path is `upload_to_workspace`.
- `_upload_glob_pattern` — recursive glob expansion with parallel uploads.

## Data classes

- `UploadResult` — `workspace_path`, `language`, `is_notebook`, `bytes_written`.
- `FolderUploadResult` — aggregated `uploaded`, `skipped`, `failed`, `total_bytes`.
- `DeleteResult` — `deleted`, `skipped`, `failed`.

## Conventions

- **Notebook detection is automatic.** A `.py` / `.scala` / `.sql` / `.r` / `.ipynb` file with the right markers becomes a notebook. Override by uploading raw bytes via the SDK if you need that.
- **Protected paths.** Do not bypass `_is_protected_path` — it exists because users do `delete_from_workspace("/")` and expect the call to refuse.

## Related

- MCP wrappers: [`databricks_mcp_server/tools/file.py`](../../databricks-mcp-server/databricks_mcp_server/tools/file.py), [`tools/workspace.py`](../../databricks-mcp-server/databricks_mcp_server/tools/workspace.py)
