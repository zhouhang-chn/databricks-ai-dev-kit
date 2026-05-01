# OpenAI Agents SDK Builder App

This section captures the analysis and design for `databricks-builder-app-oai`,
a new sibling version of `databricks-builder-app` that depends on the OpenAI
Agents SDK instead of the Claude Agent SDK.

The canonical directory is `docs/agents-sdk`.

## Contents

| Page | Topic |
|------|-------|
| [analysis.md](analysis.md) | Current Builder App coupling to Claude, target `databricks-builder-app-oai` scope, OpenAI Agents SDK capability fit, migration constraints, and risks |
| [design.md](design.md) | Proposed `databricks-builder-app-oai` runtime architecture, tool strategy, persistence, streaming, deployment, and rollout plan |

## Source References

- Target app folder: `databricks-builder-app-oai`
- Current Builder App docs: [`docs/builder-app`](../builder-app/README.md)
- Current backend runtime: [`databricks-builder-app/server/services/agent.py`](../../databricks-builder-app/server/services/agent.py)
- Current Databricks tool wrapper: [`databricks-builder-app/server/services/databricks_tools.py`](../../databricks-builder-app/server/services/databricks_tools.py)
- OpenAI Agents SDK docs:
  - [Intro](https://openai.github.io/openai-agents-python/)
  - [Running agents](https://openai.github.io/openai-agents-python/running_agents/)
  - [Streaming](https://openai.github.io/openai-agents-python/streaming/)
  - [Tools](https://openai.github.io/openai-agents-python/tools/)
  - [MCP](https://openai.github.io/openai-agents-python/mcp/)
  - [Sessions](https://openai.github.io/openai-agents-python/sessions/)
  - [Tracing](https://openai.github.io/openai-agents-python/tracing/)
  - [Sandbox agents](https://openai.github.io/openai-agents-python/sandbox_agents/)
