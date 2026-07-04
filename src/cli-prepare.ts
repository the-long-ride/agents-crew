import fs from 'node:fs';
import { createStatePaths } from './state/paths';
import { JsonStateStore } from './state/json-store';
import { getGitSnapshot } from './git/snapshot';
import { validateCrewTaskDraft } from './schema/task';
import { readJsonIfPresent } from './cli-utils';

export interface PrepareInput {
  workspace: string;
  taskPath: string | null;
  workflow?: string | null;
}

export interface PrepareOutput {
  enabled: boolean;
  ready: boolean;
  taskId: string;
  cycle: number;
}

export interface PrepareResult {
  code: number;
  output: PrepareOutput;
}

export function prepareTask(input: PrepareInput): PrepareResult {
  if (!input.taskPath) throw new Error('prepare requires --task <path>');
  const paths = createStatePaths(input.workspace);
  const store = new JsonStateStore(paths);

  const draftText = readJsonIfPresent(input.taskPath);
  if (!draftText) throw new Error(`Task file not found: ${input.taskPath}`);

  const task = validateCrewTaskDraft(draftText);
  const workflow = input.workflow || task.workflow;
  const snapshot = getGitSnapshot(input.workspace);
  const previous = store.readTask() as any;
  const now = new Date().toISOString();

  const storedTask = {
    ...task,
    workflow,
    schemaVersion: 1,
    workspaceRoot: input.workspace,
    repositoryRoot: snapshot.repositoryRoot,
    baseCommit: snapshot.baseCommit,
    diffHash: snapshot.diffHash,
    changedFiles: snapshot.changedFiles,
    reviewCycle:
      previous?.taskId === task.taskId && Number.isInteger(previous.reviewCycle)
        ? previous.reviewCycle
        : 0,
    updatedAt: now,
  };

  store.writeTask(storedTask);
  store.writeReady({
    schemaVersion: 1,
    taskId: storedTask.taskId,
    diffHash: storedTask.diffHash,
    createdAt: now,
  });

  return {
    code: 0,
    output: {
      enabled: !fs.existsSync(paths.disabled),
      ready: true,
      taskId: storedTask.taskId,
      cycle: storedTask.reviewCycle,
    },
  };
}
