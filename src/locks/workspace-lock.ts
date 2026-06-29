import fs from 'node:fs';
import path from 'node:path';

export interface WorkspaceLock {
  release(): void;
}

interface LockData {
  pid: number;
  taskId: string;
  participantId: string;
  createdAt: string;
}

export function acquireWorkspaceLock(lockPath: string, taskId: string, participantId: string): WorkspaceLock {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const data: LockData = {
    pid: process.pid,
    taskId,
    participantId,
    createdAt: new Date().toISOString(),
  };
  let descriptor: number;
  try {
    descriptor = fs.openSync(lockPath, 'wx');
  } catch (error: any) {
    if (error.code === 'EEXIST') {
      throw new Error('Workspace lock is already active');
    }
    throw error;
  }
  fs.writeFileSync(descriptor, `${JSON.stringify(data)}\n`);
  fs.closeSync(descriptor);

  return {
    release() {
      try {
        const existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        if (existing.pid === process.pid) {
          fs.rmSync(lockPath, { force: true });
        }
      } catch {}
    },
  };
}
