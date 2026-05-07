"""Plan-state tools: structured signals the runtime turns into UI events.

The bodies of these tools are mostly echoes of their arguments — the OpenAI
runtime intercepts the *call* in `normalize_openai_event` and emits semantic
stream events (`plan.created`, `plan.step_started`, ...) instead of generic
`tool_use` / `tool_result`. The model still sees a normal tool call/result
loop.

`create_plan_tools()` returns a fresh pair of tools per run, with closure
state that enforces two invariants the contract requires but the model
sometimes violates (causing turn-budget runaway):

  - `update_plan(op='create')` must be called exactly once per run.
    Subsequent `op='create'` calls return a redirect telling the model to
    use `op='start'` (to begin executing) or `op='revise'` (to change the
    plan). The new call still produces a `plan.created` UI event, but the
    frontend reducer dedups identical re-emissions within the same story.
  - `submit_conclusion` must be called exactly once and is the terminal
    action of the run. Subsequent calls return a redirect that tells the
    model the run is finished.
"""

from typing import Literal

PLAN_TOOL_NAMES = frozenset({'update_plan', 'submit_conclusion'})


def create_plan_tools() -> list:
  """Build a fresh `update_plan` + `submit_conclusion` pair for one run.

  The closure state is per-call, so each agent run gets independent
  bookkeeping — module-level state would leak between concurrent requests.
  """
  from agents import function_tool

  state = {'plan_created': False, 'conclusion_submitted': False}

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
        Call this exactly once per run. To change the plan later, use op="revise".
      - start:  mark a step running with a one-sentence narrative of intent.
      - finish: mark a step done (or failed) with a one-line finding.
      - revise: replace the remaining plan with a new step list and a reason.

    Tool calls between start(step_id=X) and finish(step_id=X) auto-attach to
    step X in the UI, so do not pass step_id on every other tool call.
    """
    if op == 'create':
      if state['plan_created']:
        return {
          'op': 'create',
          'ack': 'plan_already_exists',
          'guidance': (
            'A plan was already created for this run. Do not call '
            'update_plan(op="create") again. To begin executing, call '
            'update_plan(op="start", step_id="step-1", narrative="..."). '
            'To change the plan, call update_plan(op="revise", steps=[...], '
            'reason="...").'
          ),
        }
      state['plan_created'] = True
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
      # A revise implies a plan exists; mark plan_created so subsequent
      # creates also redirect.
      state['plan_created'] = True
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

    Call this exactly once when all plan steps are complete. This is the
    terminal action of the run — do not run additional tools afterward.
    Persist any AGENTS.md updates BEFORE calling submit_conclusion.
    """
    if state['conclusion_submitted']:
      return {
        'ack': 'conclusion_already_submitted',
        'guidance': (
          'A conclusion was already submitted for this run. Do not call '
          'submit_conclusion again and do not run more tools — the run is '
          'finished. If you have additional information, wait for the next '
          'user turn.'
        ),
      }
    state['conclusion_submitted'] = True
    return {
      'summary': summary,
      'highlights': highlights or [],
      'next_steps': next_steps or [],
      'ack': 'conclusion_submitted',
    }

  return [update_plan, submit_conclusion]
