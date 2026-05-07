# Project Management Concept and Ideas

## Purpose

The current Builder App and OAI app treat a project mostly as a named container
for conversations plus a project filesystem. That is useful for persistence, but
it is too weak as a product concept. A strong project should make the agent
faster, safer, and more correct by giving every dialog a durable business goal,
resource scope, semantic context, workflow memory, and artifact namespace.

This memo proposes a richer definition of project for Databricks-native builder
and analyst agents, while keeping the design broad enough for a general analyst
agent application.

## Official Databricks Signals

Databricks does not have a single universal product object called "project" that
matches this app's current project table. Instead, several official concepts
show what Databricks expects durable work units to contain:

- **Databricks Apps** are secure data and AI applications running on Databricks
  serverless infrastructure. They integrate with Unity Catalog, Databricks SQL,
  OAuth, Model Serving, Jobs, and other platform services. Apps should stay
  portable and avoid hardcoded resource IDs; resources should be configured as
  app resources where possible.
  Sources:
  [Databricks Apps](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/),
  [What is Databricks Apps?](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/what-is),
  [Add resources to a Databricks app](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/resources).
- **Databricks app configuration** uses `app.yaml` for runtime command,
  environment, resource references, and deployment-specific settings. Databricks
  cautions against putting sensitive values directly in app config.
  Sources:
  [Configure Databricks app execution with app.yaml](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/app-runtime),
  [Define environment variables in a Databricks app](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/environment-variables).
- **Declarative Automation Bundles** are explicitly described as an end-to-end
  definition of a project: source files, metadata, structure, tests,
  deployments, and resource definitions such as jobs, pipelines, serving
  endpoints, MLflow experiments, and models.
  Source:
  [What are Declarative Automation Bundles?](https://docs.databricks.com/aws/en/dev-tools/bundles/).
- **Unity Catalog** organizes governed data and AI assets through catalogs,
  schemas, and objects. Catalogs are a top-level data organization and isolation
  unit. Schemas are more granular and commonly represent a use case, project, or
  team sandbox. Permissions, lineage, tags, comments, and ownership are part of
  the governance model.
  Sources:
  [What is Unity Catalog?](https://docs.databricks.com/en/data-governance/unity-catalog/index.html),
  [What are catalogs in Databricks?](https://docs.databricks.com/aws/en/catalogs/),
  [What are schemas in Databricks?](https://docs.databricks.com/gcp/en/schemas/),
  [Unity Catalog permissions model concepts](https://docs.databricks.com/gcp/en/data-governance/unity-catalog/access-control/permissions-concepts).
- **AI/BI Genie spaces** are not just chat logs. Domain experts configure them
  with datasets, sample queries, text guidelines, and semantic knowledge so
  business users can ask natural-language questions over an intended data
  domain. Genie spaces are also continuously refined with feedback.
  Sources:
  [What is an AI/BI Genie space](https://docs.databricks.com/aws/genie/),
  [Set up and manage an AI/BI Genie space](https://docs.databricks.com/aws/genie/set-up).
- **Unity Catalog business semantics and metric views** define governed,
  reusable business metrics and AI-facing metadata such as synonyms, display
  names, and formatting rules. This is directly relevant to analyst agents:
  project context should prefer canonical metrics over ad hoc table guesses.
  Sources:
  [Unity Catalog business semantics](https://docs.databricks.com/gcp/en/business-semantics/),
  [Unity Catalog metric views](https://docs.databricks.com/aws/en/business-semantics/metric-views/).
- **Workspace files and workspace objects** provide a file/object hierarchy for
  notebooks, source files, dashboards, alerts, queries, folders, and Git folders.
  This suggests that a project should also have a durable artifact space, not
  only a conversation list.
  Sources:
  [What are workspace files?](https://docs.databricks.com/aws/en/files/workspace),
  [Manage workspace objects](https://docs.databricks.com/aws/en/workspace/workspace-objects).

Interpretation: in Databricks language, a strong project is closer to "a
bounded work product with source, metadata, resources, governance, and
deployment/analysis intent" than to "a folder of chat sessions."

## Proposed Definition

A project is a durable, intent-scoped workspace for an agent and its users.

It should own:

- the business or engineering objective
- the Databricks resource scope
- the semantic context the agent should trust first
- the allowed tool and action surface
- the reusable workflows and templates
- the artifacts produced by the work
- the memory, feedback, and evaluation cases that improve future runs

A conversation is then one run or thread inside a project. It can override
temporary settings, but it should inherit most context from the project.

The project should also support two role-specific surfaces over the same
underlying object:

- **Developer surface:** project authors build the data product, Databricks app,
  dashboard companion, semantic model, workflows, and release configuration.
- **User surface:** project consumers use a published, governed version as a
  read-only analyst workspace.

This mirrors the old BI development pattern: developers design and publish the
dashboard; users consume it, filter it, ask follow-up questions, and give
feedback without mutating the released definition.

## What A Project Is Not

- Not only a session folder.
- Not necessarily a Databricks App.
- Not necessarily a Unity Catalog schema, although it can bind to one.
- Not necessarily a Declarative Automation Bundle, although it can generate or
  reference one.
- Not necessarily a Genie space, although analyst projects should learn from the
  Genie space model.
- Not a broad permission bypass. Project scope should narrow and explain access;
  Unity Catalog and workspace permissions remain authoritative.

## Product Model

### Project Layers

| Layer | Purpose | Examples |
|-------|---------|----------|
| Identity | Explain why this project exists | name, description, domain, owner, collaborators, status |
| Resource scope | Bind the project to Databricks resources | workspace, default catalog/schema, warehouse, cluster, volume, MLflow experiment, Genie space, bundle root |
| Semantic scope | Tell the agent what words and metrics mean | metric views, glossary, synonyms, certified tables, join rules, grain, freshness expectations |
| Workflow scope | Capture repeated task structure | weekly review, dashboard build, anomaly investigation, data quality triage |
| Agent policy | Control model and tool behavior | skills, tool allowlist, read/write policy, approval thresholds, budget/time limits |
| Artifact space | Store and organize outputs | files, SQL, dashboards, notebooks, reports, traces, eval results |
| Memory and feedback | Improve future dialogs | approved corrections, rejected assumptions, good queries, user feedback, eval cases |
| Governance | Preserve trust boundaries | sharing, retention, audit, PII rules, export rules, least-privilege resource grants |

### Developer And User Surfaces

A single project can feel like different product types depending on role:

- to a **developer**, it is a build workspace for a data product, Databricks app,
  dashboard/Genie companion, or governed analytical package
- to a **user**, it is a curated analyst workspace with constrained data scope,
  approved workflows, and read-only interaction

The design should preserve this distinction without duplicating the project.
The clean model is:

```text
Project draft/source
  -> reviewed published release
    -> user-facing analyst sessions and stories
```

Developers edit the draft. Users run against a release snapshot. This keeps
answers reproducible and prevents user-facing behavior from changing mid-session
because a developer modified the project configuration.

Role behavior:

| Role | Main surface | Can do |
|------|--------------|--------|
| Owner | Governance and release management | manage members, resources, releases, retention, sharing |
| Developer | Build workspace | edit settings, semantics, workflows, artifacts, tools, app/dashboard assets |
| Reviewer | Release gate | approve releases, memory changes, eval thresholds, risky resource changes |
| Analyst/User | Published workspace | ask questions, run approved workflows, change allowed filters, save personal stories |
| Viewer | Read-only consumption | view published dashboards, reports, stories, and evidence |

Developer-only controls should include:

- resource bindings and app resources
- semantic scope and metric/table curation
- tool allowlists and write policies
- workflow/template authoring
- release notes
- evaluation cases and quality gates
- generated artifacts that become part of the published product

User-facing controls should be narrower:

- allowed filters, dimensions, and date ranges
- approved workflow parameters
- follow-up questions within scope
- saved personal views/stories
- feedback and correction proposals

The released project behaves like a BI dashboard plus an analyst agent. It has
the same governed definitions for every user, but user interaction can be
personalized through filters, stories, and personal memory proposals.

### Project Types

Projects should support templates because different work benefits from different
defaults.

| Template | Primary goal | Strong defaults |
|----------|--------------|-----------------|
| Analyst workspace | Answer business questions with evidence | read-only SQL, metric views, certified tables, story canvas, evals |
| Dashboard/Genie companion | Build and refine a dashboard-backed conversational surface | dashboard datasets, companion Genie space, visualization artifacts |
| Data product build | Create or modify governed data assets | bundle root, jobs/pipelines, schema/volume, stricter approval for writes |
| Databricks app build | Build and deploy an app | app.yaml, app resources, secrets policy, deployment target |
| Investigation/ops | Debug a job, pipeline, query, or serving issue | logs, traces, system tables, operational runbooks |
| Learning/onboarding | Explore a workspace safely | sandbox schema, sample data, narrow tools, tutorial workflows |

The current Builder App behaves roughly like "Databricks app build" plus a
generic chat folder. The analyst app design in `docs/analyst-app/` points
toward "Analyst workspace."

### Drafts, Releases, And User Sessions

Publishing should be first-class. A developer draft is allowed to be messy:
resource bindings may be incomplete, semantic scope may change, evals may fail,
and workflows may be under construction. A published release should be stable
enough for users.

Release contents should include:

- project metadata and description
- resource bindings
- semantic scope and glossary
- workflow definitions and default parameters
- agent policy and enabled tools
- model/runtime configuration that affects output
- eval status and known limitations
- artifact references such as dashboards, notebooks, queries, and reports

User sessions should reference `project_id` and `release_id`, not only the
latest mutable project state. A conversation can still have local overrides, but
the trace should record the release snapshot and overrides used.

This gives the app a natural lifecycle:

1. Developer creates or forks a project draft.
2. Developer configures resources, semantics, workflows, and policies.
3. Developer tests with development conversations.
4. Reviewer or owner approves the release.
5. Users interact with the published release as an analyst workspace.
6. Feedback and corrections become proposed changes for the next draft/release.

## Project Settings

### 1. Identity And Intent

Minimum settings:

- name
- short description
- owner
- collaborators or groups
- domain or use case
- target user persona
- lifecycle status: draft, active, paused, archived
- success criteria
- default output style: chat answer, analysis story, code artifact, dashboard,
  report, notebook, bundle

Why it helps:

- gives the agent stable mission context
- lets the UI show meaningful project cards instead of chat-count cards
- supports project search and reuse

### 2. Databricks Resource Bindings

Recommended settings:

- workspace URL or workspace ID
- default catalog
- default schema
- allowed catalogs/schemas
- default SQL warehouse
- default cluster, if notebook or Spark execution is needed
- default Unity Catalog volume for artifacts
- default workspace folder
- MLflow experiment for traces/evals
- optional Genie space IDs
- optional AI/BI dashboard IDs
- optional job/pipeline IDs
- optional bundle root or Git repository
- optional model serving endpoints
- optional vector search indexes
- optional Lakebase database for app state

Why it helps:

- avoids asking the user to select compute and schema on every conversation
- reduces tool search space
- makes resource assumptions explicit
- enables least-privilege app-resource design in deployed Databricks Apps

### 3. Data And Semantic Scope

Recommended settings:

- primary business entities: customer, workspace, account, opportunity, SKU,
  pipeline, model, job, table
- canonical metrics and metric views
- certified or preferred tables
- blocked or deprecated tables
- common joins and join keys
- table grain and uniqueness assumptions
- date/time defaults: timezone, fiscal calendar, default date column, default
  lookback
- freshness expectations and SLA
- glossary terms and synonyms
- sample queries and known-good SQL
- data quality caveats
- domain-specific filters and defaults

Why it helps:

- gives the agent the same kind of curated knowledge that makes Genie spaces
  work
- prevents the common analyst-agent failure mode: choosing a plausible but wrong
  table
- makes natural language shorter because the project already defines defaults

### 4. Agent Policy

Recommended settings:

- runtime provider and model
- cheaper model for title/summarization/background tasks
- selected skills
- tool allowlist
- write policy: read-only, draft writes, approved writes, autonomous writes
- SQL guardrails: row limit, timeout, dry-run requirement, mutation policy
- cost budget per run and per project
- confirmation thresholds for job runs, cluster starts, deploys, deletes, and
  table writes
- logging and trace level
- prompt-injection posture for files, comments, query results, and uploaded data

Why it helps:

- narrows the action surface by construction instead of relying on prompt text
- lets different project types have different safety behavior
- makes debugging easier because every run records inherited policy

### 5. Workflow Templates

Recommended settings:

- enabled workflow templates
- workflow parameters and defaults
- required evidence blocks
- validation checks
- output format
- scheduled or recurring runs
- owner/reviewer

Example workflows:

- weekly business review
- metric definition lookup
- anomaly investigation
- dashboard build
- table discovery and certification review
- job failure triage
- data quality incident report

Why it helps:

- repeated work becomes cheaper and more reliable
- the agent can start with a proven plan instead of inventing one
- workflows become eval targets

### 6. Project Memory

Recommended settings:

- approved memories
- rejected memories
- correction proposals
- memory scope: personal, project, team, global
- TTL and confidence
- source run and reviewer
- evidence links

Examples:

- "For ARR, use `finance.gold.arr_metric_view`, not raw invoice rows."
- "This team defines active workspace as 7-day active, paid only."
- "The Sales Ops dashboard excludes test accounts by default."

Why it helps:

- preserves useful corrections across sessions
- avoids silent global behavior changes
- gives the agent a citable reason for project-specific assumptions

### 7. Artifact And Evidence Space

Recommended settings:

- project file root
- generated SQL directory
- generated notebook directory
- dashboard/report artifact directory
- trace/eval links
- result-preview retention
- share/export policy

Why it helps:

- turns dialog into durable work product
- lets a conversation continue from a file, query, dashboard, or story
- supports review and collaboration

### 8. Release And Role Settings

Recommended settings:

- draft version
- published release versions
- current default release
- release status: draft, review, published, deprecated, archived
- release notes and migration notes
- reviewer/approver
- eval gate status
- role bindings: owner, developer, reviewer, analyst/user, viewer
- user override policy
- feedback routing policy

Why it helps:

- separates project development from project consumption
- makes user sessions reproducible
- supports BI-style release management
- gives feedback a clear path back into the next development cycle

## How Projects Improve Dialog Quality

### More Effective

- The agent starts with a known objective and domain.
- Semantic retrieval is limited to relevant assets.
- Canonical metrics and certified tables are preferred by default.
- Prior successful analyses can be reused.
- The UI can offer domain-specific next moves instead of generic suggestions.

### More Efficient

- Fewer clarification questions for stable defaults.
- Fewer catalog-wide scans and schema searches.
- Fewer repeated setup messages about warehouses, catalogs, schemas, and
  preferred output style.
- Smaller prompts because project context can be summarized and ranked.
- Cheaper background tasks can run against project-scoped metadata.

### Safer

- Tool access is project-scoped.
- Write operations can be explicitly gated.
- Databricks resource dependencies can use app resources and service-principal
  permissions rather than hardcoded IDs or personal tokens.
- Sensitive values and broad data access do not need to be copied into the
  conversation.

### More Collaborative

- A project can be shared independently from individual chat threads.
- New team members can inspect project context, artifacts, workflows, and
  decisions.
- Analysts can promote a good conversation into a workflow or memory.
- Developers can publish a curated analytical product, while users can consume
  it without being able to accidentally change its definition.

### More Reproducible

- User sessions run against a specific release snapshot.
- The trace records project release, inherited settings, overrides, model, and
  workflow version.
- Developers can compare answer quality before and after a release.
- Feedback can be replayed as evals against the next draft.

## Project Context Passed To The Agent

Every run should receive a compact project context pack. It should be built from
structured settings, not ad hoc chat history.

Suggested sections:

1. Project mission and user persona.
2. Role and release context.
3. Active Databricks resource bindings.
4. Allowed data and semantic scope.
5. Canonical metrics and preferred assets.
6. Tool policy and approval requirements.
7. Relevant memories and corrections.
8. Available workflows.
9. Active artifacts and files.
10. Conversation-specific override, if any.

The context pack should be rendered with source pointers and token budgets. If a
setting is missing, the agent should state the default rather than infer silently.

## Example `project.yaml`

```yaml
version: 1
name: revenue-growth-review
description: Monthly revenue and pipeline analysis for the Sales Ops team.
type: analyst_workspace
status: active
release:
  id: rel_2026_05
  status: published
  default_for_users: true

identity:
  owner: sales-ops@databricks.com
  audience: business_user
  success_criteria:
    - Answers cite canonical metrics and source queries.
    - Monthly review workflow is reusable.

resources:
  workspace_url: https://example.cloud.databricks.com
  default_catalog: prod
  default_schema: finance
  allowed_schemas:
    - prod.finance
    - prod.sales
  sql_warehouse_id: abc123
  artifact_volume: /Volumes/prod/analytics/revenue_review
  mlflow_experiment: /Shared/agents/revenue-growth-review
  genie_spaces:
    - 01f-genie-space-id

semantics:
  timezone: America/Los_Angeles
  default_date_range: last_full_month
  metric_views:
    - prod.finance.revenue_metrics
    - prod.sales.pipeline_metrics
  preferred_tables:
    - prod.finance.arr_snapshot
    - prod.sales.opportunity_daily
  deprecated_tables:
    - prod.finance.arr_legacy
  glossary:
    ARR: Annual recurring revenue, excluding services revenue.
    Enterprise: Accounts with segment = 'Enterprise'.

agent_policy:
  model: deepseek-v4-pro
  mini_model: deepseek-v4-flash
  mode: read_only_analysis
  enabled_skills:
    - databricks-dbsql
    - databricks-unity-catalog
    - databricks-metric-views
  sql:
    row_limit: 10000
    timeout_seconds: 120
    require_date_filter: true
  approvals:
    create_or_modify_tables: required
    start_cluster: required
    deploy_app: required

roles:
  owners:
    - sales-ops@databricks.com
  developers:
    - revenue-analytics@databricks.com
  reviewers:
    - finance-governance@databricks.com
  users:
    - field-sales@databricks.com
  viewers:
    - exec-readonly@databricks.com

release_policy:
  require_review: true
  require_eval_pass: true
  user_sessions_pin_release: true
  allowed_user_overrides:
    - date_range
    - region
    - segment

workflows:
  enabled:
    - weekly_business_review
    - anomaly_investigation
    - metric_discovery

memory:
  scope: project
  require_approval: true
```

This YAML is not a recommendation to replace database storage. It is a portable
export/import shape and a design target for the persisted project model.

## UX Ideas

### Project Creation Wizard

Step 1: Purpose

- What are you trying to accomplish?
- Analyst workspace, app build, dashboard, data product, investigation, or
  onboarding?
- Who is the audience?

Step 2: Databricks Scope

- Workspace.
- Default catalog/schema.
- Warehouse/cluster.
- Artifact volume or workspace folder.
- Optional dashboard, Genie space, job, pipeline, or bundle root.

Step 3: Semantic Scope

- Select metric views.
- Select certified tables.
- Add glossary terms.
- Add known-good queries or examples.

Step 4: Agent Policy

- Read-only or can write with approval?
- Skills/tools.
- Cost/time budgets.
- Trace/eval settings.

Step 5: Starter Workflows

- Choose question starters and reusable workflows.
- Generate a project README.

Step 6: Roles And Release Policy

- Who can develop the project?
- Who can review and publish it?
- Who can use the published analyst workspace?
- Should user sessions pin to a release?
- Which settings can users override?

### Project Home

The project landing page should be more than a list of conversations. It should
switch emphasis based on role.

Developer-facing panels:

- Mission and current objective.
- Resource health: warehouse, cluster, catalog/schema, Lakebase, MLflow.
- Data scope: preferred metrics/tables and freshness status.
- Draft status and release readiness.
- Evals and quality gates.
- Workflow/template editor.
- Artifact registry.
- Open memory and feedback proposals.
- Suggested development tasks.

User-facing panels:

- Published project summary.
- Approved workflows and question starters.
- Allowed filters and date ranges.
- Recent analysis stories.
- Trusted metrics and source assets.
- Known limitations and freshness status.
- Feedback and support path.

Shared panels:

- Active workflows.
- Open artifacts.
- Evals/quality status.
- Suggested next actions appropriate for the user's role.

### Conversation Page

Conversation should show inherited project context:

- active resource bindings
- active workflow, if any
- active metric/table scope
- selected assumptions
- policy warnings
- evidence/artifact links

The user should be able to override context for one conversation, but the UI
should clearly show whether a value is inherited from the project or overridden
locally.

For published projects, the conversation page should also show the active
release. If a newer release exists, the user should be able to choose whether to
continue the existing session on the old release or start a new session on the
new release.

## Backend Model Ideas

### Tables

Possible new or expanded tables:

- `projects`
  - id, name, description, type, status, owner, created_at, updated_at
- `project_settings`
  - project_id, settings_json, version
- `project_resources`
  - project_id, resource_type, resource_id, display_name, config_json
- `project_semantics`
  - project_id, asset_type, full_name, role, metadata_json
- `project_memories`
  - project_id, scope, content, source_run_id, confidence, status, reviewer
- `project_workflows`
  - project_id, workflow_key, version, parameters_json, enabled
- `project_artifacts`
  - project_id, artifact_type, path_or_id, metadata_json
- `project_evals`
  - project_id, question, expected_assets, expected_behavior, status
- `project_releases`
  - project_id, release_id, status, settings_snapshot_json, released_by,
    released_at, notes
- `project_memberships`
  - project_id, principal, role

### Services

- `ProjectConfigService`
  - load, validate, patch, export, import
- `ProjectContextBuilder`
  - produce compact context pack for agent runs
- `ProjectResourceResolver`
  - resolve Databricks resources and check availability
- `ProjectSemanticIndexer`
  - build and refresh semantic context
- `ProjectMemoryService`
  - propose, approve, reject, retrieve, cite
- `ProjectWorkflowService`
  - list templates, instantiate runs, store outputs
- `ProjectReleaseService`
  - create draft, validate release, publish, deprecate, diff releases
- `ProjectAccessService`
  - resolve role, enforce developer/user/viewer capabilities

### Agent Run Contract

Instead of passing many loose request fields, the backend should pass:

```ts
type AgentRunContext = {
  projectId: string
  releaseId: string
  conversationId: string
  role: 'developer' | 'user' | 'viewer'
  userMessage: string
  projectContextVersion: string
  inheritedSettings: ProjectSettings
  conversationOverrides: Partial<ProjectSettings>
  selectedWorkflow?: WorkflowRunContext
  activeArtifacts: ArtifactRef[]
}
```

This makes runs reproducible because the agent trace can record the project
context version used for the answer.

## Implementation Path

### Phase 0: Strengthen Current Project Metadata

- Add project description, type, status, and owner fields.
- Add simple role fields or memberships for owner/developer/user.
- Move default catalog/schema, warehouse, cluster, workspace folder, MLflow
  experiment, and enabled skills from conversation-first behavior into project
  settings with per-conversation overrides.
- Add a generated project README or summary file.
- Add project context to agent logs/traces.

### Phase 1: Project Context Pack

- Implement `ProjectContextBuilder`.
- Render project mission, resources, skills, and semantic scope into the agent
  system prompt.
- Show inherited settings in the UI.
- Add tests that prove conversations inherit project settings.

### Phase 2: Resource And Semantic Scope

- Add project resource registry.
- Let users pin catalogs, schemas, tables, metric views, dashboards, Genie
  spaces, jobs, volumes, and MLflow experiments.
- Build a project-scoped metadata cache and retrieval index.
- Prefer metric views and pinned/certified assets in prompts and tool planning.

### Phase 3: Workflows And Artifacts

- Add workflow templates per project type.
- Add project artifact registry.
- Let users save a good conversation as a workflow or story.
- Add project home page panels for artifacts, workflows, and open tasks.

### Phase 3.5: Publish/Consume Split

- Add project release snapshots.
- Add role-specific developer and user surfaces.
- Pin user sessions to release IDs.
- Add release diff and release notes.
- Add user override policy for published projects.

### Phase 4: Memory, Feedback, And Evals

- Add approved project memory.
- Convert feedback into project-scoped eval cases.
- Add quality dashboard for project runs.
- Record whether answers used memories, metric views, or preferred assets.

### Phase 5: Governance And Sharing

- Add sharing roles: owner, editor, runner, viewer.
- Add retention/export policy.
- Add resource permission checks.
- Add "project readiness" diagnostics for missing warehouse, schema access,
  stale metadata, missing metric views, and broken workflow dependencies.

## Design Principles

1. **Project settings should be structured, not prompt-only.** The UI, backend,
   agent, and evals should all read the same settings.
2. **Conversation overrides are temporary.** Durable defaults belong to the
   project.
3. **Published releases are stable.** User sessions should run against a
   release snapshot, not a moving developer draft.
4. **Roles change the surface, not the object.** Developer and user experiences
   are different views over the same project lifecycle.
5. **Databricks permissions remain authoritative.** Project scope narrows and
   explains access, but does not grant access by itself.
6. **Semantic context should be curated and citable.** Prefer metric views,
   certified assets, comments, tags, sample queries, and approved memories.
7. **Every artifact should belong somewhere.** Files, SQL, dashboards, reports,
   traces, and evals should be discoverable from the project.
8. **Start lightweight, grow into governance.** A project can begin with just a
   name and purpose, then progressively gain resources, semantics, workflows,
   and memory.

## Open Questions

- Should a Databricks project map one-to-one to a Unity Catalog schema when the
  project creates assets, or should schema binding stay optional?
- Should analyst projects require at least one metric view or certified table
  before they are marked "ready"?
- Should Databricks App projects generate Declarative Automation Bundle config
  by default?
- How should project sharing map to Databricks object permissions versus
  application-level permissions?
- Should project memory be stored only in Lakebase/app DB, or also exported as
  Markdown/YAML into the project artifact space?
- Which project settings should be visible to the model, and which should remain
  backend-only policy?
- How strict should release pinning be for user sessions when a new release is
  published?
- Can users create personal overlays on top of a published project without
  forking the developer-owned project?

## Recommendation

Adopt a stronger project model in the Builder/OAI app before adding more
conversation features. The next practical step is to move resource defaults and
enabled skills to project settings, add purpose/type/description, add basic
developer/user roles, and generate a project context pack for every agent run.
That alone should make dialogs more effective because the agent will know what
the project is for, which assets to prefer, which tools are allowed, which
assumptions are inherited, and whether the run is authoring a project or
consuming a published project.

For the broader analyst app, treat project as the top-level business analysis
product. Developers curate and publish it; users consume it as a governed
analyst workspace. Conversations are interaction threads; stories, workflows,
semantic assets, memories, releases, and evals are the durable project
knowledge.
