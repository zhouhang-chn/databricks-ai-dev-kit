"""MLflow tracing setup for the OpenAI Agents SDK runtime.

When ``MLFLOW_EXPERIMENT_NAME`` is set we configure ``mlflow.openai.autolog()``,
which registers an MLflow trace processor with the Agents SDK. Without this
call the Agents SDK never emits spans to MLflow, regardless of what
``MLFLOW_TRACKING_URI`` / ``MLFLOW_EXPERIMENT_NAME`` say.
"""

import logging
import os
import threading

logger = logging.getLogger(__name__)

_setup_lock = threading.Lock()
_setup_done = False
_setup_succeeded = False


def is_mlflow_tracing_configured() -> bool:
  """True when env requests MLflow tracing (experiment name is the trigger)."""
  return bool(os.environ.get('MLFLOW_EXPERIMENT_NAME'))


def is_mlflow_tracing_active() -> bool:
  """True when ``setup_mlflow_tracing`` has been called and succeeded."""
  return _setup_succeeded


def setup_mlflow_tracing() -> bool:
  """Configure MLflow tracking + Agents SDK autolog. Idempotent."""
  global _setup_done, _setup_succeeded
  with _setup_lock:
    if _setup_done:
      return _setup_succeeded
    _setup_done = True

    if not is_mlflow_tracing_configured():
      logger.info('MLflow tracing not configured (MLFLOW_EXPERIMENT_NAME unset)')
      return False

    tracking_uri = os.environ.get('MLFLOW_TRACKING_URI', 'databricks')
    experiment = os.environ['MLFLOW_EXPERIMENT_NAME']
    try:
      import mlflow

      mlflow.set_tracking_uri(tracking_uri)
      mlflow.set_experiment(experiment)
      mlflow.openai.autolog()
      logger.info(
        'MLflow tracing enabled: tracking_uri=%s experiment=%s',
        tracking_uri,
        experiment,
      )
      _setup_succeeded = True
      return True
    except Exception:
      logger.exception(
        'Failed to enable MLflow tracing (tracking_uri=%s experiment=%s) — '
        'continuing without it',
        tracking_uri,
        experiment,
      )
      return False
