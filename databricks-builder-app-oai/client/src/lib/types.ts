/**
 * Types matching the backend API and DB models.
 */

/** Current user info from GET /api/config/me */
export interface UserInfo {
  user: string;
  workspace_url: string | null;
  lakebase_configured: boolean;
  lakebase_project_id: string | null;
  lakebase_error: string | null;
}

/** Project from API (projects list/detail) */
export interface ProjectSettings {
  version: number;
  identity?: {
    audience?: string | null;
    success_criteria?: string[];
  };
  resources?: {
    cluster_id?: string | null;
    default_catalog?: string | null;
    default_schema?: string | null;
    warehouse_id?: string | null;
    workspace_folder?: string | null;
    mlflow_experiment_name?: string | null;
  };
  resource_registry?: {
    pinned?: string[];
    metadata_cache_status?: string | null;
  };
  semantics?: {
    metric_views?: string[];
    preferred_tables?: string[];
    deprecated_tables?: string[];
    glossary?: Record<string, string>;
    sample_queries?: string[];
    known_caveats?: string[];
  };
  agent_policy?: {
    mode?: string | null;
    role?: string | null;
    enabled_skills?: string[] | null;
    write_policy?: string | null;
  };
  roles?: {
    owners?: string[];
    developers?: string[];
    reviewers?: string[];
    users?: string[];
    viewers?: string[];
  };
  releases?: ProjectRelease[];
  release_policy?: {
    require_review?: boolean;
    require_eval_pass?: boolean;
    user_sessions_pin_release?: boolean;
    allowed_user_overrides?: string[];
  };
  workflows?: {
    enabled?: string[];
    templates?: string[];
    runs?: string[];
  };
  artifacts?: string[];
  feedback?: string[];
  eval_cases?: string[];
  governance?: {
    retention_policy?: string | null;
    export_policy?: string | null;
    readiness?: Record<string, boolean>;
    audit_events?: string[];
  };
  memory?: {
    approved?: string[];
    proposed?: string[];
  };
}

export interface ProjectRelease {
  id: string;
  status: 'draft' | 'review' | 'published' | 'deprecated' | 'archived';
  notes?: string;
  released_at?: string;
  released_by?: string;
  eval_status?: string;
  settings_snapshot?: ProjectSettings;
}

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  project_type?: string;
  status?: string;
  settings?: ProjectSettings;
  current_release_id?: string;
  user_email: string;
  created_at: string | null;
  updated_at?: string | null;
  conversation_count: number;
}

export interface DatabricksResources {
  databricks_host?: string | null;
  cluster_id?: string | null;
  warehouse_id?: string | null;
  workspace_folders: string[];
  workspace_files: string[];
  workflows: string[];
  input_schemas: string[];
  input_tables: string[];
  input_metric_views: string[];
  input_volume_paths: string[];
  output_schema?: string | null;
  output_volume_folders: string[];
}

export interface ProjectSetting {
  business_background: string;
  analysis_notes: string[];
  databricks_resources: DatabricksResources;
}

export interface ProjectSettingResponse {
  project_id: string;
  path: string;
  setting: ProjectSetting;
  project?: Project | null;
}

export interface ProjectSettingValidationCheck {
  name: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  detail: Record<string, unknown>;
}

export interface ProjectSettingValidationResult {
  valid: boolean;
  checked_at: string;
  sql_execution_mode: 'warehouse' | 'cluster' | 'none';
  summary: string;
  checks: ProjectSettingValidationCheck[];
}

/** Conversation summary (list) or full (detail with messages) */
export interface Conversation {
  id: string;
  project_id: string;
  title: string;
  created_at: string | null;
  session_id?: string | null;
  cluster_id?: string | null;
  default_catalog?: string | null;
  default_schema?: string | null;
  warehouse_id?: string | null;
  workspace_folder?: string | null;
  messages?: Message[];
  message_count?: number;
}

/** Single message in a conversation */
export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string | null;
  is_error: boolean;
}

/** Databricks cluster from GET /api/clusters */
export interface Cluster {
  cluster_id: string;
  cluster_name: string | null;
  state: string;
  creator_user_name?: string | null;
}

/** Databricks SQL warehouse from GET /api/warehouses */
export interface Warehouse {
  warehouse_id: string;
  warehouse_name: string | null;
  state: string;
  cluster_size?: string | null;
  creator_name?: string | null;
  is_serverless?: boolean;
}

/** Todo item from agent TodoWrite tool */
export interface TodoItem {
  id?: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

/** Skill with enabled status from GET .../skills/available */
export interface AvailableSkill {
  name: string;
  description: string;
  enabled: boolean;
}

/** Active or recent execution from GET .../executions */
export interface Execution {
  id: string;
  conversation_id: string;
  project_id: string;
  status: string;
  events: unknown[];
  error?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}
