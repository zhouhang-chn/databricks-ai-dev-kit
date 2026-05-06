"""Smoke-test an OpenAI-compatible model on the configured gateway.

Loads OPENAI_API_KEY / OPENAI_BASE_URL from .env.local, fires the same
strict-JSON prompt next_moves.py uses, and reports latency, finish
reason, output, and parse status.

Usage:
  ./.venv/bin/python scripts/check_model.py                       # deepseek-v4-flash, 30s
  ./.venv/bin/python scripts/check_model.py --model deepseek-v4-pro
  ./.venv/bin/python scripts/check_model.py --timeout 60 --runs 3
"""

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from openai import AsyncOpenAI


SAMPLE_PAYLOAD = {
  'project': {'type': 'analyst_workspace', 'run_role': 'developer'},
  'story': {
    'question': 'compare visit time per bdr for april vs march',
    'answer': 'April average is 12.4 minutes, March was 11.1 minutes (+11.7%).',
    'trace_steps': [
      {'tool_name': 'execute_sql', 'status': 'done', 'summary': '92 rows returned.'},
    ],
  },
}


def _messages() -> list[dict]:
  return [
    {
      'role': 'system',
      'content': (
        'You generate concise next-step suggestions for a Databricks '
        'analyst/developer agent UI. Return only JSON.'
      ),
    },
    {
      'role': 'user',
      'content': (
        'Generate 3 next moves.\n\n'
        'Rules: each label <= 32 chars, prompt <= 220 chars; '
        'actionType in drill/compare/validate/explain/pivot.\n\n'
        'Return: {"moves":[{"label":"...","prompt":"...","actionType":"...",'
        '"intent":"...","confidence":0.8,"requiresConfirmation":false}]}\n\n'
        f'Context:\n{json.dumps(SAMPLE_PAYLOAD)}'
      ),
    },
  ]


async def run_once(client: AsyncOpenAI, model: str, timeout: float) -> dict:
  started = time.monotonic()
  try:
    response = await asyncio.wait_for(
      client.chat.completions.create(
        model=model,
        max_tokens=600,
        temperature=0.2,
        messages=_messages(),
      ),
      timeout=timeout,
    )
  except asyncio.TimeoutError:
    return {'ok': False, 'error': 'TimeoutError', 'elapsed': time.monotonic() - started}
  except Exception as exc:
    return {'ok': False, 'error': f'{type(exc).__name__}: {exc}', 'elapsed': time.monotonic() - started}

  elapsed = time.monotonic() - started
  choice = response.choices[0]
  content = (choice.message.content or '').strip()
  parsed_ok = False
  move_count = 0
  try:
    payload = json.loads(content.removeprefix('```json').removeprefix('```').removesuffix('```').strip())
    moves = payload.get('moves') if isinstance(payload, dict) else None
    if isinstance(moves, list):
      parsed_ok = True
      move_count = len(moves)
  except Exception:
    pass

  return {
    'ok': True,
    'elapsed': elapsed,
    'finish_reason': choice.finish_reason,
    'usage': getattr(response, 'usage', None) and {
      'prompt': response.usage.prompt_tokens,
      'completion': response.usage.completion_tokens,
      'total': response.usage.total_tokens,
    },
    'parsed_json': parsed_ok,
    'move_count': move_count,
    'content_preview': content[:300] + ('…' if len(content) > 300 else ''),
  }


async def main(args: argparse.Namespace) -> int:
  api_key = os.environ.get('OPENAI_API_KEY')
  base_url = os.environ.get('OPENAI_BASE_URL')
  if not api_key:
    print('OPENAI_API_KEY is not set. Load .env.local first.', file=sys.stderr)
    return 2

  print(f'model     = {args.model}')
  print(f'base_url  = {base_url or "<openai default>"}')
  print(f'timeout   = {args.timeout}s')
  print(f'runs      = {args.runs}')
  print('---')

  client = AsyncOpenAI(api_key=api_key, base_url=base_url)
  successes = 0
  for i in range(1, args.runs + 1):
    result = await run_once(client, args.model, args.timeout)
    print(f'run {i}: elapsed={result["elapsed"]:.2f}s', end=' ')
    if result['ok']:
      successes += 1
      print(
        f'finish={result["finish_reason"]} '
        f'tokens={result["usage"]} '
        f'parsed_json={result["parsed_json"]} '
        f'moves={result["move_count"]}'
      )
      print(f'  preview: {result["content_preview"]}')
    else:
      print(f'FAILED: {result["error"]}')

  print('---')
  print(f'success rate: {successes}/{args.runs}')
  return 0 if successes == args.runs else 1


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
  parser.add_argument('--model', default='deepseek-v4-flash')
  parser.add_argument('--timeout', type=float, default=30.0)
  parser.add_argument('--runs', type=int, default=1)
  return parser.parse_args()


if __name__ == '__main__':
  here = Path(__file__).resolve().parent.parent
  load_dotenv(here / '.env.local', override=False)
  sys.exit(asyncio.run(main(parse_args())))
