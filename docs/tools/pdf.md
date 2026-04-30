# `pdf/` — HTML → PDF → UC volume

Source: [`databricks_tools_core/pdf/`](../../databricks-tools-core/databricks_tools_core/pdf/)

Single-shot HTML-to-PDF generation that lands the result in a Unity Catalog volume. Used by the unstructured-PDF-generation skill for synthetic RAG corpora.

## Public API

| Function | Returns | Notes |
|----------|---------|-------|
| `generate_and_upload_pdf(html_content, filename, catalog, schema, volume="raw_data", folder=None)` | `PDFResult` | Renders the HTML via `plutoprint`, uploads the PDF to `/Volumes/<catalog>/<schema>/<volume>[/<folder>]/<filename>.pdf`. Adds the `.pdf` extension if missing. |

`PDFResult` (pydantic): `success`, `volume_path`, `error`. The function returns `success=False` with `error` set instead of raising, so the caller / model can handle the failure inline.

## Conventions

- **Self-contained HTML.** The rendering pipeline does no asset rewriting — pass a complete HTML document, including any embedded CSS. External URLs are fetched at render time.
- **Volume must exist.** `_validate_volume_path` checks the volume up-front; create it via `unity_catalog.create_volume` if needed.
- **Dependency.** Depends on `plutoprint==0.19.0` (pinned in `pyproject.toml`). Pinning matters — newer pre-releases have rendering regressions.

## Related

- MCP wrapper: [`databricks_mcp_server/tools/pdf.py`](../../databricks-mcp-server/databricks_mcp_server/tools/pdf.py)
- Skill: [`databricks-skills/databricks-unstructured-pdf-generation/SKILL.md`](../../databricks-skills/databricks-unstructured-pdf-generation/SKILL.md)
