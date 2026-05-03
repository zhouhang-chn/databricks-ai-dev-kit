"""OpenAI-backed conversation title generation."""

import asyncio
import logging
import os
from contextlib import nullcontext
from typing import Optional

from openai import AsyncOpenAI

from .mlflow_setup import is_mlflow_tracing_active

logger = logging.getLogger(__name__)


def _title_trace_span():
  """Context manager that names the title-generation MLflow trace.

  Without this the auto-instrumented ``chat.completions.create`` call would
  create a second, anonymous trace alongside the agent run. Wrapping it in a
  named span makes the resulting trace clearly identifiable in the MLflow UI.
  Returns a no-op context manager when MLflow tracing is not configured.
  """
  if not is_mlflow_tracing_active():
    return nullcontext()
  try:
    import mlflow

    return mlflow.start_span(name='title_generation')
  except Exception:
    logger.debug('Failed to start MLflow title span; continuing without it', exc_info=True)
    return nullcontext()


def _fallback_title(message: str, max_length: int) -> str:
  title = message[:max_length].strip()
  if len(message) > max_length and ' ' in title:
    title = title.rsplit(' ', 1)[0] + '...'
  return title or 'New Conversation'


def _get_model() -> str:
  """Get the model to use for cheap auxiliary title generation."""
  return os.environ.get('OPENAI_TITLE_MODEL', 'deepseek-v4-flash')


def _create_client() -> AsyncOpenAI:
  """Create an OpenAI-compatible client for title generation."""
  api_key = os.environ.get('OPENAI_API_KEY')
  base_url = os.environ.get('OPENAI_BASE_URL')
  if not api_key:
    raise RuntimeError('OPENAI_API_KEY is required for title generation')
  return AsyncOpenAI(api_key=api_key, base_url=base_url)


async def generate_title(
  message: str,
  max_length: int = 40,
  databricks_host: Optional[str] = None,
  databricks_token: Optional[str] = None,
) -> str:
  """Generate a concise title for a conversation based on the first message."""
  del databricks_host, databricks_token
  fallback = _fallback_title(message, max_length)

  try:
    client = _create_client()
    model = _get_model()
    logger.info('Generating title with model=%s message_len=%s', model, len(message))

    with _title_trace_span():
      response = await asyncio.wait_for(
        client.chat.completions.create(
          model=model,
          max_tokens=50,
          temperature=0.2,
          messages=[
            {
              'role': 'user',
              'content': (
                'Generate a very short title, 3-6 words max, for this chat '
                'message. Return only the title, with no quotes and no trailing '
                f'punctuation.\n\nMessage: {message[:500]}'
              ),
            }
          ],
        ),
        timeout=5.0,
      )

    title = (response.choices[0].message.content or '').strip().strip('"\'')
    if len(title) > max_length:
      title = title[:max_length].rsplit(' ', 1)[0] + '...'
    return title or fallback

  except asyncio.TimeoutError:
    logger.warning('Title generation timed out, using fallback')
    return fallback
  except Exception as e:
    logger.warning('Title generation failed: %s, using fallback', e)
    return fallback


async def generate_title_async(
  message: str,
  conversation_id: str,
  user_email: str,
  project_id: str,
  databricks_host: Optional[str] = None,
  databricks_token: Optional[str] = None,
) -> None:
  """Generate a title and update the conversation in the background."""
  try:
    title = await generate_title(
      message,
      databricks_host=databricks_host,
      databricks_token=databricks_token,
    )

    from .storage import ConversationStorage

    storage = ConversationStorage(user_email, project_id)
    await storage.update_title(conversation_id, title)
    logger.info('Updated conversation %s title to: %s', conversation_id, title)

  except Exception as e:
    logger.warning('Failed to update conversation title: %s', e)
