# v0.3 Visual Storytelling Gap Analysis

Date: 2026-05-09

## Purpose And Scope

This document checks whether the current v0.3 plan can produce decision-ready
analysis stories, not just chart rendering.

Scope:

- Source docs:
  - [`../data-visualization.md`](../data-visualization.md)
  - [`../roadmap.md`](../roadmap.md)
- Current implementation:
  - `databricks-builder-app-oai/client/src/features/analysis/*`
  - `databricks-builder-app-oai/server/services/*`

Out of scope:

- Live Databricks workspace execution
- Browser performance benchmarking
- Production usage telemetry

## Fact-Check Summary

1. The app has a strong evidence transport and table rendering base.
2. The app does not yet implement chart evidence, chart specs, or
   `visualize_data`.
3. The main story card still lacks inline evidence; evidence is in the inspect
   panel.
4. Current docs are implementation-complete but narrative-incomplete.
5. v0.3 needs a story quality contract, not only a chart pipeline.

## Narrative Gap Matrix

| Narrative gap | Current evidence | Why it blocks storytelling | Priority |
|---|---|---|---|
| No claim-first structure | Docs and UI focus on tool/evidence mechanics before decision claim. | Readers cannot answer "what should I do?" quickly. | P0 |
| No primary evidence selection rule | Evidence is appended as events; no rule for "most decision-relevant block." | Story reads like logs, not argument. | P0 |
| No confidence/caveat policy | Caveats exist in project context, but conclusion style is not standardized. | Risk of overconfident conclusions from partial evidence. | P0 |
| No contradiction policy | No explicit handling when chart trend and conclusion text conflict. | Trust drops immediately when mismatch appears. | P1 |
| No stakeholder action framing | Next moves exist, but no required "recommended decision next step." | Stories end with options instead of direction. | P1 |
| No story quality scoring | Validation emphasizes rendering and compatibility, not communication quality. | Hard to know when storytelling is release-ready. | P1 |

## Technical Gap Matrix

| Technical gap | Current state | Impact | Priority |
|---|---|---|---|
| Inline evidence in story panel | `StoryCard` shows question/plan/conclusion/next moves; no evidence strip. | Visual evidence is detached from the conclusion. | P0 |
| `ChartSpec` contract | `EvidenceType` includes `chart`, but no `ChartSpec` or `chartSpec` field. | No stable chart render interface. | P0 |
| Chart renderer | No `recharts` dependency, no `ChartEvidence` component. | No chart output path. | P0 |
| Shared tabular parsing | Row parsing is local inside `EvidenceContent.tsx`. | Chart detection and table rendering can diverge. | P0 |
| Model-guided chart spec path | Current run contract centers on `submit_conclusion`. | Free-form `__chart_spec__` is brittle. | P1 |
| Dedicated visualization tool | No `visualize_data` typed tool today. | Agent cannot declare visualization intent explicitly. | P1 |
| Story export | No story-level share/export surface yet. | "Shareable narrative" roadmap objective is unmet. | P1 |

## Storytelling Quality Rubric

Score each story 0-2 per dimension.

| Dimension | 0 | 1 | 2 |
|---|---|---|---|
| Claim clarity | No clear answer | Answer exists but vague | Single clear decision claim |
| Evidence relevance | Evidence unrelated to claim | Partially supports claim | Primary evidence directly supports claim |
| Visual readability | Visual confusing or absent | Visual readable with effort | Visual readable in seconds |
| Caveat transparency | Caveats missing | Caveats implied | Caveats explicit and bounded |
| Actionability | No next decision | Generic next move | Specific recommended next step |
| Claim-evidence consistency | Claim contradicts evidence | Minor mismatch risk | Claim and evidence aligned |

Ship bar for v0.3:

- Total score >= 8/12
- No score of 0 in: claim clarity, evidence relevance, claim-evidence consistency

## Failure Modes And Risks

| Failure mode | Symptom | Mitigation |
|---|---|---|
| Chart without decision | Nice visual, no recommendation | Require decision claim + recommended next step in conclusion schema |
| Conclusion contradicts chart | Narrative says growth while line declines | Add consistency check and force caveat/mismatch callout |
| Wrong chart type | Pie used for dense ranking | Apply conservative heuristic + model override validation |
| Excessive evidence density | Story card becomes long event dump | Limit default evidence strip to top 1-3 blocks |
| Overconfident language | Weak data framed as certainty | Apply confidence wording policy |

## Reframed v0.3 Story Outcome

v0.3 should produce this flow for a decision owner:

```text
Question
-> Decision claim
-> Primary visual evidence
-> One-line insight
-> Caveat/confidence statement
-> Recommended next step
```

If this flow is missing, the story is not at v0.3 quality, even if charts
render correctly.

## Prioritized Gap Closures

1. P0: Introduce narrative contract and inline evidence in story card.
2. P0: Add shared evidence parser, `ChartSpec`, and chart render path.
3. P1: Add story quality rubric and contradiction handling rules.
4. P1: Add structured model-guided visualization path aligned with
   `submit_conclusion`.
5. P1: Add story/share export baseline.
6. P2: Add chart interaction enhancements and deeper validation.

## Validation Evidence Needed

1. Ten golden conversation runs scored by the storytelling rubric.
2. At least three runs with explicit caveats and medium/low confidence wording.
3. At least two contradiction simulations and expected handling behavior.
4. Replay tests showing chart evidence reconstructs from persisted events.
5. UI review proving a stakeholder can read story card only and decide in
   under 60 seconds.
