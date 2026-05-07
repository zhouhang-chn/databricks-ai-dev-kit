"""Tests for small agent-route persistence helpers."""

from server.routers.agent import _answer_text_for_run, _synthesis_summary_from_event


def test_synthesis_summary_is_extracted_from_structured_event():
  """submit_conclusion summary should be available for durable persistence."""
  summary = _synthesis_summary_from_event({
    'type': 'synthesis.appended',
    'summary': '  Revenue increased 12% after filtering to active accounts.  ',
    'highlights': [{'label': 'Growth', 'value': '12%'}],
  })

  assert summary == 'Revenue increased 12% after filtering to active accounts.'


def test_synthesis_summary_is_ignored_for_other_events():
  """Only synthesis events should influence final answer fallback text."""
  summary = _synthesis_summary_from_event({
    'type': 'plan.step_finished',
    'summary': 'Not an answer',
  })

  assert summary == ''


def test_answer_text_prefers_streamed_text_when_present():
  """Normal assistant text stays canonical when it exists."""
  answer = _answer_text_for_run('Detailed answer\n', 'Structured summary')

  assert answer == 'Detailed answer\n'


def test_answer_text_falls_back_to_structured_synthesis():
  """A submit_conclusion-only run still gets persisted and sent to Next Moves."""
  answer = _answer_text_for_run('', 'Structured summary')

  assert answer == 'Structured summary'
