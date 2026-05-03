"""OpenAI and AI Gateway model configuration."""

import logging
import os
from dataclasses import dataclass

logger = logging.getLogger(__name__)


def _env_bool(name: str, default: bool = False) -> bool:
  value = os.environ.get(name)
  if value is None:
    return default
  return value.strip().lower() in {'1', 'true', 'yes', 'on'}


@dataclass(frozen=True, slots=True)
class OpenAIModelSettings:
  """Resolved model provider settings."""

  api_key: str | None
  base_url: str | None
  agent_model: str
  title_model: str
  tracing_disabled: bool


def load_model_settings(*, require: bool = False) -> OpenAIModelSettings:
  """Load model settings from the environment."""
  settings = OpenAIModelSettings(
    api_key=os.environ.get('OPENAI_API_KEY'),
    base_url=os.environ.get('OPENAI_BASE_URL'),
    agent_model=os.environ.get('OPENAI_AGENT_MODEL', 'deepseek-v4-pro'),
    title_model=os.environ.get('OPENAI_TITLE_MODEL', 'deepseek-v4-flash'),
    tracing_disabled=_env_bool('OPENAI_AGENTS_DISABLE_TRACING'),
  )

  if require:
    missing = []
    if not settings.api_key:
      missing.append('OPENAI_API_KEY')
    if not settings.base_url:
      missing.append('OPENAI_BASE_URL')
    if not settings.agent_model:
      missing.append('OPENAI_AGENT_MODEL')
    if missing:
      raise RuntimeError(
        'OpenAI agent runtime is not configured. Missing: '
        + ', '.join(missing)
      )

  return settings


def build_agent_model(settings: OpenAIModelSettings):
  """Build the model value passed to an OpenAI Agent.

  AI Gateway is OpenAI-compatible, so use the Chat Completions model wrapper
  with an explicit `AsyncOpenAI` client. Direct OpenAI fallback keeps the string
  model path when `OPENAI_BASE_URL` is unset.
  """
  if not settings.base_url:
    return settings.agent_model

  from openai import AsyncOpenAI
  from agents import OpenAIChatCompletionsModel, set_tracing_disabled

  from ..mlflow_setup import is_mlflow_tracing_configured

  # AI Gateway credentials are model-call credentials, not OpenAI tracing
  # credentials. Disable provider tracing unless explicitly routed later.
  # Skip when MLflow tracing is configured — we need the Agents SDK to keep
  # emitting spans so MLflow's trace processor can capture them.
  if not is_mlflow_tracing_configured():
    set_tracing_disabled(True)

  client = AsyncOpenAI(
    api_key=settings.api_key,
    base_url=settings.base_url,
  )
  logger.info(
    'Configured AI Gateway OpenAI-compatible model: base_url=%s model=%s api_key_len=%s',
    settings.base_url,
    settings.agent_model,
    len(settings.api_key or ''),
  )
  return OpenAIChatCompletionsModel(
    model=settings.agent_model,
    openai_client=client,
  )
