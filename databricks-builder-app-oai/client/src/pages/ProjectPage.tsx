import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  Code2,
  Eye,
  ExternalLink,
  FolderCog,
  Loader2,
  Save,
  Settings2,
  ShieldCheck,
  Square,
  Sparkles,
  UserRound,
  Wrench,
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
  storiesFromMessages,
  storyEventsFromStreamEvent,
} from '@/features/analysis/storyTransforms';
import type { AnalysisEvent, AnalysisStory, NextMove } from '@/features/analysis/types';
import {
  createConversation,
  deleteConversation,
  fetchClusters,
  fetchConversation,
  fetchConversations,
  fetchExecutions,
  fetchProject,
  fetchWarehouses,
  invokeAgent,
  reconnectToExecution,
  stopExecution,
  updateProject,
} from '@/lib/api';
import type {
  Cluster,
  Conversation,
  Message,
  Project,
  ProjectRelease,
  ProjectSettings,
  Warehouse,
  TodoItem,
} from '@/lib/types';
import { cn } from '@/lib/utils';

// Combined activity item for display
interface ActivityItem {
  id: string;
  type: 'thinking' | 'tool_use' | 'tool_result';
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  isError?: boolean;
  timestamp: number;
}

interface ActiveStream {
  fullText: string;
  activityItems: ActivityItem[];
  todos: TodoItem[];
  tools: string[];
  stories: AnalysisStory[];
  executionId: string | null;
  abortController: AbortController | null;
  isReconnecting: boolean;
  storyId?: string;
  pendingMessages: Message[];
}

// Databricks logo mark SVG
function DatabricksLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M18 2L3 10.5V12.5L18 21L33 12.5V10.5L18 2Z" fill="currentColor" />
      <path d="M18 24.5L3 16V18L18 27L33 18V16L18 24.5Z" fill="currentColor" />
      <path d="M18 30.5L3 22V24L18 33L33 24V22L18 30.5Z" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

// Activity indicator - shows current tool with animated dots
function ActivitySection({
  items,
}: {
  items: ActivityItem[];
  isStreaming: boolean;
}) {
  if (items.length === 0) return null;

  const currentTool = [...items].reverse().find((item) => item.type === 'tool_use');
  if (!currentTool) return null;

  const toolName = currentTool.toolName?.replace('mcp__databricks__', '').replace(/_/g, ' ') || 'working';

  return (
    <div className="flex items-start gap-3 max-w-3xl">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-[var(--color-accent-primary)] to-[var(--color-accent-secondary)] flex items-center justify-center shadow-sm mt-0.5">
        <DatabricksLogo className="h-4 w-4 text-white" />
      </div>
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--color-bg-secondary)]/60 border border-[var(--color-border)]/30">
        <Wrench className="h-3.5 w-3.5 text-[var(--color-accent-primary)] animate-pulse" />
        <span className="text-xs text-[var(--color-text-muted)] capitalize">
          {toolName}
        </span>
        <span className="flex gap-0.5">
          <span className="w-1 h-1 rounded-full bg-[var(--color-text-muted)] animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1 h-1 rounded-full bg-[var(--color-text-muted)] animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1 h-1 rounded-full bg-[var(--color-text-muted)] animate-bounce" style={{ animationDelay: '300ms' }} />
        </span>
      </div>
    </div>
  );
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

// Configuration panel component
function ConfigPanel({
  isOpen,
  onClose,
  defaultCatalog,
  setDefaultCatalog,
  defaultSchema,
  setDefaultSchema,
  clusters,
  selectedClusterId,
  setSelectedClusterId,
  warehouses,
  selectedWarehouseId,
  setSelectedWarehouseId,
  workspaceFolder,
  setWorkspaceFolder,
  mlflowExperimentName,
  setMlflowExperimentName,
  workspaceUrl,
  onSaveProjectDefaults,
  isSavingProjectDefaults,
}: {
  isOpen: boolean;
  onClose: () => void;
  defaultCatalog: string;
  setDefaultCatalog: (v: string) => void;
  defaultSchema: string;
  setDefaultSchema: (v: string) => void;
  clusters: Cluster[];
  selectedClusterId?: string;
  setSelectedClusterId: (v: string | undefined) => void;
  warehouses: Warehouse[];
  selectedWarehouseId?: string;
  setSelectedWarehouseId: (v: string | undefined) => void;
  workspaceFolder: string;
  setWorkspaceFolder: (v: string) => void;
  mlflowExperimentName: string;
  setMlflowExperimentName: (v: string) => void;
  workspaceUrl: string | null;
  onSaveProjectDefaults: () => void;
  isSavingProjectDefaults: boolean;
}) {
  if (!isOpen) return null;

  return (
    <div className="absolute right-0 top-full mt-2 w-96 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-2xl z-50 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-border)]/50 bg-[var(--color-bg-secondary)]/30">
        <h3 className="text-sm font-semibold text-[var(--color-text-heading)]">Configuration</h3>
        <button onClick={onClose} className="p-1 rounded-md hover:bg-[var(--color-bg-secondary)] transition-colors">
          <X className="h-4 w-4 text-[var(--color-text-muted)]" />
        </button>
      </div>
      <div className="p-5 space-y-5">
        {/* Catalog & Schema - stacked for more room */}
        <div>
          <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">Catalog / Schema</label>
          <div className="mt-1.5 flex items-center gap-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] overflow-hidden focus-within:ring-2 focus-within:ring-[var(--color-accent-primary)]/30 focus-within:border-[var(--color-accent-primary)]/50">
            <input
              type="text"
              value={defaultCatalog}
              onChange={(e) => setDefaultCatalog(e.target.value)}
              placeholder="catalog"
              className="flex-1 h-10 px-3 bg-transparent text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]/50 focus:outline-none min-w-0"
            />
            <span className="text-[var(--color-text-muted)] font-bold text-lg leading-none select-none">.</span>
            <input
              type="text"
              value={defaultSchema}
              onChange={(e) => setDefaultSchema(e.target.value)}
              placeholder="schema"
              className="flex-1 h-10 px-3 bg-transparent text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]/50 focus:outline-none min-w-0"
            />
            {workspaceUrl && defaultCatalog && defaultSchema && (
              <a
                href={`${workspaceUrl}/explore/data/${defaultCatalog}/${defaultSchema}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center h-10 w-10 flex-shrink-0 border-l border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-accent-primary)] hover:bg-[var(--color-bg-secondary)]/50 transition-colors"
                title="Open in Catalog Explorer"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>

        {/* Cluster - custom dropdown */}
        {clusters.length > 0 && (
          <ResourceDropdown
            label="Cluster"
            items={clusters}
            selectedId={selectedClusterId}
            onSelect={setSelectedClusterId}
            nameKey="cluster_name"
            idKey="cluster_id"
          />
        )}

        {/* Warehouse - custom dropdown */}
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

        {/* Workspace Folder */}
        <div>
          <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">Workspace Folder</label>
          <input
            type="text"
            value={workspaceFolder}
            onChange={(e) => setWorkspaceFolder(e.target.value)}
            placeholder="/Workspace/Users/..."
            className="mt-1.5 w-full h-10 px-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-primary)]/30 focus:border-[var(--color-accent-primary)]/50"
          />
        </div>

        {/* MLflow Experiment */}
        <div>
          <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">MLflow Experiment</label>
          <input
            type="text"
            value={mlflowExperimentName}
            onChange={(e) => setMlflowExperimentName(e.target.value)}
            placeholder="Experiment ID or name"
            className="mt-1.5 w-full h-10 px-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-primary)]/30 focus:border-[var(--color-accent-primary)]/50"
          />
        </div>

        <button
          type="button"
          onClick={onSaveProjectDefaults}
          disabled={isSavingProjectDefaults}
          className="w-full h-10 inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--color-accent-primary)] text-white text-sm font-medium hover:bg-[var(--color-accent-secondary)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {isSavingProjectDefaults ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save as Project Defaults
        </button>
      </div>
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

function stringifyGlossary(glossary?: Record<string, string>): string {
  return Object.entries(glossary || {})
    .map(([term, definition]) => `${term}: ${definition}`)
    .join('\n');
}

function parseGlossary(value: string): Record<string, string> {
  const glossary: Record<string, string> = {};
  for (const line of splitLines(value)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex < 1) continue;
    const term = line.slice(0, separatorIndex).trim();
    const definition = line.slice(separatorIndex + 1).trim();
    if (term && definition) glossary[term] = definition;
  }
  return glossary;
}

function computeReadiness(project: Project | null): Record<string, boolean> {
  const settings = project?.settings;
  const resources = settings?.resources || {};
  const semantics = settings?.semantics || {};
  return {
    purpose: Boolean(project?.description?.trim()),
    catalogSchema: Boolean(resources.default_catalog && resources.default_schema),
    warehouse: Boolean(resources.warehouse_id),
    workspaceFolder: Boolean(resources.workspace_folder),
    semanticScope: Boolean(
      (semantics.metric_views?.length || 0) > 0
      || (semantics.preferred_tables?.length || 0) > 0
    ),
    release: Boolean(project?.current_release_id && project.current_release_id !== 'draft'),
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
  onSave,
  onPublish,
  onStartUserPreview,
  isSaving,
}: {
  isOpen: boolean;
  onClose: () => void;
  project: Project | null;
  onSave: (payload: ProjectManagementPayload) => void;
  onPublish: (releaseId: string, notes: string) => void;
  onStartUserPreview: () => void;
  isSaving: boolean;
}) {
  const [description, setDescription] = useState('');
  const [projectType, setProjectType] = useState('databricks_app_build');
  const [status, setStatus] = useState('draft');
  const [audience, setAudience] = useState('developer');
  const [successCriteria, setSuccessCriteria] = useState('');
  const [metricViews, setMetricViews] = useState('');
  const [preferredTables, setPreferredTables] = useState('');
  const [deprecatedTables, setDeprecatedTables] = useState('');
  const [sampleQueries, setSampleQueries] = useState('');
  const [glossary, setGlossary] = useState('');
  const [caveats, setCaveats] = useState('');
  const [pinnedResources, setPinnedResources] = useState('');
  const [users, setUsers] = useState('');
  const [viewers, setViewers] = useState('');
  const [workflows, setWorkflows] = useState('');
  const [artifacts, setArtifacts] = useState('');
  const [approvedMemory, setApprovedMemory] = useState('');
  const [feedback, setFeedback] = useState('');
  const [evalCases, setEvalCases] = useState('');
  const [retentionPolicy, setRetentionPolicy] = useState('project_default');
  const [exportPolicy, setExportPolicy] = useState('exclude_secrets');
  const [releaseId, setReleaseId] = useState(makeReleaseId());
  const [releaseNotes, setReleaseNotes] = useState('');

  useEffect(() => {
    if (!project || !isOpen) return;
    const settings = project.settings || { version: 1 };
    setDescription(project.description || '');
    setProjectType(project.project_type || 'databricks_app_build');
    setStatus(project.status || 'draft');
    setAudience(settings.identity?.audience || 'developer');
    setSuccessCriteria(joinLines(settings.identity?.success_criteria));
    setMetricViews(joinLines(settings.semantics?.metric_views));
    setPreferredTables(joinLines(settings.semantics?.preferred_tables));
    setDeprecatedTables(joinLines(settings.semantics?.deprecated_tables));
    setSampleQueries(joinLines(settings.semantics?.sample_queries));
    setGlossary(stringifyGlossary(settings.semantics?.glossary));
    setCaveats(joinLines(settings.semantics?.known_caveats));
    setPinnedResources(joinLines(settings.resource_registry?.pinned));
    setUsers(joinLines(settings.roles?.users));
    setViewers(joinLines(settings.roles?.viewers));
    setWorkflows(joinLines(settings.workflows?.enabled));
    setArtifacts(joinLines(settings.artifacts));
    setApprovedMemory(joinLines(settings.memory?.approved));
    setFeedback(joinLines(settings.feedback));
    setEvalCases(joinLines(settings.eval_cases));
    setRetentionPolicy(settings.governance?.retention_policy || 'project_default');
    setExportPolicy(settings.governance?.export_policy || 'exclude_secrets');
    setReleaseId(makeReleaseId());
    setReleaseNotes('');
  }, [project, isOpen]);

  if (!isOpen) return null;

  const readiness = computeReadiness(project);
  const releaseCount = project?.settings?.releases?.length || 0;

  const handleSave = () => {
    onSave({
      description: description || null,
      project_type: projectType,
      status,
      settings: {
        identity: {
          audience,
          success_criteria: splitLines(successCriteria),
        },
        resource_registry: {
          pinned: splitLines(pinnedResources),
          metadata_cache_status: splitLines(pinnedResources).length > 0 ? 'configured' : 'not_configured',
        },
        semantics: {
          metric_views: splitLines(metricViews),
          preferred_tables: splitLines(preferredTables),
          deprecated_tables: splitLines(deprecatedTables),
          sample_queries: splitLines(sampleQueries),
          glossary: parseGlossary(glossary),
          known_caveats: splitLines(caveats),
        },
        roles: {
          users: splitLines(users),
          viewers: splitLines(viewers),
        },
        workflows: {
          enabled: splitLines(workflows),
        },
        artifacts: splitLines(artifacts),
        memory: {
          approved: splitLines(approvedMemory),
        },
        feedback: splitLines(feedback),
        eval_cases: splitLines(evalCases),
        governance: {
          retention_policy: retentionPolicy || 'project_default',
          export_policy: exportPolicy || 'exclude_secrets',
          readiness,
        },
      },
    });
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-sm">
      <div className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-6 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-[var(--color-text-heading)]">Project Management</h3>
            <p className="text-xs text-[var(--color-text-muted)] truncate">
              {project?.name || 'Project'} · {releaseCount} release{releaseCount === 1 ? '' : 's'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-[var(--color-bg-secondary)]">
            <X className="h-4 w-4 text-[var(--color-text-muted)]" />
          </button>
        </div>

        <div className="space-y-6 p-6">
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-heading)]">
              <FolderCog className="h-4 w-4 text-[var(--color-accent-primary)]" />
              Setup
            </div>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Project purpose..." className="min-h-20 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
            <div className="grid grid-cols-2 gap-3">
              <select value={projectType} onChange={(e) => setProjectType(e.target.value)} className="h-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm">
                <option value="databricks_app_build">Databricks app build</option>
                <option value="analyst_workspace">Analyst workspace</option>
                <option value="dashboard_companion">Dashboard companion</option>
                <option value="data_product_build">Data product build</option>
                <option value="investigation_ops">Investigation / ops</option>
              </select>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm">
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Audience or persona" className="h-10 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm" />
            <textarea value={successCriteria} onChange={(e) => setSuccessCriteria(e.target.value)} placeholder="Success criteria, one per line" className="min-h-20 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-heading)]">
              <BookOpen className="h-4 w-4 text-[var(--color-accent-primary)]" />
              Resource And Semantic Registry
            </div>
            <textarea value={pinnedResources} onChange={(e) => setPinnedResources(e.target.value)} placeholder="Pinned Databricks resources, one per line" className="min-h-20 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
            <div className="grid grid-cols-2 gap-3">
              <textarea value={metricViews} onChange={(e) => setMetricViews(e.target.value)} placeholder="Metric views, one per line" className="min-h-24 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
              <textarea value={preferredTables} onChange={(e) => setPreferredTables(e.target.value)} placeholder="Preferred tables, one per line" className="min-h-24 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
              <textarea value={deprecatedTables} onChange={(e) => setDeprecatedTables(e.target.value)} placeholder="Deprecated/blocked tables" className="min-h-24 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
              <textarea value={sampleQueries} onChange={(e) => setSampleQueries(e.target.value)} placeholder="Known-good SQL/query patterns" className="min-h-24 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
            </div>
            <textarea value={glossary} onChange={(e) => setGlossary(e.target.value)} placeholder="Glossary lines: ARR: Annual recurring revenue" className="min-h-24 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
            <textarea value={caveats} onChange={(e) => setCaveats(e.target.value)} placeholder="Known caveats, one per line" className="min-h-20 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-heading)]">
              <UserRound className="h-4 w-4 text-[var(--color-accent-primary)]" />
              Roles And User Preview
            </div>
            <div className="grid grid-cols-2 gap-3">
              <textarea value={users} onChange={(e) => setUsers(e.target.value)} placeholder="Users, one email/group per line" className="min-h-20 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
              <textarea value={viewers} onChange={(e) => setViewers(e.target.value)} placeholder="Viewers, one email/group per line" className="min-h-20 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
            </div>
            <button type="button" onClick={onStartUserPreview} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 text-sm hover:bg-[var(--color-bg-secondary)]">
              <Eye className="h-4 w-4" />
              Start User Preview Chat
            </button>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-heading)]">
              <ShieldCheck className="h-4 w-4 text-[var(--color-accent-primary)]" />
              Releases And Governance
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input value={releaseId} onChange={(e) => setReleaseId(e.target.value)} className="h-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm" />
              <button type="button" onClick={() => onPublish(releaseId, releaseNotes)} className="h-10 rounded-lg border border-[var(--color-border)] px-3 text-sm hover:bg-[var(--color-bg-secondary)]">
                Publish Snapshot
              </button>
            </div>
            <textarea value={releaseNotes} onChange={(e) => setReleaseNotes(e.target.value)} placeholder="Release notes" className="min-h-20 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
            <div className="grid grid-cols-2 gap-3">
              <input value={retentionPolicy} onChange={(e) => setRetentionPolicy(e.target.value)} placeholder="Retention policy" className="h-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm" />
              <input value={exportPolicy} onChange={(e) => setExportPolicy(e.target.value)} placeholder="Export policy" className="h-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm" />
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-heading)]">
              <Code2 className="h-4 w-4 text-[var(--color-accent-primary)]" />
              Workflows, Artifacts, Memory
            </div>
            <div className="grid grid-cols-2 gap-3">
              <textarea value={workflows} onChange={(e) => setWorkflows(e.target.value)} placeholder="Enabled workflows" className="min-h-20 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
              <textarea value={artifacts} onChange={(e) => setArtifacts(e.target.value)} placeholder="Artifacts" className="min-h-20 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
              <textarea value={approvedMemory} onChange={(e) => setApprovedMemory(e.target.value)} placeholder="Approved memory" className="min-h-20 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
              <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Feedback queue" className="min-h-20 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
            </div>
            <textarea value={evalCases} onChange={(e) => setEvalCases(e.target.value)} placeholder="Eval cases, one per line" className="min-h-20 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" />
          </section>

          <section className="space-y-3">
            <div className="text-sm font-semibold text-[var(--color-text-heading)]">Readiness</div>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(readiness).map(([key, ready]) => (
                <div key={key} className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs">
                  <span className={cn('h-2 w-2 rounded-full', ready ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-muted)]/40')} />
                  <span className="capitalize text-[var(--color-text-muted)]">{key.replace(/([A-Z])/g, ' $1')}</span>
                </div>
              ))}
            </div>
          </section>

          <div className="sticky bottom-0 -mx-6 border-t border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4">
            <button type="button" onClick={handleSave} disabled={isSaving} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-accent-primary)] text-sm font-medium text-white hover:bg-[var(--color-accent-secondary)] disabled:opacity-60">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Project Management Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { user, workspaceUrl } = useUser();

  // State
  const [project, setProject] = useState<Project | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [analysisStories, setAnalysisStories] = useState<AnalysisStory[]>([]);
  const [activeStoryId, setActiveStoryId] = useState<string | undefined>();
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [streamingConvIds, setStreamingConvIds] = useState<string[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
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

  const syncStoriesFromMessages = useCallback((nextMessages: Message[]) => {
    const stories = storiesFromMessages({ messages: nextMessages, messageTools: messageToolsRef.current });
    setAnalysisStories(stories);
    setActiveStoryId(stories[stories.length - 1]?.id);
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
        const [projectData, conversationsData, clustersData, warehousesData] = await Promise.all([
          fetchProject(projectId),
          fetchConversations(projectId),
          fetchClusters().catch(() => []), // Don't fail if clusters can't be loaded
          fetchWarehouses().catch(() => []), // Don't fail if warehouses can't be loaded
        ]);
        setProject(projectData);
        setConversations(conversationsData);
        setClusters(clustersData);
        setWarehouses(warehousesData);

        const generatedSchema = toSchemaName(user, projectData.name);

        // Load first conversation if available
        if (conversationsData.length > 0) {
          const conv = await fetchConversation(projectId, conversationsData[0].id);
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

  // Check for active execution when conversation loads and reconnect if needed
  useEffect(() => {
    if (!projectId || !currentConversation?.id || isLoading || allStreamsRef.current[currentConversation.id]) return;

    // Skip if we've already checked this conversation
    if (reconnectAttemptedRef.current === currentConversation.id) return;
    reconnectAttemptedRef.current = currentConversation.id;

    const checkAndReconnect = async () => {
      try {
        const { active } = await fetchExecutions(projectId, currentConversation.id);

        if (active && active.status === 'running') {
          console.log('[RECONNECT] Found active execution:', active.id);
          const reconConvId = currentConversation.id;
          const controller = new AbortController();
          const latestUserMessage = [...(currentConversation.messages || [])].reverse()
            .find((message) => message.role === 'user');
          const reconnectStory = createAnalysisStory({
            id: latestUserMessage ? `story-${latestUserMessage.id}` : undefined,
            conversationId: reconConvId,
            question: latestUserMessage?.content || currentConversation.title || 'Active analysis',
            status: 'running',
            messageIds: latestUserMessage ? [latestUserMessage.id] : [],
          });
          setAnalysisStories((prev) => (
            prev.some((story) => story.id === reconnectStory.id)
              ? prev.map((story) => (
                story.id === reconnectStory.id
                  ? { ...story, status: 'running', updatedAt: new Date().toISOString() }
                  : story
              ))
              : [...prev, reconnectStory]
          ));
          setActiveStoryId(reconnectStory.id);
          allStreamsRef.current[reconConvId] = {
            fullText: '',
            activityItems: [],
            todos: [],
            tools: [],
            stories: [reconnectStory],
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
              } else if (type === 'tool_use') {
                const newItem: ActivityItem = {
                  id: event.tool_id as string,
                  type: 'tool_use',
                  content: '',
                  toolName: event.tool_name as string,
                  toolInput: event.tool_input as Record<string, unknown>,
                  timestamp: Date.now(),
                };
                if (stream) {
                  stream.activityItems = [...stream.activityItems, newItem];
                  stream.tools = [...stream.tools, event.tool_name as string];
                }
                if (isForeground) setActivityItems(prev => [...prev, newItem]);
              } else if (type === 'tool_result') {
                const newItem: ActivityItem = {
                  id: `result-${event.tool_use_id}`,
                  type: 'tool_result',
                  content: typeof event.content === 'string' ? event.content : JSON.stringify(event.content),
                  isError: event.is_error as boolean,
                  timestamp: Date.now(),
                };
                if (stream) stream.activityItems = [...stream.activityItems, newItem];
                if (isForeground) setActivityItems(prev => [...prev, newItem]);
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
                setActivityItems([]);
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
  }, [messages, streamingText, activityItems]);

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

  // Select a conversation
  const handleSelectConversation = async (conversationId: string) => {
    if (!projectId || currentConversation?.id === conversationId) return;

    // Update ref immediately so stream callbacks target the right conversation
    currentConvIdRef.current = conversationId;
    // Reset reconnect tracking for the new conversation
    reconnectAttemptedRef.current = null;

    try {
      const conv = await fetchConversation(projectId, conversationId);
      setCurrentConversation(conv);

      // Sync streaming UI state for the new conversation
      const stream = allStreamsRef.current[conversationId];
      if (stream) {
        // Merge API messages with pending messages not yet saved to DB
        const apiMessages = conv.messages || [];
        const pending = stream.pendingMessages || [];
        const apiIds = new Set(apiMessages.map(m => m.content + m.role));
        const missingPending = pending.filter(m => !apiIds.has(m.content + m.role));
        setMessages([...missingPending, ...apiMessages]);
        const streamStories = stream.stories.length > 0
          ? stream.stories
          : storiesFromMessages({ messages: [...missingPending, ...apiMessages], messageTools: messageToolsRef.current });
        setAnalysisStories(streamStories);
        setActiveStoryId(stream.storyId || streamStories[streamStories.length - 1]?.id);
        setStreamingText(stream.fullText);
        setActivityItems([...stream.activityItems]);
        setTodos([...stream.todos]);
        setActiveExecutionId(stream.executionId);
        setIsReconnecting(stream.isReconnecting);
      } else {
        setMessages(conv.messages || []);
        syncStoriesFromMessages(conv.messages || []);
        setStreamingText('');
        setActivityItems([]);
        setTodos([]);
        setActiveExecutionId(null);
        setIsReconnecting(false);
      }
      setSelectedClusterId(resolveClusterId(conv, project, clusters));
      setSelectedWarehouseId(resolveWarehouseId(conv, project, warehouses));
      setDefaultCatalog(resolveDefaultCatalog(conv, project));
      setDefaultSchema(resolveDefaultSchema(conv, project, userDefaultSchema));
      setWorkspaceFolder(resolveWorkspaceFolder(conv, project, user, projectId));
      setMlflowExperimentName(resolveMlflowExperimentName(project));
    } catch (error) {
      console.error('Failed to load conversation:', error);
      toast.error('Failed to load conversation');
    }
  };

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
      // Clear streaming UI (new conv isn't streaming yet)
      setStreamingText('');
      setActivityItems([]);
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

  // Delete conversation
  const handleDeleteConversation = async (conversationId: string) => {
    if (!projectId) return;

    try {
      await deleteConversation(projectId, conversationId);
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));

      // Clean up any active stream for this conversation
      const stream = allStreamsRef.current[conversationId];
      if (stream) {
        stream.abortController?.abort();
        delete allStreamsRef.current[conversationId];
        setStreamingConvIds(prev => prev.filter(id => id !== conversationId));
      }

      if (currentConversation?.id === conversationId) {
        const remaining = conversations.filter((c) => c.id !== conversationId);
        if (remaining.length > 0) {
          const conv = await fetchConversation(projectId, remaining[0].id);
          setCurrentConversation(conv);
          setMessages(conv.messages || []);
          syncStoriesFromMessages(conv.messages || []);
          setSelectedClusterId(resolveClusterId(conv, project, clusters));
          setSelectedWarehouseId(resolveWarehouseId(conv, project, warehouses));
          setDefaultCatalog(resolveDefaultCatalog(conv, project));
          setDefaultSchema(resolveDefaultSchema(conv, project, userDefaultSchema));
          setWorkspaceFolder(resolveWorkspaceFolder(conv, project, user, projectId));
          setMlflowExperimentName(resolveMlflowExperimentName(project));
        } else {
          setCurrentConversation(null);
          setMessages([]);
          setAnalysisStories([]);
          setActiveStoryId(undefined);
        }
        setStreamingText('');
        setActivityItems([]);
        setTodos([]);
        setActiveExecutionId(null);
      }
      toast.success('Conversation deleted');
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      toast.error('Failed to delete conversation');
    }
  };

  // Send message
  const handleSendMessage = useCallback(async () => {
    if (!projectId || !input.trim()) return;
    const convId = currentConversation?.id;
    // Block only if THIS conversation is already streaming
    if (convId && allStreamsRef.current[convId]) return;

    const userMessage = input.trim();
    setInput('');
    setStreamingText('');
    setActivityItems([]);
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
      activityItems: [],
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
            const thinking = (event.thinking as string) || '';
            if (thinking) {
              const updateThinking = (prev: ActivityItem[]) => {
                if (type === 'thinking_delta' && prev.length > 0 && prev[prev.length - 1].type === 'thinking') {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    ...updated[updated.length - 1],
                    content: updated[updated.length - 1].content + thinking,
                  };
                  return updated;
                }
                return [
                  ...prev,
                  {
                    id: `thinking-${Date.now()}`,
                    type: 'thinking' as const,
                    content: thinking,
                    timestamp: Date.now(),
                  },
                ];
              };
              if (stream) stream.activityItems = updateThinking(stream.activityItems);
              if (isForeground) setActivityItems(updateThinking);
            }
          } else if (type === 'tool_use') {
            applyStoryStreamEvent(stream, event);
            const toolName = event.tool_name as string;
            const newItem: ActivityItem = {
              id: event.tool_id as string,
              type: 'tool_use',
              content: '',
              toolName,
              toolInput: event.tool_input as Record<string, unknown>,
              timestamp: Date.now(),
            };
            if (stream) {
              stream.tools = [...stream.tools, toolName];
              stream.activityItems = [...stream.activityItems, newItem];
            }
            if (isForeground) setActivityItems(prev => [...prev, newItem]);
          } else if (type === 'tool_result') {
            applyStoryStreamEvent(stream, event);
            let content = event.content as string;

            if (event.is_error && typeof content === 'string') {
              const errorMatch = content.match(/<tool_use_error>(.*?)<\/tool_use_error>/s);
              if (errorMatch) {
                content = errorMatch[1].trim();
              }
              if (content === 'Stream closed' || content.includes('Stream closed')) {
                content = 'Tool execution interrupted: The operation took too long or the connection was lost. This may happen when operations exceed the 50-second timeout window. Check backend logs for details.';
              }
            }

            const newItem: ActivityItem = {
              id: `result-${event.tool_use_id}`,
              type: 'tool_result',
              content: typeof content === 'string' ? content : JSON.stringify(content),
              isError: event.is_error as boolean,
              timestamp: Date.now(),
            };
            if (stream) stream.activityItems = [...stream.activityItems, newItem];
            if (isForeground) setActivityItems(prev => [...prev, newItem]);
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
            setActivityItems([]);
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
            setActivityItems([]);
            setTodos([]);
          }

          // Fetch full conversation to get updated title and messages
          if (conversationId) {
            const conv = await fetchConversation(projectId, conversationId);
            if (currentConvIdRef.current === finalStreamKey) {
              setCurrentConversation(conv);
            }
            fetchConversations(projectId).then(setConversations);
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
        setActivityItems([]);
        setTodos([]);
      }
    }
  }, [
    projectId,
    input,
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
    setActivityItems([]);
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

  const [isSavingProjectDefaults, setIsSavingProjectDefaults] = useState(false);
  const [isSavingProjectManagement, setIsSavingProjectManagement] = useState(false);
  const handleSaveProjectDefaults = useCallback(async () => {
    if (!projectId || !project) return;

    setIsSavingProjectDefaults(true);
    try {
      const updated = await updateProject(projectId, {
        settings: {
          resources: {
            cluster_id: selectedClusterId ?? null,
            default_catalog: defaultCatalog || null,
            default_schema: defaultSchema || null,
            warehouse_id: selectedWarehouseId ?? null,
            workspace_folder: workspaceFolder || null,
            mlflow_experiment_name: mlflowExperimentName || null,
          },
        },
      });
      setProject(updated);
      toast.success('Project defaults saved');
    } catch (error) {
      console.error('Failed to save project defaults:', error);
      toast.error('Failed to save project defaults');
    } finally {
      setIsSavingProjectDefaults(false);
    }
  }, [
    projectId,
    project,
    selectedClusterId,
    defaultCatalog,
    defaultSchema,
    selectedWarehouseId,
    workspaceFolder,
    mlflowExperimentName,
  ]);

  const handleSaveProjectManagement = useCallback(async (payload: ProjectManagementPayload) => {
    if (!projectId || !project) return;

    setIsSavingProjectManagement(true);
    try {
      const updated = await updateProject(projectId, payload);
      setProject(updated);
      toast.success('Project settings saved');
    } catch (error) {
      console.error('Failed to save project settings:', error);
      toast.error('Failed to save project settings');
    } finally {
      setIsSavingProjectManagement(false);
    }
  }, [projectId, project]);

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

  // Config panel state
  const [configPanelOpen, setConfigPanelOpen] = useState(false);
  const configPanelRef = useRef<HTMLDivElement>(null);

  // Close config panel on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (configPanelRef.current && !configPanelRef.current.contains(event.target as Node)) {
        setConfigPanelOpen(false);
      }
    };
    if (configPanelOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [configPanelOpen]);

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

  const handleStarterPrompt = useCallback((prompt: string) => {
    setInput(prompt);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Config summary for header chips
  const configChips = useMemo(() => {
    const chips: { label: string; color: string }[] = [];
    if (defaultCatalog && defaultSchema) {
      chips.push({ label: `${defaultCatalog}.${defaultSchema}`, color: 'text-[var(--color-accent-primary)]' });
    }
    const cluster = clusters.find(c => c.cluster_id === selectedClusterId);
    if (cluster) {
      const isServerless = cluster.cluster_id === '__serverless__';
      chips.push({ label: isServerless ? 'Serverless Compute' : (cluster.cluster_name || 'Cluster'), color: cluster.state === 'RUNNING' ? 'text-[var(--color-success)]' : 'text-[var(--color-text-muted)]' });
    }
    const warehouse = warehouses.find(w => w.warehouse_id === selectedWarehouseId);
    if (warehouse) {
      chips.push({ label: warehouse.warehouse_name || 'Warehouse', color: warehouse.state === 'RUNNING' ? 'text-[var(--color-success)]' : 'text-[var(--color-text-muted)]' });
    }
    return chips;
  }, [defaultCatalog, defaultSchema, clusters, selectedClusterId, warehouses, selectedWarehouseId]);

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

  const sidebar = (
    <Sidebar
      conversations={conversations}
      currentConversationId={currentConversation?.id}
      onConversationSelect={handleSelectConversation}
      onNewConversation={handleNewConversation}
      onDeleteConversation={handleDeleteConversation}
      onViewSkills={handleViewSkills}
      isLoading={false}
    />
  );

  return (
    <MainLayout projectName={project?.name} sidebar={sidebar}>
      <div className="flex flex-1 flex-col h-full">
        {/* Chat Header */}
        <div className="flex h-14 items-center justify-between border-b border-[var(--color-border)]/60 px-6 bg-[var(--color-bg-secondary)]/20">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--color-accent-primary)]/10 to-[var(--color-accent-secondary)]/10 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-[var(--color-accent-primary)]" />
            </div>
            <h2 className="font-semibold text-[15px] text-[var(--color-text-heading)] truncate">
              {currentConversation?.title || 'New Chat'}
            </h2>
          </div>
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
            {/* Config summary chips */}
            <div className="hidden md:flex items-center gap-1.5">
              {configChips.map((chip, i) => (
                <span
                  key={i}
                  className={cn('text-[11px] font-medium px-2.5 py-1 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]/40 truncate max-w-[160px]', chip.color)}
                >
                  {chip.label}
                </span>
              ))}
            </div>
            <button
              onClick={() => setProjectPanelOpen(true)}
              className="flex items-center justify-center h-9 w-9 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-all"
              title="Project management"
            >
              <FolderCog className="h-4.5 w-4.5" />
            </button>
            {/* Settings button */}
            <div className="relative" ref={configPanelRef}>
              <button
                onClick={() => setConfigPanelOpen(!configPanelOpen)}
                className={cn(
                  'flex items-center justify-center h-9 w-9 rounded-lg transition-all',
                  configPanelOpen
                    ? 'bg-[var(--color-accent-primary)]/10 text-[var(--color-accent-primary)] ring-2 ring-[var(--color-accent-primary)]/20'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)]'
                )}
                title="Configuration"
              >
                <Settings2 className="h-4.5 w-4.5" />
              </button>
              <ConfigPanel
                isOpen={configPanelOpen}
                onClose={() => setConfigPanelOpen(false)}
                defaultCatalog={defaultCatalog}
                setDefaultCatalog={setDefaultCatalog}
                defaultSchema={defaultSchema}
                setDefaultSchema={setDefaultSchema}
                clusters={clusters}
                selectedClusterId={selectedClusterId}
                setSelectedClusterId={setSelectedClusterId}
                warehouses={warehouses}
                selectedWarehouseId={selectedWarehouseId}
                setSelectedWarehouseId={setSelectedWarehouseId}
                workspaceFolder={workspaceFolder}
                setWorkspaceFolder={setWorkspaceFolder}
                mlflowExperimentName={mlflowExperimentName}
                setMlflowExperimentName={setMlflowExperimentName}
                workspaceUrl={workspaceUrl}
                onSaveProjectDefaults={handleSaveProjectDefaults}
                isSavingProjectDefaults={isSavingProjectDefaults}
              />
            </div>
          </div>
        </div>

        <ProjectManagementPanel
          isOpen={projectPanelOpen}
          onClose={() => setProjectPanelOpen(false)}
          project={project}
          onSave={handleSaveProjectManagement}
          onPublish={handlePublishRelease}
          onStartUserPreview={handleStartUserPreview}
          isSaving={isSavingProjectManagement}
        />

        {/* Analysis Canvas */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="grid h-full min-h-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-h-0 overflow-y-auto">
              <StoryCanvas
                stories={analysisStories}
                activeStoryId={activeStoryId}
                onSelectStory={setActiveStoryId}
                onNextMove={handleNextMove}
                emptyTitle={runRole === 'user_preview' ? 'What would a user ask?' : 'What can I help you build?'}
                emptyDescription={
                  runRole === 'user_preview'
                    ? 'Preview the published project with read-only tools and release-pinned context.'
                    : 'Build data pipelines, generate synthetic data, create dashboards, and explore Databricks resources.'
                }
                starterPrompts={starterPrompts}
                onStarterPrompt={handleStarterPrompt}
              />

              {isStreamingHere && activityItems.length > 0 && (
                <div className="mx-auto w-full max-w-4xl px-6 pb-6">
                  <ActivitySection items={activityItems} isStreaming={isStreamingHere} />
                </div>
              )}

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
            <RightInspectPanel story={activeStory} onNextMove={handleNextMove} />
          </div>
        </div>

        {/* Input Area */}
        <div className="px-6 pb-5 pt-3">
          <div className="mx-auto max-w-3xl">
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
    </MainLayout>
  );
}
