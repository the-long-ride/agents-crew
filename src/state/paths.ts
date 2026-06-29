import path from 'node:path';

export interface StatePaths {
  directory: string;
  task: string;
  ready: string;
  review: string;
  turns: string;
  context: string;
  lock: string;
  needsHuman: string;
  disabled: string;
}

export function createStatePaths(workspace: string, directoryName = '.agents-crew'): StatePaths {
  const directory = path.join(workspace, directoryName);
  return {
    directory,
    task: path.join(directory, 'TASK.json'),
    ready: path.join(directory, 'READY.json'),
    review: path.join(directory, 'REVIEW.json'),
    turns: path.join(directory, 'TURNS.jsonl'),
    context: path.join(directory, 'CONTEXT.md'),
    lock: path.join(directory, 'LOCK.json'),
    needsHuman: path.join(directory, 'NEEDS_HUMAN.md'),
    disabled: path.join(directory, 'DISABLED'),
  };
}
