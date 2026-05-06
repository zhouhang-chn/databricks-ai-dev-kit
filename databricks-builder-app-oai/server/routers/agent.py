"""OpenAI agent invocation endpoints.

Handles async streaming responses from OpenAI agent sessions with SSE.

The async pattern:
1. POST /invoke_agent - Starts agent, returns execution_id immediately
2. POST /stream_progress/{execution_id} - SSE stream of events (50-second windows)
3. POST /stop_stream/{execution_id} - Cancel execution
"""

import asyncio
import json
import logging
import time
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..project_config import build_project_context, get_project_resource_defaults
from ..services.active_stream import get_stream_manager
from ..services.agent import get_project_directory, stream_agent_response
from ..services.backup_manager import mark_for_backup
from ..services.logging_utils import ensure_logger_active
from ..services.next_moves import (
    NextMoveContext,
    NextMoveTraceStep,
    generate_next_moves,
    summarize_evidence_content,
)
from ..services.storage import ConversationStorage, ProjectStorage
from ..services.title_generator import generate_title_async
from ..services.user import get_current_token, get_current_user, get_workspace_url

logger = logging.getLogger(__name__)
ensure_logger_active(logger, set_propagate_false=True)
router = APIRouter()

# SSE streaming window duration (seconds) - break before 60s timeout
SSE_WINDOW_SECONDS = 50


def sse_event(data: dict) -> str:
    """Format data as SSE event."""
    return f'data: {json.dumps(data)}\n\n'


def _recent_messages_for_next_moves(conversation, latest_message: str) -> list[dict[str, str]]:
    """Build a compact recent-message list without exposing database models."""
    messages = []
    for message in list(getattr(conversation, 'messages', []) or [])[-6:]:
        role = getattr(message, 'role', '')
        content = getattr(message, 'content', '')
        if role and content:
            messages.append({'role': str(role), 'content': str(content)[:1000]})
    messages.append({'role': 'user', 'content': latest_message[:1000]})
    return messages


def _project_context_section(project_context: dict, key: str) -> dict:
    """Return a dict section from the project context settings."""
    settings = project_context.get('settings')
    if not isinstance(settings, dict):
        return {}
    section = settings.get(key)
    return section if isinstance(section, dict) else {}


class InvokeAgentRequest(BaseModel):
    """Request to invoke the OpenAI agent runtime."""

    project_id: str
    conversation_id: Optional[str] = None  # Will create new if not provided
    message: str
    cluster_id: Optional[str] = None  # Databricks cluster for code execution
    default_catalog: Optional[str] = None  # Default Unity Catalog
    default_schema: Optional[str] = None  # Default schema
    warehouse_id: Optional[str] = None  # Databricks SQL warehouse for queries
    workspace_folder: Optional[str] = None  # Workspace folder for file uploads
    mlflow_experiment_name: Optional[str] = None  # MLflow experiment name for tracing
    run_role: Optional[str] = None  # developer, user_preview, user, or viewer
    target_databricks_host: Optional[str] = None  # Target workspace URL for cross-workspace ops
    target_databricks_token: Optional[str] = None  # Pre-generated OAuth token for target workspace


class InvokeAgentResponse(BaseModel):
    """Response from invoke_agent with execution tracking info."""

    execution_id: str
    conversation_id: str


class StreamProgressRequest(BaseModel):
    """Request to stream progress from an active execution."""

    last_event_timestamp: Optional[float] = None


class StopStreamResponse(BaseModel):
    """Response from stop_stream endpoint."""

    success: bool
    message: str


@router.post('/invoke_agent', response_model=InvokeAgentResponse)
async def invoke_agent(request: Request, body: InvokeAgentRequest):
    """Start the OpenAI agent asynchronously.

    Creates a new conversation if conversation_id is not provided.
    Returns execution_id immediately for streaming progress.

    The agent runs in the background and events are accumulated.
    Use POST /stream_progress/{execution_id} to stream events via SSE.
    Use POST /stop_stream/{execution_id} to cancel execution.
    """
    ensure_logger_active(logger, set_propagate_false=True)
    logger.info(
        f'Invoking agent for project: {body.project_id}, conversation: {body.conversation_id}'
    )

    # Get current user and Databricks auth for Databricks tool operations.
    user_email = await get_current_user(request)
    user_token = await get_current_token(request)
    workspace_url = get_workspace_url()

    # Databricks tool operations target the caller-specified workspace when
    # cross-workspace params are provided, otherwise default to this workspace
    is_cross_workspace = body.target_databricks_host is not None
    tools_host = body.target_databricks_host or workspace_url
    tools_token = body.target_databricks_token or user_token

    # Verify project exists and belongs to user
    project_storage = ProjectStorage(user_email)
    project = await project_storage.get(body.project_id)
    if not project:
        logger.error(f'Project not found: {body.project_id}')
        raise HTTPException(status_code=404, detail=f'Project not found: {body.project_id}')

    run_role = body.run_role or 'developer'
    project_defaults = get_project_resource_defaults(project, run_role=run_role)
    effective_cluster_id = body.cluster_id or project_defaults.get('cluster_id')
    effective_default_catalog = body.default_catalog or project_defaults.get('default_catalog')
    effective_default_schema = body.default_schema or project_defaults.get('default_schema')
    effective_warehouse_id = body.warehouse_id or project_defaults.get('warehouse_id')
    effective_workspace_folder = body.workspace_folder or project_defaults.get('workspace_folder')
    effective_mlflow_experiment_name = (
        body.mlflow_experiment_name or project_defaults.get('mlflow_experiment_name')
    )
    conversation_overrides = {
        'cluster_id': body.cluster_id,
        'default_catalog': body.default_catalog,
        'default_schema': body.default_schema,
        'warehouse_id': body.warehouse_id,
        'workspace_folder': body.workspace_folder,
        'mlflow_experiment_name': body.mlflow_experiment_name,
    }
    project_context = build_project_context(
        project,
        run_role=run_role,
        effective_resources={
            'cluster_id': effective_cluster_id,
            'default_catalog': effective_default_catalog,
            'default_schema': effective_default_schema,
            'warehouse_id': effective_warehouse_id,
            'workspace_folder': effective_workspace_folder,
            'mlflow_experiment_name': effective_mlflow_experiment_name,
        },
        conversation_overrides=conversation_overrides,
    )
    logger.info(
        'Resolved project context: project=%s type=%s status=%s release=%s role=%s '
        'source=%s resources=%s',
        body.project_id,
        project_context.get('project_type'),
        project_context.get('status'),
        project_context.get('release_id'),
        project_context.get('role'),
        project_context.get('settings_source'),
        project_context.get('effective_resources'),
    )

    # Read enabled skills from project filesystem (not DB)
    from ..services.skills_manager import get_project_enabled_skills
    project_dir = get_project_directory(body.project_id)
    enabled_skills = get_project_enabled_skills(project_dir)

    # Get or create conversation
    conv_storage = ConversationStorage(user_email, body.project_id)
    conversation_id = body.conversation_id

    if not conversation_id:
        # Create new conversation with temporary title (will be updated by AI)
        temp_title = body.message[:40].strip()
        if len(body.message) > 40:
            temp_title = temp_title.rsplit(' ', 1)[0] + '...'
        conversation = await conv_storage.create(title=temp_title)
        conversation_id = conversation.id
        logger.info(f'Created new conversation: {conversation_id}')

        # Generate AI title in the background (fire-and-forget).
        # Title generation uses OPENAI_* model configuration, not Databricks auth.
        asyncio.create_task(
            generate_title_async(
                message=body.message,
                conversation_id=conversation_id,
                user_email=user_email,
                project_id=body.project_id,
            )
        )
    else:
        # Verify conversation exists and get session_id for resumption
        conversation = await conv_storage.get(conversation_id)
        if not conversation:
            logger.error(f'Conversation not found: {conversation_id}')
            raise HTTPException(
                status_code=404,
                detail=f'Conversation not found: {conversation_id}',
            )

    # Get session_id from conversation for resumption
    session_id = conversation.session_id if conversation else None

    # Create active stream with user_email for persistence
    stream_manager = get_stream_manager()
    stream = await stream_manager.create_stream(
        project_id=body.project_id,
        conversation_id=conversation_id,
        user_email=user_email,
    )
    story_id = f'story-{stream.execution_id}'
    stream.event_metadata = {
        'project_id': body.project_id,
        'conversation_id': conversation_id,
        'execution_id': stream.execution_id,
        'story_id': story_id,
    }

    def stream_event(event_data: dict) -> dict:
        """Attach stable run metadata to every persisted/SSE event."""
        enriched = dict(event_data)
        enriched.setdefault('project_id', body.project_id)
        enriched.setdefault('conversation_id', conversation_id)
        enriched.setdefault('execution_id', stream.execution_id)
        enriched.setdefault('story_id', story_id)
        return enriched

    def emit(event_data: dict) -> None:
        """Add a metadata-enriched event to the active stream."""
        trace_id = event_data.get('trace_id')
        if trace_id:
            stream.event_metadata.setdefault('trace_id', trace_id)
        stream.add_event(stream_event(event_data))

    # Emit conversation_id as first event
    emit({'type': 'conversation.created', 'conversation_id': conversation_id})
    emit({
        'type': 'story.created',
        'question_preview': body.message[:500],
        'context': {
            'project_id': body.project_id,
            'conversation_id': conversation_id,
            'run_role': run_role,
            'resources': project_context.get('effective_resources'),
        },
    })

    # Create the agent coroutine that will run in background
    async def run_agent():
        """Run the agent and accumulate events in the stream."""
        final_text = ''
        new_session_id: Optional[str] = None
        error_message: Optional[str] = None
        received_deltas = False  # Track if we received streaming deltas
        tool_started_at: dict[str, float] = {}
        trace_steps: list[NextMoveTraceStep] = []
        trace_steps_by_tool_id: dict[str, NextMoveTraceStep] = {}
        tool_calls_by_id: dict[str, dict[str, Any]] = {}
        evidence_summaries: list[str] = []

        try:
            # Stream all events from the OpenAI runtime.
            # Pass a cancellation check function so the agent thread can stop early
            async for event in stream_agent_response(
                project_id=body.project_id,
                message=body.message,
                conversation_id=conversation_id,
                session_id=session_id,
                cluster_id=effective_cluster_id,
                default_catalog=effective_default_catalog,
                default_schema=effective_default_schema,
                warehouse_id=effective_warehouse_id,
                workspace_folder=effective_workspace_folder,
                databricks_host=tools_host,
                databricks_token=tools_token,
                is_cross_workspace=is_cross_workspace,
                is_cancelled_fn=lambda: stream.is_cancelled,
                enabled_skills=enabled_skills,
                mlflow_experiment_name=effective_mlflow_experiment_name,
                project_context=project_context,
                execution_id=stream.execution_id,
                story_id=story_id,
            ):
                # Check if cancelled (also checked in agent thread, but double-check here)
                if stream.is_cancelled:
                    logger.info(f'Stream {stream.execution_id} cancelled, stopping agent')
                    break

                event_type = event.get('type', '')

                if event_type == 'text_delta':
                    # Token-by-token streaming - this is preferred
                    text = event.get('text', '')
                    final_text += text
                    received_deltas = True
                    emit({'type': 'text_delta', 'text': text})

                elif event_type == 'text':
                    # Complete text block - accumulate all text blocks
                    # Agents can send multiple text blocks when tool calls happen in between.
                    # We track received_deltas to know if we should also emit text events
                    # (if deltas are being used, the client already has the text token-by-token)
                    text = event.get('text', '')
                    if text:
                        if not received_deltas:
                            # No deltas received, so send complete text blocks to client
                            final_text += text
                            emit({'type': 'text', 'text': text})
                        # Note: If received_deltas is True, we skip sending 'text' events
                        # because the client already received the same content via 'text_delta'
                        # BUT we still need to track final_text for persistence
                        # The text_delta handler already accumulates to final_text

                elif event_type == 'thinking':
                    emit({
                        'type': 'thinking',
                        'thinking': event.get('thinking', ''),
                    })

                elif event_type == 'tool_use':
                    tool_id = str(event.get('tool_id', ''))
                    tool_name = event.get('tool_name', '')
                    tool_input = event.get('tool_input', {})
                    trace_step = NextMoveTraceStep(
                        tool_name=str(tool_name or 'tool'),
                        status='running',
                        summary=summarize_evidence_content(tool_input),
                    )
                    trace_steps.append(trace_step)
                    if tool_id:
                        tool_started_at[tool_id] = time.time()
                        trace_steps_by_tool_id[tool_id] = trace_step
                        tool_calls_by_id[tool_id] = {
                            'tool_name': str(tool_name or 'tool'),
                            'tool_input': tool_input,
                        }

                    emit({
                        'type': 'tool_use',
                        'tool_id': tool_id,
                        'tool_name': tool_name,
                        'tool_input': tool_input,
                    })

                    # Emit dedicated todos event when TodoWrite is called
                    if (
                        tool_name == 'TodoWrite'
                        and isinstance(tool_input, dict)
                        and 'todos' in tool_input
                    ):
                        emit({
                            'type': 'todos',
                            'todos': tool_input['todos'],
                        })

                elif event_type == 'tool_result':
                    tool_use_id = str(event.get('tool_use_id', ''))
                    content = event.get('content', '')
                    is_error = event.get('is_error', False)
                    started = tool_started_at.pop(tool_use_id, None)
                    duration_ms = int((time.time() - started) * 1000) if started else None
                    summary = summarize_evidence_content(content, is_error=bool(is_error))
                    evidence_summaries.append(summary)
                    trace_step = trace_steps_by_tool_id.pop(tool_use_id, None)
                    if trace_step:
                        trace_step.status = 'error' if is_error else 'done'
                        trace_step.summary = summary
                        trace_step.duration_ms = duration_ms

                    # Detect cascade failure pattern - "Stream closed" errors indicate
                    # the internal tool connection is broken.
                    if is_error and 'Stream closed' in str(content):
                        logger.error(f'Detected MCP connection failure: {content}')
                        # Add context to the error
                        content = (
                            'Tool Connection Lost: The tool execution was interrupted '
                            'because the internal communication channel broke. This '
                            'usually happens after a long-running operation. Please '
                            'start a new message to reset the run. Original error: '
                            f'{content}'
                        )

                    tool_call = tool_calls_by_id.pop(tool_use_id, {}) if tool_use_id else {}
                    emit({
                        'type': 'tool_result',
                        'tool_use_id': tool_use_id,
                        'tool_name': tool_call.get('tool_name'),
                        'tool_input': tool_call.get('tool_input'),
                        'content': content,
                        'is_error': is_error,
                        'duration_ms': duration_ms,
                    })

                elif event_type == 'result':
                    new_session_id = event.get('session_id')
                    emit({
                        'type': 'result',
                        'session_id': new_session_id,
                        'duration_ms': event.get('duration_ms'),
                        'total_cost_usd': event.get('total_cost_usd'),
                        'is_error': event.get('is_error', False),
                        'num_turns': event.get('num_turns'),
                        'trace_id': event.get('trace_id'),
                    })

                elif event_type == 'error':
                    error_message = event.get('error', 'Unknown error')
                    logger.error(f'Agent error received: {error_message}')
                    emit({
                        'type': 'error',
                        'error': error_message,
                        'trace_id': event.get('trace_id'),
                    })

                elif event_type == 'system':
                    # Extract session_id from init event if not already set
                    data = event.get('data')
                    if event.get('subtype') == 'init' and data and not new_session_id:
                        new_session_id = data.get('session_id')
                    emit({
                        'type': 'system',
                        'subtype': event.get('subtype', ''),
                        'data': data,
                        'trace_id': event.get('trace_id'),
                    })

                elif event_type == 'cancelled':
                    # Agent was cancelled by user request
                    logger.info(f'Stream {stream.execution_id} received cancellation confirmation')
                    emit({'type': 'cancelled'})
                    break

                elif event_type == 'keepalive':
                    # Keepalive during long tool execution; forward to the UI stream.
                    elapsed = event.get('elapsed_since_last_event', 0)
                    logger.debug(
                        f'Stream {stream.execution_id} keepalive - '
                        f'{elapsed:.0f}s since last event'
                    )
                    emit({
                        'type': 'keepalive',
                        'elapsed_since_last_event': elapsed,
                    })

        except Exception as e:
            import traceback
            error_details = traceback.format_exc()
            logger.error(f'Error during agent stream: {type(e).__name__}: {e}')
            logger.error(f'Agent stream traceback:\n{error_details}')
            print(f'[AGENT STREAM ERROR] {type(e).__name__}: {e}', flush=True)
            print(f'[AGENT STREAM TRACEBACK]\n{error_details}', flush=True)

            # Provide more context for common errors
            error_message = str(e)
            if 'Stream closed' in error_message:
                error_message = (
                    f'Agent communication interrupted: {error_message}. '
                    'Check backend logs for details.'
                )

            emit({'type': 'error', 'error': error_message})

        if not stream.is_cancelled:
            try:
                next_move_generation = await generate_next_moves(
                    NextMoveContext(
                        project_id=body.project_id,
                        conversation_id=conversation_id,
                        execution_id=stream.execution_id,
                        story_id=story_id,
                        run_role=run_role,
                        project_type=str(project_context.get('project_type') or ''),
                        project_status=str(project_context.get('status') or ''),
                        release_id=str(project_context.get('release_id') or ''),
                        question=body.message,
                        answer=final_text,
                        error=error_message,
                        recent_messages=_recent_messages_for_next_moves(
                            conversation,
                            body.message,
                        ),
                        trace_steps=trace_steps,
                        evidence_summaries=evidence_summaries,
                        effective_resources=dict(
                            project_context.get('effective_resources') or {}
                        ),
                        semantic_context=_project_context_section(project_context, 'semantics'),
                        workflow_context=_project_context_section(project_context, 'workflows'),
                        memory_context=_project_context_section(project_context, 'memory'),
                    )
                )
                emit({
                    'type': 'next_moves.updated',
                    'moves': [
                        move.to_event_dict()
                        for move in next_move_generation.moves
                    ],
                    **next_move_generation.event_metadata(),
                })
            except Exception as e:
                logger.warning('Failed to generate next moves: %s', e, exc_info=True)

        # Save messages to storage after stream completes (if not cancelled)
        if not stream.is_cancelled:
            try:
                # Save user message
                await conv_storage.add_message(
                    conversation_id=conversation_id,
                    role='user',
                    content=body.message,
                )

                # Save assistant response (or error)
                if final_text or error_message:
                    content = final_text if final_text else f'Error: {error_message}'
                    is_error = bool(error_message)
                    logger.info(
                        f'Saving assistant message: {len(content)} chars, '
                        f'is_error={is_error}'
                    )
                    await conv_storage.add_message(
                        conversation_id=conversation_id,
                        role='assistant',
                        content=content,
                        is_error=is_error,
                    )
                else:
                    logger.warning('No response to save (no text and no error)')

                # Update session_id for conversation resumption
                if new_session_id:
                    await conv_storage.update_session_id(conversation_id, new_session_id)

                # Update cluster_id if provided
                if body.cluster_id:
                    await conv_storage.update_cluster_id(conversation_id, body.cluster_id)

                # Update catalog/schema if provided
                if body.default_catalog or body.default_schema:
                    await conv_storage.update_catalog_schema(
                        conversation_id, body.default_catalog, body.default_schema
                    )

                # Update warehouse_id if provided
                if body.warehouse_id:
                    await conv_storage.update_warehouse_id(conversation_id, body.warehouse_id)

                # Update workspace_folder if provided
                if body.workspace_folder:
                    await conv_storage.update_workspace_folder(
                        conversation_id,
                        body.workspace_folder,
                    )

                logger.info(
                    f'Saved messages to conversation {conversation_id}: '
                    f'text={len(final_text)} chars, error={error_message is not None}'
                )

                # Mark project for backup (will be processed by backup worker)
                mark_for_backup(body.project_id)

            except Exception as e:
                logger.error(f'Failed to save messages: {e}')

        # Mark stream as complete
        if error_message:
            stream.mark_error(error_message, emit_error_event=False)
        else:
            stream.mark_complete()

    # Start the agent in background
    await stream_manager.start_stream(stream, run_agent)

    return InvokeAgentResponse(
        execution_id=stream.execution_id,
        conversation_id=conversation_id,
    )


@router.post('/stream_progress/{execution_id}')
async def stream_progress(execution_id: str, body: StreamProgressRequest):
    """Stream events from an active execution via SSE.

    This endpoint streams events as Server-Sent Events (SSE).
    It runs for up to 50 seconds before sending a reconnect signal,
    allowing clients to reconnect before the 60-second HTTP timeout.

    Args:
        execution_id: The execution ID from invoke_agent
        body: Request body with last_event_timestamp for resuming

    Returns:
        SSE stream of events
    """
    ensure_logger_active(logger, set_propagate_false=True)
    stream_manager = get_stream_manager()
    stream = await stream_manager.get_stream(execution_id)
    logger.info(
        f'SSE stream_progress requested for {execution_id} '
        f'from cursor={body.last_event_timestamp or 0.0}'
    )

    if not stream:
        logger.error(
            f'Stream {execution_id} not found in memory; returning terminal SSE event'
        )

        async def missing_stream_events():
            """Tell the client the in-memory stream disappeared."""
            yield sse_event({
                'type': 'error',
                'execution_id': execution_id,
                'error': (
                    'Execution stream is no longer available. The backend server '
                    'may have restarted, so the in-memory agent process was '
                    'interrupted. Start a new message to continue.'
                ),
            })
            yield sse_event({
                'type': 'stream.completed',
                'execution_id': execution_id,
                'is_error': True,
                'is_cancelled': False,
            })
            yield 'data: [DONE]\n\n'

        return StreamingResponse(
            missing_stream_events(),
            media_type='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
            },
        )

    async def generate_events():
        """Generate SSE stream of events with 50-second window."""
        last_timestamp = body.last_event_timestamp or 0.0
        start_time = datetime.now()

        def stream_event(event_data: dict) -> dict:
            """Attach stream metadata to synthetic SSE control events."""
            enriched = dict(stream.event_metadata)
            enriched.update(event_data)
            enriched.setdefault('execution_id', execution_id)
            return enriched

        # Keep streaming until timeout or completion
        while True:
            # Get new events since last timestamp
            new_events, new_cursor = stream.get_events_since(last_timestamp)

            # Send new events
            for event in new_events:
                event_type = event.get('type')
                if event_type == 'error':
                    logger.error(f'SSE event for {execution_id}: {event}')
                else:
                    logger.debug(f'SSE event for {execution_id}: {event}')
                yield sse_event(event)

            # Update timestamp
            if new_events:
                last_timestamp = new_cursor

            # Check if stream is complete or cancelled
            if stream.is_complete or stream.is_cancelled:
                logger.info(
                    f'SSE stream_progress completing for {execution_id}: '
                    f'is_error={stream.error is not None}, is_cancelled={stream.is_cancelled}'
                )
                # Drain any events added between last poll and completion
                remaining, _ = stream.get_events_since(last_timestamp)
                for event in remaining:
                    if event.get('type') != 'stream.completed':
                        if event.get('type') == 'error':
                            logger.error(f'SSE final event for {execution_id}: {event}')
                        else:
                            logger.debug(f'SSE final event for {execution_id}: {event}')
                        yield sse_event(event)
                yield sse_event(stream_event({
                    'type': 'stream.completed',
                    'is_error': stream.error is not None,
                    'is_cancelled': stream.is_cancelled,
                }))
                yield 'data: [DONE]\n\n'
                break

            # Check if we've exceeded the SSE window (50 seconds)
            elapsed = (datetime.now() - start_time).total_seconds()
            if elapsed > SSE_WINDOW_SECONDS:
                logger.info(
                    f'SSE stream_progress window expired for {execution_id}; '
                    f'client should reconnect from cursor={last_timestamp}'
                )
                # Send reconnect signal with last timestamp
                yield sse_event(stream_event({
                    'type': 'stream.reconnect',
                    'execution_id': execution_id,
                    'last_timestamp': last_timestamp,
                    'message': 'Reconnect to continue streaming',
                }))
                break

            # Wait a bit before checking for new events
            await asyncio.sleep(0.1)

    return StreamingResponse(
        generate_events(),
        media_type='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    )


@router.post('/stop_stream/{execution_id}', response_model=StopStreamResponse)
async def stop_stream(execution_id: str):
    """Stop/cancel an active stream.

    Args:
        execution_id: The execution ID from invoke_agent

    Returns:
        Success status and message
    """
    ensure_logger_active(logger, set_propagate_false=True)
    stream_manager = get_stream_manager()
    stream = await stream_manager.get_stream(execution_id)

    if not stream:
        raise HTTPException(
            status_code=404,
            detail=f'Stream not found: {execution_id}'
        )

    if stream.is_complete:
        return StopStreamResponse(
            success=False,
            message='Stream already complete'
        )

    cancelled = stream.cancel()

    return StopStreamResponse(
        success=cancelled,
        message='Stream cancelled' if cancelled else 'Failed to cancel stream'
    )


@router.get('/projects/{project_id}/files')
async def list_project_files(request: Request, project_id: str):
    """List files in a project directory."""
    user_email = await get_current_user(request)

    # Verify project exists and belongs to user
    project_storage = ProjectStorage(user_email)
    project = await project_storage.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f'Project {project_id} not found')

    # Get project directory and list files
    project_dir = get_project_directory(project_id)

    files = []
    for path in project_dir.rglob('*'):
        if path.is_file():
            rel_path = path.relative_to(project_dir)
            files.append(
                {
                    'path': str(rel_path),
                    'name': path.name,
                    'size': path.stat().st_size,
                    'modified': datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
                }
            )

    return {'project_id': project_id, 'files': files}


@router.get('/projects/{project_id}/conversations/{conversation_id}/executions')
async def get_conversation_executions(
    request: Request,
    project_id: str,
    conversation_id: str,
):
    """Get active and recent executions for a conversation.

    Returns the current active execution (if any) and recent completed ones.
    This enables session independence - users can reconnect after navigating away.
    """
    ensure_logger_active(logger, set_propagate_false=True)
    from ..services.storage import ExecutionStorage

    user_email = await get_current_user(request)

    # Verify project exists and belongs to user
    project_storage = ProjectStorage(user_email)
    project = await project_storage.get(project_id)
    if not project:
        raise HTTPException(
            status_code=404,
            detail=f'Project {project_id} not found'
        )

    # First check in-memory streams for this conversation (always works)
    stream_manager = get_stream_manager()
    in_memory_active = None
    async with stream_manager._lock:
        for stream in stream_manager._streams.values():
            if (
                stream.conversation_id == conversation_id
                and not stream.is_complete
                and not stream.is_cancelled
            ):
                in_memory_active = {
                    'id': stream.execution_id,
                    'conversation_id': stream.conversation_id,
                    'project_id': stream.project_id,
                    'status': 'running',
                    'events': [e.data for e in stream.events],
                    'error': stream.error,
                    'created_at': None,
                }
                break

    # Try to get executions from database (may fail if table doesn't exist yet)
    active = None
    recent = []
    try:
        exec_storage = ExecutionStorage(user_email, project_id, conversation_id)
        active = await exec_storage.get_active()

        if active and not in_memory_active:
            error_message = (
                'Execution interrupted because the backend server restarted. '
                'The in-memory agent process is no longer running.'
            )
            logger.warning(
                f'Marking orphaned execution {active.id} as error: {error_message}'
            )
            await exec_storage.add_events(
                active.id,
                [
                    {
                        'timestamp': time.time(),
                        'type': 'error',
                        'error': error_message,
                    },
                    {
                        'timestamp': time.time(),
                        'type': 'stream.completed',
                        'is_error': True,
                    },
                ],
            )
            await exec_storage.update_status(active.id, 'error', error_message)
            active = None

        recent = await exec_storage.get_recent(limit=5)
    except Exception as e:
        # Table might not exist yet (migration pending) - log and continue
        # In-memory streams will still work
        logger.warning(f'Failed to query executions table (may not exist yet): {e}')

    return {
        'active': (
            in_memory_active
            or (active.to_dict() if active else None)
        ),
        'recent': [e.to_dict() for e in recent if e.id != (
            active.id if active else None
        )],
    }
