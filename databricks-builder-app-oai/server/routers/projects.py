"""Project management endpoints.

All endpoints are scoped to the current authenticated user.
"""

import logging
from typing import Any

from databricks_tools_core.auth import clear_databricks_auth, set_databricks_auth
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from ..services.backup_manager import mark_for_backup
from ..services.project_settings import (
  ProjectSetting,
  ensure_project_setting_file,
  parse_project_setting_yaml,
  project_update_from_setting,
  read_project_setting,
  validate_project_setting,
  write_project_setting,
)
from ..services.storage import ProjectStorage
from ..services.user import get_current_token, get_current_user, get_workspace_url

logger = logging.getLogger(__name__)
router = APIRouter()


class CreateProjectRequest(BaseModel):
  """Request to create a new project."""

  name: str
  description: str | None = None
  project_type: str | None = None
  settings: dict[str, Any] | None = None


class UpdateProjectRequest(BaseModel):
  """Request to update a project."""

  name: str | None = None
  description: str | None = None
  project_type: str | None = None
  status: str | None = None
  current_release_id: str | None = None
  settings: dict[str, Any] | None = None


class ProjectSettingResponse(BaseModel):
  """Response containing the YAML-backed project setting."""

  project_id: str
  path: str
  setting: ProjectSetting
  project: dict[str, Any] | None = None


async def _get_owned_project(storage: ProjectStorage, project_id: str, user_email: str):
  """Fetch a project and raise 404 if it is not owned by the current user."""
  project = await storage.get(project_id)
  if not project:
    logger.warning(f'Project not found: {project_id} for user: {user_email}')
    raise HTTPException(status_code=404, detail=f'Project {project_id} not found')
  return project


@router.get('/projects')
async def get_all_projects(request: Request):
  """Get all projects for the current user sorted by created_at (newest first)."""
  user_email = await get_current_user(request)
  storage = ProjectStorage(user_email)

  logger.info(f'Fetching all projects for user: {user_email}')
  projects = await storage.get_all()
  logger.info(f'Retrieved {len(projects)} projects for user: {user_email}')

  return [project.to_dict() for project in projects]


@router.get('/projects/{project_id}')
async def get_project(request: Request, project_id: str):
  """Get a specific project by ID."""
  user_email = await get_current_user(request)
  storage = ProjectStorage(user_email)

  logger.info(f'Fetching project {project_id} for user: {user_email}')

  project = await storage.get(project_id)
  if not project:
    logger.warning(f'Project not found: {project_id} for user: {user_email}')
    raise HTTPException(status_code=404, detail=f'Project {project_id} not found')

  return project.to_dict()


@router.post('/projects')
async def create_project(request: Request, body: CreateProjectRequest):
  """Create a new project."""
  user_email = await get_current_user(request)
  storage = ProjectStorage(user_email)

  logger.info(f"Creating project '{body.name}' for user: {user_email}")

  project = await storage.create(
    name=body.name,
    description=body.description,
    project_type=body.project_type,
    settings=body.settings,
  )
  try:
    ensure_project_setting_file(
      project.id,
      project,
      user_email=user_email,
      databricks_host=get_workspace_url(),
    )
    mark_for_backup(project.id)
  except Exception as exc:
    logger.warning(f'Failed to create project_setting.yaml for project {project.id}: {exc}')
  logger.info(f'Created project {project.id} for user: {user_email}')

  return project.to_dict()


@router.get('/projects/{project_id}/project-setting')
async def get_project_setting(request: Request, project_id: str):
  """Get project_setting.yaml, creating it from project defaults if missing."""
  user_email = await get_current_user(request)
  storage = ProjectStorage(user_email)
  project = await _get_owned_project(storage, project_id, user_email)

  try:
    setting, path = read_project_setting(
      project_id,
      project,
      user_email=user_email,
      databricks_host=get_workspace_url(),
    )
  except ValueError as exc:
    raise HTTPException(status_code=400, detail=str(exc)) from exc

  return ProjectSettingResponse(
    project_id=project_id,
    path=str(path),
    setting=setting,
    project=project.to_dict(),
  )


@router.put('/projects/{project_id}/project-setting')
async def save_project_setting(request: Request, project_id: str, body: ProjectSetting):
  """Save project_setting.yaml and sync its resource hints into project settings."""
  user_email = await get_current_user(request)
  storage = ProjectStorage(user_email)
  await _get_owned_project(storage, project_id, user_email)

  path = write_project_setting(project_id, body)
  project = await storage.update(project_id, project_update_from_setting(body))
  if not project:
    raise HTTPException(status_code=404, detail=f'Project {project_id} not found')

  mark_for_backup(project_id)
  return ProjectSettingResponse(
    project_id=project_id,
    path=str(path),
    setting=body,
    project=project.to_dict(),
  )


@router.post('/projects/{project_id}/project-setting/parse')
async def parse_project_setting_route(request: Request, project_id: str, body: dict):
  """Parse project_setting.yaml content."""
  user_email = await get_current_user(request)
  storage = ProjectStorage(user_email)
  await _get_owned_project(storage, project_id, user_email)

  content = body.get('content', '')
  try:
    return parse_project_setting_yaml(content)
  except ValueError as exc:
    raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post('/projects/{project_id}/project-setting/validate')
async def validate_project_setting_route(request: Request, project_id: str, body: ProjectSetting):
  """Validate project_setting.yaml Databricks resources."""
  user_email = await get_current_user(request)
  storage = ProjectStorage(user_email)
  await _get_owned_project(storage, project_id, user_email)

  user_token = await get_current_token(request)
  workspace_url = body.databricks_resources.databricks_host or get_workspace_url()
  set_databricks_auth(workspace_url, user_token)
  try:
    return await run_in_threadpool(validate_project_setting, body)
  finally:
    clear_databricks_auth()


@router.patch('/projects/{project_id}')
async def update_project(request: Request, project_id: str, body: UpdateProjectRequest):
  """Update a project's metadata and settings."""
  user_email = await get_current_user(request)
  storage = ProjectStorage(user_email)

  logger.info(f'Updating project {project_id} for user: {user_email}')

  updates = body.model_dump(exclude_unset=True)
  for required_field in ('name', 'project_type', 'status', 'current_release_id'):
    if required_field in updates and updates[required_field] is None:
      raise HTTPException(
        status_code=400,
        detail=f'{required_field} cannot be null',
      )

  project = await storage.update(project_id, updates)
  if not project:
    logger.warning(f'Project not found for update: {project_id} for user: {user_email}')
    raise HTTPException(status_code=404, detail=f'Project {project_id} not found')

  logger.info(f'Updated project {project_id} for user: {user_email}')
  return project.to_dict()


@router.delete('/projects/{project_id}')
async def delete_project(request: Request, project_id: str):
  """Delete a project and all its conversations."""
  user_email = await get_current_user(request)
  storage = ProjectStorage(user_email)

  logger.info(f'Deleting project {project_id} for user: {user_email}')

  success = await storage.delete(project_id)
  if not success:
    logger.warning(f'Project not found for deletion: {project_id} for user: {user_email}')
    raise HTTPException(status_code=404, detail=f'Project {project_id} not found')

  logger.info(f'Deleted project {project_id} for user: {user_email}')
  return {'success': True, 'deleted_project_id': project_id}
