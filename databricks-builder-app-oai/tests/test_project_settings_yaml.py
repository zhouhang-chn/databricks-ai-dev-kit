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
  assert patch['settings']['semantics']['preferred_tables'] == ['cat.sch.table']
  assert patch['settings']['workflows']['enabled'] == ['daily_refresh']
