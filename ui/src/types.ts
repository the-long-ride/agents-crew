export type CrewScope = 'builtin' | 'global' | 'workspace';
export type WritableCrewScope = Exclude<CrewScope, 'builtin'>;
export type ViewName = 'builder' | 'crews' | 'connect' | 'runtime' | 'history';
export type NodeKind = 'boss' | 'member';

export interface Position { x: number; y: number }
export interface GraphViewport { x: number; y: number; scale: number }
export interface CrewMetadata { id: string; name: string; description: string; group?: string; layout: Record<string, Position> }
export interface BossInformation {
  host: string;
  alias?: string;
  model?: string;
  coding: 'never' | 'small_fixes' | 'full';
  small_fix_max_files: number;
  small_fix_max_changed_lines: number;
}
export interface MemberConfig {
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
  template: CrewMetadata;
  run: Record<string, unknown>;
  manager: BossInformation;
  autonomy: Record<string, unknown>;
  permissions: Record<string, unknown>;
  verification: Record<string, unknown>;
  workers: MemberConfig[];
}
export type CrewRecord = { id: string; name: string; description: string; group?: string; scope: CrewScope; path?: string; config: CrewConfig };
export interface CanvasNode {
  id: string;
  type: NodeKind;
  index?: number;
  x: number;
  y: number;
  data: BossInformation | MemberConfig;
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
  boss: string;
  updated_at: string;
  archived: boolean;
  completed_tasks: number;
  total_tasks: number;
}
export interface RunTask { id: string; title: string; status: string; role: string; assigned_member?: string }
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

export interface ConnectionFileStatus { path: string; action: string; message: string }
export interface ConnectionStatus {
  host: string;
  status: 'connected' | 'modified' | 'missing' | 'error';
  files: ConnectionFileStatus[];
  message?: string;
}
export interface ManagedProcess {
  id: string;
  worker_id: string;
  host: string;
  pid: number;
  run_id: string;
  task_id: string;
  workspace: string;
  started_at: string;
  updated_at: string;
  state: 'running' | 'pausing' | 'paused' | 'stopping' | 'exited' | 'failed';
  exit_code?: number;
  message?: string;
}

export interface BootstrapResponse {
  crews: CrewRecord[];
  groups?: string[];
  runs: RunSummary[];
  history_runs: RunSummary[];
  roles: string[];
  capabilities: string[];
  model_presets: string[];
}
export interface SaveCrewRequest { scope: WritableCrewScope; config: CrewConfig }

export interface AppState {
  crews: CrewRecord[];
  runs: RunSummary[];
  historyRuns: RunSummary[];
  connections: ConnectionStatus[];
  processes: ManagedProcess[];
  roles: string[];
  capabilities: string[];
  models: string[];
  modelCatalogs: Record<string, ModelCatalogResponse | undefined>;
  current: CrewRecord | null;
  selected: Selection | null;
  selectedRunId: string | null;
  runDetail: RunDetail | null;
  selectedHistoryRunId: string | null;
  historyDetail: RunDetail | null;
  viewport: GraphViewport;
  view: ViewName;
  search: string;
  saveScope: WritableCrewScope;
  groups: string[];
  collapsedGroups: string[];
}