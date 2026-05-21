"""Tests for project-management settings helpers."""

from dataclasses import dataclass

from server.project_config import (
  build_project_context,
  default_project_settings,
  get_project_resource_defaults,
  get_project_settings_for_run,
  merge_project_settings,
  parse_project_settings,
)
from server.services.system_prompt import get_system_prompt


@dataclass
class ProjectLike:
  """Small Project stand-in for helper tests."""

  id: str = 'project-1'
  name: str = 'Revenue Review'
  description: str | None = 'Monthly revenue workspace'
  project_type: str = 'analyst_workspace'
  status: str = 'draft'
  current_release_id: str = 'draft'
  settings_json: str | None = None


def test_parse_project_settings_returns_full_defaults_for_missing_json():
  """Missing persisted JSON still returns the full current settings shape."""
  settings = parse_project_settings(None)

  assert settings['version'] == 1
  assert settings['resources']['default_catalog'] is None
  assert settings['agent_policy']['role'] == 'developer'
  assert settings['semantics']['metric_view_context']['metric_views'] == []
  assert settings['scenario_onboarding']['analysis_requirements'] == []


def test_parse_project_settings_recovers_from_invalid_sections():
  """Malformed settings sections should not break project reads."""
  settings = parse_project_settings('{"resources": null}')

  assert settings['resources']['default_catalog'] is None
  assert settings['resources']['warehouse_id'] is None


def test_merge_project_settings_deep_merges_without_deleting_existing_values():
  """Resource patches should preserve unrelated settings sections."""
  current = default_project_settings()
  current['semantics']['metric_views'] = ['prod.finance.revenue_metrics']

  merged_json = merge_project_settings(
    None,
    {
      'semantics': {'metric_views': current['semantics']['metric_views']},
      'resources': {'default_catalog': 'prod'},
    },
  )
  patched_json = merge_project_settings(
    merged_json,
    {'resources': {'default_schema': 'finance'}},
  )
  patched = parse_project_settings(patched_json)

  assert patched['resources']['default_catalog'] == 'prod'
  assert patched['resources']['default_schema'] == 'finance'
  assert patched['semantics']['metric_views'] == ['prod.finance.revenue_metrics']


def test_parse_project_settings_migrates_legacy_preferred_tables():
  """Old saved settings should load as input tables without re-emitting preferred_tables."""
  settings = parse_project_settings(
    '{"semantics": {"preferred_tables": ["prod.finance.orders"]}}'
  )

  assert settings['semantics']['input_tables'] == ['prod.finance.orders']
  assert 'preferred_tables' not in settings['semantics']


def test_project_context_prefers_effective_resources_and_tracks_overrides():
  """The context pack exposes effective resources and conversation overrides."""
  project = ProjectLike(
    settings_json=merge_project_settings(
      None,
      {
        'resources': {'default_catalog': 'prod'},
      },
    )
  )

  context = build_project_context(
    project,
    effective_resources={'default_catalog': 'prod', 'default_schema': 'finance'},
    conversation_overrides={'default_schema': 'finance'},
  )

  assert get_project_resource_defaults(project)['default_catalog'] == 'prod'
  assert context['effective_resources']['default_schema'] == 'finance'
  assert context['conversation_overrides']['default_schema'] == 'finance'


def test_user_preview_uses_published_release_snapshot():
  """User preview runs pin to the current release snapshot when present."""
  release_settings = default_project_settings()
  release_settings['resources']['default_catalog'] = 'published'
  draft_settings = merge_project_settings(
    None,
    {
      'resources': {'default_catalog': 'draft'},
      'releases': [
        {
          'id': 'rel_1',
          'status': 'published',
          'settings_snapshot': release_settings,
        }
      ],
    },
  )
  project = ProjectLike(current_release_id='rel_1', settings_json=draft_settings)

  settings, source = get_project_settings_for_run(project, run_role='user_preview')
  context = build_project_context(project, run_role='user_preview')

  assert settings['resources']['default_catalog'] == 'published'
  assert source == 'release:rel_1'
  assert context['settings']['agent_policy']['write_policy'] == 'read_only'
  assert context['role'] == 'user_preview'


def test_system_prompt_renders_project_context():
  """Agent instructions include the compact project context pack."""
  project = ProjectLike(
    settings_json=merge_project_settings(
      None,
      {
        'semantics': {
          'metric_views': ['prod.finance.revenue_metrics'],
          'input_tables': ['prod.finance.orders'],
          'glossary': {'ARR': 'Annual recurring revenue'},
        },
      },
    )
  )
  context = build_project_context(
    project,
    effective_resources={'default_catalog': 'prod', 'default_schema': 'finance'},
  )

  prompt = get_system_prompt(project_context=context, enabled_skills=[])

  assert 'Project Management Context' in prompt
  assert 'Revenue Review' in prompt
  assert 'prod.finance.revenue_metrics' in prompt
  assert 'Input Tables' in prompt
  assert 'Preferred Tables' not in prompt
  assert 'prod.finance.orders' in prompt
  assert 'governed semantic layer' in prompt
  assert '`MEASURE(...)` before using raw input tables' in prompt
  assert 'Annual recurring revenue' in prompt


def test_system_prompt_renders_metric_view_context_status():
  """Metric View context should expose status and validation routing hints."""
  project = ProjectLike(
    settings_json=merge_project_settings(
      None,
      {
        'semantics': {
          'metric_views': ['prod.finance.revenue_metrics'],
          'metric_view_context': {
            'metric_views': [
              {
                'full_name': 'prod.finance.revenue_metrics',
                'status': 'candidate',
                'grain': ['Account', 'Month'],
                'measures': ['ARR', 'Net Revenue'],
                'dimensions': ['Month', 'Account Segment'],
                'validation': {'direct_sql_ref': 'revenue_metrics_direct_sql'},
              }
            ],
          },
        },
      },
    )
  )
  context = build_project_context(project)

  prompt = get_system_prompt(project_context=context, enabled_skills=[])

  assert 'Metric View Context' in prompt
  assert 'status `candidate`' in prompt
  assert 'revenue_metrics_direct_sql' in prompt
  assert 'candidate-only' in prompt
  assert 'MEASURE(`Measure Name`)' in prompt


def test_system_prompt_renders_analysis_notes_as_known_caveats():
  """Analysis notes saved through project settings reach prompt context."""
  project = ProjectLike(
    settings_json=merge_project_settings(
      None,
      {
        'semantics': {
          'known_caveats': [
            'Use validated visit-base denominator and exclude BDR 28062128.',
          ],
        },
      },
    )
  )
  context = build_project_context(project)

  prompt = get_system_prompt(project_context=context, enabled_skills=[])

  assert 'Known Caveats' in prompt
  assert 'Use validated visit-base denominator and exclude BDR 28062128.' in prompt


def test_system_prompt_renders_project_operating_guide_snapshot():
  """AGENTS.md content is injected as mechanism guidance, not payload."""
  prompt = get_system_prompt(
    enabled_skills=[],
    project_operating_guide='# Project Operating Guide\n\n- Validate schemas before SQL.',
  )

  assert 'Project Operating Guide Snapshot (AGENTS.md)' in prompt
  assert 'project-local mechanism guidance, not project payload' in prompt
  assert 'Validate schemas before SQL' in prompt


def test_system_prompt_separates_schema_and_selected_column_stats():
  """Schema inspection should be separate from selected-column profiling."""
  prompt = get_system_prompt(enabled_skills=[])

  assert 'inspect schema first with\n  `get_table_schema`' in prompt
  assert 'does not compute row counts or column statistics' in prompt
  assert 'Use `get_table_stats` only after schema discovery' in prompt
  assert 'explicit\n  non-empty `columns` list' in prompt
