import fs from 'node:fs';
import path from 'node:path';

export function readJsonIfPresent(filePath: string): any {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function atomicWrite(filePath: string, content: string): void {
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

export function emit(result: any, asJson: boolean): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (typeof result === 'object' && result.enabled !== undefined) {
    process.stdout.write(
      `agents-crew: ${result.enabled ? 'enabled' : 'disabled'}; ` +
        `ready=${result.ready}; task=${result.taskId ?? 'none'}; cycle=${result.cycle}\n`,
    );
    return;
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

export function appendTurn(paths: any, turn: any): void {
  fs.mkdirSync(paths.directory, { recursive: true });
  fs.appendFileSync(paths.turns, `${JSON.stringify(turn)}\n`, { encoding: 'utf8' });
}

export function readTurns(paths: any): any[] {
  if (!fs.existsSync(paths.turns)) return [];
  const lines = fs.readFileSync(paths.turns, 'utf8').trim().split('\n').filter(Boolean);
  return lines.map((line: string) => JSON.parse(line));
}

export function writeNeedsHuman(paths: any, task: any, summary: string, cycle: number, findings: any[] = []): void {
  const review = {
    schemaVersion: 1,
    taskId: task.taskId,
    diffHash: task.diffHash,
    cycle,
    status: 'needs_human',
    summary,
    findings,
    reviewedAt: new Date().toISOString(),
  };
  atomicWrite(paths.review, `${JSON.stringify(review, null, 2)}\n`);
  atomicWrite(
    paths.needsHuman,
    `# Agent Review Needs Human\n\nTask: ${task.taskId}\n\nCycle: ${cycle}\n\n${summary}\n`,
  );
  try { fs.rmSync(paths.ready, { force: true }); } catch {}
}

export function resolveSchemaPath(schemaName: string): string {
  const pkgDir = path.resolve(path.join(__dirname, '..'));
  const pkgSchema = path.join(pkgDir, 'schemas', schemaName);
  if (fs.existsSync(pkgSchema)) return pkgSchema;
  return path.join(process.cwd(), 'schemas', schemaName);
}
