import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  commandContent,
  commands,
  generatedRoles,
  hosts,
  managerContent,
  normalizeHost,
  roleContent,
  type Host,
} from './registry.js';

export type ConnectionStatusName = 'connected' | 'modified' | 'missing' | 'error';
export type ConnectionFileAction = 'ok' | 'modified' | 'missing' | 'unowned' | 'preserve' | 'removed';

export interface ConnectionFileStatus {
  path: string;
  action: ConnectionFileAction;
  message: string;
}

export interface ConnectionStatus {
  host: Host;
  status: ConnectionStatusName;
  files: ConnectionFileStatus[];
  message?: string;
}

interface Manifest {
  version: 1;
  host: Host;
  generated_by: 'agents-crew';
  files: { path: string; sha256: string }[];
}

function hash(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function skillContent(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;
}

function codexSkillBody(host: Host, name: string, description: string): string {
  const body = commandContent(host, name, description)
    .replaceAll('`$ARGUMENTS`', 'the user request following this skill')
    .replaceAll('"$ARGUMENTS"', '"<user-goal>"')
    .replaceAll('$ARGUMENTS', '<arguments>');
  return skillContent(name, description, body);
}

function claudeSkillBody(host: Host, name: string, description: string): string {
  const body = commandContent(host, name, description)
    .replace(/^---[\s\S]*?---\n\n/u, '')
    .replaceAll('`$ARGUMENTS`', 'the user request following this skill');
  return skillContent(name, description, body);
}

export class GlobalHostConnections {
  constructor(private readonly home: string) {}

  private manifestPath(host: Host): string {
    return join(this.home, '.agents-crew', 'connections', `${host}.json`);
  }

  private commandPath(host: Host, name: string): string {
    if (host === 'codex') return join(this.home, '.agents', 'skills', name, 'SKILL.md');
    if (host === 'claude-code') return join(this.home, '.claude', 'skills', name, 'SKILL.md');
    if (host === 'opencode') return join(this.home, '.config', 'opencode', 'commands', `${name}.md`);
    return join(this.home, '.gemini', 'config', 'plugins', 'agents-crew', 'skills', name, 'SKILL.md');
  }

  private rolePath(host: Host, role: (typeof generatedRoles)[number]): string {
    const name = `agents-crew-${role}`;
    if (host === 'codex') return join(this.home, '.agents', 'skills', name, 'SKILL.md');
    if (host === 'claude-code') return join(this.home, '.claude', 'agents', `${name}.md`);
    if (host === 'opencode') return join(this.home, '.config', 'opencode', 'agents', `${name}.md`);
    return join(this.home, '.gemini', 'config', 'plugins', 'agents-crew', 'skills', name, 'SKILL.md');
  }

  private managerPath(host: Host): string {
    if (host === 'codex') return join(this.home, '.agents', 'skills', 'agents-crew-manager', 'SKILL.md');
    if (host === 'claude-code') return join(this.home, '.claude', 'agents', 'agents-crew-manager.md');
    if (host === 'opencode') return join(this.home, '.config', 'opencode', 'agents', 'agents-crew-manager.md');
    return join(this.home, '.gemini', 'config', 'plugins', 'agents-crew', 'rules', 'agents-crew-manager.md');
  }

  planFiles(value: string): [string, string][] {
    const host = normalizeHost(value);
    const files: [string, string][] = commands.map(([name, description]) => {
      const content = host === 'codex'
        ? codexSkillBody(host, name, description)
        : host === 'claude-code'
          ? claudeSkillBody(host, name, description)
          : commandContent(host, name, description);
      return [this.commandPath(host, name), content];
    });
    const manager = managerContent(host);
    files.push([
      this.managerPath(host),
      host === 'codex' ? skillContent('agents-crew-manager', 'Coordinates Agents Crew runs', manager) : manager,
    ]);
    for (const role of generatedRoles) files.push([this.rolePath(host, role), `# Agents Crew ${role}\n`]);
    if (host === 'antigravity') {
      files.push([
        join(this.home, '.gemini', 'config', 'plugins', 'agents-crew', 'plugin.json'),
        '{\n  "name": "agents-crew",\n  "version": 1,\n  "description": "TypeScript-enforced multi-agent loop manager"\n}\n',
      ]);
    }
    return files;
  }

  private async completeFiles(host: Host): Promise<[string, string][]> {
    const files = new Map(this.planFiles(host));
    for (const role of generatedRoles) {
      let content = await roleContent(host, role);
      if (host === 'codex') {
        content = skillContent(`agents-crew-${role}`, `Agents Crew ${role} role`, content);
      }
      files.set(this.rolePath(host, role), content);
    }
    return [...files.entries()];
  }

  private async readManifest(host: Host): Promise<Manifest | undefined> {
    const path = this.manifestPath(host);
    if (!existsSync(path)) return undefined;
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
    } catch {
      throw new Error(`invalid global connection manifest: ${host}`);
    }
    if (!raw || typeof raw !== 'object') throw new Error(`invalid global connection manifest: ${host}`);
    const manifest = raw as Partial<Manifest>;
    const allowed = new Set(this.planFiles(host).map(([file]) => file));
    if (manifest.version !== 1 || manifest.host !== host || manifest.generated_by !== 'agents-crew' || !Array.isArray(manifest.files)) {
      throw new Error(`invalid global connection manifest: ${host}`);
    }
    const seen = new Set<string>();
    for (const entry of manifest.files) {
      if (!entry || typeof entry.path !== 'string' || typeof entry.sha256 !== 'string'
        || !/^[a-f0-9]{64}$/u.test(entry.sha256) || !allowed.has(entry.path) || seen.has(entry.path)) {
        throw new Error(`invalid global connection manifest: ${host}`);
      }
      seen.add(entry.path);
    }
    return manifest as Manifest;
  }

  private async writeManifest(host: Host, files: [string, string][]): Promise<void> {
    const path = this.manifestPath(host);
    const manifest: Manifest = {
      version: 1,
      host,
      generated_by: 'agents-crew',
      files: files.map(([file, content]) => ({ path: file, sha256: hash(content) })),
    };
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await rename(temp, path);
  }

  async check(value: string): Promise<ConnectionStatus> {
    const host = normalizeHost(value);
    const generated = new Map(await this.completeFiles(host));
    const manifest = await this.readManifest(host);
    const files: ConnectionFileStatus[] = [];
    if (!manifest) {
      for (const path of generated.keys()) {
        files.push(existsSync(path)
          ? { path, action: 'unowned', message: 'target exists but is not owned by Agents Crew' }
          : { path, action: 'missing', message: 'not connected' });
      }
      return { host, status: files.some((file) => file.action === 'unowned') ? 'modified' : 'missing', files };
    }

    const owned = new Map(manifest.files.map((entry) => [entry.path, entry.sha256]));
    for (const [path, content] of generated) {
      if (!existsSync(path)) {
        files.push({ path, action: 'missing', message: 'owned generated file is missing' });
        continue;
      }
      const expected = owned.get(path);
      if (!expected) {
        files.push({ path, action: 'unowned', message: 'target is not present in the ownership manifest' });
        continue;
      }
      const current = hash(await readFile(path));
      const next = hash(content);
      if (current !== expected || current !== next) files.push({ path, action: 'modified', message: 'generated file was modified or is outdated' });
      else files.push({ path, action: 'ok', message: 'generated file matches current connection' });
    }
    return { host, status: files.every((file) => file.action === 'ok') ? 'connected' : 'modified', files };
  }

  async list(): Promise<ConnectionStatus[]> {
    return Promise.all(hosts.map(async (host) => {
      try {
        return await this.check(host);
      } catch (error) {
        return { host, status: 'error' as const, files: [], message: error instanceof Error ? error.message : String(error) };
      }
    }));
  }

  async connect(value: string): Promise<ConnectionStatus> {
    const host = normalizeHost(value);
    const manifest = await this.readManifest(host);
    if (manifest) {
      const status = await this.check(host);
      if (status.status === 'connected') return status;
      throw new Error(`connection is modified; use repair: ${host}`);
    }
    const files = await this.completeFiles(host);
    const conflict = files.find(([path]) => existsSync(path));
    if (conflict) throw new Error(`refusing to overwrite unowned file: ${conflict[0]}`);
    for (const [path, content] of files) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, 'utf8');
    }
    await this.writeManifest(host, files);
    return this.check(host);
  }

  async repair(value: string): Promise<ConnectionStatus> {
    const host = normalizeHost(value);
    const manifest = await this.readManifest(host);
    if (!manifest) return this.connect(host);
    const owned = new Set(manifest.files.map((entry) => entry.path));
    const files = await this.completeFiles(host);
    const conflict = files.find(([path]) => existsSync(path) && !owned.has(path));
    if (conflict) throw new Error(`refusing to overwrite unowned file: ${conflict[0]}`);
    for (const [path, content] of files) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, 'utf8');
    }
    await this.writeManifest(host, files);
    return this.check(host);
  }

  async disconnect(value: string): Promise<ConnectionStatus> {
    const host = normalizeHost(value);
    const manifest = await this.readManifest(host);
    if (!manifest) return this.check(host);
    const files: ConnectionFileStatus[] = [];
    for (const entry of manifest.files) {
      if (!existsSync(entry.path)) {
        files.push({ path: entry.path, action: 'missing', message: 'already absent' });
        continue;
      }
      const current = hash(await readFile(entry.path));
      if (current === entry.sha256) {
        await rm(entry.path, { force: true });
        files.push({ path: entry.path, action: 'removed', message: 'removed unchanged generated file' });
      } else {
        files.push({ path: entry.path, action: 'preserve', message: 'preserved user-modified generated file' });
      }
    }
    await rm(this.manifestPath(host), { force: true });
    return { host, status: files.some((file) => file.action === 'preserve') ? 'modified' : 'missing', files };
  }
}
