# Project Management Action Plan

## Purpose

This plan turns [`concept-and-ideas.md`](concept-and-ideas.md) and
[`design.md`](design.md) into an implementation sequence for
`databricks-builder-app-oai`.

The plan starts by strengthening the existing OAI app project model without
breaking the current conversation and streaming flows. Later phases add the
BI-style developer/user release lifecycle and richer analyst-agent behavior.

## Execution Principles

- Keep existing project, conversation, and SSE APIs compatible unless an
  additive field is needed.
- Move durable defaults to the project; keep conversation fields as local
  overrides.
- Store settings as structured JSON before rendering them into prompts.
- Keep Databricks auth and model auth separate.
- Do not store tokens or secrets in project settings.
- Enforce tool access by constructing the tool list, not by prompt text only.
- Treat releases as snapshots once user-facing analyst sessions exist.
- Use `npm` for `databricks-builder-app-oai/client`.

## Progress Snapshot

Last updated: 2026-05-03.

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0: Document Target Model | Complete | Concept, design, and action-plan docs now define the project/conversation/release model and OAI implementation path. |
| Phase 1: Project Metadata And Settings MVP | Complete | Project fields, JSON settings helpers, API patch support, Alembic migration, and tests are implemented. |
| Phase 2: Project Defaults In Agent Runs | Complete | Agent routes resolve project defaults plus conversation overrides and pass a project context pack into the OpenAI runtime prompt. |
| Phase 3: Project Settings UI Slice | Complete | Project page inherits defaults and the config panel can save current resource selections as project defaults. |
| Phase 4: Project Home And Creation Wizard | Pending | Add a project landing surface and guided setup. |
| Phase 5: Resource And Semantic Registry | Pending | Pin Databricks resources, metric views, tables, glossary, sample queries, and caveats. |
| Phase 6: Developer/User Roles | Pending | Add memberships and role-specific UI/action policies. |
| Phase 7: Releases And User Sessions | Pending | Add release snapshots, publish flow, and user-session release pinning. |
| Phase 8: Workflows, Artifacts, Memory, Feedback | Pending | Add reusable workflows, artifact registry, approved memories, and feedback-to-eval flow. |
| Phase 9: Governance And Readiness | Pending | Add diagnostics, retention/export rules, and readiness checks. |

## Phase 0: Document Target Model

Goal: make the product direction and implementation contract clear before
expanding the app schema.

Tasks:

- Keep `concept-and-ideas.md` as the broad product proposal.
- Add `design.md` with concrete data model, API, runtime, UI, security, and
  observability contracts.
- Add this action plan with phase gates and progress tracking.

Acceptance gates:

- Docs explain the distinction between project, conversation, release, and user
  session.
- Docs explicitly state that `databricks-builder-app-oai` starts in developer
  mode.
- Docs explain how project defaults become agent runtime context.

## Phase 1: Project Metadata And Settings MVP

Goal: make projects carry durable identity and structured settings.

Tasks:

- Add project columns:
  - `description`
  - `project_type`
  - `status`
  - `settings_json`
  - `current_release_id`
  - `updated_at`
- Add an Alembic migration with safe defaults for existing rows.
- Add a project settings helper module for:
  - default settings
  - JSON parsing and normalization
  - deep-merge patching
  - resource-default extraction
  - project context construction
- Update `Project.to_dict()` to return additive metadata and parsed settings.
- Update `ProjectStorage.create()` and project routes to accept optional
  metadata/settings.
- Update `PATCH /projects/{project_id}` to deep-merge settings and return the
  updated project.

Acceptance gates:

- Existing projects load with default settings when `settings_json` is null.
- Project list/detail responses include the new fields.
- A settings patch can update resource defaults without deleting other settings.
- Unit tests cover settings normalization and merge behavior.

## Phase 2: Project Defaults In Agent Runs

Goal: make every agent run inherit project settings and expose them to the
runtime.

Tasks:

- Resolve effective resources in `server/routers/agent.py`:
  - request/conversation override
  - project resource default
  - generated fallback
- Add `project_context` to `AgentRunRequest`.
- Pass project context from `stream_agent_response()` into the OpenAI runtime.
- Render a compact Project Context section in `get_system_prompt()`.
- Add runtime logs for project type, status, release ID, effective resources,
  and conversation overrides.
- Keep tokens and model secrets out of the context pack.

Acceptance gates:

- A run with no conversation override uses project catalog/schema/warehouse
  defaults.
- The system prompt includes project name, type, status, release, resources,
  semantic hints, and policy hints.
- Tests prove prompt rendering includes project context and excludes missing
  sections cleanly.

## Phase 3: Project Settings UI Slice

Goal: let users see and save project defaults without building the full project
home surface.

Tasks:

- Extend frontend `Project` types with metadata and settings.
- Add a generic `updateProject()` API helper.
- Load resource defaults from `project.settings.resources` on project page.
- Use conversation values as overrides when selecting an existing conversation.
- Add a config-panel action to save current selections as project defaults.
- Refresh the local project state after saving defaults.

Acceptance gates:

- New conversations inherit project defaults.
- Existing conversations preserve their local overrides.
- Saving defaults updates the project and future conversation fallbacks.
- Frontend typecheck passes.

## Phase 4: Project Home And Creation Wizard

Goal: make project setup intentional rather than a single name input.

Tasks:

- Add a project home tab or top-level project panel.
- Add fields for description, project type, status, audience, and success
  criteria.
- Add guided setup for Databricks resources.
- Add a lightweight project readiness panel:
  - catalog/schema set
  - warehouse set and reachable
  - workspace folder set
  - MLflow tracing configured
  - skills selected
- Add project card badges for type/status/readiness.

Acceptance gates:

- A new project can be created with a purpose and type.
- Users can see missing setup items before starting a conversation.
- Project cards show more than conversation count.

## Phase 5: Resource And Semantic Registry

Goal: make project scope explicit and curated.

Tasks:

- Add `project_resources` for Databricks object references.
- Add semantic settings for:
  - metric views
  - preferred tables
  - blocked/deprecated tables
  - glossary
  - known-good SQL
  - data caveats
- Add UI to pin resources from Databricks discovery results.
- Add project-scoped metadata cache and refresh status.
- Prefer pinned metric views and certified tables in system prompt/tool
  planning.

Acceptance gates:

- The agent can answer "what data is in this project?" from project registry
  before scanning the full workspace.
- Preferred assets appear in prompt context with bounded length.
- Deprecated/blocked assets are visible to the agent as avoid rules.

## Phase 6: Developer/User Roles

Goal: support the same project as both a build workspace and a governed analyst
workspace.

Tasks:

- Add `project_memberships`.
- Define initial roles:
  - owner
  - developer
  - reviewer
  - user
  - viewer
- Add backend role resolution for current user.
- Add role-specific write-policy enforcement.
- Add UI mode differences:
  - developers can edit settings and run write-capable tools
  - users can ask questions and use approved workflows
  - viewers can inspect published artifacts only

Acceptance gates:

- A user without developer role cannot edit project settings.
- User-facing runs do not receive developer-only write tools.
- Role is included in project context and trace metadata.

## Phase 7: Releases And User Sessions

Goal: make user-facing behavior stable and reproducible.

Tasks:

- Add `project_releases`.
- Store settings snapshot, release notes, eval status, released_by, released_at.
- Add publish/deprecate flow.
- Pin user sessions to `release_id`.
- Add release diff and "start new session on latest release" behavior.
- Record release ID in agent runs, executions, and traces.

Acceptance gates:

- A published release is immutable.
- Existing user sessions continue on their pinned release after draft settings
  change.
- Developers can compare draft and released settings.

## Phase 8: Workflows, Artifacts, Memory, Feedback

Goal: turn successful dialogs into reusable project knowledge.

Tasks:

- Add project workflow templates and workflow runs.
- Add artifact registry for files, SQL, notebooks, dashboards, reports, traces,
  and eval results.
- Add memory proposal/approval flow.
- Let users submit feedback from a response.
- Convert feedback into project-scoped eval cases.

Acceptance gates:

- A conversation can be promoted to a workflow or story.
- Approved memories appear in later runs with source references.
- Feedback can be replayed as an eval case.

## Phase 9: Governance And Readiness

Goal: make projects safe to share and operate.

Tasks:

- Add readiness diagnostics for missing/broken resources.
- Add retention and export policy.
- Add permissions diagnostics for pinned Databricks resources.
- Add project export/import shape compatible with `project.yaml`.
- Add audit events for settings changes, release publication, and memory
  approval.

Acceptance gates:

- Project readiness identifies missing catalog/schema/warehouse/skills/tracing.
- Exported project config excludes secrets.
- Audit history shows who changed project settings and when.

## Current Implementation Checks

Run after phases 1-3:

```bash
cd databricks-builder-app-oai
UV_CACHE_DIR=/tmp/uv-cache-ai-dev-kit uv run pytest tests -q
UV_CACHE_DIR=/tmp/uv-cache-ai-dev-kit uv run ruff check server/project_config.py server/db/models.py server/services/agent.py server/services/agent_runtime/base.py server/services/agent_runtime/openai_runtime.py server/services/system_prompt.py server/routers/projects.py server/routers/agent.py tests --select F,E9
cd client
npm run lint --cache /tmp/npm-cache-ai-dev-kit
npm run build:typecheck --cache /tmp/npm-cache-ai-dev-kit
```
