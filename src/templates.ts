import { existsSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig, saveConfig, starterConfig, validateConfig } from './config.js';
import type { CrewConfig } from './types.js';

export type TemplateScope = 'builtin' | 'global' | 'workspace';
export interface TemplateRecord {
  id: string;
  name: string;
  description: string;
  scope: TemplateScope;
  path?: string;
  config: CrewConfig;
}

export function validateTemplateId(id: string): void {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(id)) throw new Error(`invalid template id: ${id}`);
}

export function defaultGlobalTemplateRoot(): string {
  const base = process.env.AGENTS_CREW_HOME ?? process.env.HOME ?? process.env.USERPROFILE ?? '.';
  return process.env.AGENTS_CREW_HOME ? join(base, 'templates') : join(base, '.agents-crew', 'templates');
}

function record(scope: TemplateScope, path: string | undefined, config: CrewConfig): TemplateRecord {
  const metadata = config.template;
  if (!metadata) throw new Error('template metadata is required');
  validateTemplateId(metadata.id);
  return { id: metadata.id, name: metadata.name, description: metadata.description, scope, path, config };
}

function builtin(): TemplateRecord {
  const config = starterConfig();
  config.template = { id: 'default', name: 'Default crew', description: 'Manager-native starter crew', layout: {} };
  return record('builtin', undefined, config);
}

export class TemplateRegistry {
  readonly workspaceRoot: string;
  readonly globalRoot: string;
  constructor(readonly workspace: string, globalRoot = defaultGlobalTemplateRoot()) {
    this.workspaceRoot = join(workspace, '.agents-crew', 'templates');
    this.globalRoot = globalRoot;
  }

  private async readScope(scope: Exclude<TemplateScope, 'builtin'>, root: string): Promise<TemplateRecord[]> {
    if (!existsSync(root)) return [];
    const records: TemplateRecord[] = [];
    for (const name of await readdir(root)) {
      if (!name.endsWith('.toml')) continue;
      const path = join(root, name);
      const config = await loadConfig(path);
      records.push(record(scope, path, config));
    }
    return records.sort((left, right) => left.id.localeCompare(right.id));
  }

  async list(): Promise<TemplateRecord[]> {
    const byId = new Map<string, TemplateRecord>([[builtin().id, builtin()]]);
    for (const item of await this.readScope('global', this.globalRoot)) byId.set(item.id, item);
    for (const item of await this.readScope('workspace', this.workspaceRoot)) byId.set(item.id, item);
    return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  async resolve(id: string): Promise<TemplateRecord> {
    validateTemplateId(id);
    for (const [scope, root] of [['workspace', this.workspaceRoot], ['global', this.globalRoot]] as const) {
      const path = join(root, `${id}.toml`);
      if (existsSync(path)) return record(scope, path, await loadConfig(path));
    }
    if (id === 'default') return builtin();
    throw new Error(`template not found: ${id}`);
  }

  async save(scope: Exclude<TemplateScope, 'builtin'>, config: CrewConfig): Promise<TemplateRecord> {
    validateConfig(config);
    const metadata = config.template;
    if (!metadata) throw new Error('template metadata is required');
    validateTemplateId(metadata.id);
    const root = scope === 'global' ? this.globalRoot : this.workspaceRoot;
    await mkdir(root, { recursive: true });
    const path = join(root, `${metadata.id}.toml`);
    await saveConfig(path, config);
    return record(scope, path, await loadConfig(path));
  }

  async delete(scope: Exclude<TemplateScope, 'builtin'>, id: string): Promise<void> {
    validateTemplateId(id);
    const path = join(scope === 'global' ? this.globalRoot : this.workspaceRoot, `${id}.toml`);
    if (!existsSync(path)) throw new Error(`template not found: ${id}`);
    await rm(path);
  }
}
