"""Tests for v0.2 project_setting.yaml helpers."""

from dataclasses import dataclass

from server.services.project_settings import (
  ProjectSetting,
  default_project_setting,
  parse_project_setting_yaml,
  project_update_from_setting,
  render_project_setting_yaml,
)


@dataclass
class ProjectLike:
  """Small Project stand-in for YAML helper tests."""

  id: str = 'project-1'
  name: str = 'BDR Routing Pilot'
  description: str | None = 'Evaluate ML-generated visit plans.'
  settings_json: str | None = None


def test_default_project_setting_uses_user_and_project_for_output_schema():
  """New projects get a useful output schema in the minimal YAML contract."""
  setting = default_project_setting(
    ProjectLike(),
    user_email='hang.zhou1@example.com',
    databricks_host='https://adb.example.com',
  )

  assert setting.business_background == 'Evaluate ML-generated visit plans.'
  assert setting.databricks_resources.databricks_host == 'https://adb.example.com'
  assert setting.databricks_resources.output_schema == 'ai_dev_kit.hang_zhou1_bdr_routing_pilot'


def test_project_setting_yaml_round_trips_lists_and_block_text():
  """Rendered YAML should parse back into the same schema-level values."""
  setting = ProjectSetting.model_validate(
    {
      'business_background': 'Line one\n\nLine two',
      'analysis_notes': ['Use April as pilot month'],
      'databricks_resources': {
        'cluster_id': 'cluster-1',
        'warehouse_id': None,
        'input_tables': ['cat.sch.table'],
        'output_schema': 'out.schema',
      },
    }
  )

  parsed = parse_project_setting_yaml(render_project_setting_yaml(setting))

  assert 'Line one' in parsed.business_background
  assert parsed.analysis_notes == ['Use April as pilot month']
  assert parsed.databricks_resources.cluster_id == 'cluster-1'
  assert parsed.databricks_resources.warehouse_id is None
  assert parsed.databricks_resources.input_tables == ['cat.sch.table']


def test_project_update_from_setting_maps_yaml_to_runtime_defaults():
  """Saving project_setting.yaml also updates the runtime resource defaults."""
  setting = ProjectSetting.model_validate(
    {
      'business_background': 'Analyze a pilot',
      'analysis_notes': ['Known caveat'],
      'databricks_resources': {
        'cluster_id': 'cluster-1',
        'warehouse_id': 'warehouse-1',
        'workspace_folders': ['/Workspace/Users/me/source'],
        'workflows': ['daily_refresh'],
        'input_tables': ['cat.sch.table'],
        'input_metric_views': ['cat.sch.metric_view'],
        'output_schema': 'out.schema',
      },
    }
  )

  patch = project_update_from_setting(setting)

  assert patch['description'] == 'Analyze a pilot'
  assert patch['settings']['resources']['cluster_id'] == 'cluster-1'
  assert patch['settings']['resources']['warehouse_id'] == 'warehouse-1'
  assert patch['settings']['resources']['default_catalog'] == 'out'
  assert patch['settings']['resources']['default_schema'] == 'schema'
  assert patch['settings']['semantics']['input_tables'] == ['cat.sch.table']
  assert 'preferred_tables' not in patch['settings']['semantics']
  assert patch['settings']['semantics']['metric_views'] == ['cat.sch.metric_view']
  assert patch['settings']['semantics']['known_caveats'] == ['Known caveat']
  assert patch['settings']['workflows']['enabled'] == ['daily_refresh']


def test_metric_view_context_round_trips_and_syncs_to_runtime_settings():
  """Metric View context keeps status, grain, measures, and validation metadata."""
  setting = ProjectSetting.model_validate(
    {
      'business_background': 'Analyze governed metrics.',
      'databricks_resources': {
        'input_metric_views': ['cat.sch.poc_metrics'],
      },
      'analysis_requirements': [
        {
          'requirement_id': 'req_poc_achievement',
          'grain': ['M1', 'Month'],
          'measures': ['POC Achievement Rate'],
          'dimensions': ['Year Month', 'M1 No'],
          'priority': 'P0',
        }
      ],
      'semantic_gap_analysis': [
        {
          'requirement_id': 'req_poc_achievement',
          'existing_coverage': 'partial',
          'gaps': ['Metric View needs direct SQL reconciliation.'],
          'recommended_assets': ['cat.sch.poc_metrics'],
          'readiness': 'blocked_until_validated',
        }
      ],
      'metric_view_context': {
        'metric_views': [
          {
            'full_name': 'cat.sch.poc_metrics',
            'status': 'candidate',
            'grain': ['POC', 'Month'],
            'dimensions': ['Year Month', 'M1 No'],
            'measures': ['Total POC Count', 'POC Achievement Rate'],
            'validation': {
              'direct_sql_ref': 'poc_achievement_direct_sql',
              'tolerance': {'count_fields': 'exact', 'rate_fields': 0.01},
            },
          }
        ],
      },
      'readiness_summary': {'status': 'partially_ready'},
    }
  )

  parsed = parse_project_setting_yaml(render_project_setting_yaml(setting))
  patch = project_update_from_setting(parsed)

  assert parsed.analysis_requirements[0].requirement_id == 'req_poc_achievement'
  assert parsed.semantic_gap_analysis[0].existing_coverage == 'partial'
  assert parsed.metric_view_context.metric_views[0].status == 'candidate'
  assert parsed.metric_view_context.metric_views[0].validation is not None
  assert (
    parsed.metric_view_context.metric_views[0].validation.direct_sql_ref
    == 'poc_achievement_direct_sql'
  )
  assert (
    patch['settings']['semantics']['metric_view_context']['metric_views'][0]['full_name']
    == 'cat.sch.poc_metrics'
  )
  assert (
    patch['settings']['scenario_onboarding']['readiness_summary']['status'] == 'partially_ready'
  )
