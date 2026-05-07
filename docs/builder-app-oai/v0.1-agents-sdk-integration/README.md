# OpenAI Agents SDK Builder App

This folder captures the v0.1 migration analysis and design for
`databricks-builder-app-oai`: a sibling Builder App that depends on the OpenAI
Agents SDK instead of the Claude Agent SDK.

This is a historical progress track. Current OAI app feature docs live in
[`../`](../), and v0.2 business-question gap filling is tracked in
[`../v0.2-business-analysis/`](../v0.2-business-analysis/).

## Contents

| Page | Topic |
|------|-------|
| [analysis.md](analysis.md) | Current Builder App coupling to Claude, target `databricks-builder-app-oai` scope, OpenAI Agents SDK capability fit, migration constraints, and risks |
| [design.md](design.md) | Proposed `databricks-builder-app-oai` runtime architecture, tool strategy, persistence, streaming, deployment, and rollout plan |
| [action-plan.md](action-plan.md) | Implementation phases, acceptance gates, and validation checklist |

## Source References

- Target app folder: `databricks-builder-app-oai`
- Current OAI docs: [`docs/builder-app-oai`](../README.md)
- Current Builder App docs: [`docs/builder-app`](../../builder-app/README.md)
- Legacy backend runtime reference: [`databricks-builder-app/server/services/agent.py`](../../../databricks-builder-app/server/services/agent.py)
- OAI runtime implementation: [`databricks-builder-app-oai/server/services/agent_runtime`](../../../databricks-builder-app-oai/server/services/agent_runtime/)
- OpenAI Agents SDK docs:
  - [Intro](https://openai.github.io/openai-agents-python/)
  - [Running agents](https://openai.github.io/openai-agents-python/running_agents/)
  - [Streaming](https://openai.github.io/openai-agents-python/streaming/)
  - [Tools](https://openai.github.io/openai-agents-python/tools/)
  - [MCP](https://openai.github.io/openai-agents-python/mcp/)
  - [Sessions](https://openai.github.io/openai-agents-python/sessions/)
  - [Tracing](https://openai.github.io/openai-agents-python/tracing/)
  - [Sandbox agents](https://openai.github.io/openai-agents-python/sandbox_agents/)
