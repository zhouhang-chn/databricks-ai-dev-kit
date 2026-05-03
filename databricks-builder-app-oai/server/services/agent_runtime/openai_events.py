"""Map OpenAI Agents SDK stream events to Builder App events."""

from typing import Any


def _get(obj: Any, name: str, default: Any = None) -> Any:
  if isinstance(obj, dict):
    return obj.get(name, default)
  return getattr(obj, name, default)


def _text_from_content(content: Any) -> str:
  if content is None:
    return ''
  if isinstance(content, str):
    return content
  if isinstance(content, list):
    parts = []
    for item in content:
      text = _get(item, 'text') or _get(item, 'content')
      if text:
        parts.append(str(text))
    return '\n'.join(parts)
  text = _get(content, 'text') or _get(content, 'content')
  return str(text) if text else ''


def normalize_openai_event(event: Any) -> list[dict]:
  """Convert one SDK event into zero or more Builder App events.

  The SDK exposes several event classes depending on whether the item is a raw
  Responses event or a semantic run item event. This mapper is intentionally
  defensive so minor SDK shape changes degrade into `system` events rather than
  frontend-breaking objects.
  """
  event_type = _get(event, 'type', type(event).__name__)

  if event_type == 'raw_response_event':
    data = _get(event, 'data')
    data_type = _get(data, 'type', '')
    if data_type in {
      'response.output_text.delta',
      'response.output_text_delta',
      'output_text_delta',
    }:
      delta = _get(data, 'delta', '')
      return [{'type': 'text_delta', 'text': delta}] if delta else []
    return []

  if event_type == 'run_item_stream_event':
    item = _get(event, 'item')
    item_type = _get(item, 'type', '')
    raw_item = _get(item, 'raw_item', item)

    if item_type in {'tool_call_item', 'function_call_item'} or 'tool_call' in item_type:
      return [{
        'type': 'tool_use',
        'tool_id': _get(raw_item, 'id') or _get(item, 'id', ''),
        'tool_name': _get(raw_item, 'name') or _get(item, 'name', 'tool'),
        'tool_input': _get(raw_item, 'arguments') or _get(item, 'arguments') or {},
      }]

    if (
      item_type in {'tool_call_output_item', 'function_call_output_item'}
      or 'tool_call_output' in item_type
    ):
      return [{
        'type': 'tool_result',
        'tool_use_id': _get(raw_item, 'call_id') or _get(item, 'call_id', ''),
        'content': _text_from_content(_get(raw_item, 'output') or _get(item, 'output')),
        'is_error': False,
      }]

    if item_type in {'message_output_item', 'message_item'} or 'message' in item_type:
      text = _text_from_content(_get(raw_item, 'content') or _get(item, 'content'))
      return [{'type': 'text', 'text': text}] if text else []

  if event_type == 'agent_updated_stream_event':
    return [{
      'type': 'system',
      'subtype': 'agent_updated',
      'data': {'agent': str(_get(event, 'new_agent', ''))},
    }]

  return [{
    'type': 'system',
    'subtype': event_type,
    'data': {'preview': repr(event)[:500]},
  }]
