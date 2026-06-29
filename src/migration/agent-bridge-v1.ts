import fs from 'node:fs';
import path from 'node:path';
import { createStatePaths } from '../state/paths';

const LEGACY_FILES = ['TASK.json', 'READY.json', 'REVIEW.json', 'NEEDS_HUMAN.md', 'DISABLED'] as const;

export interface MigrationResult {
  migrated: boolean;
  copiedFiles: string[];
}

export async function migrateAgentBridgeV1(workspace: string): Promise<MigrationResult> {
  const legacyDir = path.join(workspace, '.agent-bridge');
  const newPaths = createStatePaths(workspace);

  if (!fs.existsSync(path.join(legacyDir, 'TASK.json'))) {
    return { migrated: false, copiedFiles: [] };
  }

  const copiedFiles: string[] = [];
  const destDir = newPaths.directory;
  fs.mkdirSync(destDir, { recursive: true });

  for (const file of LEGACY_FILES) {
    const src = path.join(legacyDir, file);
    const dest = path.join(destDir, file);
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
      copiedFiles.push(file);
    }
  }

  return { migrated: copiedFiles.length > 0, copiedFiles };
}
