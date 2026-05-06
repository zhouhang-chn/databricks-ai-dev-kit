"""Plan-state tools: structured signals the runtime turns into UI events.

The bodies of these tools intentionally do nothing other than echo their
arguments. The OpenAI runtime intercepts calls to these tool names in
`normalize_openai_event` and emits semantic stream events
(`plan.created`, `plan.step_started`, etc.) instead of generic `tool_use` /
`tool_result`. The model still sees a normal tool call/result loop.
"""

from typing import Literal

PLAN_TOOL_NAMES = frozenset({'update_plan', 'submit_conclusion'})


def create_plan_tools() -> list:
  """Build the update_plan and submit_conclusion @function_tool instances."""
  from agents import function_tool

  @function_tool(strict_mode=False)
  def update_plan(
    op: Literal['create', 'start', 'finish', 'revise'],
    objective: str | None = None,
    steps: list[dict] | None = None,
    step_id: str | None = None,
    narrative: str | None = None,
    finding: str | None = None,
    status: Literal['done', 'failed'] = 'done',
    reason: str | None = None,
  ) -> dict:
    """Record a plan-state transition that the UI renders as a stepper.

    Operations:
      - create: open the plan with an objective and a list of {id, title} steps.
      - start:  mark a step running with a one-sentence narrative of intent.
      - finish: mark a step done (or failed) with a one-line finding.
      - revise: replace the remaining plan with a new step list and a reason.

    Tool calls between start(step_id=X) and finish(step_id=X) auto-attach to
    step X in the UI, so do not pass step_id on every other tool call.
    """
    if op == 'create':
      return {
        'op': 'create',
        'objective': objective or '',
        'steps': steps or [],
        'ack': 'plan_created',
      }
    if op == 'start':
      return {
        'op': 'start',
        'step_id': step_id or '',
        'narrative': narrative or '',
        'ack': 'step_started',
      }
    if op == 'finish':
      return {
        'op': 'finish',
        'step_id': step_id or '',
        'finding': finding or '',
        'status': status,
        'ack': 'step_finished',
      }
    if op == 'revise':
      return {
        'op': 'revise',
        'steps': steps or [],
        'reason': reason or '',
        'ack': 'plan_revised',
      }
    return {'op': op, 'ack': 'noop'}

  @function_tool(strict_mode=False)
  def submit_conclusion(
    summary: str,
    highlights: list[dict] | None = None,
    next_steps: list[str] | None = None,
  ) -> dict:
    """Submit the final synthesis instead of a regular markdown response.

    Call this exactly once when all plan steps are complete. The UI replaces
    the stepper with the structured summary and highlights.
    """
    return {
      'summary': summary,
      'highlights': highlights or [],
      'next_steps': next_steps or [],
      'ack': 'conclusion_submitted',
    }

  return [update_plan, submit_conclusion]
