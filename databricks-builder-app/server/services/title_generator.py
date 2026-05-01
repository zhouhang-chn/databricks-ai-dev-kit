"""AI-powered conversation title generation.

Uses Claude to generate concise, descriptive titles for conversations
based on the first user message.

Supports direct Anthropic API and Anthropic-compatible gateways configured via
ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY. Databricks FMAPI is only used as a
fallback when explicit Anthropic environment configuration is absent.
"""

import asyncio
import logging
import os
from typing import Optional

import anthropic

logger = logging.getLogger(__name__)


def _get_model() -> str:
  """Get the model to use for title generation.

  Uses ANTHROPIC_MODEL_MINI for efficiency (title generation is a simple task).
  Falls back to ANTHROPIC_MODEL if mini not set.
  """
  return os.environ.get(
    'ANTHROPIC_MODEL_MINI',
    os.environ.get('ANTHROPIC_MODEL', 'databricks-claude-sonnet-4-5')
  )


def _create_client(
  databricks_host: Optional[str] = None,
  databricks_token: Optional[str] = None,
) -> anthropic.AsyncAnthropic:
  """Create an Anthropic client configured for the current context.

  Explicit ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY configuration takes
  precedence over Databricks credentials. When that env config is absent and
  databricks_host/token are provided, falls back to Databricks FMAPI. Otherwise
  uses direct Anthropic API.

  Args:
      databricks_host: Databricks workspace URL (e.g., https://xxx.cloud.databricks.com)
      databricks_token: User's Databricks OAuth or PAT token

  Returns:
      Configured AsyncAnthropic client
  """
  # Environment-based Anthropic-compatible gateway config wins over Databricks
  # app credentials because some deployments do not have the Databricks
  # model-serving gateway available.
  api_key = os.environ.get('ANTHROPIC_API_KEY')
  base_url = os.environ.get('ANTHROPIC_BASE_URL')
  auth_token = os.environ.get('ANTHROPIC_AUTH_TOKEN')
  gateway_token = api_key or auth_token

  if base_url and gateway_token:
    logger.info(
      'Title generation using Anthropic-compatible gateway: '
      f'BASE_URL={base_url}, AUTH_TOKEN_LEN={len(gateway_token)}, MODEL={_get_model()}'
    )
    client = anthropic.AsyncAnthropic(
      auth_token=gateway_token,
      base_url=base_url,
    )
    # The Anthropic Python SDK reads ANTHROPIC_API_KEY from os.environ even
    # when auth_token is passed. Clear the client field so custom gateways see
    # only the Authorization bearer token, not an extra X-Api-Key header.
    client.api_key = None
    return client

  if base_url and not gateway_token:
    logger.warning(
      'ANTHROPIC_BASE_URL is set but no ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN '
      'is available; falling back to other title generation auth'
    )

  # Check if we should use Databricks FMAPI as a fallback.
  if databricks_host and databricks_token:
    # Build Databricks model serving endpoint URL
    # Format: https://<workspace>/serving-endpoints/anthropic
    host = databricks_host.replace('https://', '').replace('http://', '').rstrip('/')
    base_url = f'https://{host}/serving-endpoints/anthropic'

    return anthropic.AsyncAnthropic(
      api_key=databricks_token,
      base_url=base_url,
    )

  # Direct Anthropic API
  return anthropic.AsyncAnthropic(api_key=api_key)


async def generate_title(
  message: str,
  max_length: int = 40,
  databricks_host: Optional[str] = None,
  databricks_token: Optional[str] = None,
) -> str:
  """Generate a concise title for a conversation based on the first message.

  Args:
      message: The user's first message in the conversation
      max_length: Maximum length of the generated title
      databricks_host: Optional Databricks workspace URL for FMAPI auth
      databricks_token: Optional user's Databricks token for FMAPI auth

  Returns:
      A short, descriptive title (or truncated message as fallback)
  """
  # Fallback: truncate message
  fallback = message[:max_length].strip()
  if len(message) > max_length:
    fallback = fallback.rsplit(' ', 1)[0] + '...'

  try:
    client = _create_client(databricks_host, databricks_token)
    model = _get_model()

    response = await asyncio.wait_for(
      client.messages.create(
        model=model,
        max_tokens=50,
        messages=[
          {
            'role': 'user',
            'content': f'''Generate a very short title (3-6 words max) for this chat message.
The title should capture the main intent/topic. No quotes, no punctuation at the end.

Message: {message[:500]}

Title:''',
          }
        ],
      ),
      timeout=5.0,  # 5 second timeout
    )

    # Extract title from response
    title = response.content[0].text.strip()

    # Clean up: remove quotes, limit length
    title = title.strip('"\'')
    if len(title) > max_length:
      title = title[:max_length].rsplit(' ', 1)[0] + '...'

    return title if title else fallback

  except asyncio.TimeoutError:
    logger.warning('Title generation timed out, using fallback')
    return fallback
  except Exception as e:
    logger.warning(f'Title generation failed: {e}, using fallback')
    return fallback


async def generate_title_async(
  message: str,
  conversation_id: str,
  user_email: str,
  project_id: str,
  databricks_host: Optional[str] = None,
  databricks_token: Optional[str] = None,
) -> None:
  """Generate a title and update the conversation in the background.

  This runs in a fire-and-forget pattern so it doesn't block the main response.

  Args:
      message: The user's first message
      conversation_id: ID of the conversation to update
      user_email: User's email for storage access
      project_id: Project ID for storage access
      databricks_host: Optional Databricks workspace URL for FMAPI auth
      databricks_token: Optional user's Databricks token for FMAPI auth
  """
  try:
    title = await generate_title(
      message,
      databricks_host=databricks_host,
      databricks_token=databricks_token,
    )

    # Update the conversation title
    from .storage import ConversationStorage

    storage = ConversationStorage(user_email, project_id)
    await storage.update_title(conversation_id, title)
    logger.info(f'Updated conversation {conversation_id} title to: {title}')

  except Exception as e:
    logger.warning(f'Failed to update conversation title: {e}')
