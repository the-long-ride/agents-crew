import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

export type ChangeSnapshot = Record<string, string>;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function withDirectoryLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      await mkdir(path);
      await writeFile(join(path, 'owner.json'), `${JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })}
`, 'utf8');
      try { return await operation(); }
      finally { await rm(path, { recursive: true, force: true }); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const owner = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8')) as { pid?: number };
        if (!processAlive(Number(owner.pid))) {
          await rm(path, { recursive: true, force: true });
          continue;
        }
      } catch (ownerError) {
        if ((ownerError as NodeJS.ErrnoException).code !== 'ENOENT') await rm(path, { recursive: true, force: true });
      }
      await delay(10);
    }
  }
  throw new Error(`timed out acquiring Git integration lock: ${path}`);
}


export function canonicalScopedPath(root: string, scoped: string): string {
  if (isAbsolute(scoped)) throw new Error(`path escape is not allowed: ${scoped}`);
  const base = resolve(root);
  const output = resolve(base, scoped);
  if (output !== base && !output.startsWith(`${base}${sep}`)) throw new Error(`path escape is not allowed: ${scoped}`);
  return output;
}

function safeName(value: string): string { return value.replace(/[^a-zA-Z0-9._-]+/gu, '-'); }

function porcelainEntries(output: string): Map<string, string> {
  const values = output.split('\0');
  const entries = new Map<string, string>();
  for (let index = 0; index < values.length; index += 1) {
    const entry = values[index];
    if (!entry || entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if (path) entries.set(path, status);
    if (/[RC]/u.test(status)) {
      const related = values[index + 1];
      if (related) entries.set(related, status);
      index += 1;
    }
  }
  return entries;
}

async function fingerprintPath(root: string, path: string, status: string): Promise<string> {
  const absolute = canonicalScopedPath(root, path);
  try {
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink()) return createHash('sha256').update(`${status}:link:${await readlink(absolute)}`).digest('hex');
    if (metadata.isFile()) return createHash('sha256').update(status).update(await readFile(absolute)).digest('hex');
    return createHash('sha256').update(`${status}:${metadata.mode}:${metadata.size}`).digest('hex');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return createHash('sha256').update(`${status}:missing`).digest('hex');
    throw error;
  }
}

export class GitRepository {
  constructor(readonly root: string) {}

  static async discover(start: string): Promise<GitRepository> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: start, encoding: 'utf8' });
      return new GitRepository(stdout.trim());
    } catch (error) {
      throw new Error(`git repository not found: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async runRaw(args: string[], cwd = this.root): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  }

  async run(args: string[], cwd = this.root): Promise<string> {
    return (await this.runRaw(args, cwd)).trim();
  }

  validateWriteScope(scopes: string[], changedFiles: string[]): void {
    for (const changed of changedFiles) {
      const path = canonicalScopedPath(this.root, changed);
      const allowed = scopes.some((scope) => {
        if (scope === '.') return true;
        const root = canonicalScopedPath(this.root, scope);
        return path === root || path.startsWith(`${root}${sep}`);
      });
      if (!allowed) throw new Error(`changed file is outside write scope: ${changed}`);
    }
  }

  async createTaskWorktree(runId: string, taskId: string): Promise<string> {
    const path = join(this.root, '.agents-crew', 'worktrees', safeName(runId), safeName(taskId));
    const branch = `agents-crew/${safeName(runId)}/${safeName(taskId)}`;
    await mkdir(dirname(path), { recursive: true });
    if (existsSync(path)) await rm(path, { recursive: true, force: true });
    try { await this.run(['branch', '-D', branch]); } catch { /* branch can be absent */ }
    await this.run(['worktree', 'add', '-b', branch, path, 'HEAD']);
    return path;
  }

  async integrateTaskWorktree(worktree: string): Promise<void> {
    await this.run(['add', '-N', '--all'], worktree);
    const patch = await this.runRaw(['diff', '--binary', 'HEAD', '--'], worktree);
    if (!patch.trim()) return;
    const lockPath = join(this.root, '.agents-crew', 'worktrees', '.integration-lock');
    await withDirectoryLock(lockPath, async () => {
      const patchPath = join(this.root, '.agents-crew', 'worktrees', `.integrate-${process.pid}-${randomUUID()}.patch`);
      await mkdir(dirname(patchPath), { recursive: true });
      await writeFile(patchPath, patch, 'utf8');
      try {
        await this.run(['apply', '--3way', '--whitespace=nowarn', patchPath]);
      } finally {
        await rm(patchPath, { force: true });
      }
    });
  }

  async cleanupTaskWorktree(path: string): Promise<void> {
    try { await this.run(['worktree', 'remove', '--force', path]); } catch { await rm(path, { recursive: true, force: true }); }
    try { await this.run(['worktree', 'prune']); } catch { /* best effort */ }
  }

  async cleanupRunWorktrees(runId: string): Promise<void> {
    const base = join(this.root, '.agents-crew', 'worktrees', safeName(runId));
    const porcelain = await this.runRaw(['worktree', 'list', '--porcelain']);
    for (const line of porcelain.split(/\r?\n/u)) {
      if (!line.startsWith('worktree ')) continue;
      const path = line.slice('worktree '.length);
      const rel = relative(base, path);
      if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
        try { await this.run(['worktree', 'remove', '--force', path]); } catch { /* cleanup continues */ }
      }
    }
    await rm(base, { recursive: true, force: true });
    try { await this.run(['worktree', 'prune']); } catch { /* best effort */ }
  }

  async snapshotChanges(cwd = this.root): Promise<ChangeSnapshot> {
    const output = await this.runRaw(['status', '--porcelain=v1', '-z', '--untracked-files=all'], cwd);
    const snapshot: ChangeSnapshot = {};
    for (const [path, status] of porcelainEntries(output)) snapshot[path] = await fingerprintPath(cwd, path, status);
    return snapshot;
  }

  async changedSince(before: ChangeSnapshot, cwd = this.root): Promise<string[]> {
    const after = await this.snapshotChanges(cwd);
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((path) => before[path] !== after[path])
      .sort();
  }

  async changedFiles(cwd = this.root): Promise<string[]> {
    return Object.keys(await this.snapshotChanges(cwd)).sort();
  }
}
