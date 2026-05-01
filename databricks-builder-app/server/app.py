"""FastAPI app for the Claude Code MCP application."""

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

# Configure logging BEFORE importing other modules.
# Mirror to a timestamped file so background-thread agent runs can be inspected
# after the server process exits.
_LOG_FORMAT = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
_LOG_DIR = Path(__file__).resolve().parent.parent / 'logs'
_LOG_DIR.mkdir(parents=True, exist_ok=True)
_LOG_FILE = _LOG_DIR / f'server_{datetime.now().strftime("%Y%m%d_%H%M%S")}.log'
os.environ['BUILDER_APP_LOG_FILE'] = str(_LOG_FILE)


def _parse_log_level(value: str | None) -> int | None:
  """Parse a standard logging level name or number."""
  if not value:
    return None
  value = value.strip()
  if value.isdigit():
    return int(value)
  level = getattr(logging, value.upper(), None)
  return level if isinstance(level, int) else None


_root_logger = logging.getLogger()
_explicit_log_level = _parse_log_level(
  os.environ.get('BUILDER_APP_LOG_LEVEL') or os.environ.get('LOG_LEVEL')
)
_root_level = _explicit_log_level or (
  _root_logger.getEffectiveLevel()
  if _root_logger.getEffectiveLevel() < logging.INFO
  else logging.INFO
)

_log_formatter = logging.Formatter(_LOG_FORMAT)
_stream_handler = logging.StreamHandler()
_stream_handler.setFormatter(_log_formatter)
_stream_handler.setLevel(_root_level)
_file_handler = logging.FileHandler(_LOG_FILE, encoding='utf-8')
_file_handler.setFormatter(_log_formatter)
_file_handler.setLevel(_root_level)


def _ensure_root_logging_handlers() -> None:
  """Keep root logging level and app handlers intact after server reconfiguration."""
  _root_logger.setLevel(_root_level)
  if not any(
    isinstance(handler, logging.FileHandler)
    and Path(handler.baseFilename) == _LOG_FILE
    for handler in _root_logger.handlers
  ):
    _root_logger.addHandler(_file_handler)
  if not any(
    isinstance(handler, logging.StreamHandler)
    and not isinstance(handler, logging.FileHandler)
    for handler in _root_logger.handlers
  ):
    _root_logger.addHandler(_stream_handler)


logging.basicConfig(
  level=_root_level,
  format=_LOG_FORMAT,
  handlers=[
    _stream_handler,
    _file_handler,
  ],
)

_ensure_root_logging_handlers()
logging.getLogger(__name__).info(f'Logging to {_LOG_FILE}')

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.cors import CORSMiddleware

from .db import is_postgres_configured, is_dynamic_token_mode, run_migrations, init_database, start_token_refresh, stop_token_refresh
from .routers import agent_router, clusters_router, config_router, conversations_router, projects_router, skills_router, warehouses_router
from .services.backup_manager import start_backup_worker, stop_backup_worker
from .services.skills_manager import copy_skills_to_app

logger = logging.getLogger(__name__)


def _ensure_app_loggers_active() -> None:
  """Undo Uvicorn disabling or raising levels on application loggers."""
  _ensure_root_logging_handlers()
  prefixes = ('server', 'databricks_tools_core', 'databricks_mcp_server')
  logger_dict = logging.Logger.manager.loggerDict
  for name, candidate in logger_dict.items():
    if not isinstance(candidate, logging.Logger):
      continue
    if not any(name == prefix or name.startswith(f'{prefix}.') for prefix in prefixes):
      continue
    candidate.disabled = False
    if candidate.level == logging.NOTSET or candidate.level > _root_level:
      candidate.setLevel(_root_level)


_ensure_app_loggers_active()

# Load environment variables
env_local_loaded = load_dotenv(dotenv_path='.env.local')
env = os.getenv('ENV', 'development' if env_local_loaded else 'production')

if env_local_loaded:
  logger.info(f'Loaded .env.local (ENV={env})')
else:
  logger.info(f'Using system environment variables (ENV={env})')


# MCP Gateway state — populated at module level if enabled, used in lifespan
_mcp_asgi_app = None  # Inner FastMCP ASGI app (needs lifespan management)
_mcp_lifespan_task = None
_mcp_shutdown_event = None


@asynccontextmanager
async def lifespan(app: FastAPI):
  """Async lifespan context manager for startup/shutdown events."""
  global _mcp_lifespan_task, _mcp_shutdown_event

  _ensure_app_loggers_active()
  logger.info('Starting application...')

  # Copy skills from databricks-skills to local cache
  copy_skills_to_app()

  # Initialize database if configured
  db_initialized = False
  if is_postgres_configured():
    logger.info('Initializing database...')
    try:
      init_database()
      db_initialized = True

      # Start token refresh for dynamic OAuth mode (Databricks Apps)
      if is_dynamic_token_mode():
        await start_token_refresh()

      # Run migrations in background thread (non-blocking)
      asyncio.create_task(asyncio.to_thread(run_migrations))

      # Start backup worker
      start_backup_worker()
    except Exception as e:
      logger.warning(
        f'Database initialization failed: {e}\n'
        'App will continue without database features (conversations won\'t be persisted).'
      )
  else:
    logger.warning(
      'Database not configured. Set either:\n'
      '  - LAKEBASE_PG_URL (static URL with password), or\n'
      '  - LAKEBASE_ENDPOINT and LAKEBASE_DATABASE_NAME (autoscale, dynamic OAuth), or\n'
      '  - LAKEBASE_INSTANCE_NAME and LAKEBASE_DATABASE_NAME (provisioned, dynamic OAuth)'
    )

  # Start MCP Gateway lifespan (initializes StreamableHTTPSessionManager)
  if _mcp_asgi_app is not None:
    try:
      from .mcp_gateway import start_mcp_lifespan
      _mcp_lifespan_task, _mcp_shutdown_event = await start_mcp_lifespan(_mcp_asgi_app)
    except Exception as e:
      logger.warning(f'MCP Gateway lifespan failed to start: {e}')

  yield

  logger.info('Shutting down application...')

  # Stop MCP Gateway lifespan
  if _mcp_lifespan_task is not None:
    try:
      from .mcp_gateway import stop_mcp_lifespan
      await stop_mcp_lifespan(_mcp_lifespan_task, _mcp_shutdown_event)
    except Exception as e:
      logger.warning(f'MCP Gateway lifespan shutdown error: {e}')

  # Stop token refresh if running
  await stop_token_refresh()

  stop_backup_worker()


app = FastAPI(
  title='Claude Code MCP App',
  description='Project-based Claude Code agent application',
  lifespan=lifespan,
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
  """Log all unhandled exceptions."""
  logger.exception(f'Unhandled exception for {request.method} {request.url}: {exc}')
  return JSONResponse(
    status_code=500,
    content={'detail': 'Internal Server Error', 'error': str(exc)},
  )


# Configure CORS
allowed_origins = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'] if env == 'development' else []
logger.info(f'CORS allowed origins: {allowed_origins}')

app.add_middleware(
  CORSMiddleware,
  allow_origins=allowed_origins,
  allow_credentials=True,
  allow_methods=['*'],
  allow_headers=['*'],
)

API_PREFIX = '/api'

# Include routers
app.include_router(config_router, prefix=f'{API_PREFIX}/config', tags=['configuration'])
app.include_router(clusters_router, prefix=API_PREFIX, tags=['clusters'])
app.include_router(warehouses_router, prefix=API_PREFIX, tags=['warehouses'])
app.include_router(projects_router, prefix=API_PREFIX, tags=['projects'])
app.include_router(conversations_router, prefix=API_PREFIX, tags=['conversations'])
app.include_router(agent_router, prefix=API_PREFIX, tags=['agent'])
app.include_router(skills_router, prefix=API_PREFIX, tags=['skills'])

# Production: Serve Vite static build
# Check multiple possible locations for the frontend build
_app_root = Path(__file__).parent.parent  # server/app.py -> app root
_possible_build_paths = [
  _app_root / 'client/out',  # Standard location relative to app root
  Path('.') / 'client/out',  # Relative to working directory
  Path('/app/python/source_code') / 'client/out',  # Databricks Apps location
]

build_path = None
for path in _possible_build_paths:
  if path.exists():
    build_path = path
    break

if build_path:
  logger.info(f'Serving static files from {build_path}')
  index_html = build_path / 'index.html'

  # SPA fallback: catch 404s from static files and serve index.html for client-side routing
  # This must be defined BEFORE mounting static files
  @app.exception_handler(StarletteHTTPException)
  async def spa_fallback(request: Request, exc: StarletteHTTPException):
    # Only handle 404s for non-API routes (and non-MCP routes)
    if exc.status_code == 404 and not request.url.path.startswith(('/api', '/mcp')):
      return FileResponse(index_html)
    # For API/MCP 404s or other errors, return JSON
    return JSONResponse(
      status_code=exc.status_code,
      content={'detail': exc.detail},
    )

  app.mount('/', StaticFiles(directory=str(build_path), html=True), name='static')
else:
  logger.warning(
    f'Build directory not found in any of: {[str(p) for p in _possible_build_paths]}. '
    'In development, run Vite separately: cd client && pnpm dev'
  )

# ---------------------------------------------------------------------------
# MCP Gateway (optional — enabled via ENABLE_MCP_GATEWAY=true)
#
# When enabled, the builder app also serves as an MCP server at /mcp,
# exposing all Databricks tools to Genie Code, AI Playground, and other
# MCP clients.  Requests to /mcp* are routed to a standalone ASGI sub-app
# with its own permissive CORS, bypassing the main app's middleware.
#
# The gateway's MCP ASGI app needs lifespan events to initialize its
# StreamableHTTPSessionManager.  We start it inside FastAPI's lifespan
# (see above) via synthetic ASGI lifespan events.
#
# Disabled by default; does not affect local development or standard deploys.
# ---------------------------------------------------------------------------

_enable_mcp_gateway = os.getenv('ENABLE_MCP_GATEWAY', '').lower() == 'true'

if _enable_mcp_gateway:
  logger.info('MCP Gateway enabled — mounting at /mcp')
  try:
    from .mcp_gateway import create_mcp_gateway

    _mcp_gateway_wrapped, _mcp_asgi_app = create_mcp_gateway()

    # Store reference so the ASGI wrapper can delegate
    _fastapi_app = app

    async def _app_with_mcp_gateway(scope, receive, send):
      """Root ASGI app that routes /mcp* to the MCP gateway.

      We intercept at the ASGI level (before FastAPI's middleware stack)
      so the gateway gets its own permissive CORS instead of the main
      app's restricted policy.

      Unlike the previous version, we do NOT strip /mcp — the gateway
      handles /mcp* paths directly (matching the reference MCP app).
      Lifespan events go to FastAPI; the MCP app's lifespan is managed
      separately via start_mcp_lifespan() in FastAPI's lifespan handler.
      """
      if scope['type'] == 'lifespan':
        await _fastapi_app(scope, receive, send)
      elif scope['type'] in ('http', 'websocket') and scope.get('path', '').startswith('/mcp'):
        await _mcp_gateway_wrapped(scope, receive, send)
      else:
        await _fastapi_app(scope, receive, send)

    # Replace module-level app with the routing wrapper.
    # uvicorn imports server.app:app — it accepts any ASGI3 callable.
    app = _app_with_mcp_gateway  # type: ignore[assignment]
    logger.info('MCP Gateway mounted at /mcp')
  except Exception:
    logger.exception('Failed to initialize MCP Gateway — continuing without it')
else:
  logger.info('MCP Gateway disabled (set ENABLE_MCP_GATEWAY=true to enable)')
