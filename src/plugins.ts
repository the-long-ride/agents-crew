import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type { Role } from './types.js';

export const hosts = ['codex', 'claude-code', 'opencode', 'antigravity'] as const;
export type Host = typeof hosts[number];
const commands = [
  ['agents-crew', 'Start, resume, inspect, pause, or cancel a durable template run.'],
  ['crew-init', 'Create Agents Crew configuration and role files.'],
  ['crew-run', 'Run one goal through the complete managed crew loop.'],
  ['crew-plan', 'Create a bounded plan without implementation writes.'],
  ['crew-status', 'Show run, task, approval, and pending-action state.'],
  ['crew-resume', 'Resume a paused or interrupted run.'],
  ['crew-pause', 'Pause scheduling new tasks.'],
  ['crew-approve', 'Approve one pending guarded action.'],
  ['crew-reject', 'Reject one pending guarded action.'],
  ['crew-cancel', 'Cancel the selected run.'],
  ['crew-doctor', 'Probe config, workers, credentials, plugins, and Git.'],
  ['crew-config', 'Show and validate configuration.'],
] as const;
const generatedRoles: Role[] = ['planner', 'researcher', 'implementer', 'tester', 'reviewer', 'integrator'];

function hash(content: string | Buffer): string { return createHash('sha256').update(content).digest('hex'); }
function normalizeHost(value: string): Host {
  const host = value === 'claude' ? 'claude-code' : value;
  if (!hosts.includes(host as Host)) throw new Error(`unknown host: ${value}`);
  return host as Host;
}
function commandPath(root: string, host: Host, name: string): string {
  if (host === 'codex') return join(root, '.codex', 'prompts', `${name}.md`);
  if (host === 'claude-code') return join(root, '.claude', 'commands', `${name}.md`);
  if (host === 'opencode') return join(root, '.opencode', 'commands', `${name}.md`);
  return join(root, '.agents', 'plugins', 'agents-crew', 'skills', name, 'SKILL.md');
}
function rolePath(root: string, host: Host, role: Role): string {
  const name = `agents-crew-${role}`;
  if (host === 'codex') return join(root, '.codex', 'agents', `${name}.md`);
  if (host === 'claude-code') return join(root, '.claude', 'agents', `${name}.md`);
  if (host === 'opencode') return join(root, '.opencode', 'agents', `${name}.md`);
  return join(root, '.agents', 'plugins', 'agents-crew', 'skills', name, 'SKILL.md');
}
function managerPath(root: string, host: Host): string {
  if (host === 'codex') return join(root, '.codex', 'agents', 'agents-crew-manager.md');
  if (host === 'claude-code') return join(root, '.claude', 'agents', 'agents-crew-manager.md');
  if (host === 'opencode') return join(root, '.opencode', 'agents', 'agents-crew-manager.md');
  return join(root, '.agents', 'plugins', 'agents-crew', 'rules', 'agents-crew-manager.md');
}
function manifestPath(root: string, host: Host): string { return join(root, '.agents-crew', 'plugin-manifests', `${host}.json`); }

async function rolePrompt(role: Role): Promise<string> {
  const path = new URL(`../roles/${role}.md`, import.meta.url);
  return readFile(path, 'utf8');
}
function canWrite(role: Role): boolean { return role === 'implementer' || role === 'integrator'; }
async function roleContent(host: Host, role: Role): Promise<string> {
  const name = `agents-crew-${role}`;
  let front = '';
  if (host === 'claude-code') front = `---\nname: ${name}\ndescription: Agents Crew ${role} role\ntools: ${canWrite(role) ? 'Read, Write, Edit, Bash' : 'Read, Bash'}\n---\n\n`;
  if (host === 'opencode') front = `---\ndescription: Agents Crew ${role} role\nmode: subagent\npermission:\n  edit: ${canWrite(role) ? 'allow' : 'deny'}\n  bash: allow\n---\n\n`;
  if (host === 'antigravity') front = `---\nname: ${name}\ndescription: Agents Crew ${role} role\n---\n\n`;
  return `${front}${await rolePrompt(role)}\n\nObey the capability envelope, workspace, context file, and output schema supplied by the TypeScript manager action. Return only the requested normalized result.`;
}
function commandContent(host: Host, name: string, description: string): string {
  let front = '';
  if (host === 'opencode') front = `---\ndescription: ${description}\nagent: agents-crew-manager\n---\n\n`;
  if (host === 'claude-code') front = `---\ndescription: ${description}\n---\n\n`;
  if (host === 'antigravity') front = `---\nname: ${name}\ndescription: ${description}\n---\n\n`;
  if (name === 'agents-crew') return `${front}Interpret \`$ARGUMENTS\` as an Agents Crew subcommand: start, resume, status, pause, or cancel. Use \`agents-crew ... --json\`. Continue only through actions returned by \`agents-crew manager step --run <run-id> --json\`, and submit results with \`agents-crew manager submit --run <run-id> --action <action-id> --result <file> --json\`. Read \`.agents-crew/active/<run-id>/goal-<run-id>.md\` and \`status.md\`. Never invent action IDs or claim completion before the core returns completed. Host: ${host}.\n`;
  if (name === 'crew-run') return `${front}Start with \`crew manager start --goal "$ARGUMENTS" --host ${host} --json\`. Follow plan, review, dispatch_native, request_approval, and terminal actions. Use \`crew manager step\` and \`crew manager submit\`; never bypass policy.\n`;
  const invocations: Record<string, string> = {
    'crew-init': 'crew init --non-interactive --json', 'crew-plan': 'crew --json plan $ARGUMENTS',
    'crew-status': 'crew status $ARGUMENTS --json', 'crew-resume': 'crew resume $ARGUMENTS --json',
    'crew-pause': 'crew pause $ARGUMENTS --json', 'crew-approve': 'crew approve $ARGUMENTS --json',
    'crew-reject': 'crew reject $ARGUMENTS --json', 'crew-cancel': 'crew cancel $ARGUMENTS --json',
    'crew-doctor': 'crew doctor --json', 'crew-config': 'crew config validate --json && crew config show --json',
  };
  return `${front}Run \`${invocations[name]}\` using safe argument boundaries.\n`;
}
function managerContent(host: Host): string {
  let front = '';
  if (host === 'opencode') front = '---\ndescription: Coordinates Agents Crew runs\nmode: primary\npermission:\n  edit: allow\n  bash: ask\n  task: allow\n---\n\n';
  if (host === 'claude-code') front = '---\nname: agents-crew-manager\ndescription: Coordinates Agents Crew runs\ntools: Read, Write, Edit, Bash, Task\n---\n\n';
  return `${front}# Agents Crew Manager\n\nYou are the only installed manager. The TypeScript core is the authority for scheduling, policy, retries, workspaces, durable run files, action IDs, and completion. Before each cycle read the goal and status projections. Execute only actions returned by \`agents-crew manager step\`. Submit normalized results with \`manager submit\`. Do not claim completion until the core returns completed. Host: ${host}.\n`;
}

interface Manifest { version: number; host: Host; generated_by: string; files: { path: string; sha256: string }[] }
export interface PluginReport { host: Host; files: { path: string; action: string; message: string }[] }

function validManifest(value: unknown, host: Host, allowedPaths: Set<string>): value is Manifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<Manifest>;
  if (manifest.version !== 1 || manifest.host !== host || manifest.generated_by !== 'agents-crew' || !Array.isArray(manifest.files)) return false;
  const seen = new Set<string>();
  for (const entry of manifest.files) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/u.test(entry.sha256) || !allowedPaths.has(entry.path) || seen.has(entry.path)) return false;
    seen.add(entry.path);
  }
  return true;
}

export class HostPlugin {
  readonly host: Host;
  constructor(host: string) { this.host = normalizeHost(host); }

  private async readManifest(root: string): Promise<Manifest> {
    const raw = JSON.parse(await readFile(manifestPath(root, this.host), 'utf8')) as unknown;
    const allowed = new Set(this.planFiles(root).map(([path]) => relative(root, path)));
    if (!validManifest(raw, this.host, allowed)) throw new Error(`invalid plugin manifest: ${this.host}`);
    return raw;
  }

  planFiles(root: string): [string, string][] {
    const planned: [string, string][] = commands.map(([name, description]) => [commandPath(root, this.host, name), commandContent(this.host, name, description)]);
    planned.push([managerPath(root, this.host), managerContent(this.host)]);
    for (const role of generatedRoles) planned.push([rolePath(root, this.host, role), `# Agents Crew ${role}\n`]);
    if (this.host === 'antigravity') planned.push([join(root, '.agents', 'plugins', 'agents-crew', 'plugin.json'), '{\n  "name": "agents-crew",\n  "version": 1,\n  "description": "TypeScript-enforced multi-agent loop manager"\n}\n']);
    return planned;
  }

  private async completeFiles(root: string): Promise<[string, string][]> {
    const planned = this.planFiles(root);
    const byPath = new Map(planned);
    for (const role of generatedRoles) byPath.set(rolePath(root, this.host, role), await roleContent(this.host, role));
    return [...byPath.entries()];
  }

  async install(root: string, force = false): Promise<PluginReport> {
    const manifestFile = manifestPath(root, this.host);
    let previous: Manifest | undefined;
    if (existsSync(manifestFile)) previous = await this.readManifest(root);
    const report: PluginReport['files'] = [];
    const generated: Manifest['files'] = [];
    for (const [path, content] of await this.completeFiles(root)) {
      const relativePath = relative(root, path);
      if (existsSync(path) && !force) {
        const old = previous?.files.find((entry) => entry.path === relativePath);
        const currentHash = hash(await readFile(path));
        if (!old || old.sha256 !== currentHash) throw new Error(`refusing to overwrite unowned file: ${path}`);
      }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, 'utf8');
      generated.push({ path: relativePath, sha256: hash(content) });
      report.push({ path: relativePath, action: 'write', message: 'generated' });
    }
    const manifest: Manifest = { version: 1, host: this.host, generated_by: 'agents-crew', files: generated };
    await mkdir(dirname(manifestFile), { recursive: true });
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return { host: this.host, files: report };
  }

  async doctor(root: string): Promise<PluginReport> {
    const manifest = await this.readManifest(root);
    const files = [];
    for (const entry of manifest.files) {
      const path = join(root, entry.path);
      if (!existsSync(path)) files.push({ path: entry.path, action: 'missing', message: 'generated file is missing' });
      else if (hash(await readFile(path)) === entry.sha256) files.push({ path: entry.path, action: 'pass', message: 'generated file matches manifest' });
      else files.push({ path: entry.path, action: 'modified', message: 'generated file was modified' });
    }
    return { host: this.host, files };
  }

  async uninstall(root: string): Promise<PluginReport> {
    const file = manifestPath(root, this.host);
    const manifest = await this.readManifest(root);
    const files = [];
    for (const entry of manifest.files) {
      const path = join(root, entry.path);
      if (!existsSync(path)) files.push({ path: entry.path, action: 'missing', message: 'already absent' });
      else if (hash(await readFile(path)) === entry.sha256) {
        await rm(path, { force: true });
        files.push({ path: entry.path, action: 'remove', message: 'removed unchanged generated file' });
      } else files.push({ path: entry.path, action: 'preserve', message: 'preserved user-modified generated file' });
    }
    await rm(file, { force: true });
    return { host: this.host, files };
  }
}
