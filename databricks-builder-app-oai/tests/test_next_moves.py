"""Unit tests for context-aware next-move generation."""

import asyncio
import json

from server.services.next_moves import (
  NextMoveContext,
  NextMoveTraceStep,
  generate_fallback_next_moves,
  generate_next_moves,
  parse_model_next_moves,
)


def _context(**overrides) -> NextMoveContext:
  """Build a minimal next-move context for tests."""
  base = {
    'project_id': 'proj_1',
    'conversation_id': 'conv_1',
    'execution_id': 'exec_1',
    'story_id': 'story_1',
    'run_role': 'developer',
    'project_type': 'databricks_app_build',
    'project_status': 'draft',
    'release_id': 'draft',
    'question': 'list all catalogs ending with _dev',
    'answer': 'Here are 7 catalogs ending with _dev.',
    'trace_steps': [
      NextMoveTraceStep(
        tool_name='manage_uc_objects',
        status='done',
        summary='7 catalogs returned.',
        duration_ms=1200,
      )
    ],
    'evidence_summaries': ['7 catalogs returned.'],
    'effective_resources': {'default_catalog': 'ai_dev_kit'},
    'semantic_context': {},
    'workflow_context': {},
    'memory_context': {},
  }
  base.update(overrides)
  return NextMoveContext(**base)


def test_catalog_discovery_fallback_is_specific():
  """Catalog discovery should narrow into the actual catalog and surface defaults."""
  moves = generate_fallback_next_moves(_context(project_type='analyst_workspace'))

  prompts = ' '.join(move.prompt for move in moves).lower()
  labels = ' '.join(move.label for move in moves).lower()

  # The configured default catalog must surface in label or prompt.
  assert 'ai_dev_kit' in labels + ' ' + prompts
  # Discovery moves still suggest schema/table inspection.
  assert 'schema' in prompts
  assert 'table' in prompts
  intents = {move.intent for move in moves}
  assert {'inspect_metadata', 'find_data_assets'} & intents
  assert {'operationalize', 'operationalize_readonly'} & intents


def test_table_discovery_references_the_table():
  """A trace mentioning a fully-qualified table should be reflected in moves."""
  moves = generate_fallback_next_moves(
    _context(
      question='show me the latest visit segments',
      answer='Found 5 tables under bdr_routing_workdb.',
      evidence_summaries=[
        'inspected `ds_uc_china_dev`.`bdr_routing_workdb`.`pilot_bdr_visit_record_seg`',
      ],
      effective_resources={
        'default_catalog': 'ds_uc_china_dev',
        'default_schema': 'bdr_routing_workdb',
      },
    )
  )

  combined = ' '.join(f'{m.label} {m.prompt}' for m in moves).lower()
  # Both the schema and the specific table should leak into the moves.
  assert 'bdr_routing_workdb' in combined
  assert 'pilot_bdr_visit_record_seg' in combined


def test_read_only_context_filters_write_or_release_moves():
  """Read-only roles should not receive write, publish, or deploy prompts."""
  moves = generate_fallback_next_moves(
    _context(
      run_role='user_preview',
      question='build a dashboard for these metrics',
      answer='Created a dashboard plan with charts and release notes.',
    )
  )

  combined = ' '.join(f'{move.label} {move.prompt}' for move in moves).lower()

  assert 'deploy' not in combined
  assert 'publish' not in combined
  assert 'save as project default' not in combined
  assert all(not move.requires_confirmation for move in moves)


def test_error_context_prioritizes_recovery_moves():
  """Failed runs should suggest recovery and surface the failed tool/resource."""
  moves = generate_fallback_next_moves(
    _context(
      question='show all tables in this schema',
      answer='',
      error='Permission denied while listing tables',
      trace_steps=[
        NextMoveTraceStep(
          tool_name='manage_uc_objects',
          status='error',
          summary='Permission denied while listing tables',
          duration_ms=120,
        )
      ],
      evidence_summaries=['Permission denied'],
      effective_resources={
        'default_catalog': 'ai_dev_kit',
        'default_schema': 'hang_zhou1_test9',
      },
    )
  )

  assert moves[0].intent == 'debug_failure'
  assert any(move.intent == 'validate_source' for move in moves)
  combined = ' '.join(f'{m.label} {m.prompt}' for m in moves).lower()
  # The failed tool name and the configured schema should surface somewhere.
  assert 'manage_uc_objects' in combined
  assert 'hang_zhou1_test9' in combined or 'ai_dev_kit' in combined


def test_metric_moves_use_period_and_dimension_hints():
  """Metric questions mentioning a period and a dimension should reflect both."""
  moves = generate_fallback_next_moves(
    _context(
      project_type='analyst_workspace',
      question='compare visit time per bdr for april vs march',
      answer='April average is 12.4 minutes, March was 11.1.',
      semantic_context={'metric_views': [{'name': 'visit_time'}]},
    )
  )

  combined = ' '.join(f'{m.label} {m.prompt}' for m in moves).lower()
  assert 'april' in combined or 'march' in combined
  assert 'bdr' in combined
  assert 'visit_time' in combined


def test_model_moves_are_validated_and_policy_filtered():
  """Model output parser should reject raw payloads and read-only write actions."""
  content = json.dumps({
    'moves': [
      {
        'label': 'Deploy app',
        'prompt': 'Deploy this app now',
        'actionType': 'pivot',
        'intent': 'deploy_artifact',
        'confidence': 0.9,
      },
      {
        'label': 'Raw JSON',
        'prompt': '{"items": [{"name": "secret"}]}',
        'actionType': 'drill',
        'intent': 'inspect_metadata',
        'confidence': 0.8,
      },
      {
        'label': 'Validate sources',
        'prompt': 'Validate source freshness, permissions, and caveats for this result.',
        'actionType': 'validate',
        'intent': 'validate_source',
        'confidence': 0.7,
      },
    ]
  })

  moves = parse_model_next_moves(content, _context(run_role='user_preview'))

  assert [move.label for move in moves] == ['Validate sources']
  assert moves[0].source == 'model'


def test_generate_next_moves_disabled_uses_heuristic(monkeypatch):
  """Generator should skip model calls when NEXT_MOVES_MODEL_ENABLED is false."""
  monkeypatch.setenv('NEXT_MOVES_MODEL_ENABLED', 'false')
  monkeypatch.delenv('OPENAI_API_KEY', raising=False)

  generation = asyncio.run(generate_next_moves(_context()))

  assert generation.source == 'heuristic'
  assert generation.fallback_reason == 'model_disabled'
  assert generation.moves

