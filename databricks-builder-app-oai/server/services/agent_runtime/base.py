"""Runtime-neutral request and streaming protocol for agent backends."""

from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(slots=True)
class AgentRunRequest:
  """Application-level values needed for one agent run."""

  project_id: str
  conversation_id: str
  session_id: str | None
  message: str
  execution_id: str | None = None
  story_id: str | None = None
  cluster_id: str | None = None
  default_catalog: str | None = None
  default_schema: str | None = None
  warehouse_id: str | None = None
  workspace_folder: str | None = None
  databricks_host: str | None = None
  databricks_token: str | None = None
  is_cross_workspace: bool = False
  enabled_skills: list[str] | None = None
  mlflow_experiment_name: str | None = None
  project_context: dict[str, Any] | None = None
  is_cancelled_fn: Callable[[], bool] | None = None


class AgentRuntime(Protocol):
  """Protocol implemented by concrete agent runtimes."""

  async def stream_response(
    self,
    request: AgentRunRequest,
  ) -> AsyncIterator[dict]:
    """Stream normalized Builder App events."""
    ...
