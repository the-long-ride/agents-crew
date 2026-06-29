export type TemplateScope = 'builtin' | 'global' | 'workspace';
export type WritableTemplateScope = Exclude<TemplateScope, 'builtin'>;
export type ViewName = 'builder' | 'templates' | 'runtime' | 'history';
export type NodeKind = 'manager' | 'worker';

export interface Position { x: number; y: number }
export interface GraphViewport { x: number; y: number; scale: number }
export interface TemplateMetadata { id: string; name: string; description: string; layout: Record<string, Position> }
export interface ManagerConfig {
  host: string;
  alias?: string;
  model?: string;
  coding: 'never' | 'small_fixes' | 'full';
  small_fix_max_files: number;
  small_fix_max_changed_lines: number;
}
export interface WorkerConfig {
  id: string;
  alias?: string;
  kind: 'native' | 'cli' | 'api';
  enabled: boolean;
  adapter?: string;
  provider?: string;
  host?: string;
  model?: string;
  model_fallback?: 'allow_host_default' | 'deny';
  roles: string[];
  capabilities: string[];
  priority: number;
  command?: string;
  args: string[];
  env_allowlist: string[];
  api_base_url?: string;
  api_key_env?: string;
  headers: Record<string, string>;
  timeout_seconds?: number;
  requires_network?: boolean;
  requires_credentials?: boolean;
}
export interface CrewConfig {
  version: number;
  template: TemplateMetadata;
  run: Record<string, unknown>;
  manager: ManagerConfig;
  autonomy: Record<string, unknown>;
  permissions: Record<string, unknown>;
  verification: Record<string, unknown>;
  workers: WorkerConfig[];
}
export interface TemplateRecord {
  id: string;
  name: string;
  description: string;
  scope: TemplateScope;
  path?: string;
  config: CrewConfig;
}
export interface CanvasNode {
  id: string;
  type: NodeKind;
  index?: number;
  x: number;
  y: number;
  data: ManagerConfig | WorkerConfig;
}
export interface CanvasEdge { id: string; x1: number; y1: number; x2: number; y2: number }
export interface Selection { id: string; type: NodeKind }
export interface ModelSuggestion {
  id: string;
  name: string;
  provider: string;
  context?: number;
  reasoning: boolean;
  tool_call: boolean;
  attachment: boolean;
}
export interface ModelCatalogResponse {
  host: string;
  providers: string[];
  models: ModelSuggestion[];
  source: 'live' | 'cache' | 'stale' | 'unavailable' | 'none';
  stale: boolean;
  fetched_at?: string;
  error?: string;
}
export interface RunSummary {
  id: string;
  goal: string;
  status: string;
  manager: string;
  updated_at: string;
  archived: boolean;
  completed_tasks: number;
  total_tasks: number;
}
export interface RunTask { id: string; title: string; status: string; role: string; assigned_worker?: string }
export interface RunEvent { sequence: number; kind: string; timestamp: string; data?: unknown }
export interface RunRecord {
  id: string;
  original_goal: string;
  status: string;
  iteration: number;
  max_iterations: number;
  terminal_summary?: string;
  tasks: Record<string, RunTask>;
}
export interface RunDetail {
  run: RunRecord;
  events: RunEvent[];
  files: string[];
  archived: boolean;
  pending_actions: unknown[];
  expired_actions: unknown[];
}
export interface BootstrapResponse {
  templates: TemplateRecord[];
  runs: RunSummary[];
  history_runs: RunSummary[];
  roles: string[];
  capabilities: string[];
  model_presets: string[];
}
export interface SaveTemplateRequest { scope: WritableTemplateScope; config: CrewConfig }

export interface AppState {
  templates: TemplateRecord[];
  runs: RunSummary[];
  historyRuns: RunSummary[];
  roles: string[];
  capabilities: string[];
  models: string[];
  modelCatalogs: Record<string, ModelCatalogResponse | undefined>;
  current: TemplateRecord | null;
  selected: Selection | null;
  selectedRunId: string | null;
  runDetail: RunDetail | null;
  selectedHistoryRunId: string | null;
  historyDetail: RunDetail | null;
  viewport: GraphViewport;
  view: ViewName;
  search: string;
  saveScope: WritableTemplateScope;
}
