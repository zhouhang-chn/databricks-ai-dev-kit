"""Map OpenAI Agents SDK stream events to Builder App events."""

import json
from typing import Any

from ..tools.plan_tools import PLAN_TOOL_NAMES

# Track call_id -> tool_name for plan tools per-request would be better, but for now
# we'll at least ensure we don't leak forever.
_PLAN_CALL_IDS: set[str] = set()
_PLAN_CALL_INPUTS: dict[str, Any] = {}


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
      if text is not None and text != '':
        parts.append(text if isinstance(text, str) else _json_preview(text))
      elif isinstance(item, str):
        parts.append(item)
      elif _get(item, 'text') is not None or _get(item, 'content') is not None:
        continue
      else:
        parts.append(_json_preview(item))
    return '\n'.join(parts)
  if isinstance(content, dict):
    text = _get(content, 'text') or _get(content, 'content') or _get(content, 'output')
    return text if isinstance(text, str) else _json_preview(text or content)
  text = _get(content, 'text') or _get(content, 'content')
  return text if isinstance(text, str) else _json_preview(text) if text else ''


def _json_preview(value: Any) -> str:
  """Serialize structured tool values for evidence/debug display."""
  try:
    return json.dumps(value, ensure_ascii=False, default=str)
  except TypeError:
    return str(value)


def _parse_tool_arguments(arguments: Any) -> Any:
  """Return tool arguments as structured data when the SDK gives JSON text."""
  if not isinstance(arguments, str):
    return arguments or {}
  stripped = arguments.strip()
  if not stripped:
    return {}
  try:
    return json.loads(stripped)
  except json.JSONDecodeError:
    return arguments


def _plan_events_from_call(call_id: str, tool_name: str, tool_input: Any) -> list[dict]:
  """Translate an update_plan / submit_conclusion call into UI events."""
  args = tool_input if isinstance(tool_input, dict) else {}
  if tool_name == 'submit_conclusion':
    return [{
      'type': 'synthesis.appended',
      'call_id': call_id,
      'summary': str(args.get('summary') or ''),
      'highlights': args.get('highlights') or [],
      'next_steps': args.get('next_steps') or [],
    }]
  if tool_name == 'update_plan':
    op = str(args.get('op') or '')
    if op == 'create':
      steps = args.get('steps')
      if isinstance(steps, str):
        try:
          steps = json.loads(steps)
        except Exception:
          steps = []
      return [{
        'type': 'plan.created',
        'call_id': call_id,
        'objective': str(args.get('objective') or ''),
        'steps': steps if isinstance(steps, list) else [],
      }]
    if op == 'start':
      return [{
        'type': 'plan.step_started',
        'call_id': call_id,
        'step_id': str(args.get('step_id') or ''),
        'narrative': str(args.get('narrative') or ''),
      }]
    if op == 'finish':
      return [{
        'type': 'plan.step_finished',
        'call_id': call_id,
        'step_id': str(args.get('step_id') or ''),
        'finding': str(args.get('finding') or ''),
        'status': str(args.get('status') or 'done'),
      }]
    if op == 'revise':
      steps = args.get('steps')
      if isinstance(steps, str):
        try:
          steps = json.loads(steps)
        except Exception:
          steps = []
      return [{
        'type': 'plan.revised',
        'call_id': call_id,
        'steps': steps if isinstance(steps, list) else [],
        'reason': str(args.get('reason') or ''),
      }]
  return []


def _plan_events_from_output(call_id: str, original_input: Any, output: Any) -> list[dict]:
  """Translate special plan-tool output acks that change runtime state."""
  parsed_output = _parse_tool_arguments(output)
  if not isinstance(parsed_output, dict):
    return []
  if parsed_output.get('ack') != 'duplicate_plan_started':
    return []

  step_id = str(parsed_output.get('step_id') or '')
  narrative = str(parsed_output.get('narrative') or 'Continuing with the existing plan.')
  if not step_id and isinstance(original_input, dict):
    steps = original_input.get('steps')
    if isinstance(steps, list) and steps and isinstance(steps[0], dict):
      step_id = str(steps[0].get('id') or steps[0].get('step_id') or '')
  return [{
    'type': 'plan.step_started',
    'call_id': call_id,
    'step_id': step_id or 'step-1',
    'narrative': narrative,
  }]


def _is_error_output(raw_item: Any, output: Any) -> bool:
  """Best-effort error flag for tool output items."""
  status = str(_get(raw_item, 'status', '') or '').lower()
  if status in {'failed', 'error'}:
    return True
  if isinstance(output, dict):
    if bool(output.get('is_error')) or bool(output.get('error')):
      return True
    output_status = str(output.get('status') or '').lower()
    return output_status in {'failed', 'error'}
  return False


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

    if (
      item_type in {'tool_call_output_item', 'function_call_output_item'}
      or 'tool_call_output' in item_type
    ):
      call_id = (
        _get(item, 'call_id')
        or _get(raw_item, 'call_id')
        or _get(raw_item, 'id')
        or ''
      )
      output = _get(item, 'output') or _get(raw_item, 'output')
      # Plan tool outputs are usually pure echoes of the call; the call already
      # produced the semantic event. Suppress them so the UI never sees a
      # generic tool_result. One exception is a duplicate create that the tool
      # layer converts into a step start, since its call looked like `create`.
      if call_id and call_id in _PLAN_CALL_IDS:
        _PLAN_CALL_IDS.discard(call_id)
        original_input = _PLAN_CALL_INPUTS.pop(call_id, {})
        return _plan_events_from_output(call_id, original_input, output)
      return [{
        'type': 'tool_result',
        'tool_use_id': call_id,
        'content': _text_from_content(output),
        'is_error': _is_error_output(raw_item, output),
      }]

    if item_type in {'tool_call_item', 'function_call_item'} or 'tool_call' in item_type:
      arguments = _get(raw_item, 'arguments') or _get(item, 'arguments') or {}
      tool_input = _parse_tool_arguments(arguments)
      tool_id = (
        _get(item, 'call_id')
        or _get(raw_item, 'call_id')
        or _get(raw_item, 'id')
        or _get(item, 'id', '')
      )
      tool_name = (
        _get(item, 'tool_name')
        or _get(raw_item, 'name')
        or _get(item, 'name', 'tool')
      )
      if tool_name in PLAN_TOOL_NAMES:
        if tool_id:
          _PLAN_CALL_IDS.add(tool_id)
          _PLAN_CALL_INPUTS[tool_id] = tool_input
        return _plan_events_from_call(tool_id, tool_name, tool_input)
      return [{
        'type': 'tool_use',
        'tool_id': tool_id,
        'tool_name': tool_name,
        'tool_input': tool_input,
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
