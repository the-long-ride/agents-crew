import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export interface GitSnapshot {
  repositoryRoot: string;
  baseCommit: string;
  diffHash: string;
  changedFiles: string[];
}

function runGit(workspace: string, args: string[], encoding: BufferEncoding = 'utf8'): string | Buffer {
  const result = spawnSync('git', args, {
    cwd: workspace,
    encoding,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : result.stderr;
    throw new Error(`git ${args.join(' ')} failed: ${String(stderr).trim()}`);
  }
  return result.stdout;
}

function splitNull(buffer: Buffer | string): string[] {
  return buffer
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((item) => item.replaceAll('/', path.sep));
}

function isRuntimePath(relativePath: string, stateDirectoryName: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/');
  return normalized === stateDirectoryName || normalized.startsWith(`${stateDirectoryName}/`);
}

export function getGitSnapshot(workspace: string, stateDirectoryName = '.agents-crew'): GitSnapshot {
  const repositoryRoot = path.resolve(String(runGit(workspace, ['rev-parse', '--show-toplevel'], 'utf8')).trim());
  const baseCommit = String(runGit(repositoryRoot, ['rev-parse', 'HEAD'], 'utf8')).trim();
  const trackedFiles = splitNull(runGit(repositoryRoot, ['diff', '--name-only', '-z', 'HEAD']));
  const untrackedFiles = splitNull(
    runGit(repositoryRoot, ['ls-files', '--others', '--exclude-standard', '-z']),
  ).filter((file) => !isRuntimePath(file, stateDirectoryName));
  const changedFiles = [...new Set([...trackedFiles, ...untrackedFiles])].sort((left, right) =>
    left.localeCompare(right),
  );

  const hash = crypto.createHash('sha256');
  hash.update(repositoryRoot);
  hash.update('\0');
  hash.update(baseCommit);
  hash.update('\0');
  hash.update(runGit(repositoryRoot, ['diff', '--binary', '--no-ext-diff', 'HEAD']));
  for (const relativePath of untrackedFiles.sort()) {
    hash.update('\0untracked\0');
    hash.update(relativePath);
    const absolutePath = path.join(repositoryRoot, relativePath);
    if (fs.statSync(absolutePath).isFile()) hash.update(fs.readFileSync(absolutePath));
  }

  return { repositoryRoot, baseCommit, changedFiles, diffHash: hash.digest('hex') };
}
