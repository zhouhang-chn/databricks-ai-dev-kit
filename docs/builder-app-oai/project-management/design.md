# Project Management Design

## Summary

Project management should become the top-level product contract for Builder and
analyst agents. A project is not only a container for conversations. It is the
durable object that defines intent, Databricks resource scope, semantic scope,
tool policy, artifacts, releases, and role-specific behavior.

This design turns the concept proposal into an implementation target for
`databricks-builder-app-oai`. The first implementation slice is deliberately
small: project metadata, structured project settings, inherited resource
defaults, and an agent-visible project context pack. Later phases add releases,
memberships, semantic registries, workflows, memory, feedback, and governance.

## Decisions

1. **Project is the durable context boundary.** Conversations are threads inside
   a project and should inherit project settings unless they explicitly
   override them.
2. **Project settings are structured data.** Prompt text, UI controls, evals,
   logs, and traces must read from the same settings object.
3. **`databricks-builder-app-oai` starts with developer mode.** The current app
   is still primarily a Databricks app/data-product build workspace. User-facing
   analyst releases are a later phase, not a forced MVP abstraction.
4. **Resource defaults move first.** Catalog, schema, SQL warehouse, cluster,
   workspace folder, MLflow experiment, and enabled skills are the immediate
   high-value settings because they reduce repeated setup and make agent runs
   more reproducible.
5. **Published releases are snapshots.** When the user surface is added,
   sessions must pin to a release ID rather than silently following mutable
   draft settings.
6. **Databricks permissions remain authoritative.** Project scope narrows and
   explains what the agent should use; it does not grant platform access by
   itself.

## Product Model

### Project

A project is a durable work product with:

- identity: name, description, type, status, owner
- role context: owner, developer, reviewer, user, viewer
- Databricks resource bindings: workspace, catalog/schema, warehouse, cluster,
  workspace folder, MLflow experiment, volumes, dashboards, jobs, pipelines
- semantic scope: metric views, preferred tables, glossary, joins, caveats
- agent policy: model/runtime, selected skills, tool policy, approval policy,
  cost/time limits
- workflows: reusable analysis or build procedures
- artifacts: generated files, SQL, dashboards, notebooks, reports, traces
- memory and feedback: approved corrections, proposed memories, eval cases
- releases: immutable snapshots for user-facing consumption

### Conversation

A conversation is one interaction thread inside a project. It may override some
settings for experimentation, but those overrides should remain local to the
conversation and should be visible in the UI and trace.

Conversation-owned state should include:

- title and message history
- runtime session ID
- execution history and reconnect buffer
- conversation-specific overrides

Conversation-owned state should not become the only source of project defaults.

### Developer/User Split

The same project supports two role-specific surfaces.

Developer surface:

- edit project settings, resources, semantic scope, workflows, and artifacts
- run exploratory conversations against the draft
- create and validate releases
- inspect logs, traces, evals, and feedback

User surface:

- ask questions against a published release
- use approved workflows and allowed filters
- save personal stories or views
- submit feedback and correction proposals
- avoid mutating project definitions unless explicitly granted a developer role

This mirrors the BI dashboard pattern: developers build and release a governed
product; users consume the published version and interact within controlled
bounds.

## Settings Schema

The MVP stores settings as JSON on `projects.settings_json`. The long-term model
can normalize the most important sections into separate tables after the shape
settles.

```json
{
  "version": 1,
  "identity": {
    "audience": "developer",
    "success_criteria": []
  },
  "resources": {
    "cluster_id": null,
    "default_catalog": null,
    "default_schema": null,
    "warehouse_id": null,
    "workspace_folder": null,
    "mlflow_experiment_name": null
  },
  "semantics": {
    "metric_views": [],
    "preferred_tables": [],
    "glossary": {},
    "known_caveats": []
  },
  "agent_policy": {
    "mode": "build_with_approval",
    "role": "developer",
    "enabled_skills": null,
    "write_policy": "approval_required"
  },
  "workflows": {
    "enabled": []
  },
  "memory": {
    "approved": [],
    "proposed": []
  }
}
```

Project columns hold fields needed for list/detail views and indexing:

- `description`
- `project_type`
- `status`
- `current_release_id`
- `settings_json`
- `updated_at`

## Runtime Contract

Every agent run receives an `AgentRunRequest` with a `project_context` field:

```python
project_context = {
  "id": project.id,
  "name": project.name,
  "description": project.description,
  "project_type": project.project_type,
  "status": project.status,
  "release_id": project.current_release_id,
  "settings": project_settings,
  "effective_resources": {
    "cluster_id": "...",
    "default_catalog": "...",
    "default_schema": "...",
    "warehouse_id": "...",
    "workspace_folder": "...",
    "mlflow_experiment_name": "..."
  },
  "conversation_overrides": {
    "default_schema": "..."
  }
}
```

The router resolves settings in this order:

1. request/conversation override
2. project resource default
3. app-generated fallback, such as first warehouse or generated schema

The system prompt renders a compact Project Context section. The prompt should
include only context that helps the agent behave correctly: project purpose,
type/status/release, effective resources, selected semantic assets, glossary,
and agent policy. Backend-only data such as secrets must never be included.

## API Contract

Existing project endpoints remain stable and receive additive fields.

`POST /projects`

```json
{
  "name": "Sales App",
  "description": "Optional short purpose",
  "project_type": "databricks_app_build",
  "settings": {}
}
```

`PATCH /projects/{project_id}`

```json
{
  "name": "Sales App",
  "description": "Build a Lakehouse app for Sales Ops",
  "project_type": "databricks_app_build",
  "status": "draft",
  "current_release_id": "draft",
  "settings": {
    "resources": {
      "default_catalog": "main",
      "default_schema": "sales_ops",
      "warehouse_id": "abc123"
    }
  }
}
```

`settings` is deep-merged with the current project settings. Unspecified
sections are preserved. Explicit `null` values clear the corresponding setting.

## UI Contract

The OAI app should expose project settings progressively.

MVP behavior:

- project detail loads resource defaults from project settings
- conversation values override project defaults
- config panel can save current resource selections as project defaults
- project management panel edits setup, role, release, semantic, workflow,
  artifact, memory, feedback, and governance settings
- developers can switch the current chat to user-preview mode or start a new
  user-preview chat
- header chips reflect effective resources
- project cards can show type/status when useful

Later behavior:

- project home page with developer and user modes
- guided project creation wizard
- semantic scope editor
- workflow/template editor
- release readiness and publish flow
- feedback and memory proposal queue

## Current Source Alignment

The current OAI source has JSON-backed project settings, resource-default
helpers, project context rendering, user-preview role handling, and release
snapshot support. One v0.2 correctness gap remains in the Project Management
panel: it loads resource fields from `settings.resources`, but its save payload
does not yet persist those resource fields. The config panel's resource-default
save flow is separate from that gap.

## Persistence And Migration Strategy

The first migration is additive. Existing projects remain valid with default
settings:

- `project_type = "databricks_app_build"`
- `status = "draft"`
- `current_release_id = "draft"`
- `settings_json = null`, interpreted as default settings

No existing conversation columns are removed in the MVP. The app continues to
read conversation fields as overrides, which keeps historical sessions working.

Future migrations can normalize settings into:

- `project_resources`
- `project_semantics`
- `project_workflows`
- `project_releases`
- `project_memberships`
- `project_memories`
- `project_artifacts`

## Security And Governance

- Model provider credentials remain runtime configuration, not project data.
- Databricks user tokens and target workspace tokens are never stored in project
  settings or rendered into prompts.
- Tool access must continue to be enforced by constructing the actual tool list
  per run.
- Read-only user sessions should never expose developer-only write tools.
- User-preview runs should use read-oriented project file and Databricks tools
  and should pin to the current release snapshot when one exists.
- Release snapshots should record the settings used for a user session.
- Project settings should narrow resource use, but Unity Catalog and workspace
  permissions remain the final access control.

## Observability

Every agent run should log:

- project ID, type, status, release ID
- effective resource defaults used
- conversation overrides present
- enabled skill source/count
- runtime/model provider config without secrets

Traces should include the same identifiers as metadata so a failed answer can be
replayed against the project context that produced it.

## Open Questions

- Which roles are stored in app DB first: owner/developer/user only, or the full
  owner/developer/reviewer/user/viewer set?
- Should a project type imply a default tool policy, or should policy remain
  fully explicit?
- How much semantic scope should be prompt-rendered versus retrieved on demand?
- Should user sessions be allowed to carry personal memory overlays on top of a
  published release?
- Should the app eventually export/import project settings as `project.yaml` in
  addition to DB storage?
