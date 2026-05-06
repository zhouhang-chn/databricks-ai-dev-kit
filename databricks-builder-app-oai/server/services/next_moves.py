"""Context-aware next-move generation for analysis stories."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, Literal, Optional

from openai import AsyncOpenAI

from .logging_utils import ensure_logger_active

logger = logging.getLogger(__name__)
ensure_logger_active(logger, set_propagate_false=True)

ActionType = Literal['drill', 'compare', 'validate', 'explain', 'pivot']
MoveSource = Literal['model', 'heuristic']

ACTION_TYPES: set[str] = {'drill', 'compare', 'validate', 'explain', 'pivot'}
READ_ONLY_ROLES = {'user', 'user_preview', 'viewer'}
WRITE_INTENTS = {'operationalize', 'build_artifact', 'release_project', 'deploy_artifact'}
DEFAULT_MODEL = 'deepseek-v4-flash'
DEFAULT_TIMEOUT_SCHEDULE: tuple[float, ...] = (15.0, 30.0)
MAX_LABEL_CHARS = 32
MAX_PROMPT_CHARS = 220


@dataclass(slots=True)
class NextMoveTraceStep:
  """Compact trace step used to generate user-facing next moves."""

  tool_name: str
  status: str
  summary: str | None = None
  duration_ms: int | None = None


@dataclass(slots=True)
class NextMoveContext:
  """Context packet for next-move generation."""

  project_id: str
  conversation_id: str
  question: str
  answer: str
  run_role: str = 'developer'
  project_type: str | None = None
  project_status: str | None = None
  release_id: str | None = None
  execution_id: str | None = None
  story_id: str | None = None
  recent_messages: list[dict[str, str]] = field(default_factory=list)
  trace_steps: list[NextMoveTraceStep] = field(default_factory=list)
  evidence_summaries: list[str] = field(default_factory=list)
  effective_resources: dict[str, str | None] = field(default_factory=dict)
  semantic_context: dict[str, Any] = field(default_factory=dict)
  workflow_context: dict[str, Any] = field(default_factory=dict)
  memory_context: dict[str, Any] = field(default_factory=dict)
  error: str | None = None


@dataclass(slots=True)
class NextMove:
  """One user-facing follow-up suggestion."""

  label: str
  prompt: str
  action_type: ActionType
  intent: str
  confidence: float
  requires_confirmation: bool = False
  source: MoveSource = 'heuristic'

  def to_event_dict(self) -> dict[str, Any]:
    """Return the camelCase event payload expected by the frontend."""
    return {
      'label': self.label,
      'prompt': self.prompt,
      'actionType': self.action_type,
      'intent': self.intent,
      'confidence': round(self.confidence, 3),
      'requiresConfirmation': self.requires_confirmation,
      'source': self.source,
    }


@dataclass(slots=True)
class NextMoveGeneration:
  """Generated move set plus observability metadata."""

  moves: list[NextMove]
  source: MoveSource
  model: str | None
  latency_ms: int
  fallback_reason: str | None = None

  def event_metadata(self) -> dict[str, Any]:
    """Return additive metadata for the `next_moves.updated` SSE event."""
    return {
      'source': self.source,
      'model': self.model,
      'latency_ms': self.latency_ms,
      'fallback_reason': self.fallback_reason,
    }


def _env_bool(name: str, default: bool = False) -> bool:
  value = os.environ.get(name)
  if value is None:
    return default
  return value.strip().lower() in {'1', 'true', 'yes', 'on'}


def _truncate(text: str, max_chars: int) -> str:
  normalized = re.sub(r'\s+', ' ', text).strip()
  if len(normalized) <= max_chars:
    return normalized
  return normalized[: max_chars - 3].rstrip() + '...'


def _safe_text(value: Any, max_chars: int = 500) -> str:
  if value is None:
    return ''
  if isinstance(value, str):
    return _truncate(value, max_chars)
  try:
    return _truncate(json.dumps(value, ensure_ascii=False, default=str), max_chars)
  except TypeError:
    return _truncate(str(value), max_chars)


def _parse_json_text(text: str) -> Any | None:
  try:
    return json.loads(text)
  except json.JSONDecodeError:
    return None


def summarize_evidence_content(content: Any, *, is_error: bool = False) -> str:
  """Return a short, user-safe summary for tool/evidence content."""
  text = _safe_text(content, 500)
  if is_error:
    return text or 'Tool failed.'

  parsed = _parse_json_text(content) if isinstance(content, str) else content
  if isinstance(parsed, list):
    return f'{len(parsed)} records returned.'
  if isinstance(parsed, dict):
    for key in ('items', 'rows', 'data', 'results', 'records', 'catalogs', 'schemas', 'tables'):
      value = parsed.get(key)
      if isinstance(value, list):
        label = _count_label(key)
        return f'{len(value)} {label} returned.'
    if parsed:
      return f'Tool returned {len(parsed)} fields.'
  if not text:
    return 'Tool completed without a visible result.'
  if text[0] in {'{', '['}:
    return 'Tool completed and returned structured data.'
  return text


def _count_label(key: str) -> str:
  normalized = key.lower()
  if 'row' in normalized:
    return 'rows'
  if 'catalog' in normalized:
    return 'catalogs'
  if 'schema' in normalized:
    return 'schemas'
  if 'table' in normalized:
    return 'tables'
  if 'result' in normalized:
    return 'results'
  return 'records'


def _context_text(context: NextMoveContext) -> str:
  parts = [
    context.question,
    context.answer,
    context.error or '',
    context.project_type or '',
    ' '.join(step.tool_name for step in context.trace_steps),
    ' '.join(context.evidence_summaries),
  ]
  return ' '.join(parts).lower()


def _is_read_only(context: NextMoveContext) -> bool:
  return context.run_role in READ_ONLY_ROLES


def _is_discovery_context(text: str) -> bool:
  return any(
    token in text
    for token in (
      'catalog',
      'schema',
      'schemas',
      'table',
      'tables',
      'volume',
      'warehouse',
      'cluster',
      'unity catalog',
      '_dev',
    )
  )


def _is_metric_context(text: str, context: NextMoveContext) -> bool:
  metric_views = context.semantic_context.get('metric_views')
  return bool(metric_views) or any(
    token in text
    for token in (
      'metric',
      'kpi',
      'revenue',
      'arr',
      'dau',
      'mau',
      'conversion',
      'rate',
      'count',
      'trend',
      'growth',
      'period',
    )
  )


def _is_build_context(text: str, context: NextMoveContext) -> bool:
  project_type = (context.project_type or '').lower()
  return any(token in project_type for token in ('app', 'dashboard', 'build')) or any(
    token in text
    for token in (
      'dashboard',
      'chart',
      'app',
      'deploy',
      'publish',
      'release',
      'pipeline',
      'job',
      'artifact',
    )
  )


def _move(
  label: str,
  prompt: str,
  action_type: ActionType,
  intent: str,
  confidence: float,
  *,
  requires_confirmation: bool = False,
  source: MoveSource = 'heuristic',
) -> NextMove:
  return NextMove(
    label=_truncate(label, MAX_LABEL_CHARS),
    prompt=_truncate(prompt, MAX_PROMPT_CHARS),
    action_type=action_type,
    intent=intent,
    confidence=max(0.0, min(confidence, 1.0)),
    requires_confirmation=requires_confirmation,
    source=source,
  )


def _filter_policy(moves: list[NextMove], context: NextMoveContext) -> list[NextMove]:
  filtered: list[NextMove] = []
  for move in moves:
    if _is_read_only(context) and (
      move.intent in WRITE_INTENTS
      or _looks_like_write_action(move.label)
      or _looks_like_write_action(move.prompt)
    ):
      continue
    filtered.append(move)
  return filtered


def _looks_like_write_action(text: str) -> bool:
  lowered = text.lower()
  return any(
    token in lowered
    for token in (
      'deploy',
      'delete',
      'drop ',
      'write ',
      'create table',
      'modify',
      'publish',
      'save as project default',
      'save project default',
      'set project default',
      'pin as default',
      'pin project default',
    )
  )


def _dedupe_moves(moves: list[NextMove], *, limit: int = 3) -> list[NextMove]:
  deduped: list[NextMove] = []
  seen_labels: set[str] = set()
  seen_intents: set[str] = set()
  for move in sorted(moves, key=lambda item: item.confidence, reverse=True):
    label_key = move.label.lower()
    if label_key in seen_labels or move.intent in seen_intents:
      continue
    seen_labels.add(label_key)
    seen_intents.add(move.intent)
    deduped.append(move)
    if len(deduped) >= limit:
      break
  return deduped


_FQN_RE = re.compile(r'\b([A-Za-z][\w]*)\.([A-Za-z][\w]*)(?:\.([A-Za-z][\w]*))?\b')
_BACKTICK_FQN_RE = re.compile(
  r'`([^`]+)`(?:\s*\.\s*`([^`]+)`(?:\s*\.\s*`([^`]+)`)?)?'
)
_PERIOD_RE = re.compile(
  r'\b('
  r'q[1-4]|fy\d{2,4}|'
  r'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|'
  r'jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|'
  r'today|yesterday|last week|last month|last quarter|last year|'
  r'mom|yoy|wow|qoq'
  r')\b',
  re.IGNORECASE,
)
_DIMENSION_HINTS = (
  'region', 'segment', 'channel', 'product', 'category', 'team', 'bdr',
  'customer', 'sku', 'territory', 'route', 'account',
)
_FQN_BLOCKLIST = {
  'http', 'https', 'www', 'com', 'cn', 'azure', 'databricks', 'mlflow',
  'self', 'cls', 'os', 'sys', 're', 'json', 'time',
}


def _extract_entities(context: NextMoveContext) -> dict[str, Optional[str]]:
  """Pull the most-specific catalog/schema/table from context.

  Priority order: backticked fully-qualified names in answer/evidence/trace,
  then dotted bare names, then ``effective_resources`` for catalog/schema.
  """
  catalog: Optional[str] = None
  schema: Optional[str] = None
  table: Optional[str] = None

  haystack_parts = [context.question, context.answer]
  haystack_parts.extend(context.evidence_summaries[-3:])
  for step in (context.trace_steps or [])[-5:]:
    if step.summary:
      haystack_parts.append(step.summary)
  haystack = ' '.join(p for p in haystack_parts if p)

  # Backticked names first — these are unambiguous SQL identifiers.
  for match in _BACKTICK_FQN_RE.finditer(haystack):
    parts = [p.strip() for p in match.groups() if p and p.strip()]
    if not parts:
      continue
    if len(parts) >= 3:
      catalog = catalog or parts[0]
      schema = schema or parts[1]
      table = table or parts[2]
    elif len(parts) == 2:
      schema = schema or parts[0]
      table = table or parts[1]
    else:
      table = table or parts[0]
    if catalog and schema and table:
      break

  # Dotted bare names as a softer signal.
  if not (catalog and schema and table):
    for match in _FQN_RE.finditer(haystack):
      parts = [p for p in match.groups() if p]
      if any(p.lower() in _FQN_BLOCKLIST for p in parts):
        continue
      if len(parts) == 3:
        catalog = catalog or parts[0]
        schema = schema or parts[1]
        table = table or parts[2]
      elif len(parts) == 2:
        schema = schema or parts[0]
        table = table or parts[1]
      if catalog and schema and table:
        break

  # Effective resources fill in remaining catalog/schema gaps.
  resources = context.effective_resources or {}
  catalog = catalog or (resources.get('default_catalog') or None)
  schema = schema or (resources.get('default_schema') or None)
  return {'catalog': catalog, 'schema': schema, 'table': table}


def _qualified(*parts: Optional[str]) -> str:
  """Join non-empty parts with dots."""
  return '.'.join(p for p in parts if p)


def _short_name(name: Optional[str], max_chars: int = 22) -> str:
  """Truncate a Databricks identifier to fit in a label."""
  if not name:
    return ''
  return name if len(name) <= max_chars else name[: max_chars - 1] + '…'


def _last_failed_tool(context: NextMoveContext) -> Optional[str]:
  """Return the most recent trace step whose status indicates failure."""
  for step in reversed(context.trace_steps or []):
    if (step.status or '').lower() in {'error', 'failed', 'failure'}:
      return step.tool_name
  return None


def _metric_hint(context: NextMoveContext) -> Optional[str]:
  """Best-effort metric name from semantic context or evidence summaries."""
  metric_views = context.semantic_context.get('metric_views') if isinstance(
    context.semantic_context, dict
  ) else None
  if isinstance(metric_views, list) and metric_views:
    first = metric_views[0]
    if isinstance(first, dict):
      name = first.get('name') or first.get('metric_view') or first.get('id')
      if isinstance(name, str) and name:
        return name
    elif isinstance(first, str) and first:
      return first
  return None


def _period_hint(context: NextMoveContext) -> Optional[str]:
  """Pull a time-window phrase from question or answer if obvious."""
  match = _PERIOD_RE.search(context.question or '') or _PERIOD_RE.search(
    context.answer or ''
  )
  return match.group(0) if match else None


def _dimension_hint(context: NextMoveContext) -> Optional[str]:
  """Pull a likely segmentation dimension from question or answer."""
  text = ((context.question or '') + ' ' + (context.answer or '')).lower()
  for token in _DIMENSION_HINTS:
    if token in text:
      return token
  return None


def generate_fallback_next_moves(context: NextMoveContext) -> list[NextMove]:
  """Generate deterministic, role-safe moves without calling a model."""
  text = _context_text(context)
  candidates: list[NextMove] = []

  if context.error or 'error' in text or 'failed' in text or 'timeout' in text:
    candidates.extend(_error_moves(context))
  else:
    if _is_discovery_context(text):
      candidates.extend(_discovery_moves(context))
    if _is_metric_context(text, context):
      candidates.extend(_metric_moves(context))
    if _is_build_context(text, context):
      candidates.extend(_build_moves(context))
  if not candidates:
    candidates.extend(_generic_moves(context))

  filtered = _filter_policy(candidates, context)
  if not filtered:
    filtered = _generic_moves(context)
  return _dedupe_moves(filtered)


def _error_moves(context: NextMoveContext) -> list[NextMove]:
  failed_tool = _last_failed_tool(context)
  entities = _extract_entities(context)
  target = _qualified(entities['catalog'], entities['schema'], entities['table'])
  err = (context.error or '').strip()
  err_short = _truncate(err, 90) if err else ''

  retry_label = f'Retry {_short_name(failed_tool, 18)}' if failed_tool else 'Retry narrower'
  if failed_tool and target:
    retry_prompt = (
      f'Retry {failed_tool} on {target} with a narrower scope; '
      'explain each assumption and skip steps that already failed.'
    )
  elif target:
    retry_prompt = (
      f'Retry this request scoped to {target}; explain each assumption '
      f'and avoid the path that produced: {err_short or context.question}'
    )
  else:
    retry_prompt = (
      f'Retry this request with a narrower scope and explain each assumption: '
      f'{context.question}'
    )

  resources_prompt = (
    f'Check whether {target} is accessible — confirm catalog, schema, '
    f'warehouse, cluster, and permissions for this request.'
    if target
    else 'Check the project catalog, schema, warehouse, and permissions for this request.'
  )

  trace_prompt = (
    f'Summarize why {failed_tool} failed'
    if failed_tool
    else 'Summarize which step failed'
  )
  if err_short:
    trace_prompt += f' (error: {err_short})'
  trace_prompt += ' and recommend exactly what configuration or permission to fix.'

  return [
    _move(retry_label, retry_prompt, 'validate', 'debug_failure', 0.92),
    _move(
      'Check resources' if not target else f'Check {_short_name(target)}',
      resources_prompt,
      'validate',
      'validate_source',
      0.84,
    ),
    _move('Inspect trace', trace_prompt, 'explain', 'explain_failure', 0.76),
  ]


def _discovery_moves(context: NextMoveContext) -> list[NextMove]:
  entities = _extract_entities(context)
  catalog = entities['catalog']
  schema = entities['schema']
  table = entities['table']
  schema_path = _qualified(catalog, schema)
  table_path = _qualified(catalog, schema, table)

  moves: list[NextMove] = []

  if table:
    moves.append(_move(
      f'Inspect {_short_name(table)}',
      f'Show schema, sample rows, row count, freshness, and likely keys for {table_path}.',
      'drill',
      'inspect_metadata',
      0.92,
    ))
  if schema:
    moves.append(_move(
      f'Tables in {_short_name(schema)}',
      f'List analytics tables in {schema_path or schema} with row counts, freshness, '
      'and a one-line purpose for each.',
      'drill',
      'find_data_assets',
      0.88,
    ))
  elif catalog:
    moves.append(_move(
      f'Schemas in {_short_name(catalog)}',
      f'Show schemas in {catalog} with table counts and recommend which schemas '
      'matter for this project.',
      'drill',
      'inspect_metadata',
      0.88,
    ))

  if not moves:
    moves.append(_move(
      'Inspect schemas',
      'Show schemas and table counts for the relevant catalogs, then recommend '
      'which schemas matter for this project.',
      'drill',
      'inspect_metadata',
      0.85,
    ))
    moves.append(_move(
      'Find useful tables',
      'Find likely analytics tables in the relevant schemas and summarize '
      'purpose, freshness, and row counts.',
      'drill',
      'find_data_assets',
      0.82,
    ))

  if _is_read_only(context):
    moves.append(_move(
      'Recommend defaults',
      (
        f'Recommend whether to use {schema_path} as catalog/schema defaults '
        'for future questions in this project.'
        if schema_path
        else 'Recommend the best catalog and schema defaults for future questions '
        'in this project.'
      ),
      'pivot',
      'operationalize_readonly',
      0.78,
    ))
  else:
    moves.append(_move(
      f'Pin {_short_name(schema_path)}' if schema_path else 'Set project defaults',
      (
        f'Save {schema_path} as the project default catalog/schema and explain '
        'why these are the right choices.'
        if schema_path
        else 'Recommend which catalog and schema should be saved as project '
        f'defaults based on: {context.question}'
      ),
      'pivot',
      'operationalize',
      0.78,
      requires_confirmation=True,
    ))

  return moves


def _metric_moves(context: NextMoveContext) -> list[NextMove]:
  entities = _extract_entities(context)
  metric = _metric_hint(context)
  period = _period_hint(context)
  dimension = _dimension_hint(context)
  source = _qualified(entities['catalog'], entities['schema'], entities['table'])
  noun = metric or 'this result'

  if period:
    compare_label = f'Compare vs prior {_short_name(period, 16)}'
    compare_prompt = (
      f'Compare {noun} for {period} against the previous comparable period and '
      'explain the biggest driver of change.'
    )
  else:
    compare_label = f'Compare {_short_name(metric, 18)}' if metric else 'Compare period'
    compare_prompt = (
      f'Compare {noun} with the previous comparable period and explain the '
      f'biggest change: {context.question}'
    )

  if dimension:
    breakdown_label = f'Break down by {_short_name(dimension, 16)}'
    breakdown_prompt = (
      f'Break {noun} down by {dimension} and surface the top movers, with '
      'short business interpretation.'
    )
  else:
    breakdown_label = f'Break down {_short_name(metric, 16)}' if metric else 'Break down result'
    breakdown_prompt = (
      f'Break {noun} down by the most relevant segment, region, or business '
      'dimension and call out the top movers.'
    )

  validate_label = f'Validate {_short_name(metric, 18)}' if metric else 'Validate metric'
  if source:
    validate_prompt = (
      f'Validate {noun}: confirm the definition, source ({source}), filters, '
      'freshness, and any known caveats.'
    )
  else:
    validate_prompt = (
      f'Validate the {("definition of " + metric) if metric else "metric definition"}, '
      'source table, filters, freshness, and known caveats.'
    )

  return [
    _move(compare_label, compare_prompt, 'compare', 'compare_periods', 0.88),
    _move(breakdown_label, breakdown_prompt, 'drill', 'segment_result', 0.84),
    _move(validate_label, validate_prompt, 'validate', 'validate_metric', 0.82),
  ]


def _build_moves(context: NextMoveContext) -> list[NextMove]:
  ptype = (context.project_type or '').lower()
  if 'dashboard' in ptype or 'report' in ptype:
    artifact = 'dashboard'
  elif 'app' in ptype:
    artifact = 'app'
  else:
    artifact = 'project'

  entities = _extract_entities(context)
  source = _qualified(entities['catalog'], entities['schema'], entities['table'])

  if _is_read_only(context):
    return [
      _move(
        f'Preview {artifact}',
        f'Explain the latest {artifact} outputs from a user perspective, '
        'including assumptions and caveats.',
        'explain',
        'preview_artifact',
        0.86,
      ),
      _move(
        'Validate sources',
        (
          f'Validate the sources behind this {artifact}'
          + (f' (incl. {source})' if source else '')
          + ' — freshness, caveats, and access scope.'
        ),
        'validate',
        'validate_source',
        0.82,
      ),
      _move(
        'Explore metrics',
        f'Show the available governed metrics, dimensions, and filters for this {artifact}.',
        'drill',
        'find_data_assets',
        0.74,
      ),
    ]

  return [
    _move(
      f'Preview {artifact} as user',
      f'Preview this {artifact} as a user and identify any confusing output, '
      'missing context, or risky assumption.',
      'validate',
      'preview_artifact',
      0.86,
    ),
    _move(
      'Add validation',
      (
        f'Add validation checks for {source} '
        if source
        else 'Add validation checks for sources, '
      )
      + 'freshness, permissions, and expected output shape.',
      'validate',
      'validate_source',
      0.8,
    ),
    _move(
      f'Release {artifact}',
      f'Prepare a release checklist for this {artifact} with evidence, caveats, '
      'and user-facing notes.',
      'pivot',
      'release_project',
      0.72,
      requires_confirmation=True,
    ),
  ]


def _generic_moves(context: NextMoveContext) -> list[NextMove]:
  entities = _extract_entities(context)
  source = _qualified(entities['catalog'], entities['schema'], entities['table'])
  dimension = _dimension_hint(context)

  validate_prompt = (
    f'Validate the source data behind this answer ({source}) — freshness, '
    'permissions, and known caveats.'
    if source
    else 'Validate the source data, freshness, permissions, and known caveats for this answer.'
  )
  drill_prompt = (
    f'Drill into this result by {dimension} and surface the top driver or exception.'
    if dimension
    else 'Drill down into the most important segment, exception, or driver in this result.'
  )
  drill_label = f'Drill by {_short_name(dimension, 16)}' if dimension else 'Drill down'

  return [
    _move(
      'Explain assumptions',
      f'Explain the assumptions, evidence, and caveats behind this answer: {context.question}',
      'explain',
      'clarify_scope',
      0.68,
    ),
    _move(
      'Validate sources' if not source else f'Validate {_short_name(source)}',
      validate_prompt,
      'validate',
      'validate_source',
      0.66,
    ),
    _move(drill_label, drill_prompt, 'drill', 'segment_result', 0.62),
  ]


def _next_moves_model() -> str:
  return os.environ.get('OPENAI_NEXT_MOVES_MODEL') or DEFAULT_MODEL


def _client_from_env() -> AsyncOpenAI:
  api_key = os.environ.get('OPENAI_API_KEY')
  base_url = os.environ.get('OPENAI_BASE_URL')
  if not api_key:
    raise RuntimeError('OPENAI_API_KEY is required for model-based next moves')
  return AsyncOpenAI(api_key=api_key, base_url=base_url)


def _context_payload(context: NextMoveContext) -> dict[str, Any]:
  return {
    'project': {
      'id': context.project_id,
      'type': context.project_type,
      'status': context.project_status,
      'release_id': context.release_id,
      'run_role': context.run_role,
      'effective_resources': context.effective_resources,
    },
    'conversation': {
      'id': context.conversation_id,
      'recent_messages': context.recent_messages[-8:],
    },
    'story': {
      'execution_id': context.execution_id,
      'story_id': context.story_id,
      'question': _safe_text(context.question, 1000),
      'answer': _safe_text(context.answer, 4000),
      'error': _safe_text(context.error, 1000),
      'trace_steps': [
        {
          'tool_name': step.tool_name,
          'status': step.status,
          'summary': step.summary,
          'duration_ms': step.duration_ms,
        }
        for step in context.trace_steps[-8:]
      ],
      'evidence_summaries': context.evidence_summaries[-5:],
    },
    'settings': {
      'semantics': _bounded_json_value(context.semantic_context, 2000),
      'workflows': _bounded_json_value(context.workflow_context, 1200),
      'memory': _bounded_json_value(context.memory_context, 1200),
    },
  }


def _bounded_json_value(value: Any, max_chars: int) -> Any:
  text = _safe_text(value, max_chars)
  parsed = _parse_json_text(text)
  return parsed if parsed is not None else text


def _model_messages(context: NextMoveContext) -> list[dict[str, str]]:
  payload = _context_payload(context)
  return [
    {
      'role': 'system',
      'content': (
        'You generate concise next-step suggestions for a Databricks '
        'analyst/developer agent UI. Return only JSON. Do not expose raw tool '
        'outputs. Do not suggest actions that violate the user role or project policy.'
      ),
    },
    {
      'role': 'user',
      'content': (
        'Generate 3 next moves.\n\n'
        'Rules:\n'
        '- Each label must be 32 characters or fewer.\n'
        '- Each prompt must be a complete user message, 220 characters or fewer.\n'
        '- actionType must be one of: drill, compare, validate, explain, pivot.\n'
        '- Avoid duplicate intents.\n'
        '- If the answer failed, suggest recovery or narrowing steps.\n'
        '- If the result is discovery metadata, suggest schemas/tables/defaults.\n'
        '- If the result is a metric, suggest comparison, segmentation, or validation.\n'
        '- If the result is a build artifact, suggest preview, validation, or release.\n'
        '- For user_preview, user, or viewer roles, do not suggest write/deploy actions.\n\n'
        'Return exactly this JSON shape:\n'
        '{"moves":[{"label":"...","prompt":"...","actionType":"drill",'
        '"intent":"inspect_metadata","confidence":0.8,'
        '"requiresConfirmation":false}]}\n\n'
        f'Context:\n{json.dumps(payload, ensure_ascii=False, default=str)}'
      ),
    },
  ]


async def _generate_model_moves(context: NextMoveContext, timeout_seconds: float) -> list[NextMove]:
  client = _client_from_env()
  model = _next_moves_model()
  response = await asyncio.wait_for(
    client.chat.completions.create(
      model=model,
      max_tokens=600,
      temperature=0.2,
      messages=_model_messages(context),
    ),
    timeout=timeout_seconds,
  )
  content = (response.choices[0].message.content or '').strip()
  return parse_model_next_moves(content, context)


def parse_model_next_moves(content: str, context: NextMoveContext) -> list[NextMove]:
  """Parse, validate, and policy-filter model output."""
  parsed = _parse_json_text(_strip_code_fence(content))
  if not isinstance(parsed, dict):
    raise ValueError('next-move model output is not a JSON object')
  raw_moves = parsed.get('moves')
  if not isinstance(raw_moves, list):
    raise ValueError('next-move model output missing moves list')

  moves: list[NextMove] = []
  for raw in raw_moves:
    if not isinstance(raw, dict):
      continue
    label = _safe_text(raw.get('label'), MAX_LABEL_CHARS)
    prompt = _safe_text(raw.get('prompt'), MAX_PROMPT_CHARS)
    action_type = raw.get('actionType') or raw.get('action_type')
    intent = _safe_text(raw.get('intent'), 64) or 'pivot'
    if not label or not prompt or action_type not in ACTION_TYPES:
      continue
    if _looks_like_raw_payload(label) or _looks_like_raw_payload(prompt):
      continue
    moves.append(
      _move(
        label,
        prompt,
        action_type,  # type: ignore[arg-type]
        intent,
        _float_or_default(raw.get('confidence'), 0.5),
        requires_confirmation=bool(
          raw.get('requiresConfirmation') or raw.get('requires_confirmation')
        ),
        source='model',
      )
    )

  moves = _filter_policy(moves, context)
  moves = _dedupe_moves(moves)
  if not moves:
    raise ValueError('next-move model output had no valid moves')
  return moves


def _strip_code_fence(content: str) -> str:
  if content.startswith('```'):
    lines = content.splitlines()
    if lines and lines[0].startswith('```'):
      lines = lines[1:]
    if lines and lines[-1].startswith('```'):
      lines = lines[:-1]
    return '\n'.join(lines).strip()
  return content


def _float_or_default(value: Any, default: float) -> float:
  try:
    return float(value)
  except (TypeError, ValueError):
    return default


def _looks_like_raw_payload(text: str) -> bool:
  stripped = text.strip()
  return (
    stripped.startswith('{')
    or stripped.startswith('[')
    or '```json' in stripped.lower()
    or '"items":' in stripped
    or '"rows":' in stripped
  )


async def generate_next_moves(
  context: NextMoveContext,
  *,
  timeout_schedule: tuple[float, ...] = DEFAULT_TIMEOUT_SCHEDULE,
) -> NextMoveGeneration:
  """Generate next moves with a model, falling back to deterministic heuristics.

  The model call is retried with growing per-attempt timeouts taken from
  ``timeout_schedule`` (default 5s, 10s, 30s, 60s). Only ``asyncio.TimeoutError``
  triggers a retry; other exceptions fall through to the heuristic fallback.
  """
  ensure_logger_active(logger, set_propagate_false=True)
  started = time.time()
  model = _next_moves_model()
  if not _env_bool('NEXT_MOVES_MODEL_ENABLED', True):
    moves = generate_fallback_next_moves(context)
    return NextMoveGeneration(
      moves=moves,
      source='heuristic',
      model=None,
      latency_ms=int((time.time() - started) * 1000),
      fallback_reason='model_disabled',
    )

  last_exc: Exception | None = None
  for attempt, timeout in enumerate(timeout_schedule, start=1):
    try:
      moves = await _generate_model_moves(context, timeout)
      generation = NextMoveGeneration(
        moves=moves,
        source='model',
        model=model,
        latency_ms=int((time.time() - started) * 1000),
      )
      logger.info(
        'Generated next moves with model: project=%s conversation=%s story=%s '
        'model=%s moves=%s latency_ms=%s attempt=%s timeout=%ss',
        context.project_id,
        context.conversation_id,
        context.story_id,
        model,
        len(moves),
        generation.latency_ms,
        attempt,
        timeout,
      )
      return generation
    except asyncio.TimeoutError as exc:
      last_exc = exc
      logger.info(
        'Next moves attempt %s timed out after %ss; '
        'project=%s story=%s model=%s — retrying with next budget',
        attempt,
        timeout,
        context.project_id,
        context.story_id,
        model,
      )
      continue
    except Exception as exc:
      last_exc = exc
      break

  fallback_reason = type(last_exc).__name__ if last_exc else 'unknown'
  moves = generate_fallback_next_moves(context)
  generation = NextMoveGeneration(
    moves=moves,
    source='heuristic',
    model=model,
    latency_ms=int((time.time() - started) * 1000),
    fallback_reason=fallback_reason,
  )
  logger.info(
    'Generated fallback next moves: project=%s conversation=%s story=%s '
    'model=%s moves=%s latency_ms=%s reason=%s attempts=%s',
    context.project_id,
    context.conversation_id,
    context.story_id,
    model,
    len(moves),
    generation.latency_ms,
    fallback_reason,
    len(timeout_schedule) if isinstance(last_exc, asyncio.TimeoutError) else 1,
  )
  return generation
