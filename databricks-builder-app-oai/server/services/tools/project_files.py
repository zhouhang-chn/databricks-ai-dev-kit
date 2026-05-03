"""Project-confined file tools for the OpenAI agent runtime."""

from pathlib import Path

MAX_READ_BYTES = 512_000
MAX_WRITE_BYTES = 1_000_000
MAX_LIST_RESULTS = 500


class ProjectFileError(ValueError):
  """Raised for model-actionable project file errors."""


def _resolve_project_path(project_dir: Path, raw_path: str) -> Path:
  if not raw_path or not raw_path.strip():
    raise ProjectFileError('Path is required.')

  project_root = project_dir.resolve()
  candidate = Path(raw_path)
  if candidate.is_absolute():
    resolved = candidate.resolve()
  else:
    resolved = (project_root / candidate).resolve()

  if resolved != project_root and project_root not in resolved.parents:
    raise ProjectFileError(f'Path escapes the project root: {raw_path}')
  return resolved


def _relative(project_dir: Path, path: Path) -> str:
  return str(path.resolve().relative_to(project_dir.resolve()))


def create_project_file_tools(project_dir: Path) -> list:
  """Create function tools bound to a single project directory."""
  from agents import function_tool

  project_dir.mkdir(parents=True, exist_ok=True)

  @function_tool
  def read_project_file(path: str) -> str:
    """Read a UTF-8 text file from the project by project-relative path."""
    resolved = _resolve_project_path(project_dir, path)
    if not resolved.exists():
      raise ProjectFileError(f'File not found: {path}')
    if not resolved.is_file():
      raise ProjectFileError(f'Path is not a file: {path}')
    size = resolved.stat().st_size
    if size > MAX_READ_BYTES:
      raise ProjectFileError(
        f'File is too large to read ({size} bytes, max {MAX_READ_BYTES}).'
      )
    return resolved.read_text(encoding='utf-8')

  @function_tool
  def write_project_file(path: str, content: str) -> str:
    """Create or replace a UTF-8 text file under the project root."""
    encoded = content.encode('utf-8')
    if len(encoded) > MAX_WRITE_BYTES:
      raise ProjectFileError(
        f'Content is too large to write ({len(encoded)} bytes, max {MAX_WRITE_BYTES}).'
      )
    resolved = _resolve_project_path(project_dir, path)
    resolved.parent.mkdir(parents=True, exist_ok=True)
    resolved.write_text(content, encoding='utf-8')
    return f'Wrote {_relative(project_dir, resolved)} ({len(encoded)} bytes).'

  @function_tool
  def edit_project_file(
    path: str,
    old_text: str,
    new_text: str,
    expected_replacements: int = 1,
  ) -> str:
    """Replace exact text in a project file."""
    if expected_replacements < 1:
      raise ProjectFileError('expected_replacements must be at least 1.')
    resolved = _resolve_project_path(project_dir, path)
    if not resolved.is_file():
      raise ProjectFileError(f'File not found: {path}')
    content = resolved.read_text(encoding='utf-8')
    count = content.count(old_text)
    if count != expected_replacements:
      raise ProjectFileError(
        f'Expected {expected_replacements} replacements, found {count}.'
      )
    updated = content.replace(old_text, new_text)
    if len(updated.encode('utf-8')) > MAX_WRITE_BYTES:
      raise ProjectFileError('Edited content exceeds write size cap.')
    resolved.write_text(updated, encoding='utf-8')
    return f'Edited {_relative(project_dir, resolved)} ({count} replacements).'

  @function_tool
  def list_project_files(pattern: str = '**/*') -> list[dict]:
    """List files under the project root matching a glob pattern."""
    results = []
    for path in sorted(project_dir.glob(pattern)):
      resolved = _resolve_project_path(project_dir, str(path))
      if not resolved.is_file():
        continue
      results.append({
        'path': _relative(project_dir, resolved),
        'size': resolved.stat().st_size,
      })
      if len(results) >= MAX_LIST_RESULTS:
        break
    return results

  @function_tool
  def grep_project_files(pattern: str, file_glob: str = '**/*') -> list[dict]:
    """Search project text files for a literal string."""
    if not pattern:
      raise ProjectFileError('Search pattern is required.')
    matches = []
    for path in sorted(project_dir.glob(file_glob)):
      resolved = _resolve_project_path(project_dir, str(path))
      if not resolved.is_file() or resolved.stat().st_size > MAX_READ_BYTES:
        continue
      try:
        lines = resolved.read_text(encoding='utf-8').splitlines()
      except UnicodeDecodeError:
        continue
      for lineno, line in enumerate(lines, start=1):
        if pattern in line:
          matches.append({
            'path': _relative(project_dir, resolved),
            'line': lineno,
            'text': line[:500],
          })
          if len(matches) >= MAX_LIST_RESULTS:
            return matches
    return matches

  @function_tool
  def get_project_tree(max_files: int = 200) -> list[str]:
    """Return a bounded, sorted project file tree."""
    max_files = min(max(max_files, 1), MAX_LIST_RESULTS)
    files = []
    for path in sorted(project_dir.rglob('*')):
      resolved = _resolve_project_path(project_dir, str(path))
      if resolved.is_file():
        files.append(_relative(project_dir, resolved))
      if len(files) >= max_files:
        break
    return files

  return [
    read_project_file,
    write_project_file,
    edit_project_file,
    list_project_files,
    grep_project_files,
    get_project_tree,
  ]
