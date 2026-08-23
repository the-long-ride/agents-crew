import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const defaultStaleMilliseconds = 30_000;
const defaultAttempts = 6_000;
const defaultDelayMilliseconds = 10;

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

async function ageMilliseconds(path: string): Promise<number | undefined> {
  try { return Date.now() - (await stat(path)).mtimeMs; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function staleLock(path: string, staleMilliseconds: number): Promise<boolean> {
  try {
    const raw = await readFile(join(path, 'owner.json'), 'utf8');
    try {
      const owner = JSON.parse(raw) as { pid?: number };
      return !processAlive(Number(owner.pid));
    } catch {
      return (await ageMilliseconds(path) ?? 0) > staleMilliseconds;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return (await ageMilliseconds(path) ?? 0) > staleMilliseconds;
  }
}

export async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

export async function withDirectoryLock<T>(
  path: string,
  operation: () => Promise<T>,
  options: { staleMilliseconds?: number; attempts?: number; delayMilliseconds?: number } = {},
): Promise<T> {
  const staleMilliseconds = options.staleMilliseconds ?? defaultStaleMilliseconds;
  const attempts = options.attempts ?? defaultAttempts;
  const wait = options.delayMilliseconds ?? defaultDelayMilliseconds;
  await mkdir(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await mkdir(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await staleLock(path, staleMilliseconds)) {
        await rm(path, { recursive: true, force: true });
        continue;
      }
      await delay(wait);
      continue;
    }
    try {
      try {
        await atomicJson(join(path, 'owner.json'), { pid: process.pid, created_at: new Date().toISOString() });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          await delay(wait);
          continue;
        }
        throw error;
      }
      return await operation();
    } finally {
      await rm(path, { recursive: true, force: true });
    }
  }
  throw new Error(`timed out acquiring directory lock: ${path}`);
}
