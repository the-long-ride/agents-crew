import fs from 'node:fs';
import path from 'node:path';
import type { StatePaths } from './paths';

function atomicWrite(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function writeJson(filePath: string, value: unknown): void {
  atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJsonIfPresent(filePath: string): unknown | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export class JsonStateStore {
  constructor(private paths: StatePaths) {}

  writeTask(data: unknown): void {
    writeJson(this.paths.task, data);
  }

  writeReady(data: unknown): void {
    writeJson(this.paths.ready, data);
  }

  writeReview(data: unknown): void {
    writeJson(this.paths.review, data);
  }

  readTask(): unknown | null {
    return readJsonIfPresent(this.paths.task);
  }

  readReady(): unknown | null {
    return readJsonIfPresent(this.paths.ready);
  }

  readReview(): unknown | null {
    return readJsonIfPresent(this.paths.review);
  }
}
