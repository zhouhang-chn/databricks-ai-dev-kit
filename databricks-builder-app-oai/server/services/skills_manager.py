"""Skills manager for copying and managing Databricks skills.

Handles copying skills from the source repository to the app and project directories.
"""

import json
import logging
import os
import shutil
from pathlib import Path
from typing import Any, Callable

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Skill → tool allowlist mapping.
# Tool names are plain runtime tool names. ``get_allowed_mcp_tools`` also
# accepts MCP gateway names like ``mcp__databricks__execute_sql`` and compares
# their plain suffixes.
# ---------------------------------------------------------------------------
BASE_TOOL_NAMES = frozenset(
  {
    'update_plan',
    'submit_conclusion',
    'read_project_file',
    'execute_sql',
    'execute_sql_multi',
    'get_table_schema',
    'get_table_stats',
    'check_operation_status',
    'list_operations',
  }
)

SKILL_TOOL_MAPPING: dict[str, list[str]] = {
  'databricks-analysis': [
    'list_sql_warehouses',
    'get_best_sql_warehouse',
    'list_compute',
    'get_current_user',
  ],
  'databricks-scenario-onboarding': [
    'write_project_file',
    'edit_project_file',
    'list_project_files',
    'grep_project_files',
    'get_project_tree',
    'list_sql_warehouses',
    'get_best_sql_warehouse',
    'list_compute',
    'get_current_user',
    'manage_metric_views',
    'manage_volume_files',
    'get_volume_folder_details',
    'manage_workspace_files',
  ],
  'databricks-agent-bricks': ['manage_ka', 'manage_mas'],
  'databricks-aibi-dashboards': ['manage_dashboard'],
  'databricks-genie': ['manage_genie', 'ask_genie'],
  'databricks-spark-declarative-pipelines': ['manage_pipeline', 'manage_pipeline_run'],
  'databricks-model-serving': ['manage_serving_endpoint'],
  'databricks-jobs': ['manage_jobs', 'manage_job_runs'],
  'databricks-unity-catalog': [
    'manage_uc_objects',
    'manage_uc_grants',
    'manage_uc_storage',
    'manage_uc_connections',
    'manage_uc_tags',
    'manage_uc_security_policies',
    'manage_uc_monitors',
    'manage_uc_sharing',
    'manage_volume_files',
    'get_volume_folder_details',
    'manage_metric_views',
  ],
  'databricks-vector-search': [
    'manage_vs_endpoint',
    'manage_vs_index',
    'manage_vs_data',
    'query_vs_index',
  ],
  'databricks-metric-views': ['manage_metric_views'],
  # Provisioned and Autoscale Lakebase share the core database/sync/credential
  # tools.  Autoscale additionally claims branch tools.  If either skill is
  # enabled, the shared tools are available.
  'databricks-lakebase-provisioned': [
    'manage_lakebase_database',
    'manage_lakebase_sync',
    'generate_lakebase_credential',
  ],
  'databricks-lakebase-autoscale': [
    'manage_lakebase_database',
    'manage_lakebase_sync',
    'generate_lakebase_credential',
    'manage_lakebase_branch',
  ],
  # APX (FastAPI+React) and Python (Dash/Streamlit/etc.) share the same
  # app lifecycle tools — the skill content differs, not the MCP operations.
  'databricks-app-apx': ['manage_app'],
  'databricks-app-python': ['manage_app'],
}


def get_allowed_mcp_tools(
  all_tool_names: list[str],
  enabled_skills: list[str] | None = None,
) -> list[str]:
  """Return tools allowed by the enabled-skill whitelist.

  When ``enabled_skills`` is unset, all tools are allowed for backwards
  compatibility. When a project provides an explicit enabled-skill list, only
  the base tools plus tools claimed by those skills are exposed.

  Args:
      all_tool_names: Full list of MCP tool names (mcp__databricks__xxx format)
          or plain OpenAI function-tool names.
      enabled_skills: List of enabled skill names, or None for all tools.

  Returns:
      Filtered list of allowed MCP tool names.
  """
  if enabled_skills is None:
    return all_tool_names

  allowed_plain_names = set(BASE_TOOL_NAMES)
  for skill_name in enabled_skills:
    allowed_plain_names.update(SKILL_TOOL_MAPPING.get(skill_name, []))

  prefix = 'mcp__databricks__'
  allowed = []
  for tool_name in all_tool_names:
    plain_name = tool_name[len(prefix) :] if tool_name.startswith(prefix) else tool_name
    if plain_name in allowed_plain_names:
      allowed.append(tool_name)
  return allowed


def filter_openai_tools_by_skills(tools: list, enabled_skills: list[str] | None = None) -> list:
  """Filter OpenAI function tools using the enabled-skill whitelist."""
  if enabled_skills is None:
    return tools
  names = [getattr(tool, 'name', '') for tool in tools]
  allowed_names = set(get_allowed_mcp_tools(names, enabled_skills=enabled_skills))
  return [tool for tool in tools if getattr(tool, 'name', '') in allowed_names]


# Skills source directories.  install_skills.sh aggregates skills from
# multiple repos (this repo's databricks-skills/, mlflow/skills, apx) into
# the app's .agents/skills/ directory.  We check several locations so that
# the server works both in local development and when deployed.
#
# Candidate source directories (checked in priority order):
#   1. ./skills at app root — the deployed bundle / app-bundled location.
#   2. Sibling ../../databricks-skills — the repo-local Databricks-only skills.
#   3. .agents/skills/ inside the app — local runtime-neutral installs.
#   4. .claude/skills/ inside the app — legacy migration source.
_APP_ROOT = Path(__file__).parent.parent.parent
_INSTALLED_SKILLS_DIR = _APP_ROOT / '.agents' / 'skills'
_LEGACY_SKILLS_DIR = _APP_ROOT / '.claude' / 'skills'
_DEV_SKILLS_DIR = _APP_ROOT.parent / 'databricks-skills'
_DEPLOYED_SKILLS_DIR = _APP_ROOT / 'skills'

# Local cache of skills within this app (copied on startup)
APP_SKILLS_DIR = _APP_ROOT / 'skills'


def _non_empty_dir(p: Path) -> bool:
  return p.exists() and p.is_dir() and any(p.iterdir())


# Build an ordered list of source directories.  The first directory that
# contains a given skill wins, so put the most-complete source first.
_SKILLS_SOURCE_DIRS: list[Path] = []
if (
  _non_empty_dir(_DEPLOYED_SKILLS_DIR)
  and _DEPLOYED_SKILLS_DIR.resolve() != APP_SKILLS_DIR.resolve()
):
  _SKILLS_SOURCE_DIRS.append(_DEPLOYED_SKILLS_DIR)
if _non_empty_dir(_DEV_SKILLS_DIR):
  _SKILLS_SOURCE_DIRS.append(_DEV_SKILLS_DIR)
if _non_empty_dir(_INSTALLED_SKILLS_DIR):
  _SKILLS_SOURCE_DIRS.append(_INSTALLED_SKILLS_DIR)
if _non_empty_dir(_LEGACY_SKILLS_DIR):
  _SKILLS_SOURCE_DIRS.append(_LEGACY_SKILLS_DIR)

# Legacy single-directory reference used by callers that haven't been
# updated yet.  Points to the first available source.
SKILLS_SOURCE_DIR = _SKILLS_SOURCE_DIRS[0] if _SKILLS_SOURCE_DIRS else _DEV_SKILLS_DIR


def get_project_skills_dir(project_dir: Path) -> Path:
  """Return the runtime-neutral project skills directory."""
  return project_dir / '.agents' / 'skills'


def _legacy_project_skills_dir(project_dir: Path) -> Path:
  return project_dir / '.claude' / 'skills'


def get_enabled_skills_from_env() -> list[str] | None:
  """Get list of enabled skills from the ``ENABLED_SKILLS`` environment variable.

  Returns:
      List of skill names to include, or None when unset/empty (= all skills).
  """
  enabled = os.environ.get('ENABLED_SKILLS', '').strip()
  if not enabled:
    return None
  return [s.strip() for s in enabled.split(',') if s.strip()]


# Backwards-compatible alias used inside this module.
_get_enabled_skills = get_enabled_skills_from_env


def get_available_skills(enabled_skills: list[str] | None = None) -> list[dict]:
  """Get list of available skills with their metadata.

  Args:
      enabled_skills: Optional list of skill names to include.
          If None, all skills are returned.

  Returns:
      List of dicts with name, description, and path for each skill
  """
  skills = []

  if not APP_SKILLS_DIR.exists():
    logger.warning(f'Skills directory not found: {APP_SKILLS_DIR}')
    return skills

  for skill_dir in APP_SKILLS_DIR.iterdir():
    if not skill_dir.is_dir():
      continue

    skill_md = skill_dir / 'SKILL.md'
    if not skill_md.exists():
      continue

    # Parse frontmatter to get name and description
    try:
      content = skill_md.read_text()
      if content.startswith('---'):
        # Extract YAML frontmatter
        end_idx = content.find('---', 3)
        if end_idx > 0:
          frontmatter = content[3:end_idx].strip()
          name = None
          description = None

          for line in frontmatter.split('\n'):
            if line.startswith('name:'):
              name = line.split(':', 1)[1].strip().strip('"\'')
            elif line.startswith('description:'):
              description = line.split(':', 1)[1].strip().strip('"\'')

          if name:
            # Filter by enabled_skills if provided
            if enabled_skills is not None and name not in enabled_skills:
              continue
            skills.append(
              {
                'name': name,
                'description': description or '',
                'path': str(skill_dir),
              }
            )
    except Exception as e:
      logger.warning(f'Failed to parse skill {skill_dir}: {e}')

  return skills


class SkillNotFoundError(Exception):
  """Raised when an enabled skill is not found in the source directory."""

  pass


def _find_skill_source(skill_name: str) -> Path | None:
  """Find a skill directory across all source directories.

  Returns the first directory that contains ``skill_name/SKILL.md``.
  """
  for src_dir in _SKILLS_SOURCE_DIRS:
    candidate = src_dir / skill_name
    if candidate.is_dir() and (candidate / 'SKILL.md').exists():
      return candidate
  return None


def copy_skills_to_app() -> bool:
  """Copy skills from source directories to app's skills directory.

  Skills may originate from multiple locations (the deployed bundle, the repo's
  databricks-skills/, runtime-neutral .agents/skills/, or legacy .claude/skills/).
  This function merges them into APP_SKILLS_DIR.

  Called on server startup to ensure we have the latest skills.
  Only copies skills listed in ENABLED_SKILLS env var (if set).

  Returns:
      True if successful, False otherwise

  Raises:
      SkillNotFoundError: If an enabled skill folder doesn't exist in any
          source directory or lacks SKILL.md.
  """
  if not _SKILLS_SOURCE_DIRS:
    # No external source directories found.  In a deployed app the skills
    # are bundled directly into APP_SKILLS_DIR (== _DEPLOYED_SKILLS_DIR),
    # so there is nothing to copy — skills are already in place.
    if _non_empty_dir(APP_SKILLS_DIR):
      logger.info(f'No external source dirs; skills already in place at {APP_SKILLS_DIR}')
      return True
    logger.warning('No skills source directories found')
    return False

  # Guard against self-deletion: when every source *is* APP_SKILLS_DIR we
  # would wipe the only copy.  Skills are already in place, so skip.
  all_same = all(src.resolve() == APP_SKILLS_DIR.resolve() for src in _SKILLS_SOURCE_DIRS)
  if all_same:
    logger.info(f'All skills sources resolve to {APP_SKILLS_DIR}, skipping copy')
    return True

  enabled_skills = _get_enabled_skills()
  if enabled_skills:
    logger.info(f'Filtering skills to: {enabled_skills}')

    for skill_name in enabled_skills:
      found = _find_skill_source(skill_name)
      if found is None:
        searched = ', '.join(str(d) for d in _SKILLS_SOURCE_DIRS)
        raise SkillNotFoundError(
          f"Skill '{skill_name}' not found in any source directory. "
          f'Searched: {searched}. '
          f'Check ENABLED_SKILLS in your .env file.'
        )

  try:
    if APP_SKILLS_DIR.exists():
      shutil.rmtree(APP_SKILLS_DIR)

    APP_SKILLS_DIR.mkdir(parents=True, exist_ok=True)

    copied: set[str] = set()
    for src_dir in _SKILLS_SOURCE_DIRS:
      if src_dir.resolve() == APP_SKILLS_DIR.resolve():
        continue
      for item in src_dir.iterdir():
        if not item.is_dir() or not (item / 'SKILL.md').exists():
          continue
        if item.name in copied:
          continue
        if enabled_skills and item.name not in enabled_skills:
          logger.debug(f'Skipping skill (not enabled): {item.name}')
          continue

        dest = APP_SKILLS_DIR / item.name
        shutil.copytree(item, dest)
        copied.add(item.name)
        logger.debug(f'Copied skill: {item.name}')

    logger.info(f'Copied {len(copied)} skills to {APP_SKILLS_DIR}')
    return True

  except SkillNotFoundError:
    raise
  except Exception as e:
    logger.error(f'Failed to copy skills: {e}')
    return False


def copy_skills_to_project(project_dir: Path, enabled_skills: list[str] | None = None) -> bool:
  """Copy skills to a project's .agents/skills directory.

  Args:
      project_dir: Path to the project directory
      enabled_skills: Optional list of skill names to copy.
          If None, all skills are copied (backward compatible).

  Returns:
      True if successful, False otherwise
  """
  if not APP_SKILLS_DIR.exists():
    logger.warning('App skills directory not found, trying to copy from source')
    copy_skills_to_app()

  if not APP_SKILLS_DIR.exists():
    logger.warning('No skills available to copy')
    return False

  # Build a set of enabled skill directory names by matching SKILL.md name to dir
  enabled_dir_names = None
  if enabled_skills is not None:
    enabled_dir_names = set()
    for skill_dir in APP_SKILLS_DIR.iterdir():
      if not skill_dir.is_dir() or not (skill_dir / 'SKILL.md').exists():
        continue
      skill_name = _parse_skill_name(skill_dir)
      if skill_name and skill_name in enabled_skills:
        enabled_dir_names.add(skill_dir.name)

  try:
    project_skills_dir = get_project_skills_dir(project_dir)
    project_skills_dir.mkdir(parents=True, exist_ok=True)

    # Copy skills (filtered if enabled_dir_names is set)
    copied_count = 0
    for skill_dir in APP_SKILLS_DIR.iterdir():
      if skill_dir.is_dir() and (skill_dir / 'SKILL.md').exists():
        if enabled_dir_names is not None and skill_dir.name not in enabled_dir_names:
          continue
        dest = project_skills_dir / skill_dir.name
        if dest.exists():
          shutil.rmtree(dest)
        shutil.copytree(skill_dir, dest)
        copied_count += 1

    logger.info(f'Copied {copied_count} skills to project: {project_dir}')
    return True

  except Exception as e:
    logger.error(f'Failed to copy skills to project: {e}')
    return False


def sync_project_skills(project_dir: Path, enabled_skills: list[str] | None = None) -> bool:
  """Sync a project's skills directory to match the enabled skills list.

  Removes skills not in the enabled list and adds missing ones.
  More efficient than a full wipe-and-recopy for incremental changes.

  Args:
      project_dir: Path to the project directory
      enabled_skills: List of enabled skill names, or None for all skills

  Returns:
      True if successful, False otherwise
  """
  if not APP_SKILLS_DIR.exists():
    logger.warning('App skills directory not found')
    return False

  try:
    project_skills_dir = get_project_skills_dir(project_dir)
    project_skills_dir.mkdir(parents=True, exist_ok=True)

    # Build mapping: skill_name -> app_skills_dir_name
    name_to_dir = {}
    for skill_dir in APP_SKILLS_DIR.iterdir():
      if not skill_dir.is_dir() or not (skill_dir / 'SKILL.md').exists():
        continue
      skill_name = _parse_skill_name(skill_dir)
      if skill_name:
        name_to_dir[skill_name] = skill_dir.name

    # Determine which dir names should be present
    if enabled_skills is not None:
      desired_dirs = {name_to_dir[name] for name in enabled_skills if name in name_to_dir}
    else:
      desired_dirs = set(name_to_dir.values())

    # Remove skills that shouldn't be there
    for existing in project_skills_dir.iterdir():
      if existing.is_dir() and existing.name not in desired_dirs:
        logger.debug(f'Removing disabled skill from project: {existing.name}')
        shutil.rmtree(existing)

    # Add missing skills
    for dir_name in desired_dirs:
      dest = project_skills_dir / dir_name
      if not dest.exists():
        src = APP_SKILLS_DIR / dir_name
        if src.exists():
          logger.debug(f'Adding enabled skill to project: {dir_name}')
          shutil.copytree(src, dest)

    logger.info(f'Synced project skills: {len(desired_dirs)} enabled')
    return True

  except Exception as e:
    logger.error(f'Failed to sync project skills: {e}')
    return False


def _parse_skill_name(skill_dir: Path) -> str | None:
  """Parse the skill name from a skill directory's SKILL.md frontmatter.

  Args:
      skill_dir: Path to the skill directory

  Returns:
      Skill name string, or None if not parseable
  """
  skill_md = skill_dir / 'SKILL.md'
  if not skill_md.exists():
    return None
  try:
    content = skill_md.read_text()
    if content.startswith('---'):
      end_idx = content.find('---', 3)
      if end_idx > 0:
        frontmatter = content[3:end_idx].strip()
        for line in frontmatter.split('\n'):
          if line.startswith('name:'):
            return line.split(':', 1)[1].strip().strip('"\'')
  except Exception:
    pass
  return None


def _strip_frontmatter(content: str) -> str:
  """Remove leading YAML frontmatter from a skill document."""
  if not content.startswith('---'):
    return content.strip()
  end_idx = content.find('---', 3)
  if end_idx <= 0:
    return content.strip()
  return content[end_idx + 3 :].strip()


def _project_has_metric_views(project_context: dict[str, Any] | None) -> bool:
  """Whether the project has any configured Metric Views (stable per project)."""
  if not isinstance(project_context, dict):
    return False
  settings = project_context.get('settings') or {}
  if not isinstance(settings, dict):
    return False
  semantics = settings.get('semantics') or {}
  if not isinstance(semantics, dict):
    return False
  if isinstance(semantics.get('metric_views'), list) and semantics.get('metric_views'):
    return True
  mvc = semantics.get('metric_view_context')
  if isinstance(mvc, dict):
    nested = mvc.get('metric_views')
    if isinstance(nested, list) and nested:
      return True
  return False


# Per-skill optional sections, keyed by the `## ` heading prefix, paired with a
# predicate over project metadata. A section is dropped only when its predicate
# returns False (high-confidence "not applicable for this project"); sections
# without an entry are always kept.
#
# Selection uses only stable, per-conversation project metadata — never the
# current user message — so the rendered guidance stays byte-stable across a
# conversation's turns and does not break the static-prompt cache (P0).
_OPTIONAL_SKILL_SECTIONS: dict[str, list[tuple[str, Callable[[dict[str, Any] | None], bool]]]] = {
  'databricks-analysis': [
    # The Metric Views section tells the agent to "query Metric Views first";
    # for a project with no Metric Views that guidance is actively misleading.
    ('Metric Views', _project_has_metric_views),
  ],
}


def _filter_optional_skill_sections(
  content: str,
  skill_name: str,
  project_context: dict[str, Any] | None,
) -> str:
  """Drop optional `## ` sections that don't apply to this project.

  Splits on level-2 headings, keeps the preamble and every section without a
  rule, and drops a section only when its rule's predicate returns False.
  Returns the content unchanged when the skill has no rules or no project
  context is available.
  """
  rules = _OPTIONAL_SKILL_SECTIONS.get(skill_name)
  if not rules or project_context is None:
    return content

  blocks: list[list[str]] = [[]]
  for line in content.split('\n'):
    if line.startswith('## '):
      blocks.append([line])
    else:
      blocks[-1].append(line)

  kept_lines: list[str] = list(blocks[0])  # preamble before the first heading
  for block in blocks[1:]:
    heading = block[0][3:].strip()
    drop = any(
      heading.startswith(prefix) and not predicate(project_context) for prefix, predicate in rules
    )
    if not drop:
      kept_lines.extend(block)
  return '\n'.join(kept_lines).strip()


def render_project_skill_guidance(
  project_dir: Path,
  enabled_skills: list[str] | None = None,
  *,
  max_chars: int = 40_000,
  project_context: dict[str, Any] | None = None,
) -> str:
  """Render selected project skill Markdown into bounded agent instructions."""
  project_skills_dir = get_project_skills_dir(project_dir)
  if not project_skills_dir.exists():
    return ''

  enabled_set = set(enabled_skills) if enabled_skills is not None else None
  sections: list[str] = []
  used_chars = 0

  for skill_dir in sorted(project_skills_dir.iterdir(), key=lambda p: p.name):
    if not skill_dir.is_dir():
      continue
    skill_md = skill_dir / 'SKILL.md'
    if not skill_md.exists():
      continue

    skill_name = _parse_skill_name(skill_dir) or skill_dir.name
    if enabled_set is not None and skill_name not in enabled_set:
      continue

    try:
      content = _strip_frontmatter(skill_md.read_text())
    except OSError as e:
      logger.warning(f'Failed to read skill guidance {skill_md}: {e}')
      continue

    if not content:
      continue

    content = _filter_optional_skill_sections(content, skill_name, project_context)
    if not content:
      continue

    header = f'### {skill_name}\n\n'
    remaining = max_chars - used_chars - len(header)
    if remaining <= 0:
      break

    if len(content) > remaining:
      content = content[:remaining].rsplit('\n', 1)[0].strip()
      content += '\n\n[Skill guidance truncated to fit prompt budget.]'

    section = header + content
    sections.append(section)
    used_chars += len(section)

    if used_chars >= max_chars:
      break

  if not sections:
    return ''

  return '\n\n'.join(sections)


def reload_project_skills(project_dir: Path, enabled_skills: list[str] | None = None) -> bool:
  """Reload skills for a project by refreshing from source.

  This function:
  1. Refreshes the app's skills cache from the source repo
  2. Removes the project's existing skills
  3. Copies the updated skills to the project (filtered by enabled_skills)

  Args:
      project_dir: Path to the project directory
      enabled_skills: Optional list of skill names to include.
          If None, all skills are copied.

  Returns:
      True if successful, False otherwise
  """
  try:
    # First, refresh app skills from source
    logger.info('Refreshing app skills from source...')
    copy_skills_to_app()

    # Remove existing project skills
    project_skills_dir = get_project_skills_dir(project_dir)
    if project_skills_dir.exists():
      logger.info(f'Removing existing project skills: {project_skills_dir}')
      shutil.rmtree(project_skills_dir)

    # Copy fresh skills to project (filtered by enabled_skills)
    logger.info('Copying fresh skills to project...')
    return copy_skills_to_project(project_dir, enabled_skills=enabled_skills)

  except Exception as e:
    logger.error(f'Failed to reload project skills: {e}')
    return False


def get_skills_summary() -> str:
  """Get a summary of available skills for the system prompt.

  Returns:
      Markdown-formatted summary of skills
  """
  skills = get_available_skills()

  if not skills:
    return ''

  lines = ['## Available Skills', '']
  lines.append('The app injects selected skill guidance directly into the agent prompt:')
  lines.append('')

  for skill in skills:
    lines.append(f'- **{skill["name"]}**: {skill["description"]}')

  return '\n'.join(lines)


# ---------------------------------------------------------------------------
# File-based enabled skills storage (no DB migration required)
# Stored at: project_dir/.agents/enabled_skills.json
# ---------------------------------------------------------------------------

_ENABLED_SKILLS_FILENAME = 'enabled_skills.json'


def get_project_enabled_skills(project_dir: Path) -> list[str] | None:
  """Read the enabled skills list for a project from the filesystem.

  Returns:
      List of enabled skill names, or None if all skills are enabled.
  """
  config_path = project_dir / '.agents' / _ENABLED_SKILLS_FILENAME
  legacy_config_path = project_dir / '.claude' / _ENABLED_SKILLS_FILENAME
  if not config_path.exists():
    if legacy_config_path.exists():
      config_path = legacy_config_path
    else:
      return None
  try:
    data = json.loads(config_path.read_text())
    if isinstance(data, list):
      return data
    return None
  except (json.JSONDecodeError, OSError) as e:
    logger.warning(f'Failed to read enabled skills config: {e}')
    return None


def set_project_enabled_skills(project_dir: Path, enabled_skills: list[str] | None) -> bool:
  """Write the enabled skills list for a project to the filesystem.

  Args:
      project_dir: Path to the project directory
      enabled_skills: List of skill names to enable, or None for all skills.

  Returns:
      True if successful, False otherwise
  """
  agents_dir = project_dir / '.agents'
  config_path = agents_dir / _ENABLED_SKILLS_FILENAME
  try:
    if enabled_skills is None:
      # All skills enabled — remove the config file if it exists
      if config_path.exists():
        config_path.unlink()
    else:
      agents_dir.mkdir(parents=True, exist_ok=True)
      config_path.write_text(json.dumps(enabled_skills, indent=2))
    return True
  except OSError as e:
    logger.error(f'Failed to write enabled skills config: {e}')
    return False
