# Builder App OAI — Roadmap (v0.2 → v0.6)

> Living document. Each version below is a release theme, not a fixed scope.
> Scope and timing adjust based on pilot feedback and engineering capacity.

## Guiding Principles

1. **Preparation before scale.** v0.2 establishes that project settings (business background + data settings) and analysis notes are the foundation for tuning agent behavior. We move away from the generated scenario bundle concept.
2. **One scenario before breadth.** The BDR routing pilot must be stable through project settings, analysis notes, read-only execution, and feedback capture before we add new themes.
3. **Governed semantics before canonical answers.** Metric Views are the official Databricks semantic layer for business metrics. Before golden cases hard-code paths, Builder App must engineer and validate Metric Views from user input, project code, metadata, and data.
4. **Latency is a feature.** v0.6 is the dedicated latency release, but every release should keep "time-to-first-answer" in view.
5. **Permissions are layered, not retrofitted.** v0.5 splits role permission (UI/server gate) from data permission (row filter) so each can ship cleanly.

---

## v0.2 — Preview (Analyst Pilot)

**Theme:** Project Settings + Analysis Notes + read-only Analysis Agent, ready for analyst pilot on real business scenarios.

**Exit criteria (must close before tagging v0.2):**
- Drop the bundle generator idea: business background and data setting are already managed in project setting YAML.
- Analysis notes implemented to further tune agent behavior by providing more contexts.
- `project_setting.yaml` schema validator + API route + UI workflow (Action Plan Phase 2).
- Deterministic retrieval path for project settings and analysis notes consumed by Analysis Agent in read-only mode; Builder/Analysis boundary enforced.

**Deferred to v0.2.x patch releases during pilot:**
- Source-code / Databricks metadata enrichment
- Partial regeneration engine
- Settings and notes retrieval optimization
- Tool surface trimming per project

**Pilot audience:** Internal data analysts. Single-user mode acceptable; no sharing.

**Pilot success signals:**
- ≥ 1 BDR pilot answer accepted by the decision owner without analyst rework
- Analyst clarification questions reduce by ≥ 30% on the second project after the first settings/notes tuning pass
- Missing-context feedback from Analysis Agent loops back into Builder refinement at least once

---

## v0.3 — Visualization for Storytelling

**Theme:** Turn the analysis story into a rich visual narrative that makes conclusions more convincing.

**Why now:** v0.2 produces tables, conclusions, and next moves; analysts still hand-build charts elsewhere. Storytelling is what turns analysis into a decision.

**Scope:**
- **Focus on Analysis Story Panel**: Charts are rendered directly within the completed analysis story flow (rather than only the right inspect panel), making visualization a critical part of the core narrative. During execution, intermediate evidence and visualizations remain in Inspect so the running story card stays focused on the plan.
- **Phased implementation based on `data-visualization.md`**:
  - **Phase 1**: Client-side chart detection (Recharts) on SQL results using heuristics (no backend changes).
  - **Phase 2**: Model-guided visualization using `__chart_spec__` JSON blocks in agent responses for custom types and insight annotations.
  - **Phase 3**: Dedicated `visualize_data` tool for explicit intent and chart-click interactions for story continuation.
- Conclusion view stitches text + table + chart into a shareable narrative (export to PNG / clipboard).
- Charts support toggle back to underlying data table at any time.

**Out of scope:** dashboarding, saved charts library, BI-tool parity. v0.3 is in-conversation visuals, not a dashboard product.

**Dependencies:** v0.2 evidence model stable; project settings/notes define which metrics warrant which chart families.

---

## v0.3.5 — Metric View Context Engineering

**Theme:** Build the Databricks Metric View semantic layer that turns messy
business context into reliable, governed analysis context.

**Why now:** v0.3 makes answers easier to understand, but visualization does
not solve metric drift. v0.4 golden cases should not encode raw-table SQL as
their primary semantic truth. The app needs an intermediate step that converts
user non-structured input, project notes, user code, Unity Catalog metadata,
and data profiling into validated Metric Views.

**Scope:**
- Treat Metric Views as the preferred semantic layer for KPIs, aggregate
  measures, dimensions, grain, synonyms, and formatting.
- Discover candidate metrics from business background, analysis notes, user
  notebooks/SQL, UC schemas/comments, table stats, sample values, and analyst
  feedback.
- Draft and review Metric View YAML definitions with dimensions, measures,
  joins, comments, display names, synonyms, and formats when runtime support is
  available.
- Validate Metric View output against direct SQL oracles and documented
  tolerances.
- Register validated Metric Views in `databricks_resources.input_metric_views`
  and `settings.semantics.metric_views`.
- Make KPI and aggregate analysis prefer Metric Views, with explicit fallback
  when the semantic layer is missing, stale, or does not cover the requested
  grain.
- Seed the Distribution project by certifying MV1-MV3 from
  `databricks-builder-app-oai/projects/distribution/metric-view-design.md`.

**Out of scope:** full BI modeling studio, unreviewed production Metric View
creation, production row-level permission enforcement, and precomputed metric
serving.

**Dependencies:** v0.2 project settings and analysis notes; v0.3 evidence and
story flow for showing validation output.

---

## v0.4 — Golden Analysis Cases

**Theme:** Revisit the "golden cases" concept to provide reliable analysis paths for well-known patterns on top of a validated Metric View semantic layer.

**Why now:** We dropped the full bundle generator in v0.2, but golden cases remain a powerful concept for ensuring quality. After v0.3.5, golden cases can reference certified Metric Views as their happy path and keep direct SQL as the eval oracle instead of rediscovering metric definitions.

**Scope:**
- Manual analyst trace workflow for high-value scenarios, starting from the BDR routing pilot.
- Golden cases implementation: defined as part of project settings or a lightweight template, mapping specific questions to canonical Metric View paths, validation SQL, and answer contracts.
- No business context YAML or data context YAML.
- Fast path for the Analysis Agent: when the user's question matches a golden case, the Agent runs the certified Metric View path instead of free-form planning; direct SQL remains available for validation and unsupported drill-down.
- Initial set of golden cases derived from the BDR routing pilot.

**Out of scope:** full scenario bundles with multiple YAML files; template marketplace.

**Dependencies:** v0.2 project settings and analysis notes stable; v0.3.5 Metric View context engineering for governed metrics.

---

## v0.5 — Users and Permissions

Split into two sub-releases so each can ship and be evaluated independently.

### v0.5.1 — Developer / User Roles

**Theme:** Department rollout. Data analyst designs the project; end users consume read-only.

**Scope:**
- Two roles per project: **builder** (analyst who designs and edits the bundle) and **consumer** (end user who asks questions and saves their own artifacts).
- Consumers cannot edit `project_setting.yaml` or the scenario bundle, cannot trigger bundle regeneration, cannot run write tools — but can save their own conversation, save reports/notes, and export charts.
- UI/server-level interception only; no per-resource ACL. Lightweight by design.
- Project-level sharing: builder shares a project with named users or a workspace group; share grants `consumer` role.
- Databricks Unity Catalog remains authoritative for actual data access — this layer just gates the Builder App's own surfaces.

**Out of scope:** approval workflow, audit log, multi-builder collaboration with merge.

### v0.5.2 — Row-Level Data Permission

**Theme:** National dataset, regional users — show each user only what they're allowed to see.

**Scope:**
- User → (column, value) mapping (e.g., `user_email → region_code IN ('east','west')`). Mapping stored in Postgres, managed by builder or admin.
- Filter injection at SQL execution time: `execute_sql` / `execute_sql_multi` apply the filter as an additional `WHERE` predicate against the mapped column on registered tables.
- Project settings declare which tables are row-filterable and on which column.
- Audit: every filtered query logs the user, the table, and the applied predicate.
- Fallback: if a query touches a row-filterable table without a mapped predicate for the current user, the query is refused (fail-closed).

**Out of scope:** column-level masking, integration with UC row-filters / column masks (could be a follow-up — UC-side enforcement is stronger but heavier). v0.5.2 is app-layer enforcement; UC-layer can come later.

**Dependencies:** v0.5.1 roles must be in place to attach data permissions to a meaningful subject.

---

## v0.6 — Instant Analysis (Postgres + Flash Models)

**Theme:** Drop time-to-first-answer for frequent questions from "many seconds" to "sub-second", so the chat UI feels instant and so we can offer IM-channel integration where instant is table stakes.

### v0.6.1 — Detailed Data Forward-Deployed to Postgres

**Scope:**
- Forward-deploy the detailed tables a project depends on (declared in project settings) into Lakebase Postgres on a schedule via Lakebase synced tables.
- Add an "instant" execution path: when the Analysis Agent's plan only requires data already in Postgres, route SQL to Postgres + flash model (`deepseek-v4-flash` is already wired) instead of warehouse + main agent.
- Project settings declare the freshness budget per table; a table's `instant` eligibility is derived from sync lag vs budget.
- Telemetry: report which fraction of pilot questions can be answered via the instant path.

### v0.6.2 — Precomputed Metric Data

**Scope:**
- Compute well-structured metric tables (e.g., daily BDR scorecards, weekly territory rollups) on schedule and persist to Postgres.
- Frequent questions hit the metric table directly — no aggregation at query time.
- Templates (v0.4) declare which v0.3.5 Metric Views and measures they need precomputed; v0.6.2 materializes them for any project derived from that template.
- Combined effect with v0.3.5 + v0.4: certified Metric View + template + precomputed metrics + flash model = canonical questions answered in < 1s.

### v0.6.3 — IM Integration (optional, scope TBD)

**Scope:**
- Surface the same instant-path Analysis Agent through an IM channel (Slack / Teams / Lark). Web UI remains primary; IM is read-mostly.
- Instant path is the default in IM; questions that fall outside it are politely redirected to the web UI rather than served slowly.
- Reuses v0.5 permissions (consumer role + row-level filter).

**Out of scope:** writing back from IM to project settings/notes; multi-step analyses in IM (those stay in the web UI).

**Dependencies:** v0.4 templates with declared instant-eligible questions; v0.5.2 row-level filter (so IM-served answers respect data permission).

---

## Cross-Version Themes

- **Project Settings and Notes as the contract.** Metric View context, visualization specs, golden cases, instant-path eligibility, and row-filter declarations live in or derive from project settings and analysis notes. Changes to these formats need careful versioning starting v0.3.
- **Metric Views as the semantic contract.** For governed metrics, the Analysis Agent should use Metric Views before raw tables. Raw SQL remains important for validation, drill-down, and unsupported exploratory paths.
- **Cost / latency telemetry from v0.3 onward.** Every release after v0.2 should carry forward: per-question time-to-first-answer, per-question token cost, instant-path hit rate.
- **Single-user dev mode preserved.** Even after v0.5, the local dev experience (single user, single workspace) must remain frictionless for FE-internal usage.

## Open Questions

- Does the row-level filter live entirely in the app layer (v0.5.2) or do we eventually push down to UC row-filter policies for stronger enforcement?
- Should template authoring be gated to a "template author" role, or can any builder publish a template within their workspace?
- Does v0.6.3 IM integration warrant its own release after v0.6.2, given the scope difference?

## Versioning & Release Cadence

- v0.x releases are still pre-1.0; breaking changes to settings/notes format are allowed with a written migration note in the corresponding release's design doc.
- 1.0 is targeted after v0.6 lands and the BDR pilot graduates from preview to general internal use, with at least three additional scenarios on templates.
