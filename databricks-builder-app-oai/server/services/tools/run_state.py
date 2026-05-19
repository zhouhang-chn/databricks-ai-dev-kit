"""Per-run tool policy state for the OpenAI agent runtime."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

_TABLE_REF_RE = re.compile(
  r'\b(?:from|join|into|update|table)\s+`?([a-zA-Z_][\w-]*)`?'
  r'(?:\.`?([a-zA-Z_][\w-]*)`?)?'
  r'(?:\.`?([a-zA-Z_][\w-]*)`?)?',
  re.IGNORECASE,
)
_DESCRIBE_TABLE_RE = re.compile(
  r'\b(?:describe|desc)\s+(?:table\s+|extended\s+|formatted\s+)?'
  r'`?([a-zA-Z_][\w-]*)`?(?:\.`?([a-zA-Z_][\w-]*)`?)?'
  r'(?:\.`?([a-zA-Z_][\w-]*)`?)?',
  re.IGNORECASE,
)
_SHOW_COLUMNS_RE = re.compile(
  r'\bshow\s+columns\s+(?:in|from)\s+(?:table\s+)?'
  r'`?([a-zA-Z_][\w-]*)`?(?:\.`?([a-zA-Z_][\w-]*)`?)?'
  r'(?:\.`?([a-zA-Z_][\w-]*)`?)?',
  re.IGNORECASE,
)


def _normalize_identifier(value: str | None) -> str:
  return (value or '').strip().strip('`').lower()


def _join_identifier(parts: list[str | None]) -> str | None:
  normalized = [_normalize_identifier(part) for part in parts if part]
  if len(normalized) != 3:
    return None
  return '.'.join(normalized)


def _split_table_name(table_name: str) -> tuple[str | None, str | None, str | None]:
  parts = [_normalize_identifier(part) for part in table_name.split('.') if part.strip()]
  if len(parts) >= 3:
    return parts[-3], parts[-2], parts[-1]
  if len(parts) == 2:
    return None, parts[0], parts[1]
  if len(parts) == 1:
    return None, None, parts[0]
  return None, None, None


@dataclass
class AgentToolRunState:
  """Shared state that lets tools enforce the agent workflow contract."""

  project_dir: Path | None = None
  schema_required_tables: set[str] = field(default_factory=set)
  default_catalog: str | None = None
  default_schema: str | None = None
  plan_created: bool = False
  active_step_id: str | None = None
  agents_md_read: bool = False
  inspected_tables: set[str] = field(default_factory=set)
  inspected_schemas: set[str] = field(default_factory=set)

  def __post_init__(self) -> None:
    if self.project_dir is not None:
      self.project_dir = self.project_dir.resolve()
    self.schema_required_tables = {
      table
      for table in (
        self.normalize_table_name(table) for table in self.schema_required_tables
      )
      if table
    }
    self.default_catalog = _normalize_identifier(self.default_catalog) or None
    self.default_schema = _normalize_identifier(self.default_schema) or None

  def mark_project_file_read(self, path: Path) -> None:
    """Record that a project file was read by the model."""
    if path.name == 'AGENTS.md':
      self.agents_md_read = True

  def databricks_gate_error(self, tool_name: str) -> dict | None:
    """Return an actionable error if a Databricks tool is not allowed yet.

    The wording adapts to current run state so the model never sees an
    instruction for an op it has already completed — mentioning op="create"
    after the plan was already created anchors reasoning models into a
    duplicate-create loop.
    """
    if self.active_step_id:
      return None
    if not self.plan_created:
      return {
        'error': (
          'No plan yet. Call update_plan(op="create", objective=..., steps=[...]) '
          'to open the plan, then update_plan(op="start", step_id="step-1", ...).'
        ),
        'tool': tool_name,
        'required_action': (
          'update_plan(op="create", objective="...", '
          'steps=[{"id": "step-1", "title": "..."}, ...])'
        ),
      }
    return {
      'error': (
        'Plan is already created. Do NOT call update_plan(op="create") again. '
        'Call update_plan(op="start", step_id="step-1", narrative="...") to '
        'begin the first step, then run this tool.'
      ),
      'tool': tool_name,
      'required_action': 'update_plan(op="start", step_id="step-1", narrative="...")',
    }

  def normalize_table_name(self, table_name: str | None) -> str | None:
    """Normalize a table reference to catalog.schema.table when possible."""
    if not table_name:
      return None
    catalog, schema, table = _split_table_name(table_name)
    catalog = catalog or self.default_catalog
    schema = schema or self.default_schema
    return _join_identifier([catalog, schema, table])

  def normalize_schema_name(self, catalog: str | None, schema: str | None) -> str | None:
    """Normalize a schema reference to catalog.schema when possible."""
    catalog = _normalize_identifier(catalog or self.default_catalog)
    schema = _normalize_identifier(schema or self.default_schema)
    if not catalog or not schema:
      return None
    return f'{catalog}.{schema}'

  def mark_schema_inspected(
    self,
    *,
    catalog: str | None,
    schema: str | None,
    table_names: list[str] | None = None,
  ) -> None:
    """Record schema inspection from the table-stats tool."""
    schema_name = self.normalize_schema_name(catalog, schema)
    if not schema_name:
      return

    if not table_names or any(any(ch in name for ch in '*?[]') for name in table_names):
      self.inspected_schemas.add(schema_name)
      return

    for table_name in table_names:
      normalized = self.normalize_table_name(
        table_name if table_name.count('.') >= 2 else f'{schema_name}.{table_name}'
      )
      if normalized:
        self.inspected_tables.add(normalized)

  def mark_sql_schema_inspection(self, sql_query: str) -> None:
    """Record schema inspection from explicit DESCRIBE or SHOW COLUMNS SQL."""
    for regex in (_DESCRIBE_TABLE_RE, _SHOW_COLUMNS_RE):
      for match in regex.finditer(sql_query or ''):
        table = self._normalize_match_table(match.groups())
        if table:
          self.inspected_tables.add(table)

  def sql_schema_gate_error(self, sql_query: str) -> dict | None:
    """Require schema inspection before first SQL against configured tables."""
    normalized_sql = (sql_query or '').strip().lower()
    if not normalized_sql:
      return None
    if normalized_sql.startswith(('describe ', 'desc ', 'show columns ', 'show create table ')):
      return None

    missing = [
      table
      for table in self._referenced_configured_tables(sql_query)
      if table not in self.inspected_tables
      and '.'.join(table.split('.')[:2]) not in self.inspected_schemas
    ]
    if not missing:
      return None

    return {
      'error': (
        'Inspect the table schema before writing SQL against configured project '
        'tables. Do not guess column names.'
      ),
      'missing_schema_for_tables': sorted(set(missing)),
      'required_action': (
        'Call get_table_stats_and_schema for the table with table_stat_level="NONE" '
        'unless the next decision explicitly needs actual stats, then retry the SQL '
        'using the returned column names.'
      ),
    }

  def _referenced_configured_tables(self, sql_query: str) -> set[str]:
    if not self.schema_required_tables:
      return set()
    references = set()
    for match in _TABLE_REF_RE.finditer(sql_query or ''):
      table = self._normalize_match_table(match.groups())
      if table and table in self.schema_required_tables:
        references.add(table)
    return references

  def _normalize_match_table(self, groups: tuple[str | None, ...]) -> str | None:
    first, second, third = (groups + (None, None, None))[:3]
    if third:
      return self.normalize_table_name(f'{first}.{second}.{third}')
    if second:
      return self.normalize_table_name(f'{first}.{second}')
    return self.normalize_table_name(first)
