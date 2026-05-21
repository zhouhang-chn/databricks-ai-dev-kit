"""Warning filters for known OpenAI Agents SDK dependency noise."""

import warnings


def suppress_known_agents_dependency_warnings() -> None:
  """Suppress benign import-time warnings from transitive Agents SDK packages."""
  try:
    from beartype.roar import BeartypeClawDecorWarning
  except Exception:
    warning_category: type[Warning] = Warning
  else:
    warning_category = BeartypeClawDecorWarning

  warnings.filterwarnings(
    'ignore',
    message=(
      r'Coroutine factory method '
      r'key_value\.aio\.stores\.base\.BaseContextManagerStore\.__aenter__\(\).*'
      r'not decoratable by @beartype.*'
    ),
    category=warning_category,
  )
