"""Logging guards for Builder App service modules."""

import logging
import os

_LOG_FORMAT = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'


def _desired_logger_level() -> int:
  """Use INFO by default, but honor DEBUG when the root logger is more verbose."""
  root_level = logging.getLogger().getEffectiveLevel()
  return root_level if root_level < logging.INFO else logging.INFO


def _has_file_handler(target_logger: logging.Logger, filename: str) -> bool:
  """Return True when a logger already writes to the given log file."""
  return any(
    isinstance(handler, logging.FileHandler)
    and getattr(handler, 'baseFilename', None) == filename
    for handler in target_logger.handlers
  )


def _attach_configured_file_handlers(target_logger: logging.Logger) -> None:
  """Attach configured file logging to a non-propagating logger."""
  root_logger = logging.getLogger()
  for handler in root_logger.handlers:
    if not isinstance(handler, logging.FileHandler):
      continue

    filename = getattr(handler, 'baseFilename', None)
    if filename and not _has_file_handler(target_logger, filename):
      target_logger.addHandler(handler)

  log_file = os.environ.get('BUILDER_APP_LOG_FILE')
  if log_file and not _has_file_handler(target_logger, log_file):
    file_handler = logging.FileHandler(log_file, encoding='utf-8')
    file_handler.setFormatter(logging.Formatter(_LOG_FORMAT))
    target_logger.addHandler(file_handler)


def ensure_logger_active(
  target_logger: logging.Logger,
  *,
  set_propagate_false: bool = False,
) -> None:
  """Re-enable a module logger and guarantee it has useful handlers.

  Uvicorn can reconfigure logging at startup and leave application module
  loggers disabled. Agent code may then run later with `disabled = True`, so
  normal `logger.info()` calls silently disappear from both stderr and the
  timestamped file log. This helper restores the logger level and handlers.
  """
  target_logger.disabled = False
  target_logger.setLevel(_desired_logger_level())
  if not target_logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter(_LOG_FORMAT))
    target_logger.addHandler(handler)
  if set_propagate_false:
    _attach_configured_file_handlers(target_logger)
    target_logger.propagate = False
