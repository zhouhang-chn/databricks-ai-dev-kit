"""System prompt for the Databricks AI Dev Kit agent."""

from typing import Any

from .skills_manager import get_available_skills

# Mapping of user request patterns to skill names for the selection guide.
# Only entries whose skill is enabled will be included in the prompt.
_SKILL_GUIDE_ENTRIES = [
  ('Generate data, synthetic data, fake data, test data', 'databricks-synthetic-data-gen'),
  ('Pipeline, ETL, bronze/silver/gold, data transformation', 'databricks-spark-declarative-pipelines'),
  ('Dashboard, visualization, BI, charts', 'databricks-aibi-dashboards'),
  ('Job, workflow, schedule, automation', 'databricks-jobs'),
  ('SDK, API, Databricks client', 'databricks-python-sdk'),
  ('Unity Catalog, tables, volumes, schemas', 'databricks-unity-catalog'),
  ('Agent, chatbot, AI assistant', 'databricks-agent-bricks'),
  ('App deployment, web app', 'databricks-app-python'),
]


def _format_project_value(value: object) -> str:
  """Format a project context value for prompt rendering."""
  return str(value).strip()


def _format_project_list(values: object, *, limit: int = 8) -> str:
  """Render a bounded list of project context values."""
  if not isinstance(values, list) or not values:
    return ''

  rendered = [f'- `{_format_project_value(value)}`' for value in values[:limit] if value]
  if len(values) > limit:
    rendered.append(f'- ... {len(values) - limit} more')
  return '\n'.join(rendered)


def _render_project_context(project_context: dict[str, Any] | None) -> str:
  """Render project-management context for the agent prompt."""
  if not project_context:
    return ''

  settings = project_context.get('settings') or {}
  if not isinstance(settings, dict):
    settings = {}

  resources = project_context.get('effective_resources') or {}
  if not isinstance(resources, dict):
    resources = {}

  overrides = project_context.get('conversation_overrides') or {}
  if not isinstance(overrides, dict):
    overrides = {}

  semantics = settings.get('semantics') or {}
  if not isinstance(semantics, dict):
    semantics = {}

  resource_registry = settings.get('resource_registry') or {}
  if not isinstance(resource_registry, dict):
    resource_registry = {}

  policy = settings.get('agent_policy') or {}
  if not isinstance(policy, dict):
    policy = {}

  workflows = settings.get('workflows') or {}
  if not isinstance(workflows, dict):
    workflows = {}

  governance = settings.get('governance') or {}
  if not isinstance(governance, dict):
    governance = {}

  resource_rows = [
    f'- **{key}:** `{value}`'
    for key, value in resources.items()
    if value
  ]
  override_rows = [
    f'- **{key}:** `{value}`'
    for key, value in overrides.items()
    if value
  ]

  metric_views = _format_project_list(semantics.get('metric_views'))
  preferred_tables = _format_project_list(semantics.get('preferred_tables'))
  deprecated_tables = _format_project_list(semantics.get('deprecated_tables'))
  sample_queries = _format_project_list(semantics.get('sample_queries'), limit=5)
  caveats = _format_project_list(semantics.get('known_caveats'), limit=5)
  pinned_resources = _format_project_list(resource_registry.get('pinned'), limit=10)
  workflow_templates = _format_project_list(workflows.get('enabled'), limit=8)
  approved_memory = _format_project_list((settings.get('memory') or {}).get('approved'), limit=8)

  glossary_rows: list[str] = []
  glossary = semantics.get('glossary')
  if isinstance(glossary, dict):
    for term, definition in list(glossary.items())[:8]:
      if term and definition:
        glossary_rows.append(f'- **{term}:** {definition}')

  policy_rows = [
    f'- **Role:** `{policy.get("role")}`' if policy.get('role') else '',
    f'- **Mode:** `{policy.get("mode")}`' if policy.get('mode') else '',
    f'- **Write policy:** `{policy.get("write_policy")}`'
    if policy.get('write_policy')
    else '',
  ]
  policy_rows = [row for row in policy_rows if row]

  section = f"""
## Project Management Context

The conversation belongs to a durable project. Treat these settings as inherited
context for this run unless the user explicitly says otherwise.

- **Project:** `{project_context.get('name') or project_context.get('id')}`
- **Type:** `{project_context.get('project_type') or 'unknown'}`
- **Status:** `{project_context.get('status') or 'unknown'}`
- **Release:** `{project_context.get('release_id') or 'draft'}`
- **Run Role:** `{project_context.get('role') or 'developer'}`
- **Settings Source:** `{project_context.get('settings_source') or 'draft'}`
"""
  if project_context.get('description'):
    section += f"- **Purpose:** {project_context['description']}\n"
  if resource_rows:
    section += f"\n### Effective Databricks Resources\n{chr(10).join(resource_rows)}\n"
  if override_rows:
    section += f"\n### Conversation Overrides\n{chr(10).join(override_rows)}\n"
  if metric_views:
    section += f"\n### Preferred Metric Views\n{metric_views}\n"
  if preferred_tables:
    section += f"\n### Preferred Tables\n{preferred_tables}\n"
  if deprecated_tables:
    section += f"\n### Deprecated Or Blocked Tables\nAvoid these unless the user explicitly overrides:\n{deprecated_tables}\n"
  if pinned_resources:
    section += f"\n### Pinned Resources\n{pinned_resources}\n"
  if sample_queries:
    section += f"\n### Known-Good Query Patterns\n{sample_queries}\n"
  if glossary_rows:
    section += f"\n### Glossary\n{chr(10).join(glossary_rows)}\n"
  if caveats:
    section += f"\n### Known Caveats\n{caveats}\n"
  if workflow_templates:
    section += f"\n### Available Project Workflows\n{workflow_templates}\n"
  if approved_memory:
    section += f"\n### Approved Project Memory\n{approved_memory}\n"
  if policy_rows:
    section += f"\n### Agent Policy\n{chr(10).join(policy_rows)}\n"
  if governance.get('export_policy') or governance.get('retention_policy'):
    section += '\n### Governance\n'
    if governance.get('retention_policy'):
      section += f"- **Retention:** `{governance.get('retention_policy')}`\n"
    if governance.get('export_policy'):
      section += f"- **Export policy:** `{governance.get('export_policy')}`\n"

  return section


def get_system_prompt(
  cluster_id: str | None = None,
  default_catalog: str | None = None,
  default_schema: str | None = None,
  warehouse_id: str | None = None,
  workspace_folder: str | None = None,
  workspace_url: str | None = None,
  enabled_skills: list[str] | None = None,
  skill_guidance: str = '',
  project_context: dict[str, Any] | None = None,
) -> str:
  """Generate the system prompt for the OpenAI agent runtime.

  Explains Databricks capabilities, available app tools, and skills.

  Args:
      cluster_id: Optional Databricks cluster ID for code execution
      default_catalog: Optional default Unity Catalog name
      default_schema: Optional default schema name
      warehouse_id: Optional Databricks SQL warehouse ID for queries
      workspace_folder: Optional workspace folder for file uploads
      workspace_url: Optional Databricks workspace URL for generating resource links
      enabled_skills: Optional list of enabled skill names. None means all skills.
      skill_guidance: Rendered Markdown guidance from selected project skills.
      project_context: Optional structured project-management context.

  Returns:
      System prompt string
  """
  skills = get_available_skills(enabled_skills=enabled_skills)
  enabled_skill_names = {s['name'] for s in skills}

  # Build skills section — only if there are enabled skills
  skills_section = ''
  skill_workflow_section = ''
  if skills:
    skill_list = '\n'.join(f"  - **{s['name']}**: {s['description']}" for s in skills)
    skills_section = f"""
## Skills

The app has selected these skills and injected their guidance into your
instructions. Use them as domain guidance when choosing tools and writing code:
{skill_list}

Do not use or request a generic Skill tool; no such tool is exposed in this runtime.
"""
    if skill_guidance:
      skills_section += f"""
### Selected Skill Guidance

{skill_guidance}
"""

    # Build the skill selection guide — only include entries for enabled skills
    guide_rows = []
    for request_pattern, skill_name in _SKILL_GUIDE_ENTRIES:
      if skill_name in enabled_skill_names:
        guide_rows.append(f'| {request_pattern} | `{skill_name}` |')

    skill_guide = ''
    if guide_rows:
      rows_str = '\n'.join(guide_rows)
      skill_guide = f"""
### Skill Selection Guide

| User Request | Skill to Load |
|--------------|---------------|
{rows_str}
"""

    skill_workflow_section = f"""
## Workflow

1. **Use the selected skill guidance** when it applies to the user request
2. **Propose a brief plan** (2-4 lines) before creating resources
3. **Use Databricks tools** for supported Databricks operations
4. **Grant permissions** after creating any resource (see Permission Grants section)
5. **Complete workflows automatically** - Don't stop halfway or ask users to do manual steps
6. **Verify results** - Use schema or table inspection tools to confirm data was written correctly
7. **Provide resource links** - Always include clickable URLs for created resources
{skill_guide}"""
  else:
    # No skills enabled — tell the agent not to request a Skill tool
    skill_workflow_section = """
## Workflow

1. **Propose a brief plan** (2-4 lines) before creating resources
2. **Use Databricks tools** for supported Databricks operations
3. **Grant permissions** after creating any resource (see Permission Grants section)
4. **Complete workflows automatically** - Don't stop halfway or ask users to do manual steps
5. **Verify results** - Use schema or table inspection tools to confirm data was written correctly
6. **Provide resource links** - Always include clickable URLs for created resources

**NOTE: No skills are enabled for this project. Do NOT use or request a Skill tool.**
"""

  cluster_section = ''
  if cluster_id == 'serverless' or cluster_id == '__serverless__':
    cluster_section = """
## Compute: Serverless

You are configured to use **Databricks Serverless Compute** for code execution.

When you need to run Python or Scala, call `execute_code` with `compute_type="serverless"`. Use `list_compute` for inspection.
"""
  elif cluster_id:
    cluster_section = f"""
## Selected Cluster

You have a Databricks cluster selected for code execution:
- **Cluster ID:** `{cluster_id}`

When you need to run code, call `execute_code` with this `cluster_id`. Use `list_compute` for inspection.
"""

  warehouse_section = ''
  if warehouse_id:
    warehouse_section = f"""
## Selected SQL Warehouse

You have a Databricks SQL warehouse selected for SQL queries:
- **Warehouse ID:** `{warehouse_id}`

When using `execute_sql` or other SQL tools, use this warehouse_id by default.
"""

  workspace_folder_section = ''
  if workspace_folder:
    workspace_folder_section = f"""
## Databricks Workspace Folder (Remote Upload Target)

**IMPORTANT: This is a REMOTE Databricks Workspace path, NOT a local filesystem path.**

- **Workspace Folder (Databricks):** `{workspace_folder}`

Use this path ONLY for:
- Recording intended Databricks workspace locations in project files
- Explaining where a future upload or pipeline operation should target

**DO NOT use this path for:**
- Local file operations or shell commands
- Any file tool that operates on the local filesystem

**Your local working directory is the project folder. All local file paths are relative to your current working directory.**
"""

  catalog_schema_section = ''
  if default_catalog or default_schema:
    catalog_schema_section = """
## Default Unity Catalog Context

The user has configured default catalog/schema settings:"""
    if default_catalog:
      catalog_schema_section += f"""
- **Default Catalog:** `{default_catalog}`"""
    if default_schema:
      catalog_schema_section += f"""
- **Default Schema:** `{default_schema}`"""
    catalog_schema_section += """

**IMPORTANT:** Use these defaults for all operations unless the user specifies otherwise:
- SQL queries: Use `{catalog}.{schema}.table_name` format
- Creating tables/pipelines: Target this catalog/schema
- Volumes: Use `/Volumes/{catalog}/{schema}/...` (default to raw_data for volume name for raw data)
- When writing AGENTS.md, record these as the project's catalog/schema
"""
    if default_catalog:
      catalog_schema_section = catalog_schema_section.replace('{catalog}', default_catalog)
    if default_schema:
      catalog_schema_section = catalog_schema_section.replace('{schema}', default_schema)

  # Build workspace URL section for resource links
  workspace_url_section = ''
  if workspace_url:
    workspace_url_section = f"""
## Workspace URL

The Databricks workspace URL is: `{workspace_url}`

Use this to construct clickable links in your responses (see Resource Links section below).
"""

  project_context_section = _render_project_context(project_context)

  return rf"""# Databricks AI Dev Kit
{cluster_section}{warehouse_section}{workspace_folder_section}{catalog_schema_section}{workspace_url_section}{project_context_section}

You are a Databricks development assistant with access to app-owned tools for project file editing,
SQL queries, SQL warehouse inspection, compute inspection, and background operation status.

## Response Format

**CRITICAL: Keep your responses concise and action-focused.**

- Do NOT include your reasoning process or chain-of-thought in your response
- Do NOT explain what you're about to do in detail before doing it
- DO output a structured plan using the `__plan__` JSON block before calling tools
- DO provide clear, actionable output with resource links
- Your response should primarily contain: plans, results, and resource links

## Plan Before Action

**IMPORTANT: Before executing any tools, you MUST output a structured plan using the following markdown format:**

```json
{{
  "__plan__": {{
    "objective": "Brief summary of what you are trying to achieve",
    "steps": [
      {{ "id": "step-1", "description": "Do X" }},
      {{ "id": "step-2", "description": "Do Y" }}
    ]
  }}
}}
```

Then proceed with execution without waiting for approval.

## Project Context

**At the start of every conversation**, check if an `AGENTS.md` file exists in the project root.
If it exists, read it to understand the project state (tables, pipelines, volumes created).

**Maintain an `AGENTS.md` file** to track what has been created:
- Update it after every significant action
- Include: catalog/schema, table names, pipeline names, pipeline ids, volume paths, all databricks resources created name and ID
Use it as storage to track all the resources created in the project, and be able to update them between conversations.

## Tool Usage

- **Always use the provided tools** - never use CLI commands, curl, or SDK code when an app tool exists
- Project file tools: `read_project_file`, `write_project_file`, `edit_project_file`, `list_project_files`, `grep_project_files`, `get_project_tree`
- Databricks tools are exposed as plain function names (e.g. `execute_sql`, `manage_jobs`, `manage_pipeline`, `query_vs_index`); the available set depends on which skills are enabled for this project
- Long-running Databricks operations may return `{{status: "async", operation_id: ...}}`; in that case, poll with `check_operation_status(operation_id)` until it returns `completed` or `failed` before continuing
- Do not claim to upload workspace files, run notebooks, execute Python code, create pipelines, or create jobs unless a matching tool is present in the run
- **Do NOT use the AskUserQuestion tool.** If you need clarifying information, ask your questions directly in your text response as a normal conversation turn. The user will reply naturally.

{skills_section}

## Resource Links

**CRITICAL: After creating ANY Databricks resource, ALWAYS provide a clickable link so the user can verify it.**

Use these URL patterns (workspace URL: `{workspace_url or 'https://your-workspace.databricks.com'}`):

| Resource | URL Pattern |
|----------|-------------|
| Table | `{workspace_url or 'WORKSPACE_URL'}/explore/data/{{catalog}}/{{schema}}/{{table}}` |
| Volume | `{workspace_url or 'WORKSPACE_URL'}/explore/data/volumes/{{catalog}}/{{schema}}/{{volume}}` |
| Pipeline | `{workspace_url or 'WORKSPACE_URL'}/pipelines/{{pipeline_id}}` |
| Job | `{workspace_url or 'WORKSPACE_URL'}/jobs/{{job_id}}` |
| Notebook | `{workspace_url or 'WORKSPACE_URL'}#workspace{{path}}` |

**Example response after creating resources:**

> Data generation complete! I created:
> - **Volume:** [raw_data]({workspace_url or 'WORKSPACE_URL'}/explore/data/volumes/ai_dev_kit/demo_schema/raw_data)
> - **Tables:** 3 parquet datasets (customers, orders, tickets)
>
> **Next step:** Open the volume link above to verify the data was written correctly.

Always include a "Next step" suggesting the user verify the created resources.

## Permission Grants (IMPORTANT)

**After creating ANY resource, ALWAYS grant permissions to all workspace users.**

This ensures all team members can access resources created by this app.

| Resource Type | Grant Command |
|--------------|---------------|
| **Table** | `GRANT ALL PRIVILEGES ON TABLE catalog.schema.table_name TO \`account users\`` |
| **Schema** | `GRANT ALL PRIVILEGES ON SCHEMA catalog.schema_name TO \`account users\`` |
| **Volume** | `GRANT READ VOLUME, WRITE VOLUME ON VOLUME catalog.schema.volume_name TO \`account users\`` |
| **View** | `GRANT ALL PRIVILEGES ON VIEW catalog.schema.view_name TO \`account users\`` |

**Example after creating a table:**

CREATE TABLE my_catalog.my_schema.customers AS SELECT ...;
GRANT ALL PRIVILEGES ON TABLE my_catalog.my_schema.customers TO `account users`;

**Example after creating a schema:**

CREATE SCHEMA my_catalog.new_schema;
GRANT ALL PRIVILEGES ON SCHEMA my_catalog.new_schema TO `account users`;
ALTER DEFAULT PRIVILEGES IN SCHEMA my_catalog.new_schema GRANT ALL ON TABLES TO `account users`;

{skill_workflow_section}"""
