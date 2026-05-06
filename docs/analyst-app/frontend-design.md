# Databricks Analyst App — Frontend Design

## Purpose

This document specifies the frontend architecture for `databricks-analyst-app`, grounded in what `databricks-builder-app-oai` already proves and what must change for an analyst-first experience. It is the frontend companion to [`design.md`](design.md) (product design), [`system-design.md`](system-design.md) (runtime decisions), and [`gap-analysis-vs-oai.md`](gap-analysis-vs-oai.md) (carry-over inventory).

## Design Principle

The analyst app is a **workbench**, not a chatbot. The center of gravity is the **Analysis Story** — a structured, evidence-backed answer to a business question — not a scrolling chat transcript. Every frontend decision should be evaluated against: "Does this help the analyst trust, inspect, continue, or share an analysis?"

## Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | React 18+ with TypeScript | Same as builder app; proven component reuse path |
| Build | Vite | Same as builder app |
| Styling | Tailwind CSS + CSS custom properties | Builder app's design token system (`globals.css`) is production-ready |
| Routing | React Router v6 | Same as builder app |
| State | React context + `useReducer` | Builder app pattern; upgrade to Zustand if complexity warrants |
| Streaming | SSE via `fetch` + manual line parsing | Builder app's `streamProgress()` is proven with reconnect/retry |
| Markdown | `react-markdown` + `remark-gfm` | Same as builder app |
| Icons | `lucide-react` | Same as builder app |
| Toasts | `sonner` | Same as builder app |
| Charts | Recharts or Observable Plot | Net-new; builder app has no charting |
| Fonts | DM Sans (body/heading), JetBrains Mono (code) | Builder app's font stack |

Use `pnpm`, not `npm`. Use `pnpm dlx` instead of `npx`.

## What Carries Over from `databricks-builder-app-oai`

### Carry over directly

| Component | Source | Notes |
|-----------|--------|-------|
| Design token system | [`globals.css`](../../databricks-builder-app-oai/client/src/styles/globals.css) | CSS custom properties for colors, spacing, typography, dark mode. Rebrand accent from Databricks red to analyst palette. |
| `StoryCanvas` | [`StoryCanvas.tsx`](../../databricks-builder-app-oai/client/src/features/analysis/components/StoryCanvas.tsx) | Empty state with starter prompts + story list. Extend with layout modes. |
| `StoryCard` | [`StoryCard.tsx`](../../databricks-builder-app-oai/client/src/features/analysis/components/StoryCard.tsx) | Question, conclusion (markdown), trace pills, next-move buttons, status badge. Extend with richer evidence. |
| `RightInspectPanel` | [`RightInspectPanel.tsx`](../../databricks-builder-app-oai/client/src/features/analysis/components/RightInspectPanel.tsx) | Trace, evidence, context sections. Extend with SQL inspector, validation, governance tabs. |
| Analysis types | [`types.ts`](../../databricks-builder-app-oai/client/src/features/analysis/types.ts) | `AnalysisStory`, `EvidenceBlock`, `AnalysisStep`, `NextMove`, `AnalysisEvent` union, `StreamStoryEvent`. Extend, don't replace. |
| Story event reducer | [`storyTransforms.ts`](../../databricks-builder-app-oai/client/src/features/analysis/storyTransforms.ts) | `reduceAnalysisEvent()`, `storyEventsFromStreamEvent()`, `createAnalysisStory()`. Core reducer logic is reusable. |
| SSE streaming client | [`api.ts`](../../databricks-builder-app-oai/client/src/lib/api.ts) | `streamProgress()` with reconnect, retry delays, cursor-based pagination, abort. |
| Layout shell | [`MainLayout.tsx`](../../databricks-builder-app-oai/client/src/components/layout/MainLayout.tsx), [`Sidebar.tsx`](../../databricks-builder-app-oai/client/src/components/layout/Sidebar.tsx), [`TopBar.tsx`](../../databricks-builder-app-oai/client/src/components/layout/TopBar.tsx) | Three-column layout with collapsible panels. |
| Shared types | [`lib/types.ts`](../../databricks-builder-app-oai/client/src/lib/types.ts) | `UserInfo`, `Project`, `Conversation`, `Message`, `Execution`, `ProjectSettings`. |
| Context providers | [`UserContext.tsx`](../../databricks-builder-app-oai/client/src/contexts/UserContext.tsx), [`ProjectsContext.tsx`](../../databricks-builder-app-oai/client/src/contexts/ProjectsContext.tsx) | Auth and project list context. |
| Config panel | `ConfigPanel` in [`ProjectPage.tsx`](../../databricks-builder-app-oai/client/src/pages/ProjectPage.tsx) | Cluster/warehouse/catalog/schema selection dropdowns. |
| Resource dropdown | `ResourceDropdown` in [`ProjectPage.tsx`](../../databricks-builder-app-oai/client/src/pages/ProjectPage.tsx) | Generic dropdown with state indicators. |

### Carry over with modification

| Component | Change needed |
|-----------|---------------|
| `storyTransforms.ts` | Move story derivation server-side; client becomes a thin projection of server state, not the source of truth. Keep `reduceAnalysisEvent()` for optimistic streaming updates, but reconcile with server on completion. |
| `ProjectPage.tsx` | Replace 2000-line monolith with composable page built from smaller components. Remove builder-specific panels (ProjectManagementPanel, SkillsExplorer, release/governance CRUD). |
| `api.ts` | Replace builder API surface (`/projects`, `/invoke_agent`) with analyst API surface (`/sessions`, `/stories`, `/runs`, `/context`). Keep `streamProgress()` and `request()` utility. |
| `ActiveStream` interface | Remove `todos`, `tools` fields. Add `validationResults`, `queryRuns`. |

## Shell Layout (ThoughtSpot / OpenAI Data Agent Inspired)

![Analyst Story Feed Layout Wireframe](/Users/zhouhang/.gemini/antigravity/brain/3df13975-37bd-4f45-98a4-7b3d5f109574/wireframe_story_feed_layout_1778043587128.png)
![Analyst Story Feed Layout High-Fidelity](/Users/zhouhang/.gemini/antigravity/brain/3df13975-37bd-4f45-98a4-7b3d5f109574/hifi_story_feed_layout_1778043613703.png)

```
┌─────────────────────────────────────────────────────────────┐
│ TopBar:   [ 🔍 Search your data... (Global Ask Box) ]        │
├──────┬──────────────────────────────────┬───────────────────┤
│      │                                  │                   │
│ Left │     Main Canvas                  │  Right Inspect    │
│ Rail │     (Story Canvas)               │  Panel            │
│      │                                  │                   │
│ 240px│     flex-1                        │  320px            │
│      │                                  │                   │
├──────┴──────────────────────────────────┴───────────────────┤
│ (mobile: bottom nav replaces left rail)                     │
└─────────────────────────────────────────────────────────────┘
```

### TopBar (Search-Centric)

- **Global Ask Box**: The absolute center of gravity (like ThoughtSpot). Always focused, large, and prominent. Supports natural language queries.
- Workspace / Environment indicator (subtle, left-aligned)
- Account menu, Data source management, and Pinboards/Dashboards links (right-aligned)

### Left Rail (240px, collapsible)

Sections:
1. **New Analysis** button (prominent)
2. **Recent** — last 10 analysis sessions with title + timestamp
3. **Saved Stories** — pinned/bookmarked stories
4. **Workflows** — available workflow templates
5. **Memory** — personal memory entries (count badge)

The builder app's `Sidebar.tsx` (conversations list + project list) is the starting skeleton. Replace project/conversation navigation with session/story/workflow navigation.

### Main Canvas (The "Story Feed")

The `StoryCanvas` component renders the active session's progress. While it borrows data density from BI tools like ThoughtSpot, it fundamentally remains a **conversational, iterative workbench**. The product journey flows vertically:

1. **The Investigation**: The user asks an initial question in the Global Ask Box.
2. **Iterative Analysis (Chat & Reasoning)**: The canvas displays a multi-turn feed where the agent shows its work. Each turn includes:
   - The user's prompt (or refinement).
   - The agent's semantic understanding (Query Tokens: Metrics, Dimensions, Time ranges).
   - The logical reasoning chain and intermediate evidence collected (queries run, tables checked, minor charts).
3. **The Synthesis (Story Card)**: Once the analysis reaches a conclusion, the iterative steps are summarized into a highly polished, dense **Story Card**. This card contains the final markdown answer, the primary visualization, and the data table.
4. **Empty State**: A clean page prompting the user to start searching their data with starter templates.

### Right Inspect Panel: Context & Trace

The right panel is crucial for building trust, heavily inspired by the OpenAI Data Agent's "Six Layers of Context".

![Analyst Context Panel Wireframe](/Users/zhouhang/.gemini/antigravity/brain/3df13975-37bd-4f45-98a4-7b3d5f109574/analyst_context_panel_1778043055090.png)

Tabs (extending builder app's single-section panel):
1. **Context & Trace (Primary)** — Shows exactly what data sources were used, which of the 6 layers of context were applied (e.g., Table Metadata, Human Annotations, Codex Enrichment, Memory), and a timeline of the agent's execution steps.
2. **SQL** — The generated, syntax-highlighted SQL query with validation status.
3. **Evidence** — Raw evidence blocks (tool outputs, intermediate steps).
4. **Validation** — Detailed check results (freshness, nulls, joins, reconciliation).
5. **Governance** — Permissions, source lineage, data freshness, execution links.

## Story Card Design

The `StoryCard` is the analyst app's primary UI object. It extends the builder app's card with analyst-specific sections.

### Card Sections (top to bottom)

![Analyst Story Card Wireframe](/Users/zhouhang/.gemini/antigravity/brain/3df13975-37bd-4f45-98a4-7b3d5f109574/hifi_analyst_story_card_1778042750885.png)

```
┌─────────────────────────────────────────────┐
│ [📊 Analysis Story]              [Status]   │  ← header: type label + status badge
│                                             │
│ What was total revenue by region in Q1?     │  ← question (bold, prominent)
├─────────────────────────────────────────────┤
│ CONCLUSION                                  │  ← markdown-rendered answer
│ Total Q1 revenue was $142M, up 8% YoY...   │
├─────────────────────────────────────────────┤
│ EVIDENCE                                    │  ← evidence blocks (new)
│ ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│ │ KPI     │ │ Table   │ │ Chart   │        │
│ │ $142M   │ │ 5 rows  │ │ bar     │        │
│ └─────────┘ └─────────┘ └─────────┘        │
├─────────────────────────────────────────────┤
│ TRACE  ● describe_asset  ● execute_sql     │  ← compact trace pills (same)
│        ● validate_sql    ● profile_result   │
├─────────────────────────────────────────────┤
│ NEXT MOVES                                  │  ← action buttons (same)
│ [Break down by region] [Compare vs Q4]      │
│ [Validate metric]                           │
├─────────────────────────────────────────────┤
│ 📋 3 tables · ⏱ 2.1s · 🔒 PAT owner       │  ← governance footer (new)
└─────────────────────────────────────────────┘
```

### Evidence Block Types

The builder app supports: `text | table | chart | tool_result | error`.

The analyst app extends this:

| Type | Rendering | New? |
|------|-----------|------|
| `text` | Markdown prose | Existing |
| `table` | Data grid with column headers, row count, sort | Existing shape, richer rendering |
| `chart` | Recharts/Plot visualization from chart spec | **New** |
| `tool_result` | Compact tool output summary | Existing |
| `error` | Red-bordered error message | Existing |
| `kpi` | Large-number metric card with delta and sparkline | **New** |
| `caveat` | Yellow-bordered warning with source and confidence | **New** |
| `query` | SQL block with syntax highlighting + statement link + row count | **New** |
| `validation` | Check result (pass/warn/fail) with detail | **New** |
| `metric_card` | Governed metric value with definition link | **New** |
| `freshness` | Data freshness badge with last-updated timestamp | **New** |

### Evidence Block Component Interface

```ts
interface EvidenceBlock {
  id: string;
  type: EvidenceType;
  title: string;
  content: string;          // markdown or JSON string
  isError?: boolean;
  metadata?: {
    queryId?: string;        // link to query_runs table
    statementLink?: string;  // Databricks statement URL
    rowCount?: number;
    latencyMs?: number;
    chartSpec?: ChartSpec;
    metricDefinition?: string;
    freshnessTimestamp?: string;
    validationStatus?: 'pass' | 'warn' | 'fail';
  };
  createdAt: string;
}
```

## Type Extensions

### Extended `AnalysisStory`

```ts
interface AnalysisStory {
  // --- existing (from builder app) ---
  id: string;
  conversationId?: string;
  question: string;
  status: 'planning' | 'running' | 'done' | 'error';
  conclusion?: string;
  evidence: EvidenceBlock[];
  trace: AnalysisStep[];
  nextMoves: NextMove[];
  context: AnalysisContext;
  createdAt: string;
  updatedAt: string;

  // --- new for analyst app ---
  summary?: string;               // one-line answer for list views
  layout: StoryLayout;            // card vs expanded vs dashboard
  persistedAs?: {                 // server-side persistence reference
    type: 'saved_story' | 'dashboard';
    id: string;
  };
  queryRuns: QueryRun[];          // SQL executions linked to this story
  validationResults: ValidationResult[];
  memoriesCited: string[];        // memory IDs used in this answer
  governanceFooter: GovernanceFooter;
}
```

### New Types

```ts
interface QueryRun {
  id: string;
  sql: string;
  status: 'running' | 'done' | 'error';
  rowCount?: number;
  latencyMs?: number;
  statementLink?: string;
  clusterId?: string;
  resultPreview?: string;         // first N rows as markdown table
}

interface ValidationResult {
  id: string;
  check: string;                  // 'freshness' | 'nulls' | 'joins' | 'reconciliation' | ...
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  severity: 'info' | 'warning' | 'error';
}

interface GovernanceFooter {
  tablesUsed: string[];
  metricViewsUsed: string[];
  totalLatencyMs: number;
  authMethod: string;             // 'pat' | 'oauth' | 'obo'
  freshnessStatus?: 'fresh' | 'stale' | 'unknown';
}

interface ChartSpec {
  chartType: 'bar' | 'line' | 'area' | 'pie' | 'scatter' | 'heatmap';
  xAxis: string;
  yAxis: string;
  series?: string;
  title?: string;
  data: Record<string, unknown>[];
}

type StoryLayout = 'card' | 'expanded' | 'dashboard';

interface AnalysisContext {
  // existing
  conversationId?: string;
  messageIds?: string[];
  metrics: string[];
  dimensions: string[];
  filters: string[];
  selection?: string;
  // new
  assetId?: string;
  timeRange?: { start: string; end: string };
}
```

## State Architecture

### Stores

```ts
// WorkspaceStore — stories and canvas state
interface WorkspaceState {
  stories: AnalysisStory[];
  storyOrder: string[];
  activeStoryId?: string;
  canvasLayout: 'list' | 'grid';
}

// SessionStore — session and message state
interface SessionState {
  sessions: Session[];
  activeSessionId?: string;
  messages: Message[];
}

// UIStore — panel and interaction state
interface UIState {
  leftRailOpen: boolean;
  rightPanelOpen: boolean;
  rightPanelTab: 'trace' | 'evidence' | 'sql' | 'validation' | 'context' | 'governance';
  selectedEvidenceId?: string;
  isStreaming: boolean;
  streamingStoryId?: string;
}
```

Phase 1 uses React context + `useReducer` (same as builder app). If the store count exceeds 4 or cross-store subscriptions become frequent, migrate to Zustand.

### Event Flow

```
User types question in global ask box
  → POST /api/sessions/{id}/stories  (create story + start run)
  → Server returns { story_id, run_id, session_id }
  → Client creates optimistic StoryCard (status: 'planning')
  → Client opens SSE stream: POST /api/runs/{id}/stream

SSE events arrive:
  → storyEventsFromStreamEvent() maps to AnalysisEvent[]
  → reduceAnalysisEvent() updates WorkspaceState.stories
  → StoryCard re-renders progressively
  → On 'story.completed': reconcile with server state via GET /api/stories/{id}

User clicks next-move button:
  → POST /api/stories/{id}/actions { action: move.prompt, context: story.context }
  → New run starts, same SSE flow
```

## Key Data Flow Change: Server-Anchored Stories

The builder app derives stories **client-side** from messages via `storiesFromMessages()`. Stories vanish on page reload because there is no server-side story table.

The analyst app **inverts this**: the server is the source of truth for stories.

| Concern | Builder app (current) | Analyst app (target) |
|---------|----------------------|---------------------|
| Story creation | Client-side from message pairs | Server creates `analysis_stories` row |
| Story state | Client `useReducer` only | Server row + client optimistic cache |
| Evidence | Client-derived from tool results | Server `evidence_blocks` rows |
| Page reload | Stories rebuilt from messages (lossy) | Stories loaded from server (durable) |
| Streaming | SSE → client reducer → ephemeral state | SSE → client reducer → reconcile with server on completion |

### Reconciliation Strategy

During streaming, the client applies events optimistically via `reduceAnalysisEvent()` (same as builder app). On `story.completed`, the client fetches the canonical story from `GET /api/stories/{id}` and replaces the optimistic version. This ensures:
- Streaming feels instant (no round-trip for each event)
- Final state matches server (no drift)
- Page reload loads server state directly

## Streaming Contract

Same SSE event types as the builder app, extended with analyst-specific events:

```ts
// Existing (from builder app openai_events.py)
type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; tool_id: string; tool_name: string; tool_input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error: boolean }
  | { type: 'system'; subtype: string; data: unknown }
  | { type: 'next_moves.updated'; moves: NextMove[] }
  | { type: 'result' }
  | { type: 'error'; error: string }
  | { type: 'stream.reconnect'; last_timestamp: number }
  | { type: 'stream.completed'; is_error: boolean }
  | { type: 'conversation.created'; conversation_id: string }

// New (analyst-specific)
  | { type: 'query.started'; query_id: string; sql: string }
  | { type: 'query.completed'; query_id: string; row_count: number; latency_ms: number; statement_link?: string }
  | { type: 'validation.result'; check: string; status: 'pass'|'warn'|'fail'; detail: string }
  | { type: 'evidence.block'; block: EvidenceBlock }
  | { type: 'governance.footer'; footer: GovernanceFooter }
```

## API Surface

Replace builder app's project/conversation API with analyst session/story API:

| Endpoint | Purpose | Builder app equivalent |
|----------|---------|----------------------|
| `GET /api/me` | Current identity | `GET /api/config/me` |
| `POST /api/sessions` | Create analysis session | `POST /api/projects/{id}/conversations` |
| `GET /api/sessions` | List recent sessions | `GET /api/projects/{id}/conversations` |
| `GET /api/sessions/{id}` | Session detail with stories | `GET /api/projects/{id}/conversations/{id}` |
| `POST /api/sessions/{id}/stories` | Create story from question | No equivalent (stories are client-derived) |
| `POST /api/stories/{id}/actions` | Continue/fork/drill/compare | `POST /api/invoke_agent` |
| `POST /api/runs/{id}/stream` | SSE stream | `POST /api/stream_progress/{id}` |
| `POST /api/runs/{id}/cancel` | Cancel run | `POST /api/stop_stream/{id}` |
| `GET /api/stories/{id}` | Canonical story state | No equivalent |
| `POST /api/stories/{id}/feedback` | Capture feedback | No equivalent |
| `GET /api/context/search` | Search context assets | No equivalent |
| `GET /api/workflows` | List workflow templates | No equivalent |

## Component Tree

```
App
├── UserProvider (carry over)
├── SessionProvider (replaces ProjectsProvider)
├── Routes
│   ├── / → WorkbenchPage
│   │   ├── TopBar
│   │   │   ├── WorkspaceIndicator
│   │   │   ├── GlobalAskBox            ← primary entry point
│   │   │   ├── TimeRangeSelector       ← new
│   │   │   └── AccountMenu
│   │   ├── LeftRail
│   │   │   ├── NewAnalysisButton
│   │   │   ├── RecentSessions
│   │   │   ├── SavedStories
│   │   │   ├── WorkflowList            ← new
│   │   │   └── MemoryList              ← new
│   │   ├── MainCanvas
│   │   │   └── StoryCanvas
│   │   │       ├── EmptyState          (carry over)
│   │   │       └── StoryCard[]         (extend)
│   │   │           ├── StoryHeader
│   │   │           ├── ConclusionBlock
│   │   │           ├── EvidenceStrip    ← new
│   │   │           │   ├── KPICard      ← new
│   │   │           │   ├── DataTable    ← new
│   │   │           │   ├── ChartBlock   ← new
│   │   │           │   ├── QueryBlock   ← new
│   │   │           │   ├── CaveatBlock  ← new
│   │   │           │   └── ValidationBlock ← new
│   │   │           ├── TracePills       (carry over)
│   │   │           ├── NextMoveButtons  (carry over)
│   │   │           └── GovernanceFooter ← new
│   │   └── RightInspectPanel           (extend)
│   │       ├── TraceTab                (carry over)
│   │       ├── EvidenceTab             (extend)
│   │       ├── SQLTab                  ← new
│   │       ├── ValidationTab           ← new
│   │       ├── ContextTab              (extend)
│   │       └── GovernanceTab           ← new
│   └── /settings → SettingsPage
└── Toaster (carry over)
```

## Responsive Behavior

| Breakpoint | Layout |
|------------|--------|
| `xl` (1280px+) | Three columns: left rail + canvas + right panel |
| `lg` (1024px) | Two columns: left rail collapsed to icons + canvas; right panel as overlay |
| `md` (768px) | Single column: canvas only; left rail as drawer; right panel as bottom sheet |
| `sm` (640px) | Mobile: single column; bottom navigation; inspect as full-screen overlay |

The builder app's `RightInspectPanel` already uses `xl:block` for responsive visibility. Extend this pattern for the left rail.

## Charting

The builder app has no charting. The analyst app adds chart evidence blocks.

**Phase 1**: Server returns `ChartSpec` JSON; client renders with Recharts. Supported chart types: `bar`, `line`, `area`, `pie`.

**Phase 3**: Add `scatter`, `heatmap`. Add chart interaction (hover, zoom, brush). Add "export to notebook" from chart spec.

Chart specs are generated server-side by the agent via the `create_chart_spec` tool. The client is a renderer, not a chart builder.

## Design Tokens

Inherit the builder app's CSS custom property system. Rebrand for analyst identity:

```css
:root {
  /* Analyst palette — shift from Databricks red to a calmer data-analysis blue */
  --color-accent-primary: #3B82F6;      /* blue-500 */
  --color-accent-secondary: #60A5FA;    /* blue-400 */

  /* Keep all other tokens from builder app globals.css */
}
```

Dark mode support carries over unchanged from the builder app's `.dark` class.

## Phase Mapping

| Phase | Frontend scope |
|-------|---------------|
| Phase 0 | No frontend work. Backend-only tool/prompt validation. |
| Phase 1 | WorkbenchPage shell, StoryCanvas, StoryCard (basic), GlobalAskBox, SSE streaming, session list, server-anchored stories. Evidence types: `text`, `table`, `tool_result`, `error`, `query`. |
| Phase 2 | Context preview in right panel. Asset search UI. |
| Phase 3 | SQL inspector tab. Validation tab. `caveat`, `validation`, `freshness` evidence types. Discovery trace visualization. |
| Phase 4 | Feedback UI (thumbs up/down + correction form). Eval results dashboard. |
| Phase 5 | Workflow list, workflow run UI, report output. `kpi`, `metric_card` evidence types. Chart evidence blocks (Recharts). |
| Phase 6 | Memory list in left rail. Memory proposal/approval dialog. Memory citation badges in evidence. |
| Phase 7 | No frontend changes (backend context enrichment). |
| Phase 8 | Settings page. Admin surfaces. Mobile responsive polish. |

## Open Questions

1. **Fork vs extend**: Does the analyst app fork `databricks-builder-app-oai/client/` or import shared components as a package? Fork is faster for phase 1; package is cleaner long-term.
2. **Chart library**: Recharts (React-native, easy) vs Observable Plot (more expressive, less React-native) vs ECharts (full-featured, heavier)?
3. **Table rendering**: Simple HTML table vs a virtualized data grid (e.g., TanStack Table) for large result previews?
4. **Notebook export**: Phase 5 or earlier? What format — `.py` notebook, `.sql` file, or Databricks notebook API?
5. **Dashboard composition**: Should saved story canvases become dashboard-like layouts, or is that a separate product surface?

## Cross-Reference

- [`design.md`](design.md) — product design (UX, story model, streaming strategy)
- [`system-design.md`](system-design.md) — runtime and backend decisions
- [`gap-analysis-vs-oai.md`](gap-analysis-vs-oai.md) — carry-over inventory
- [`plan.md`](plan.md) — phased build plan
- `databricks-builder-app-oai/client/` — reference implementation
