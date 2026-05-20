"""Project settings helpers for the Builder App.

The database stores project settings as JSON so the schema can evolve without
creating a migration for every new project-management idea. This module keeps
the JSON shape normalized and builds the compact context pack passed to agent
runs.
"""

from __future__ import annotations

import copy
import json
from collections.abc import Mapping
from typing import Any

DEFAULT_PROJECT_TYPE = 'databricks_app_build'
DEFAULT_PROJECT_STATUS = 'draft'
DEFAULT_RELEASE_ID = 'draft'
PROJECT_SETTINGS_VERSION = 1
USER_PREVIEW_ROLES = {'user', 'user_preview', 'viewer'}

RESOURCE_SETTING_KEYS = (
  'cluster_id',
  'default_catalog',
  'default_schema',
  'warehouse_id',
  'workspace_folder',
  'mlflow_experiment_name',
)


def default_project_settings() -> dict[str, Any]:
  """Return a fresh default project settings object."""
  return {
    'version': PROJECT_SETTINGS_VERSION,
    'identity': {
      'audience': 'developer',
      'success_criteria': [],
    },
    'resources': {key: None for key in RESOURCE_SETTING_KEYS},
    'resource_registry': {
      'pinned': [],
      'metadata_cache_status': 'not_configured',
    },
    'semantics': {
      'metric_views': [],
      'metric_view_context': {
        'discovery_sources': {},
        'metric_views': [],
      },
      'preferred_tables': [],
      'deprecated_tables': [],
      'glossary': {},
      'sample_queries': [],
      'known_caveats': [],
    },
    'scenario_onboarding': {
      'analysis_requirements': [],
      'semantic_gap_analysis': [],
      'readiness_summary': {},
    },
    'agent_policy': {
      'mode': 'build_with_approval',
      'role': 'developer',
      'enabled_skills': None,
      'write_policy': 'approval_required',
    },
    'roles': {
      'owners': [],
      'developers': [],
      'reviewers': [],
      'users': [],
      'viewers': [],
    },
    'releases': [],
    'release_policy': {
      'require_review': False,
      'require_eval_pass': False,
      'user_sessions_pin_release': True,
      'allowed_user_overrides': [],
    },
    'workflows': {
      'enabled': [],
      'templates': [],
      'runs': [],
    },
    'artifacts': [],
    'feedback': [],
    'eval_cases': [],
    'governance': {
      'retention_policy': 'project_default',
      'export_policy': 'exclude_secrets',
      'readiness': {},
      'audit_events': [],
    },
    'memory': {
      'approved': [],
      'proposed': [],
    },
  }


def _deep_merge(base: dict[str, Any], patch: Mapping[str, Any]) -> dict[str, Any]:
  """Recursively merge ``patch`` into ``base`` and return ``base``."""
  for key, value in patch.items():
    if isinstance(value, Mapping) and isinstance(base.get(key), dict):
      _deep_merge(base[key], value)
    else:
      base[key] = copy.deepcopy(value)
  return base


def normalize_project_settings(settings: Mapping[str, Any] | None) -> dict[str, Any]:
  """Merge user settings onto the current default settings schema."""
  normalized = default_project_settings()
  if not settings:
    return normalized

  _deep_merge(normalized, settings)
  normalized['version'] = PROJECT_SETTINGS_VERSION

  resources = normalized.get('resources')
  if not isinstance(resources, dict):
    resources = {}
    normalized['resources'] = resources
  for key in RESOURCE_SETTING_KEYS:
    resources.setdefault(key, None)

  return normalized


def _release_snapshot_settings(
  settings: dict[str, Any],
  release_id: str | None,
) -> dict[str, Any] | None:
  """Return normalized settings for a stored release snapshot."""
  if not release_id:
    return None

  releases = settings.get('releases')
  if not isinstance(releases, list):
    return None

  for release in releases:
    if not isinstance(release, dict):
      continue
    if release.get('id') != release_id:
      continue
    snapshot = release.get('settings_snapshot')
    if isinstance(snapshot, Mapping):
      return normalize_project_settings(snapshot)
  return None


def get_project_settings_for_run(
  project: Any,
  *,
  run_role: str | None = None,
) -> tuple[dict[str, Any], str]:
  """Return draft or release-pinned settings for one agent run."""
  settings = parse_project_settings(getattr(project, 'settings_json', None))
  release_id = getattr(project, 'current_release_id', DEFAULT_RELEASE_ID)
  if run_role in USER_PREVIEW_ROLES:
    snapshot = _release_snapshot_settings(settings, release_id)
    if snapshot:
      return snapshot, f'release:{release_id}'
  return settings, 'draft'


def parse_project_settings(settings_json: str | None) -> dict[str, Any]:
  """Parse persisted project settings JSON with a default fallback."""
  if not settings_json:
    return default_project_settings()

  try:
    parsed = json.loads(settings_json)
  except json.JSONDecodeError:
    return default_project_settings()

  if not isinstance(parsed, dict):
    return default_project_settings()

  return normalize_project_settings(parsed)


def serialize_project_settings(settings: Mapping[str, Any] | None) -> str:
  """Serialize settings after normalizing them to the current schema."""
  return json.dumps(normalize_project_settings(settings), sort_keys=True)


def merge_project_settings(
  current_settings_json: str | None,
  patch: Mapping[str, Any] | None,
) -> str:
  """Apply a deep settings patch and return serialized normalized JSON."""
  current = parse_project_settings(current_settings_json)
  if patch:
    _deep_merge(current, patch)
  return serialize_project_settings(current)


def get_project_resource_defaults(
  project: Any,
  *,
  run_role: str | None = None,
) -> dict[str, str | None]:
  """Return normalized resource defaults from a Project-like object."""
  settings, _ = get_project_settings_for_run(project, run_role=run_role)
  resources = settings.get('resources', {})
  return {
    key: value if isinstance(value, str) and value.strip() else None
    for key, value in resources.items()
    if key in RESOURCE_SETTING_KEYS
  }


def build_project_context(
  project: Any,
  *,
  run_role: str | None = None,
  effective_resources: Mapping[str, Any] | None = None,
  conversation_overrides: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
  """Build the agent-visible context pack for one project run."""
  settings, settings_source = get_project_settings_for_run(project, run_role=run_role)
  normalized_role = run_role or 'developer'
  if normalized_role in USER_PREVIEW_ROLES:
    settings = normalize_project_settings(
      {
        **settings,
        'agent_policy': {
          **(settings.get('agent_policy') or {}),
          'role': normalized_role,
          'mode': 'read_only_analysis',
          'write_policy': 'read_only',
        },
      }
    )

  return {
    'id': getattr(project, 'id', None),
    'name': getattr(project, 'name', None),
    'description': getattr(project, 'description', None),
    'project_type': getattr(project, 'project_type', DEFAULT_PROJECT_TYPE),
    'status': getattr(project, 'status', DEFAULT_PROJECT_STATUS),
    'release_id': getattr(project, 'current_release_id', DEFAULT_RELEASE_ID),
    'role': normalized_role,
    'settings_source': settings_source,
    'settings': settings,
    'effective_resources': {
      key: value
      for key, value in (effective_resources or {}).items()
      if key in RESOURCE_SETTING_KEYS and value
    },
    'conversation_overrides': {
      key: value
      for key, value in (conversation_overrides or {}).items()
      if key in RESOURCE_SETTING_KEYS and value
    },
  }
