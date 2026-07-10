export type PluginHost = 'antigravity' | 'codex' | 'claude-code' | 'opencode' | 'github-copilot';
export type PluginAction = 'install' | 'uninstall' | 'doctor' | 'list';
export type PluginTarget = PluginHost | 'all';

export interface PluginInstallTarget {
  workspace: string;
  force: boolean;
  dryRun: boolean;
}

export interface PluginFilePlan {
  path: string;
  content: string;
}

export interface PluginFileResult {
  path: string;
  action: 'create' | 'overwrite' | 'skip' | 'remove' | 'missing';
}

export interface PluginDoctorCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

export interface PluginCommandSpec {
  name: string;
  command: string;
  description: string;
}

export interface PluginHookSpec {
  event: string;
  command: string;
  description: string;
}

export interface PluginManifest {
  name: string;
  host: PluginHost;
  generatedBy: string;
  commands: PluginCommandSpec[];
  hooks: PluginHookSpec[];
  notes: string[];
}

export interface CrewHostPlugin {
  readonly host: PluginHost;
  readonly displayName: string;
  readonly summary: string;
  manifest(): PluginManifest;
  files(target: PluginInstallTarget): PluginFilePlan[];
}
