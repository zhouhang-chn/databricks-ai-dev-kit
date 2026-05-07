"""Regression checks for Project Management frontend save contracts."""

from pathlib import Path


PROJECT_PAGE = (
  Path(__file__).resolve().parents[1]
  / 'client'
  / 'src'
  / 'pages'
  / 'ProjectPage.tsx'
)


def _project_management_handle_save_body() -> str:
  source = PROJECT_PAGE.read_text(encoding='utf-8')
  start = source.index('const handleSave = () => {')
  end = source.index('\n  return (', start)
  return source[start:end]


def test_project_management_save_persists_resource_defaults():
  """The project-management panel must save every resource field it displays."""
  body = _project_management_handle_save_body()

  assert 'resources: {' in body
  for key in (
    'default_catalog',
    'default_schema',
    'cluster_id',
    'warehouse_id',
    'workspace_folder',
    'mlflow_experiment_name',
  ):
    assert key in body
