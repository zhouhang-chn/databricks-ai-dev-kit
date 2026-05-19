import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  Code2,
  Eye,
  FolderCog,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Square,
  Trash2,
  Upload,
  UserRound,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { MainLayout } from '@/components/layout/MainLayout';
import { Sidebar } from '@/components/layout/Sidebar';
import { SkillsExplorer } from '@/components/SkillsExplorer';
import { FunLoader } from '@/components/FunLoader';
import { RightInspectPanel } from '@/features/analysis/components/RightInspectPanel';
import { StoryCanvas } from '@/features/analysis/components/StoryCanvas';
import {
  createAnalysisStory,
  reduceAnalysisEvent,
  replayStoredEventsForStory,
  storiesFromMessages,
  storyEventsFromStreamEvent,
} from '@/features/analysis/storyTransforms';
import type { AnalysisEvent, AnalysisStory, NextMove } from '@/features/analysis/types';
import {
  createConversation,
  fetchClusters,
  fetchConversation,
  fetchConversations,
  fetchExecutions,
  fetchProject,
  fetchProjectSetting,
  fetchWarehouses,
  invokeAgent,
  parseProjectSetting,
  reconnectToExecution,
  renameConversation,
  saveProjectSetting,
  stopExecution,
  updateProject,
  validateProjectSetting,
} from '@/lib/api';
import { emitConversationUpdated } from '@/lib/conversationEvents';
import { ChatRenameModal } from '@/components/ChatRenameModal';
import type {
  Cluster,
  Conversation,
  Message,
  Project,
  ProjectRelease,
  ProjectSetting,
  ProjectSettingValidationResult,
  ProjectSettings,
  Warehouse,
  TodoItem,
} from '@/lib/types';
import { cn } from '@/lib/utils';


interface ActiveStream {
  fullText: string;
  todos: TodoItem[];
  tools: string[];
  stories: AnalysisStory[];
  executionId: string | null;
  abortController: AbortController | null;
  isReconnecting: boolean;
  storyId?: string;
  pendingMessages: Message[];
}

// Custom dropdown for cluster/warehouse selection with status indicators
function ResourceDropdown<T extends { state: string }>({
  label,
  items,
  selectedId,
  onSelect,
  nameKey,
  idKey,
}: {
  label: string;
  items: T[];
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
  nameKey: keyof T;
  idKey: keyof T;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) { document.addEventListener('mousedown', handler); return () => document.removeEventListener('mousedown', handler); }
  }, [open]);

  const selected = items.find((i) => String(i[idKey]) === selectedId);
  const selectedName = selected ? String(selected[nameKey] || '') : '';

  return (
    <div ref={ref} className="relative">
      <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">{label}</label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="mt-1.5 w-full flex items-center justify-between h-10 px-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] text-sm hover:border-[var(--color-accent-primary)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-primary)]/30 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {selected && (
            <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0 ring-2 ring-offset-1 ring-offset-[var(--color-background)]',
              selected.state === 'RUNNING' ? 'bg-[var(--color-success)] ring-[var(--color-success)]/30' : 'bg-[var(--color-text-muted)]/50 ring-[var(--color-text-muted)]/20'
            )} />
          )}
          <span className={cn('truncate', selected ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]')}>
            {selectedName || `Select ${label.toLowerCase()}...`}
          </span>
        </div>
        <ChevronDown className={cn('h-4 w-4 text-[var(--color-text-muted)] transition-transform flex-shrink-0', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 max-h-52 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-lg z-[60]">
          {items.map((item) => {
            const id = String(item[idKey]);
            const name = String(item[nameKey] || '');
            const isSelected = id === selectedId;
            return (
              <button
                key={id}
                onClick={() => { onSelect(id); setOpen(false); }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition-colors',
                  isSelected ? 'bg-[var(--color-accent-primary)]/5 text-[var(--color-accent-primary)]' : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)]'
                )}
              >
                <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0 ring-2 ring-offset-1 ring-offset-[var(--color-bg-elevated)]',
                  item.state === 'RUNNING' ? 'bg-[var(--color-success)] ring-[var(--color-success)]/30' : 'bg-[var(--color-text-muted)]/50 ring-[var(--color-text-muted)]/20'
                )} />
                <div className="flex-1 min-w-0">
                  <span className="truncate block">{name}</span>
                  <span className={cn('text-[10px] uppercase tracking-wider', item.state === 'RUNNING' ? 'text-[var(--color-success)]' : 'text-[var(--color-text-muted)]')}>
                    {item.state}
                  </span>
                </div>
                {isSelected && <Check className="h-4 w-4 flex-shrink-0 text-[var(--color-accent-primary)]" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Sanitize string for schema name: only a-z, 0-9, _ allowed
function sanitizeForSchema(str: string): string {
  return str.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
}

// Convert email + project name to schema name: quentin.ambard@databricks.com + "My Project" -> quentin_ambard_my_project
function toSchemaName(email: string | null, projectName: string | null): string {
  if (!email) return '';
  const localPart = email.split('@')[0];
  const emailPart = sanitizeForSchema(localPart);
  if (!projectName) return emailPart;
  const projectPart = sanitizeForSchema(projectName);
  return `${emailPart}_${projectPart}`;
}

type ResourceDefaults = {
  cluster_id?: string | null;
  default_catalog?: string | null;
  default_schema?: string | null;
  warehouse_id?: string | null;
  workspace_folder?: string | null;
  mlflow_experiment_name?: string | null;
};

type RunRole = 'developer' | 'user_preview';

type ProjectManagementPayload = {
  description?: string | null;
  project_type?: string;
  status?: string;
  current_release_id?: string;
  settings: Partial<ProjectSettings>;
};

function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinLines(values?: string[] | null): string {
  return (values || []).join('\n');
}

function computeReadiness(project: Project | null): Record<string, boolean> {
  const settings = project?.settings;
  const semantics = settings?.semantics || {};
  return {
    purpose: Boolean(project?.description?.trim()),
    semanticScope: Boolean((semantics.preferred_tables?.length || 0) > 0),
  };
}

function makeReleaseId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
  return `rel_${stamp}`;
}

function generatedWorkspaceFolder(
  user: string | null,
  projectName: string | null,
  projectId: string
): string {
  if (!user) return '';
  const projectFolder = projectName ? sanitizeForSchema(projectName) : projectId;
  return `/Workspace/Users/${user}/ai_dev_kit/${projectFolder}`;
}

function projectResourceDefaults(project: Project | null | undefined): ResourceDefaults {
  return project?.settings?.resources ?? {};
}

function splitOutputSchema(value: string): { defaultCatalog: string | null; defaultSchema: string | null } {
  const parts = value.split('.').map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 2) return { defaultCatalog: null, defaultSchema: null };
  return { defaultCatalog: parts[0], defaultSchema: parts[1] };
}

function schemaFromThreePartName(value: string): string | null {
  const parts = value.split('.').map((part) => part.trim()).filter(Boolean);
  return parts.length === 3 ? `${parts[0]}.${parts[1]}` : null;
}

function uniqueValues(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function projectSettingFromProject(project: Project | null): ProjectSetting {
  const settings = project?.settings;
  const resources = settings?.resources || {};
  const preferredTables = settings?.semantics?.preferred_tables || [];
  const metricViews = settings?.semantics?.metric_views || [];
  const outputSchema = resources.default_catalog && resources.default_schema
    ? `${resources.default_catalog}.${resources.default_schema}`
    : null;
  return {
    business_background: project?.description || '',
    analysis_notes: settings?.semantics?.known_caveats || [],
    databricks_resources: {
      databricks_host: null,
      cluster_id: resources.cluster_id || null,
      warehouse_id: resources.warehouse_id || null,
      workspace_folders: resources.workspace_folder ? [resources.workspace_folder] : [],
      workspace_files: [],
      workflows: settings?.workflows?.enabled || [],
      input_schemas: uniqueValues([
        ...preferredTables.map(schemaFromThreePartName),
        ...metricViews.map(schemaFromThreePartName),
      ]),
      input_tables: preferredTables,
      input_metric_views: metricViews,
      input_volume_paths: [],
      output_schema: outputSchema,
      output_volume_folders: [],
    },
  };
}

function resolveClusterId(
  conversation: Conversation | null | undefined,
  project: Project | null | undefined,
  clusters: Cluster[]
): string | undefined {
  return (
    conversation?.cluster_id
    || projectResourceDefaults(project).cluster_id
    || clusters[0]?.cluster_id
    || undefined
  );
}

function resolveWarehouseId(
  conversation: Conversation | null | undefined,
  project: Project | null | undefined,
  warehouses: Warehouse[]
): string | undefined {
  return (
    conversation?.warehouse_id
    || projectResourceDefaults(project).warehouse_id
    || warehouses[0]?.warehouse_id
    || undefined
  );
}

function resolveDefaultCatalog(
  conversation: Conversation | null | undefined,
  project: Project | null | undefined
): string {
  return conversation?.default_catalog || projectResourceDefaults(project).default_catalog || 'ai_dev_kit';
}

function resolveDefaultSchema(
  conversation: Conversation | null | undefined,
  project: Project | null | undefined,
  fallbackSchema: string
): string {
  return conversation?.default_schema || projectResourceDefaults(project).default_schema || fallbackSchema;
}

function resolveWorkspaceFolder(
  conversation: Conversation | null | undefined,
  project: Project | null | undefined,
  user: string | null,
  projectId: string
): string {
  return (
    conversation?.workspace_folder
    || projectResourceDefaults(project).workspace_folder
    || generatedWorkspaceFolder(user, project?.name ?? null, projectId)
  );
}

function resolveMlflowExperimentName(
  project: Project | null | undefined
): string {
  return projectResourceDefaults(project).mlflow_experiment_name || '';
}

function ProjectManagementPanel({
  isOpen,
  onClose,
  project,
  projectSetting,
  projectSettingPath,
  validationResult,
  clusters,
  warehouses,
  onSave,
  onValidate,
  onPublish,
  onStartUserPreview,
  isSaving,
  isValidating,
}: {
  isOpen: boolean;
  onClose: () => void;
  project: Project | null;
  projectSetting: ProjectSetting | null;
  projectSettingPath: string | null;
  validationResult: ProjectSettingValidationResult | null;
  clusters: Cluster[];
  warehouses: Warehouse[];
  onSave: (setting: ProjectSetting, payload: ProjectManagementPayload) => void;
  onValidate: (setting: ProjectSetting) => void;
  onPublish: (releaseId: string, notes: string) => void;
  onStartUserPreview: () => void;
  isSaving: boolean;
  isValidating: boolean;
}) {
  const [businessBackground, setBusinessBackground] = useState('');
  const [analysisNotes, setAnalysisNotes] = useState<string[]>(['']);
  const [releaseNotes, setReleaseNotes] = useState('');

  const [databricksHost, setDatabricksHost] = useState('');
  const [selectedClusterId, setSelectedClusterId] = useState<string | undefined>();
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | undefined>();
  const [workspaceFolders, setWorkspaceFolders] = useState('');
  const [workspaceFiles, setWorkspaceFiles] = useState('');
  const [workflows, setWorkflows] = useState('');
  const [inputSchemas, setInputSchemas] = useState('');
  const [inputTables, setInputTables] = useState('');
  const [inputMetricViews, setInputMetricViews] = useState('');
  const [inputVolumePaths, setInputVolumePaths] = useState('');
  const [outputSchema, setOutputSchema] = useState('');
  const [outputVolumeFolders, setOutputVolumeFolders] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const applyParsedSetting = (setting: ProjectSetting) => {
    const resources = setting.databricks_resources;
    setBusinessBackground(setting.business_background || '');
    setAnalysisNotes(setting.analysis_notes.length > 0 ? setting.analysis_notes : ['']);
    setDatabricksHost(resources.databricks_host || '');
    setSelectedClusterId(resources.cluster_id || undefined);
    setSelectedWarehouseId(resources.warehouse_id || undefined);
    setWorkspaceFolders(joinLines(resources.workspace_folders));
    setWorkspaceFiles(joinLines(resources.workspace_files));
    setWorkflows(joinLines(resources.workflows));
    setInputSchemas(joinLines(resources.input_schemas));
    setInputTables(joinLines(resources.input_tables));
    setInputMetricViews(joinLines(resources.input_metric_views));
    setInputVolumePaths(joinLines(resources.input_volume_paths));
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project?.id) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const content = ev.target?.result as string;
      try {
        const parsed = await parseProjectSetting(project.id, content);
        applyParsedSetting(parsed);
        toast.success('Project settings imported from file');
      } catch (error) {
        toast.error(`Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`);
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    if (!project || !isOpen) return;
    const setting = projectSetting || projectSettingFromProject(project);
    const resources = setting.databricks_resources;
    setBusinessBackground(setting.business_background || project.description || '');
    setAnalysisNotes(setting.analysis_notes.length > 0 ? setting.analysis_notes : ['']);
    setReleaseNotes('');

    setDatabricksHost(resources.databricks_host || '');
    setSelectedClusterId(resources.cluster_id || undefined);
    setSelectedWarehouseId(resources.warehouse_id || undefined);
    setWorkspaceFolders(joinLines(resources.workspace_folders));
    setWorkspaceFiles(joinLines(resources.workspace_files));
    setWorkflows(joinLines(resources.workflows));
    setInputSchemas(joinLines(resources.input_schemas));
    setInputTables(joinLines(resources.input_tables));
    setInputMetricViews(joinLines(resources.input_metric_views));
    setInputVolumePaths(joinLines(resources.input_volume_paths));
    setOutputSchema(resources.output_schema || '');
    setOutputVolumeFolders(joinLines(resources.output_volume_folders));
  }, [project, projectSetting, isOpen]);

  if (!isOpen) return null;

  const readiness = computeReadiness(project);
  const releaseCount = project?.settings?.releases?.length || 0;

  const handlePublishClick = () => {
    const isReady = Object.values(readiness).every(Boolean);
    if (!isReady) {
      const proceed = window.confirm("Project configuration is missing Purpose or Semantic Scope. Are you sure you want to publish?");
      if (!proceed) return;
    }
    onPublish(makeReleaseId(), releaseNotes);
    setReleaseNotes('');
  };

  const currentAnalysisNotes = () => analysisNotes.map((note) => note.trim()).filter(Boolean);

  const handleAnalysisNoteChange = (index: number, value: string) => {
    setAnalysisNotes((current) => current.map((note, noteIndex) => (
      noteIndex === index ? value : note
    )));
  };

  const handleAddAnalysisNote = () => {
    setAnalysisNotes((current) => [...current, '']);
  };

  const handleRemoveAnalysisNote = (index: number) => {
    setAnalysisNotes((current) => {
      const next = current.filter((_, noteIndex) => noteIndex !== index);
      return next.length > 0 ? next : [''];
    });
  };

  const handleSave = () => {
    const { defaultCatalog, defaultSchema } = splitOutputSchema(outputSchema.trim());
    const nextSetting: ProjectSetting = {
      business_background: businessBackground.trim(),
      analysis_notes: currentAnalysisNotes(),
      databricks_resources: {
        databricks_host: databricksHost.trim() || null,
        cluster_id: selectedClusterId || null,
        warehouse_id: selectedWarehouseId || null,
        workspace_folders: splitLines(workspaceFolders),
        workspace_files: splitLines(workspaceFiles),
        workflows: splitLines(workflows),
        input_schemas: splitLines(inputSchemas),
        input_tables: splitLines(inputTables),
        input_metric_views: splitLines(inputMetricViews),
        input_volume_paths: splitLines(inputVolumePaths),
        output_schema: outputSchema.trim() || null,
        output_volume_folders: splitLines(outputVolumeFolders),
      },
    };
    onSave(nextSetting, {
      description: businessBackground.trim() || null,
      settings: {
        resources: {
          default_catalog: defaultCatalog,
          default_schema: defaultSchema,
          cluster_id: selectedClusterId || null,
          warehouse_id: selectedWarehouseId || null,
          workspace_folder: splitLines(workspaceFolders)[0] || null,
          mlflow_experiment_name: project?.settings?.resources?.mlflow_experiment_name || null,
        },
        semantics: {
          preferred_tables: splitLines(inputTables),
          metric_views: splitLines(inputMetricViews),
          known_caveats: currentAnalysisNotes(),
        },
        workflows: {
          enabled: splitLines(workflows),
        },
        governance: {
          readiness,
        },
      },
    });
  };

  const handleValidate = () => {
    onValidate({
      business_background: businessBackground.trim(),
      analysis_notes: currentAnalysisNotes(),
      databricks_resources: {
        databricks_host: databricksHost.trim() || null,
        cluster_id: selectedClusterId || null,
        warehouse_id: selectedWarehouseId || null,
        workspace_folders: splitLines(workspaceFolders),
        workspace_files: splitLines(workspaceFiles),
        workflows: splitLines(workflows),
        input_schemas: splitLines(inputSchemas),
        input_tables: splitLines(inputTables),
        input_metric_views: splitLines(inputMetricViews),
        input_volume_paths: splitLines(inputVolumePaths),
        output_schema: outputSchema.trim() || null,
        output_volume_folders: splitLines(outputVolumeFolders),
      },
    });
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-sm">
      <div className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-6 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-[var(--color-text-heading)]">Project Setting</h3>
            <p className="text-xs text-[var(--color-text-muted)] truncate">
              {projectSettingPath || `${project?.name || 'Project'} · ${releaseCount} release${releaseCount === 1 ? '' : 's'}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleImportClick} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text-heading)] transition-colors" title="Import project-setting.yaml">
              <Upload className="h-3.5 w-3.5" />
              Import
            </button>
            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-[var(--color-bg-secondary)]">
              <X className="h-4 w-4 text-[var(--color-text-muted)]" />
            </button>
          </div>
        </div>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".yaml,.yml"
          className="hidden"
        />

        <div className="space-y-6 p-6">
          <section className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-heading)]">
              <FolderCog className="h-4 w-4 text-[var(--color-accent-primary)]" />
              Business Context
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-heading)]">Business Background</label>
              <textarea value={businessBackground} onChange={(e) => setBusinessBackground(e.target.value)} placeholder="Scenario, decision context, key questions, and expected outcome..." className="min-h-28 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-heading)]">Analysis Notes</label>
              <div className="space-y-2">
                {analysisNotes.map((note, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <textarea
                      value={note}
                      onChange={(e) => handleAnalysisNoteChange(index, e.target.value)}
                      placeholder="Metric definition, required filter, caveat, validation check, rejected path, or decision-owner expectation"
                      className="min-h-16 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveAnalysisNote(index)}
                      className="mt-1 inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text-heading)]"
                      title="Remove note"
                      aria-label={`Remove note ${index + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={handleAddAnalysisNote}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-heading)] hover:bg-[var(--color-bg-secondary)]"
                >
                  <Plus className="h-4 w-4" />
                  Add Analysis Note
                </button>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-heading)]">
              <BookOpen className="h-4 w-4 text-[var(--color-accent-primary)]" />
              Databricks Resources
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-heading)]">Databricks Host</label>
              <input
                type="text"
                value={databricksHost}
                onChange={(e) => setDatabricksHost(e.target.value)}
                placeholder="https://..."
                className="w-full h-10 px-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-primary)]/30 focus:border-[var(--color-accent-primary)]/50"
              />
            </div>

              {clusters.length > 0 && (
                <ResourceDropdown
                  label="Compute Cluster"
                  items={clusters}
                  selectedId={selectedClusterId}
                  onSelect={setSelectedClusterId}
                  nameKey="cluster_name"
                  idKey="cluster_id"
                />
              )}

              {warehouses.length > 0 && (
                <ResourceDropdown
                  label="SQL Warehouse"
                  items={warehouses}
                  selectedId={selectedWarehouseId}
                  onSelect={setSelectedWarehouseId}
                  nameKey="warehouse_name"
                  idKey="warehouse_id"
                />
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--color-text-heading)]">Workspace Folders</label>
                <textarea value={workspaceFolders} onChange={(e) => setWorkspaceFolders(e.target.value)} placeholder="/Workspace/Users/..." className="min-h-20 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--color-text-heading)]">Workspace Files</label>
                <textarea value={workspaceFiles} onChange={(e) => setWorkspaceFiles(e.target.value)} placeholder="/Workspace/Users/.../notebook" className="min-h-20 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--color-text-heading)]">Workflows</label>
                <textarea value={workflows} onChange={(e) => setWorkflows(e.target.value)} placeholder="Workflow name" className="min-h-16 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--color-text-heading)]">Input Schemas</label>
                <textarea value={inputSchemas} onChange={(e) => setInputSchemas(e.target.value)} placeholder="catalog.schema" className="min-h-16 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--color-text-heading)]">Input Tables</label>
                <textarea value={inputTables} onChange={(e) => setInputTables(e.target.value)} placeholder="catalog.schema.table" className="min-h-24 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--color-text-heading)]">Input Metric Views</label>
                <textarea value={inputMetricViews} onChange={(e) => setInputMetricViews(e.target.value)} placeholder="catalog.schema.metric_view" className="min-h-16 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--color-text-heading)]">Input Volume Paths</label>
                <textarea value={inputVolumePaths} onChange={(e) => setInputVolumePaths(e.target.value)} placeholder="/Volumes/catalog/schema/volume/path" className="min-h-16 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--color-text-heading)]">Output Schema</label>
                <input
                  type="text"
                  value={outputSchema}
                  onChange={(e) => setOutputSchema(e.target.value)}
                  placeholder="catalog.schema"
                  className="w-full h-10 px-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-primary)]/30 focus:border-[var(--color-accent-primary)]/50"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--color-text-heading)]">Output Volume Folders</label>
                <textarea value={outputVolumeFolders} onChange={(e) => setOutputVolumeFolders(e.target.value)} placeholder="/Volumes/catalog/schema/volume/folder" className="min-h-16 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
              </div>
          </section>

          {validationResult && (
            <section className="space-y-3 pt-6 border-t border-[var(--color-border)]/50">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-heading)]">
                  <ShieldCheck className="h-4 w-4 text-[var(--color-accent-primary)]" />
                  Validation
                </div>
                <span className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                  validationResult.valid
                    ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]'
                    : 'bg-red-500/10 text-red-600'
                )}>
                  {validationResult.summary}
                </span>
              </div>
              <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] overflow-hidden">
                {validationResult.checks.map((check, index) => (
                  <div key={`${check.name}-${index}`} className="flex gap-3 p-3 text-xs">
                    <span className={cn(
                      'mt-1 h-2 w-2 flex-shrink-0 rounded-full',
                      check.status === 'ok'
                        ? 'bg-[var(--color-success)]'
                        : check.status === 'warning'
                          ? 'bg-amber-500'
                          : 'bg-red-500'
                    )} />
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--color-text-heading)]">{check.name}</div>
                      <div className="text-[var(--color-text-muted)]">{check.message}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-3 pt-6 border-t border-[var(--color-border)]/50">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-heading)]">
              <UserRound className="h-4 w-4 text-[var(--color-accent-primary)]" />
              User Preview
            </div>
            <button type="button" onClick={onStartUserPreview} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 text-sm hover:bg-[var(--color-bg-secondary)]">
              <Eye className="h-4 w-4" />
              Start User Preview Chat
            </button>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-heading)]">
              <ShieldCheck className="h-4 w-4 text-[var(--color-accent-primary)]" />
              Publish Release
            </div>
            <div className="flex gap-2">
              <input value={releaseNotes} onChange={(e) => setReleaseNotes(e.target.value)} placeholder="Release notes (optional)" className="flex-1 h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm" />
              <button type="button" onClick={handlePublishClick} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 text-sm hover:bg-[var(--color-bg-secondary)] whitespace-nowrap">
                Publish Snapshot
              </button>
            </div>
          </section>

          <div className="sticky bottom-0 -mx-6 border-t border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button type="button" onClick={handleValidate} disabled={isSaving || isValidating} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] text-sm font-medium text-[var(--color-text-heading)] hover:bg-[var(--color-bg-secondary)] disabled:opacity-60">
                {isValidating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Validate Databricks Settings
              </button>
              <button type="button" onClick={handleSave} disabled={isSaving || isValidating} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[var(--color-accent-primary)] text-sm font-medium text-white hover:bg-[var(--color-accent-secondary)] disabled:opacity-60">
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Project Setting
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useUser();

  // State
  const [project, setProject] = useState<Project | null>(null);
  const [projectSetting, setProjectSetting] = useState<ProjectSetting | null>(null);
  const [projectSettingPath, setProjectSettingPath] = useState<string | null>(null);
  const [projectSettingValidation, setProjectSettingValidation] =
    useState<ProjectSettingValidationResult | null>(null);
  const [, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [analysisStories, setAnalysisStories] = useState<AnalysisStory[]>([]);
  const [activeStoryId, setActiveStoryId] = useState<string | undefined>();
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [streamingConvIds, setStreamingConvIds] = useState<string[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [selectedClusterId, setSelectedClusterId] = useState<string | undefined>();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | undefined>();
  const [defaultCatalog, setDefaultCatalog] = useState<string>('ai_dev_kit');
  const [defaultSchema, setDefaultSchema] = useState<string>('');
  const [workspaceFolder, setWorkspaceFolder] = useState<string>('');
  const [mlflowExperimentName, setMlflowExperimentName] = useState<string>('');
  const [runRole, setRunRole] = useState<RunRole>('developer');
  const [skillsExplorerOpen, setSkillsExplorerOpen] = useState(false);
  const [projectPanelOpen, setProjectPanelOpen] = useState(false);
  const [, setActiveExecutionId] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [messageTools, setMessageTools] = useState<Record<string, string[]>>({});
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingRight, setIsResizingRight] = useState(false);
  const [isChatMenuOpen, setIsChatMenuOpen] = useState(false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const chatMenuRef = useRef<HTMLDivElement>(null);

  // Close the "..." menu when clicking outside.
  useEffect(() => {
    if (!isChatMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (chatMenuRef.current && !chatMenuRef.current.contains(event.target as Node)) {
        setIsChatMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isChatMenuOpen]);

  // Handle manual resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingLeft) {
        const newWidth = e.clientX;
        if (newWidth > 200 && newWidth < 500) {
          setSidebarWidth(newWidth);
        }
      } else if (isResizingRight) {
        const newWidth = window.innerWidth - e.clientX;
        if (newWidth > 250 && newWidth < 600) {
          setRightPanelWidth(newWidth);
        }
      }
    };

    const handleMouseUp = () => {
      setIsResizingLeft(false);
      setIsResizingRight(false);
    };

    if (isResizingLeft || isResizingRight) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
    };
  }, [isResizingLeft, isResizingRight]);

  // Handle automatic resizing on window resize
  useEffect(() => {
    const handleResize = () => {
      const windowWidth = window.innerWidth;
      const minLeft = isSidebarCollapsed ? 64 : 200;
      const minMiddle = 400;
      const minRight = 250;

      let currentLeft = isSidebarCollapsed ? 64 : sidebarWidth;
      let currentRight = rightPanelWidth;

      if (currentLeft + minMiddle + currentRight > windowWidth) {
        // Shrink right first
        currentRight = Math.max(minRight, windowWidth - currentLeft - minMiddle);
        
        // If still not enough, shrink left
        if (currentLeft + minMiddle + currentRight > windowWidth) {
          currentLeft = Math.max(minLeft, windowWidth - minMiddle - currentRight);
        }
        
        if (!isSidebarCollapsed) {
          setSidebarWidth(currentLeft);
        }
        setRightPanelWidth(currentRight);
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();
    
    return () => window.removeEventListener('resize', handleResize);
  }, [sidebarWidth, rightPanelWidth, isSidebarCollapsed]);

  const handleRenameConversation = useCallback(
    async (newTitle: string) => {
      if (!projectId || !currentConversation?.id) return;
      const conversationId = currentConversation.id;
      try {
        await renameConversation(projectId, conversationId, newTitle);
        setCurrentConversation((prev) =>
          prev && prev.id === conversationId ? { ...prev, title: newTitle } : prev
        );
        setConversations((prev) =>
          prev.map((c) => (c.id === conversationId ? { ...c, title: newTitle } : c))
        );
        emitConversationUpdated({ projectId, conversationId });
        toast.success('Chat renamed');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to rename chat';
        toast.error(message);
        throw error;
      }
    },
    [projectId, currentConversation?.id]
  );

  // Calculate default schema from user email + project name once available
  const userDefaultSchema = useMemo(() => toSchemaName(user, project?.name ?? null), [user, project?.name]);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const reconnectAttemptedRef = useRef<string | null>(null);
  const currentConvIdRef = useRef<string | undefined>(undefined);
  const messageToolsRef = useRef<Record<string, string[]>>({});
  // Per-conversation streaming data (supports concurrent streams)
  const allStreamsRef = useRef<Record<string, ActiveStream>>({});

  // Keep currentConvIdRef in sync with state
  useEffect(() => { currentConvIdRef.current = currentConversation?.id; }, [currentConversation?.id]);
  useEffect(() => { messageToolsRef.current = messageTools; }, [messageTools]);

  // Clear input when switching conversations
  useEffect(() => {
    setInput('');
    setStreamingText('');
    setTodos([]);
    setIsReconnecting(false);
    setActiveExecutionId(null);
  }, [currentConversation?.id]);

  useEffect(() => {
    if (searchParams.get('settings') === '1') {
      setProjectPanelOpen(true);
    }
  }, [searchParams]);

  const syncStoriesFromMessages = useCallback((nextMessages: Message[]) => {
    setAnalysisStories(prev => {
      const dbStories = storiesFromMessages({ messages: nextMessages, messageTools: messageToolsRef.current });
      if (prev.length === 0) return dbStories;

      const storyMessageIds = (story: AnalysisStory): string[] => story.context.messageIds || [];
      const hasSharedMessageId = (left: AnalysisStory, right: AnalysisStory): boolean => {
        const rightIds = new Set(storyMessageIds(right));
        return storyMessageIds(left).some((id) => rightIds.has(id));
      };
      const isUnfinished = (story: AnalysisStory): boolean => (
        story.status !== 'done' && story.status !== 'error'
      );
      const sameQuestionAndConversation = (left: AnalysisStory, right: AnalysisStory): boolean => (
        left.conversationId === right.conversationId
        && left.question.trim() === right.question.trim()
      );
      const findLiveMatch = (dbStory: AnalysisStory): AnalysisStory | undefined => {
        const exact = prev.find((liveStory) => liveStory.id === dbStory.id);
        if (exact) return exact;

        const byMessageId = prev.find((liveStory) => hasSharedMessageId(liveStory, dbStory));
        if (byMessageId) return byMessageId;

        // Only use text matching to bridge a temporary live story to a newly
        // persisted, unfinished user turn. Repeated identical questions must
        // not merge a new running story into an older completed DB story.
        if (!isUnfinished(dbStory)) return undefined;
        return prev.find((liveStory) => (
          isUnfinished(liveStory) && sameQuestionAndConversation(liveStory, dbStory)
        ));
      };

      // 1. Process dbStories and merge with matching live stories
      const matchedLiveIds = new Set<string>();
      const updatedDbStories = dbStories.map(dbStory => {
        const match = findLiveMatch(dbStory);

        if (match) {
          matchedLiveIds.add(match.id);
          return {
            ...dbStory,
            // Preserve rich state from live match
            plan: match.plan || dbStory.plan,
            trace: match.trace.length > dbStory.trace.length ? match.trace : dbStory.trace,
            evidence: match.evidence.length > dbStory.evidence.length ? match.evidence : dbStory.evidence,
            conclusion: match.conclusion || dbStory.conclusion,
            conclusionText: match.conclusionText || dbStory.conclusionText,
            nextMoves: match.nextMoves.length > dbStory.nextMoves.length ? match.nextMoves : dbStory.nextMoves,
            status: match.status === 'running' || match.status === 'planning' ? match.status : dbStory.status,
          };
        }
        return dbStory;
      });

      // 2. Preserve "live" stories that weren't matched in dbStories
      // These are stories currently running or streaming that haven't been saved to DB yet
      const orphanedLiveStories = prev.filter(liveStory => 
        liveStory.conversationId === currentConvIdRef.current &&
        !matchedLiveIds.has(liveStory.id) && 
        (liveStory.status === 'running' || liveStory.status === 'planning' || liveStory.trace.length > 0)
      );

      return [...updatedDbStories, ...orphanedLiveStories];
    });
  }, []);

  const applyStoryEvents = useCallback((stream: ActiveStream | undefined, events: AnalysisEvent[]) => {
    if (!stream || events.length === 0) return;

    stream.stories = events.reduce(
      (nextStories, event) => reduceAnalysisEvent(nextStories, event),
      stream.stories
    );
    setAnalysisStories((prev) => events.reduce(
      (nextStories, event) => reduceAnalysisEvent(nextStories, event),
      prev
    ));
  }, []);

  const applyStoryStreamEvent = useCallback((stream: ActiveStream | undefined, event: Record<string, unknown>) => {
    if (!stream?.storyId) return;
    applyStoryEvents(stream, storyEventsFromStreamEvent(stream.storyId, event));
  }, [applyStoryEvents]);

  // Load project and conversations
  useEffect(() => {
    if (!projectId) return;

    const loadData = async () => {
      try {
        setIsLoading(true);
        // Clear old conversation state immediately
        setMessages([]);
        setAnalysisStories([]);
        setActiveStoryId(undefined);
        const [projectData, projectSettingData, conversationsData, clustersData, warehousesData] = await Promise.all([
          fetchProject(projectId),
          fetchProjectSetting(projectId).catch(() => null),
          fetchConversations(projectId),
          fetchClusters().catch(() => []), // Don't fail if clusters can't be loaded
          fetchWarehouses().catch(() => []), // Don't fail if warehouses can't be loaded
        ]);
        setProject(projectData);
        setProjectSetting(projectSettingData?.setting || null);
        setProjectSettingPath(projectSettingData?.path || null);
        setProjectSettingValidation(null);
        setConversations(conversationsData);
        setClusters(clustersData);
        setWarehouses(warehousesData);

        const generatedSchema = toSchemaName(user, projectData.name);

        // Load specific conversation from URL or first available
        const urlConvId = searchParams.get('conversationId');
        const targetConv = urlConvId 
          ? conversationsData.find(c => c.id === urlConvId) || conversationsData[0]
          : conversationsData[0];

        if (targetConv) {
          const conv = await fetchConversation(projectId, targetConv.id);
          setCurrentConversation(conv);
          setMessages(conv.messages || []);
          syncStoriesFromMessages(conv.messages || []);
          setSelectedClusterId(resolveClusterId(conv, projectData, clustersData));
          setSelectedWarehouseId(resolveWarehouseId(conv, projectData, warehousesData));
          setDefaultCatalog(resolveDefaultCatalog(conv, projectData));
          setDefaultSchema(resolveDefaultSchema(conv, projectData, generatedSchema));
          setWorkspaceFolder(resolveWorkspaceFolder(conv, projectData, user, projectId));
          setMlflowExperimentName(resolveMlflowExperimentName(projectData));
        } else {
          setAnalysisStories([]);
          setActiveStoryId(undefined);
          setSelectedClusterId(resolveClusterId(null, projectData, clustersData));
          setSelectedWarehouseId(resolveWarehouseId(null, projectData, warehousesData));
          setDefaultCatalog(resolveDefaultCatalog(null, projectData));
          setDefaultSchema(resolveDefaultSchema(null, projectData, generatedSchema));
          setWorkspaceFolder(resolveWorkspaceFolder(null, projectData, user, projectId));
          setMlflowExperimentName(resolveMlflowExperimentName(projectData));
        }
      } catch (error) {
        console.error('Failed to load project:', error);
        toast.error('Failed to load project');
        navigate('/');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [projectId, navigate, user, syncStoriesFromMessages]);

  // Handle conversation changes via URL
  useEffect(() => {
    const urlConvId = searchParams.get('conversationId');
    if (urlConvId && urlConvId !== currentConversation?.id && projectId) {
      const switchConv = async () => {
        try {
          const conv = await fetchConversation(projectId, urlConvId);
          setCurrentConversation(conv);
          setMessages(conv.messages || []);
          syncStoriesFromMessages(conv.messages || []);
          // Clear streaming UI
          setStreamingText('');
          setTodos([]);
        } catch (error) {
          console.error('Failed to switch conversation:', error);
        }
      };
      switchConv();
    }
  }, [projectId, searchParams, currentConversation?.id, syncStoriesFromMessages]);

  // Check for active execution when conversation loads and reconnect if needed
  useEffect(() => {
    if (!projectId || !currentConversation?.id || isLoading || allStreamsRef.current[currentConversation.id]) return;

    // Skip if we've already checked this conversation
    if (reconnectAttemptedRef.current === currentConversation.id) return;
    reconnectAttemptedRef.current = currentConversation.id;

    const checkAndReconnect = async () => {
      try {
        const { active, recent } = await fetchExecutions(projectId, currentConversation.id);

        const reconConvId = currentConversation.id;
        let reconnectStory: AnalysisStory | undefined;
        let initialStories = analysisStories;

        // 1. Create reconnect story if needed
        if (active && active.status === 'running') {
          console.log('[RECONNECT] Found active execution:', active.id);
          const latestUserMessage = [...(currentConversation.messages || [])].reverse()
            .find((message) => message.role === 'user');
          
          reconnectStory = createAnalysisStory({
            id: latestUserMessage ? `story-${latestUserMessage.id}` : `story-${active.id}`,
            conversationId: reconConvId,
            question: latestUserMessage?.content || currentConversation.title || 'Active analysis',
            status: 'running',
            messageIds: latestUserMessage ? [latestUserMessage.id] : [],
          });
          
          if (!initialStories.some(s => s.id === reconnectStory!.id)) {
            initialStories = [...initialStories, reconnectStory];
          } else {
            initialStories = initialStories.map(s => s.id === reconnectStory!.id ? reconnectStory! : s);
          }
        }

        // 2. Replay recent events onto the stories
        if (recent && recent.length > 0) {
          for (let i = 0; i < recent.length; i += 1) {
            const story = initialStories[initialStories.length - 1 - i];
            if (!story) break;
            const exec = recent[i];
            if (!exec?.events?.length) continue;
            const events = replayStoredEventsForStory(story.id, exec.events);
            if (events.length === 0) continue;
            initialStories = events.reduce((acc, evt) => reduceAnalysisEvent(acc, evt), initialStories);
          }
        }

        // 3. Update state with replayed data
        setAnalysisStories(initialStories);

        if (active && active.status === 'running' && reconnectStory) {
          const controller = new AbortController();
          
          // Initialize stream.stories with the replayed state so reduceAnalysisEvent 
          // can find the story and apply live updates correctly
          allStreamsRef.current[reconConvId] = {
            fullText: '',
            todos: [],
            tools: [],
            stories: initialStories,
            executionId: active.id,
            abortController: controller,
            isReconnecting: true,
            storyId: reconnectStory.id,
            pendingMessages: [],
          };
          setStreamingConvIds(prev => [...prev, reconConvId]);
          setIsReconnecting(true);
          setActiveExecutionId(active.id);

          let fullText = '';

          await reconnectToExecution({
            executionId: active.id,
            storedEvents: active.events,
            signal: controller.signal,
            onEvent: (event) => {
              const type = event.type as string;
              const stream = allStreamsRef.current[reconConvId];
              const isForeground = currentConvIdRef.current === reconConvId;
              applyStoryStreamEvent(stream, event);

              if (type === 'text_delta') {
                const text = event.text as string;
                fullText += text;
                if (stream) stream.fullText = fullText;
                if (isForeground) setStreamingText(fullText);
              } else if (type === 'text') {
                const text = event.text as string;
                if (text) {
                  if (fullText && !fullText.endsWith('\n') && !text.startsWith('\n')) {
                    fullText += '\n\n';
                  }
                  fullText += text;
                  if (stream) stream.fullText = fullText;
                  if (isForeground) setStreamingText(fullText);
                }
              } else if (type === 'todos') {
                const todoItems = event.todos as TodoItem[];
                if (todoItems) {
                  if (stream) stream.todos = todoItems;
                  if (isForeground) setTodos(todoItems);
                }
              } else if (type === 'error') {
                toast.error(event.error as string, { duration: 8000 });
              }
            },
            onError: (error) => {
              console.error('Reconnect error:', error);
              const stream = allStreamsRef.current[reconConvId];
              if (stream?.storyId) {
                applyStoryEvents(stream, [{
                  type: 'story.failed',
                  storyId: stream.storyId,
                  error: error.message || 'Failed to reconnect to execution',
                }]);
              }
              toast.error('Failed to reconnect to execution');
            },
            onDone: async () => {
              const stream = allStreamsRef.current[reconConvId];
              if (stream?.storyId) {
                applyStoryEvents(stream, [{ type: 'story.completed', storyId: stream.storyId }]);
              }
              delete allStreamsRef.current[reconConvId];
              setStreamingConvIds(prev => prev.filter(id => id !== reconConvId));

              const conv = await fetchConversation(projectId, reconConvId);
              if (currentConvIdRef.current === reconConvId) {
                setCurrentConversation(conv);
                setMessages(conv.messages || []);
                setStreamingText('');
                setIsReconnecting(false);
                setActiveExecutionId(null);
                setTodos([]);
              }
              fetchConversations(projectId).then(setConversations);
            },
          });
        }
      } catch (error) {
        console.error('Failed to check for active executions:', error);
        // Don't show error toast - this is a background check
      }
    };

    checkAndReconnect();
  }, [projectId, currentConversation, isLoading, applyStoryEvents, applyStoryStreamEvent]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // Set default schema from user email once when first available
  const schemaDefaultApplied = useRef(false);
  useEffect(() => {
    const projectSchema = projectResourceDefaults(project).default_schema;
    const fallbackSchema = projectSchema || userDefaultSchema;
    if (fallbackSchema && !schemaDefaultApplied.current && !defaultSchema) {
      setDefaultSchema(fallbackSchema);
      schemaDefaultApplied.current = true;
    }
  }, [project, userDefaultSchema, defaultSchema]);

  // Set default workspace folder from user email and project name once when first available
  const folderDefaultApplied = useRef(false);
  useEffect(() => {
    const projectFolder = projectResourceDefaults(project).workspace_folder;
    const fallbackFolder = projectFolder || (
      user && project?.name && projectId
        ? generatedWorkspaceFolder(user, project.name, projectId)
        : ''
    );
    if (fallbackFolder && !folderDefaultApplied.current && !workspaceFolder) {
      setWorkspaceFolder(fallbackFolder);
      folderDefaultApplied.current = true;
    }
  }, [user, project, projectId, workspaceFolder]);

  // Create new conversation
  const handleNewConversation = async () => {
    if (!projectId) return;

    try {
      const conv = await createConversation(projectId);
      currentConvIdRef.current = conv.id; // Update ref immediately
      setConversations((prev) => [conv, ...prev]);
      setCurrentConversation(conv);
      setMessages([]);
      setAnalysisStories([]);
      setActiveStoryId(undefined);
      setInput('');
      // Clear streaming UI (new conv isn't streaming yet)
      setStreamingText('');
      setTodos([]);
      setActiveExecutionId(null);
      setIsReconnecting(false);
      setSelectedClusterId(resolveClusterId(conv, project, clusters));
      setSelectedWarehouseId(resolveWarehouseId(conv, project, warehouses));
      setDefaultCatalog(resolveDefaultCatalog(conv, project));
      setDefaultSchema(resolveDefaultSchema(conv, project, userDefaultSchema));
      setWorkspaceFolder(resolveWorkspaceFolder(conv, project, user, projectId));
      setMlflowExperimentName(resolveMlflowExperimentName(project));
      inputRef.current?.focus();
    } catch (error) {
      console.error('Failed to create conversation:', error);
      toast.error('Failed to create conversation');
    }
  };


  // Start an agent run from either the composer or a recovery action.
  const submitMessage = useCallback(async (
    message: string,
    options: { clearInput?: boolean } = {}
  ) => {
    const userMessage = message.trim();
    if (!projectId || !userMessage) return;
    const convId = currentConversation?.id;
    // Block only if THIS conversation is already streaming
    if (convId && allStreamsRef.current[convId]) return;

    if (options.clearInput !== false) {
      setInput('');
    }
    setStreamingText('');
    setTodos([]);

    // Add user message to UI immediately
    const tempUserMessage: Message = {
      id: `temp-${Date.now()}`,
      conversation_id: convId || '',
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
      is_error: false,
    };
    setMessages((prev) => [...prev, tempUserMessage]);
    const runningStory = createAnalysisStory({
      id: `story-${tempUserMessage.id}`,
      conversationId: convId || undefined,
      question: userMessage,
      status: 'running',
      messageIds: [tempUserMessage.id],
    });
    setAnalysisStories((prev) => [...prev, runningStory]);
    setActiveStoryId(runningStory.id);

    // Create abort controller and initialize stream tracking
    const abortController = new AbortController();
    const effectiveConvId = convId || '';
    let streamKey = effectiveConvId;
    allStreamsRef.current[streamKey] = {
      fullText: '',
      todos: [],
      tools: [],
      stories: [runningStory],
      executionId: null,
      abortController,
      isReconnecting: false,
      storyId: runningStory.id,
      pendingMessages: [tempUserMessage],
    };
    setStreamingConvIds(prev => [...prev, effectiveConvId]);

    try {
      let conversationId = convId;
      let fullText = '';

      await invokeAgent({
        projectId,
        conversationId,
        message: userMessage,
        clusterId: selectedClusterId,
        defaultCatalog,
        defaultSchema,
        warehouseId: selectedWarehouseId,
        workspaceFolder,
        mlflowExperimentName: mlflowExperimentName || null,
        runRole,
        signal: abortController.signal,
        onExecutionId: (executionId) => {
          const stream = allStreamsRef.current[streamKey];
          if (stream) stream.executionId = executionId;
          if (currentConvIdRef.current === streamKey) setActiveExecutionId(executionId);
        },
        onEvent: (event) => {
          const type = event.type as string;
          const stream = allStreamsRef.current[streamKey];
          const isForeground = currentConvIdRef.current === streamKey;

          if (type === 'conversation.created') {
            const newConvId = event.conversation_id as string;
            // Move stream entry from old key to new key
            const oldStream = allStreamsRef.current[streamKey];
            applyStoryStreamEvent(oldStream, event);
            delete allStreamsRef.current[streamKey];
            const oldKey = streamKey;
            streamKey = newConvId;
            allStreamsRef.current[newConvId] = oldStream || {
              fullText: '', activityItems: [], todos: [], tools: [],
              stories: [],
              executionId: null, abortController, isReconnecting: false,
              pendingMessages: [],
            };
            conversationId = newConvId;

            // CRITICAL: Update the conversation_id of any temporary messages so they don't disappear
            setMessages(prev => prev.map(m => 
              (m.conversation_id === oldKey || m.conversation_id === '') 
                ? { ...m, conversation_id: newConvId } 
                : m
            ));

            // CRITICAL: Update stories associated with the old key
            setAnalysisStories(prev => prev.map(s => 
              (s.conversationId === oldKey || !s.conversationId) 
                ? { ...s, conversationId: newConvId } 
                : s
            ));

            // Update streamingConvIds from old key to new key
            setStreamingConvIds(prev => prev.filter(id => id !== oldKey).concat(newConvId));
            // Set currentConversation immediately so UI stays consistent
            setCurrentConversation((prev) => prev ?? {
              id: newConvId,
              project_id: projectId,
              title: 'New Chat',
              created_at: new Date().toISOString(),
              conversation_count: 0,
            } as unknown as Conversation);
            currentConvIdRef.current = newConvId;
            fetchConversations(projectId).then(setConversations);
          } else if (type === 'text_delta') {
            applyStoryStreamEvent(stream, event);
            const text = event.text as string;
            fullText += text;
            if (stream) stream.fullText = fullText;
            if (isForeground) setStreamingText(fullText);
          } else if (type === 'text') {
            applyStoryStreamEvent(stream, event);
            const text = event.text as string;
            if (text) {
              if (fullText && !fullText.endsWith('\n') && !text.startsWith('\n')) {
                fullText += '\n\n';
              }
              fullText += text;
              if (stream) stream.fullText = fullText;
              if (isForeground) setStreamingText(fullText);
            }
          } else if (type === 'thinking' || type === 'thinking_delta') {
            applyStoryStreamEvent(stream, event);
          } else if (type === 'tool_use') {
            applyStoryStreamEvent(stream, event);
            const toolName = event.tool_name as string;
            if (stream) {
              stream.tools = [...stream.tools, toolName];
            }
          } else if (type === 'tool_result') {
            applyStoryStreamEvent(stream, event);
          } else if (type === 'error') {
            applyStoryStreamEvent(stream, event);
            let errorMsg = event.error as string;
            if (errorMsg === 'Stream closed' || errorMsg.includes('Stream closed')) {
              errorMsg = 'Execution interrupted: The operation took too long or the connection was lost. Operations exceeding 50 seconds may be interrupted. Check backend logs for details.';
            }
            toast.error(errorMsg, { duration: 8000 });
          } else if (type === 'cancelled') {
            toast.info('Generation stopped');
          } else if (type === 'todos') {
            applyStoryStreamEvent(stream, event);
            const todoItems = event.todos as TodoItem[];
            if (todoItems) {
              if (stream) stream.todos = todoItems;
              if (isForeground) setTodos(todoItems);
            }
          } else if (type === 'next_moves.updated' || type === 'result') {
            applyStoryStreamEvent(stream, event);
          } else if (
            type === 'plan.created'
            || type === 'plan.step_started'
            || type === 'plan.step_finished'
            || type === 'plan.revised'
            || type === 'synthesis.appended'
          ) {
            // Semantic plan/synthesis events drive the stepper and synthesis card.
            // Without this branch they silently fall through and the UI stays on
            // "Scoping the work…" even after the agent has progressed.
            applyStoryStreamEvent(stream, event);
          }
        },
        onError: (error) => {
          console.error('Stream error:', error);
          const errorMessage = error.message || 'Failed to get response';
          const stream = allStreamsRef.current[streamKey];
          if (stream?.storyId) {
            applyStoryEvents(stream, [{ type: 'story.failed', storyId: stream.storyId, error: errorMessage }]);
          }
          delete allStreamsRef.current[streamKey];
          setStreamingConvIds(prev => prev.filter(id => id !== streamKey));
          if (currentConvIdRef.current === streamKey) {
            setStreamingText('');
            setActiveExecutionId(null);
            setTodos([]);
          }
          toast.error(errorMessage, { duration: 8000 });
        },
        onDone: async () => {
          const finalStreamKey = streamKey;
          const stream = allStreamsRef.current[finalStreamKey];
          const tools = stream?.tools || [];
          if (stream?.storyId) {
            applyStoryEvents(stream, [{ type: 'story.completed', storyId: stream.storyId }]);
          }

          if (fullText) {
            const msgId = `msg-${Date.now()}`;
            const assistantMessage: Message = {
              id: msgId,
              conversation_id: conversationId || '',
              role: 'assistant',
              content: fullText,
              timestamp: new Date().toISOString(),
              is_error: false,
            };
            // Only update messages if user is viewing this conversation
            if (currentConvIdRef.current === finalStreamKey) {
              setMessages((prev) => [...prev, assistantMessage]);
            }
            if (tools.length > 0) {
              setMessageTools((prev) => ({ ...prev, [msgId]: tools }));
            }
          }

          // Clean up stream
          delete allStreamsRef.current[finalStreamKey];
          setStreamingConvIds(prev => prev.filter(id => id !== finalStreamKey));

          if (currentConvIdRef.current === finalStreamKey) {
            setStreamingText('');
            setActiveExecutionId(null);
            setTodos([]);
          }

          // Fetch full conversation to get updated title and messages
          if (conversationId) {
            const conv = await fetchConversation(projectId, conversationId);
            if (currentConvIdRef.current === finalStreamKey) {
              setCurrentConversation(conv);
            }
            fetchConversations(projectId).then(setConversations);
            // Notify the Sidebar so its cached list picks up any AI-generated title.
            emitConversationUpdated({ projectId, conversationId });
          }
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error('Failed to send message:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to send message';
      toast.error(errorMessage, { duration: 8000 });
      // Clean up stream on error
      const stream = allStreamsRef.current[streamKey];
      if (stream?.storyId) {
        applyStoryEvents(stream, [{ type: 'story.failed', storyId: stream.storyId, error: errorMessage }]);
      }
      delete allStreamsRef.current[streamKey];
      setStreamingConvIds(prev => prev.filter(id => id !== streamKey));
      if (currentConvIdRef.current === streamKey) {
        setStreamingText('');
        setActiveExecutionId(null);
        setTodos([]);
      }
    }
  }, [
    projectId,
    currentConversation?.id,
    selectedClusterId,
    defaultCatalog,
    defaultSchema,
    selectedWarehouseId,
    workspaceFolder,
    mlflowExperimentName,
    runRole,
    applyStoryEvents,
    applyStoryStreamEvent,
  ]);

  const handleSendMessage = useCallback(async () => {
    await submitMessage(input, { clearInput: true });
  }, [input, submitMessage]);

  // Stop generation - abort client stream AND tell backend to cancel
  const handleStopGeneration = useCallback(async () => {
    const targetId = currentConversation?.id;
    if (!targetId) return;

    const stream = allStreamsRef.current[targetId];
    if (!stream) return;

    // Abort the fetch
    stream.abortController?.abort();

    // Tell the backend to cancel the agent execution
    if (stream.executionId) {
      try {
        await stopExecution(stream.executionId);
      } catch (error) {
        console.error('Failed to stop execution on backend:', error);
      }
    }

    // Save partial response
    if (stream.fullText) {
      const msgId = `msg-stopped-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: msgId,
          conversation_id: targetId,
          role: 'assistant' as const,
          content: stream.fullText,
          timestamp: new Date().toISOString(),
          is_error: false,
        },
      ]);
      if (stream.tools.length > 0) {
        setMessageTools((prev) => ({ ...prev, [msgId]: stream.tools }));
      }
    }
    if (stream.storyId) {
      applyStoryEvents(stream, [{ type: 'story.completed', storyId: stream.storyId }]);
    }

    // Clean up stream
    delete allStreamsRef.current[targetId];
    setStreamingConvIds(prev => prev.filter(id => id !== targetId));
    setStreamingText('');
    setActiveExecutionId(null);
    setTodos([]);
  }, [currentConversation?.id, applyStoryEvents]);

  // Handle keyboard submit
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Open skills explorer
  const handleViewSkills = () => {
    setSkillsExplorerOpen(true);
  };

  const [isSavingProjectManagement, setIsSavingProjectManagement] = useState(false);
  const [isValidatingProjectSetting, setIsValidatingProjectSetting] = useState(false);

  const handleSaveProjectManagement = useCallback(async (setting: ProjectSetting, payload: ProjectManagementPayload) => {
    if (!projectId || !project) return;

    setIsSavingProjectManagement(true);
    try {
      const response = await saveProjectSetting(projectId, setting);
      const updated = response.project || await updateProject(projectId, payload);
      setProject(updated);
      setProjectSetting(response.setting);
      setProjectSettingPath(response.path);
      setProjectSettingValidation(null);
      toast.success('Project settings saved');
      
      // Sync local states
      const res = updated.settings?.resources;
      if (res) {
        if (res.default_catalog !== undefined) setDefaultCatalog(res.default_catalog || '');
        if (res.default_schema !== undefined) setDefaultSchema(res.default_schema || '');
        if (res.cluster_id !== undefined) setSelectedClusterId(res.cluster_id || undefined);
        if (res.warehouse_id !== undefined) setSelectedWarehouseId(res.warehouse_id || undefined);
        if (res.workspace_folder !== undefined) setWorkspaceFolder(res.workspace_folder || '');
        if (res.mlflow_experiment_name !== undefined) setMlflowExperimentName(res.mlflow_experiment_name || '');
      }
      
      setProjectPanelOpen(false);
    } catch (error) {
      console.error('Failed to save project settings:', error);
      toast.error('Failed to save project settings');
    } finally {
      setIsSavingProjectManagement(false);
    }
  }, [projectId, project]);

  const handleValidateProjectManagement = useCallback(async (setting: ProjectSetting) => {
    if (!projectId) return;

    setIsValidatingProjectSetting(true);
    try {
      const result = await validateProjectSetting(projectId, setting);
      setProjectSettingValidation(result);
      if (result.valid) {
        toast.success(`Databricks settings valid: ${result.summary}`);
      } else {
        toast.error(`Databricks validation failed: ${result.summary}`);
      }
    } catch (error) {
      console.error('Failed to validate Databricks settings:', error);
      toast.error('Failed to validate Databricks settings');
    } finally {
      setIsValidatingProjectSetting(false);
    }
  }, [projectId]);

  const handlePublishRelease = useCallback(async (releaseId: string, notes: string) => {
    if (!projectId || !project || !releaseId.trim()) return;

    setIsSavingProjectManagement(true);
    try {
      const release: ProjectRelease = {
        id: releaseId.trim(),
        status: 'published',
        notes,
        released_at: new Date().toISOString(),
        released_by: user || undefined,
        eval_status: 'not_run',
        settings_snapshot: project.settings,
      };
      const existing = (project.settings?.releases || []).filter((item) => item.id !== release.id);
      const updated = await updateProject(projectId, {
        status: 'active',
        current_release_id: release.id,
        settings: {
          releases: [release, ...existing],
          governance: {
            audit_events: [
              `Published ${release.id} by ${user || 'unknown'} at ${release.released_at}`,
              ...(project.settings?.governance?.audit_events || []),
            ],
          },
        },
      });
      setProject(updated);
      toast.success('Project release published');
    } catch (error) {
      console.error('Failed to publish release:', error);
      toast.error('Failed to publish release');
    } finally {
      setIsSavingProjectManagement(false);
    }
  }, [projectId, project, user]);

  const handleStartUserPreview = useCallback(async () => {
    setRunRole('user_preview');
    setProjectPanelOpen(false);
    await handleNewConversation();
    toast.success('User preview chat started');
  }, [handleNewConversation]);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  };

  const activeStory = useMemo(
    () => analysisStories.find((story) => story.id === activeStoryId),
    [analysisStories, activeStoryId]
  );

  const starterPrompts = useMemo(() => (
    runRole === 'user_preview'
      ? [
        { title: 'Explain results', desc: 'Summarize the published project outputs and assumptions', prompt: 'Explain the latest published results and the assumptions behind them' },
        { title: 'Validate sources', desc: 'Check data sources, freshness, and caveats', prompt: 'Validate the data sources, freshness, and caveats for this project' },
        { title: 'Explore metrics', desc: 'Review available governed metrics and dimensions', prompt: 'Show the available metrics and dimensions for this project' },
        { title: 'Drill down', desc: 'Investigate an important segment or exception', prompt: 'Drill down into the most important segment or exception in this project' },
      ]
      : [
        { title: 'Generate synthetic data', desc: 'Realistic test datasets with customers, orders, and tickets', prompt: 'Generate synthetic customer data with orders and support tickets' },
        { title: 'Build a data pipeline', desc: 'ETL workflows with medallion architecture', prompt: 'Create a data pipeline to transform raw data into bronze, silver, and gold layers' },
        { title: 'Create a dashboard', desc: 'Interactive AI/BI visualizations', prompt: 'Create a dashboard to visualize customer metrics and trends' },
        { title: 'Explore my data', desc: 'Tables, volumes, and resources in your project', prompt: 'What tables and data do I have in my project?' },
      ]
  ), [runRole]);

  const handleNextMove = useCallback((move: NextMove) => {
    setInput(move.prompt);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const handleRetryStory = useCallback((story: AnalysisStory) => {
    void submitMessage(story.question, { clearInput: false });
  }, [submitMessage]);

  const handleStarterPrompt = useCallback((prompt: string) => {
    setInput(prompt);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Only show streaming UI if viewing a conversation that is actively streaming
  const isStreamingHere = streamingConvIds.includes(currentConversation?.id || '');

  if (isLoading) {
    return (
      <MainLayout projectName={project?.name}>
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--color-text-muted)]" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout projectName={project?.name} hideTopBar>
      <div className="flex h-full min-h-0 overflow-hidden">
        {/* Left Panel: Sidebar */}
        <Sidebar
          onViewSkills={handleViewSkills}
          onOpenProjectSettings={() => setProjectPanelOpen(true)}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={setIsSidebarCollapsed}
          style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
          isResizing={isResizingLeft}
        />
        
        {/* Left Resize Handle */}
        {!isSidebarCollapsed && (
          <div 
            className="w-1 cursor-col-resize hover:bg-[var(--color-accent-primary)]/50 transition-colors flex-shrink-0"
            onMouseDown={() => setIsResizingLeft(true)}
          />
        )}

        {/* Rest of the layout (Middle + Right) */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Chat Header */}
          <div className="flex h-14 items-center justify-between border-b border-[var(--color-border)]/60 px-6 bg-[var(--color-bg-secondary)]/20">
            <div className="flex items-center gap-1.5 min-w-0">
              <h2 className="font-semibold text-[15px] text-[var(--color-text-heading)] truncate">
                {currentConversation?.title || 'New Chat'}
              </h2>
              {currentConversation && (
                <div className="relative flex-shrink-0" ref={chatMenuRef}>
                  <button
                    type="button"
                    onClick={() => setIsChatMenuOpen((open) => !open)}
                    className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-border)]/50 hover:text-[var(--color-text-primary)] transition-all"
                    title="More options"
                    aria-haspopup="menu"
                    aria-expanded={isChatMenuOpen}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {isChatMenuOpen && (
                    <div
                      role="menu"
                      className="absolute left-0 top-full mt-1 z-20 min-w-[160px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-lg overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setIsChatMenuOpen(false);
                          setIsRenameOpen(true);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Rename
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <ChatRenameModal
              isOpen={isRenameOpen}
              initialTitle={currentConversation?.title || ''}
              onClose={() => setIsRenameOpen(false)}
              onSave={handleRenameConversation}
            />
            <div className="flex items-center gap-2.5">
              <div className="hidden lg:flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-0.5">
                <button
                  type="button"
                  onClick={() => setRunRole('developer')}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
                    runRole === 'developer'
                      ? 'bg-[var(--color-background)] text-[var(--color-text-heading)] shadow-sm'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-heading)]'
                  )}
                >
                  <Code2 className="h-3.5 w-3.5" />
                  Developer
                </button>
                <button
                  type="button"
                  onClick={() => setRunRole('user_preview')}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
                    runRole === 'user_preview'
                      ? 'bg-[var(--color-background)] text-[var(--color-text-heading)] shadow-sm'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-heading)]'
                  )}
                >
                  <Eye className="h-3.5 w-3.5" />
                  User Preview
                </button>
              </div>

            </div>
          </div>

          <ProjectManagementPanel
            isOpen={projectPanelOpen}
            onClose={() => setProjectPanelOpen(false)}
            project={project}
            projectSetting={projectSetting}
            projectSettingPath={projectSettingPath}
            validationResult={projectSettingValidation}
            clusters={clusters}
            warehouses={warehouses}
            onSave={handleSaveProjectManagement}
            onValidate={handleValidateProjectManagement}
            onPublish={handlePublishRelease}
            onStartUserPreview={handleStartUserPreview}
            isSaving={isSavingProjectManagement}
            isValidating={isValidatingProjectSetting}
          />

          {/* Analysis Canvas and Input Area */}
          <div className="min-h-0 flex-1 overflow-hidden">
            <div className="flex h-full min-h-0">
              {/* Middle Panel: StoryCanvas + Input */}
              <div className="flex-1 flex flex-col min-w-[400px] border-r border-[var(--color-border)]/40 overflow-hidden">
                <div className="flex-1 overflow-y-auto no-scrollbar">
                  <StoryCanvas
                    stories={analysisStories}
                    activeStoryId={activeStoryId}
                    onSelectStory={setActiveStoryId}
                    onNextMove={handleNextMove}
                    onRetryStory={handleRetryStory}
                    retryDisabled={isStreamingHere}
                    emptyTitle={runRole === 'user_preview' ? 'What would a user ask?' : 'What can I help you build?'}
                    emptyDescription={
                      runRole === 'user_preview'
                        ? 'Preview the published project with read-only tools and release-pinned context.'
                        : 'Build data pipelines, generate synthetic data, create dashboards, and explore Databricks resources.'
                    }
                    starterPrompts={starterPrompts}
                    onStarterPrompt={handleStarterPrompt}
                  />

                  {isStreamingHere && analysisStories.length === 0 && (
                    <div className="mx-auto w-full max-w-4xl px-6 pb-6">
                      {isReconnecting ? (
                        <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Reconnecting to agent...</span>
                        </div>
                      ) : (
                        <FunLoader todos={todos} className="py-1" />
                      )}
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="px-6 pb-5 pt-3 bg-[var(--color-background)]">
                  <div className="mx-auto max-w-4xl w-full">
                    <div className="relative rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] shadow-sm shadow-black/[0.03] focus-within:border-[var(--color-accent-primary)]/40 focus-within:shadow-lg focus-within:shadow-[var(--color-accent-primary)]/[0.06] transition-all duration-300">
                      <textarea
                        ref={inputRef}
                        value={input}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        placeholder="Message the assistant..."
                        rows={1}
                        className="w-full resize-none bg-transparent px-5 pt-4 pb-14 text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ maxHeight: 200 }}
                        disabled={isStreamingHere}
                      />
                      <div className="absolute bottom-3 left-5 right-3 flex items-center justify-between">
                        <span className="text-[11px] text-[var(--color-text-muted)]/40 select-none">
                          <kbd className="px-1.5 py-0.5 rounded border border-[var(--color-border)]/40 bg-[var(--color-bg-secondary)]/50 text-[10px] font-mono">Enter</kbd> to send
                        </span>
                        {isStreamingHere ? (
                          <button
                            onClick={handleStopGeneration}
                            className="flex items-center justify-center h-9 w-9 rounded-xl bg-[var(--color-destructive)] hover:bg-[var(--color-destructive)]/90 text-white transition-all shadow-sm hover:shadow-md"
                            title="Stop generation"
                          >
                            <Square className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={handleSendMessage}
                            disabled={!input.trim()}
                            className={cn(
                              'flex items-center justify-center h-9 w-9 rounded-xl transition-all',
                              input.trim()
                                ? 'bg-[var(--color-accent-primary)] hover:bg-[var(--color-accent-primary)]/90 text-white shadow-sm shadow-[var(--color-accent-primary)]/30 hover:shadow-md hover:shadow-[var(--color-accent-primary)]/40'
                                : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]/40 cursor-not-allowed'
                            )}
                            title="Send message"
                          >
                            <ArrowUp className="h-4.5 w-4.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Resize Handle */}
              <div 
                className="w-1 cursor-col-resize hover:bg-[var(--color-accent-primary)]/50 transition-colors flex-shrink-0"
                onMouseDown={() => setIsResizingRight(true)}
              />

              {/* Right Panel */}
              <div style={{ width: `${rightPanelWidth}px` }} className="flex-shrink-0 min-w-[250px]">
                <RightInspectPanel story={activeStory} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Skills Explorer */}
      {skillsExplorerOpen && projectId && (
        <SkillsExplorer
          projectId={projectId}
          systemPromptParams={{
            clusterId: selectedClusterId,
            warehouseId: selectedWarehouseId,
            defaultCatalog,
            defaultSchema,
            workspaceFolder,
            projectId,
          }}
          onClose={() => setSkillsExplorerOpen(false)}
        />
      )}

      {/* Resizing Overlay */}
      {(isResizingLeft || isResizingRight) && (
        <div className="fixed inset-0 z-50 cursor-col-resize" />
      )}
    </MainLayout>
  );
}
