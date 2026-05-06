"""Operation polling tools for long-running Databricks actions."""


def create_operation_tools() -> list:
  """Create OpenAI function tools for the existing operation tracker."""
  from agents import function_tool
  from ..operation_tracker import get_operation, list_operations as _list_operations

  @function_tool(strict_mode=False)
  def check_operation_status(operation_id: str) -> dict:
    """Check status for a long-running operation by operation ID."""
    op = get_operation(operation_id)
    if not op:
      return {'found': False, 'operation_id': operation_id}
    return {
      'found': True,
      'operation_id': op.operation_id,
      'tool_name': op.tool_name,
      'status': op.status,
      'result': op.result,
      'error': op.error,
      'started_at': op.started_at,
      'completed_at': op.completed_at,
    }

  @function_tool(strict_mode=False)
  def list_operations(status: str | None = None) -> list[dict]:
    """List tracked long-running operations, optionally filtered by status."""
    return _list_operations(status=status)

  return [check_operation_status, list_operations]
