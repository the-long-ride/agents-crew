import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CrewConfig, Run, RunIntent, Task } from '../domain/types.js';
import { loadConfig, saveConfig } from '../config/config.js';
import { RunStore } from '../runtime/state.js';

export class RunProtocol {
  readonly store: RunStore;
  constructor(readonly workspace: string) { this.store = new RunStore(workspace); }

  async materialize(run: Run, config: CrewConfig, intent: RunIntent): Promise<void> {
    const directory = this.store.activeRunDir(run.id);
    await Promise.all(['context', 'tasks', 'communication', 'evidence', 'blockers', 'agents'].map((name) => mkdir(join(directory, name), { recursive: true })));
    await saveConfig(join(directory, 'crew.snapshot.toml'), config);
    await writeFile(join(directory, `goal-${run.id}.md`), this.renderGoal(run, intent), 'utf8');
    await writeFile(join(directory, 'intent.json'), `${JSON.stringify(intent, null, 2)}\n`, 'utf8');
    await this.sync(run);
  }

  async sync(run: Run): Promise<void> {
    const directory = this.store.runDir(run.id);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'status.md'), this.renderStatus(run), 'utf8');
    await writeFile(join(directory, 'status.json'), `${JSON.stringify({ id: run.id, status: run.status, iteration: run.iteration, summary: run.terminal_summary, tasks: run.tasks }, null, 2)}\n`, 'utf8');
    const tasksDirectory = join(directory, 'tasks');
    const contextDirectory = join(directory, 'context');
    if (existsSync(tasksDirectory)) {
      for (const task of Object.values(run.tasks)) {
        await writeFile(join(tasksDirectory, `${task.id}.json`), `${JSON.stringify(task, null, 2)}\n`, 'utf8');
        if (existsSync(contextDirectory)) await writeFile(join(contextDirectory, `task-${task.id}.md`), this.renderTaskContext(run, task), 'utf8');
      }
    }
  }

  async loadSnapshot(runId: string): Promise<CrewConfig> { return loadConfig(join(this.store.runDir(runId), 'crew.snapshot.toml')); }

  async archiveTerminal(run: Run): Promise<void> {
    let directory = this.store.runDir(run.id);
    if (directory === this.store.activeRunDir(run.id)) directory = await this.store.archive(run.id);
    await writeFile(join(directory, 'summary.json'), `${JSON.stringify({ id: run.id, status: run.status, goal: run.original_goal, summary: run.terminal_summary, completed_at: new Date().toISOString() }, null, 2)}\n`, 'utf8');
    for (const name of ['context', 'tasks', 'communication', 'actions', 'agents', 'blockers']) await rm(join(directory, name), { recursive: true, force: true });
    await this.sync(run);
  }

  private renderGoal(run: Run, intent: RunIntent): string {
    const section = (title: string, values: string[]): string => `\n## ${title}\n${values.length ? values.map((value) => `- ${value}`).join('\n') : '- None'}\n`;
    return `# ${intent.template_name}\n\nRun ID: \`${run.id}\`\n\n## Goal\n${intent.goal}\n${section('Expectations', intent.expectations)}${section('Acceptance criteria', intent.acceptance_criteria)}${section('Constraints', intent.constraints)}`;
  }

  private renderTaskContext(run: Run, task: Task): string {
    const criteria = run.acceptance_criteria.map((item) => `- ${item.id}: ${item.description}`).join('\n') || '- None';
    const dependencies = task.dependencies.length ? task.dependencies.map((id) => `- ${id}`).join('\n') : '- None';
    return `# Task ${task.id}\n\n## Goal\n${run.original_goal}\n\n## Role\n${task.role}\n\n## Instructions\n${task.instructions}\n\n## Expected output\n${task.expected_output}\n\n## Dependencies\n${dependencies}\n\n## Acceptance criteria\n${criteria}\n`;
  }

  private renderStatus(run: Run): string {
    const tasks = Object.values(run.tasks).map((task) => `- \`${task.id}\`: ${task.status} — ${task.title}`).join('\n') || '- None';
    return `# Agents Crew Run ${run.id}\n\n- Status: **${run.status}**\n- Iteration: ${run.iteration}/${run.max_iterations}\n- Updated: ${run.updated_at}\n\n## Goal\n${run.original_goal}\n\n## Tasks\n${tasks}\n\n## Summary\n${run.terminal_summary ?? 'In progress'}\n`;
  }
}
