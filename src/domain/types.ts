export type Role = 'manager' | 'planner' | 'researcher' | 'implementer' | 'tester' | 'reviewer' | 'integrator';
export type Capability = 'read' | 'write' | 'shell' | 'network' | 'commit' | 'push' | 'deploy' | 'destructive';
export type WorkspaceMode = 'current' | 'isolated';
export type ManagerCoding = 'never' | 'small_fixes' | 'full';
export type ModelFallback = 'allow_host_default' | 'deny';
export type PermissionRule = 'allow' | 'ask' | 'deny';
export type WorkerKind = 'native' | 'cli' | 'api';
export type RunStatus = 'planning' | 'working' | 'paused' | 'awaiting_approval' | 'manager_required' | 'completed' | 'blocked' | 'failed' | 'cancelled';
export type TaskStatus = 'pending' | 'ready' | 'running' | 'verifying' | 'retryable' | 'blocked' | 'completed' | 'failed' | 'cancelled';
export type WorkerResultStatus = 'completed' | 'failed' | 'blocked';
export type TestStatus = 'passed' | 'failed' | 'skipped' | 'blocked';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface CanvasPosition { x: number; y: number }
export interface TemplateMetadata { id: string; name: string; description: string; group?: string; layout: Record<string, CanvasPosition> }
export interface RunConfig {
  workspace_mode: WorkspaceMode;
  max_iterations: number;
  max_parallel_readers: number;
  max_parallel_writers: number;
  max_tasks_per_iteration: number;
  default_task_timeout_seconds: number;
  retain_failed_worktrees: boolean;
}
export interface ManagerConfig {
  host: string;
  alias?: string;
  model?: string;
  coding: ManagerCoding;
  small_fix_max_files: number;
  small_fix_max_changed_lines: number;
}
export interface PermissionsConfig {
  local_read: PermissionRule;
  local_edit: PermissionRule;
  test_commands: PermissionRule;
  network: PermissionRule;
  destructive_commands: PermissionRule;
  credentialed_actions: PermissionRule;
  commit: PermissionRule;
  push: PermissionRule;
  deploy: PermissionRule;
}
export interface VerificationConfig {
  commands: string[][];
  require_independent_review: boolean;
  allow_same_agent_review: boolean;
}
export interface WorkerConfig {
  id: string;
  alias?: string;
  kind: WorkerKind;
  enabled: boolean;
  adapter?: string;
  provider?: string;
  host?: string;
  model?: string;
  model_fallback?: ModelFallback;
  roles: Role[];
  capabilities: Capability[];
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
  template?: TemplateMetadata;
  run: RunConfig;
  manager: ManagerConfig;
  autonomy: { mode: 'safe' | 'balanced' | 'full_auto' };
  permissions: PermissionsConfig;
  verification: VerificationConfig;
  workers: WorkerConfig[];
}
export interface AcceptanceCriterion { id: string; description: string; required_checks: string[] }
export interface Evidence { criterion_id: string; source: string; summary: string; passed: boolean; artifact?: string }
export interface TestResult { command: string[]; status: TestStatus; summary: string; exit_code?: number }
export interface ManagerIdentity { host: string; coding: ManagerCoding; small_fix_max_files: number; small_fix_max_changed_lines: number }
export interface ApprovalRequest { id: string; operation: string; reason: string; status: ApprovalStatus; created_at: string; decided_at?: string }
export interface TaskDraft {
  title: string;
  instructions: string;
  role: Role;
  capabilities: Capability[];
  write_scope: string[];
  dependencies: string[];
  preferred_workers: string[];
  expected_output: string;
  max_attempts: number;
}
export interface WorkerResult {
  task_id: string;
  status: WorkerResultStatus;
  summary: string;
  artifacts: string[];
  files_changed: string[];
  commands_run: string[][];
  capabilities_used: Capability[];
  tests: TestResult[];
  evidence: Evidence[];
  assumptions: string[];
  blockers: string[];
  recommended_next_tasks: TaskDraft[];
  metadata: Record<string, unknown>;
}
export interface Task extends TaskDraft {
  id: string;
  parent_id?: string;
  inputs: string[];
  status: TaskStatus;
  attempt: number;
  assigned_worker?: string;
  workspace_binding?: string;
  result?: WorkerResult;
  strategy_fingerprint?: string;
}
export interface Run {
  id: string;
  original_goal: string;
  normalized_goal: string;
  acceptance_criteria: AcceptanceCriterion[];
  repository: string;
  workspace_mode: WorkspaceMode;
  manager: ManagerIdentity;
  tasks: Record<string, Task>;
  approvals: ApprovalRequest[];
  evidence: Evidence[];
  verification: TestResult[];
  status: RunStatus;
  iteration: number;
  max_iterations: number;
  event_sequence: number;
  created_at: string;
  updated_at: string;
  terminal_summary?: string;
}
export type ManagerAction =
  | { type: 'plan'; goal: string; state_path: string; output_schema: string }
  | { type: 'review'; task_id: string; state_path: string; output_schema: string }
  | { type: 'dispatch_native'; task_id: string; role: Role; model?: string; model_fallback: ModelFallback; capabilities: Capability[]; workspace: string; context_path: string; output_schema: string; workspace_snapshot?: Record<string, string> }
  | { type: 'request_approval'; approval_id: string; operation: string; reason: string }
  | { type: 'display'; message: string }
  | { type: 'terminal'; status: RunStatus; summary: string };
export interface OutstandingAction {
  id: string;
  run_id: string;
  task_id?: string;
  issued_at: string;
  expires_at?: string;
  capability_envelope: Capability[];
  action: ManagerAction;
  consumed: boolean;
}
export interface RunEvent { sequence: number; timestamp: string; kind: string; data: unknown }
export interface RunIntent {
  template_id: string;
  template_name: string;
  goal: string;
  expectations: string[];
  acceptance_criteria: string[];
  constraints: string[];
}
