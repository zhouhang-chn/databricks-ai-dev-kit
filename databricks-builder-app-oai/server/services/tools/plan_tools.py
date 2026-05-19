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
    Subsequent `op='create'` calls are treated as starting the first known
    step. The duplicate call still produces a `plan.created` UI event, but the
    runtime dedups identical re-emissions within the same story and emits the
    auto-start from the tool output.
  - `submit_conclusion` must be called exactly once and is the terminal
    action of the run. Subsequent calls return a redirect that tells the
    model the run is finished.
"""

from typing import Literal

from .run_state import AgentToolRunState

PLAN_TOOL_NAMES = frozenset({'update_plan', 'submit_conclusion'})


def _first_step_id(steps: list[dict] | None) -> str:
  """Return the first plan step id, falling back to the canonical id."""
  if not steps:
    return 'step-1'
  first = steps[0]
  if isinstance(first, dict):
    step_id = first.get('id') or first.get('step_id')
    if step_id:
      return str(step_id)
  return 'step-1'


def create_plan_tools(run_state: AgentToolRunState | None = None) -> list:
  """Build a fresh `update_plan` + `submit_conclusion` pair for one run.

  The closure state is per-call, so each agent run gets independent
  bookkeeping — module-level state would leak between concurrent requests.
  """
  from agents import function_tool

  state = {
    'plan_created': False,
    'conclusion_submitted': False,
    'first_step_id': 'step-1',
  }

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
        first_step_id = str(state.get('first_step_id') or _first_step_id(steps))
        return {
          'is_error': True,
          'error': 'plan_already_exists',
          'message': (
            'A plan was already created in this run. Do NOT call '
            'update_plan(op="create") again — duplicate creates are rejected '
            'and waste a turn from the run budget. To begin executing the '
            f'plan, call update_plan(op="start", step_id="{first_step_id}", '
            'narrative="..."). To change the plan, call '
            'update_plan(op="revise", steps=[...], reason="...").'
          ),
          'next_action_required': (
            f'update_plan(op="start", step_id="{first_step_id}", narrative="...")'
          ),
        }
      state['plan_created'] = True
      state['first_step_id'] = _first_step_id(steps)
      if run_state:
        run_state.plan_created = True
      return {
        'op': 'create',
        'objective': objective or '',
        'steps': steps or [],
        'ack': 'plan_created',
      }
    if op == 'start':
      effective_step_id = step_id or str(state.get('first_step_id') or 'step-1')
      if run_state:
        run_state.active_step_id = effective_step_id
      return {
        'op': 'start',
        'step_id': effective_step_id,
        'narrative': narrative or '',
        'ack': 'step_started',
      }
    if op == 'finish':
      if run_state:
        run_state.active_step_id = None
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
      state['first_step_id'] = _first_step_id(steps)
      if run_state:
        run_state.plan_created = True
        run_state.active_step_id = None
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
    claim: str | None = None,
    primary_evidence_id: str | None = None,
    insight: str | None = None,
    caveat: str | None = None,
    confidence: Literal['high', 'medium', 'low'] | None = None,
    recommended_next_step: str | None = None,
    has_contradiction: bool | None = None,
    visualizations: list[dict] | None = None,
  ) -> dict:
    """Submit the final synthesis instead of a regular markdown response.

    Call this exactly once when all plan steps are complete. This is the
    terminal action of the run — do not run additional tools afterward.
    Persist any approved project-file updates BEFORE calling submit_conclusion.
    Visualization specs should describe the analytical purpose and main-story
    placement. Use display_in_story=True only for charts that directly support
    the conclusion.
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
    payload = {
      'summary': summary,
      'highlights': highlights or [],
      'next_steps': next_steps or [],
      'ack': 'conclusion_submitted',
    }
    if claim:
      payload['claim'] = claim
    if primary_evidence_id:
      payload['primary_evidence_id'] = primary_evidence_id
    if insight:
      payload['insight'] = insight
    if caveat:
      payload['caveat'] = caveat
    if confidence:
      payload['confidence'] = confidence
    if recommended_next_step:
      payload['recommended_next_step'] = recommended_next_step
    if has_contradiction is not None:
      payload['has_contradiction'] = bool(has_contradiction)
    if visualizations:
      payload['visualizations'] = visualizations
    return payload

  return [update_plan, submit_conclusion]
