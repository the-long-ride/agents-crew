import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createStatePaths } from './state/paths';
import { validateCrewTaskDraft } from './schema/task';
import { atomicWrite, emit } from './cli-utils';
import type { AgentKind, CrewParticipant, CrewRole, WorkflowKind } from './types';

interface WorkflowRoleConfig {
  required: CrewRole[];
  optional: CrewRole[];
}

const WORKFLOW_ROLES: Record<WorkflowKind, WorkflowRoleConfig> = {
  'implement-review': { required: ['implementer', 'reviewer'], optional: [] },
  'pair-implement': { required: ['implementer', 'pair'], optional: ['verifier'] },
  'same-agent-loop': { required: ['implementer', 'reviewer'], optional: [] },
};

const VALID_AGENTS: AgentKind[] = ['antigravity', 'codex', 'claude-code', 'opencode', 'github-copilot', 'process'];

let rlInstance: readline.Interface | null = null;

function getPrompt(): (question: string) => Promise<string> {
  if (!rlInstance) {
    rlInstance = readline.createInterface({ input: process.stdin });
  }
  const rl = rlInstance;
  const lines: string[] = [];
  let done = false;
  const pending: ((line: string | null) => void)[] = [];

  rl.on('line', (line: string) => {
    if (pending.length > 0) {
      pending.shift()!(line);
    } else {
      lines.push(line);
    }
  });
  rl.on('close', () => {
    done = true;
    while (pending.length > 0) {
      pending.shift()!(null);
    }
  });

  return (question: string): Promise<string> => {
    process.stderr.write(question);
    if (lines.length > 0) return Promise.resolve(lines.shift()!.trim());
    if (done) return Promise.resolve('');
    return new Promise((resolve) => {
      pending.push((line) => resolve((line ?? '').trim()));
    });
  };
}

function closePrompt(): void {
  if (rlInstance) {
    rlInstance.close();
    rlInstance = null;
  }
}

export interface SetupOptions {
  workspace: string;
  workflow: WorkflowKind | null;
  participants: Partial<Record<CrewRole, AgentKind>>;
  taskId: string | null;
  goal: string | null;
  json: boolean;
  force: boolean;
  output: string | null;
}

export async function runSetup(options: SetupOptions): Promise<number> {
  const needPrompt =
    options.workflow === null ||
    options.taskId === null ||
    options.goal === null ||
    Object.keys(options.participants).length === 0;

  let prompt: ((q: string) => Promise<string>) | null = null;

  try {
    if (needPrompt) prompt = getPrompt();

    const workflow = options.workflow ?? await (async () => {
      const workflows = Object.keys(WORKFLOW_ROLES) as WorkflowKind[];
      process.stderr.write('Available workflows:\n');
      for (const w of workflows) {
        const cfg = WORKFLOW_ROLES[w];
        const roles = [...cfg.required, ...cfg.optional.map((r) => `${r}?`)];
        process.stderr.write(`  ${w}: ${roles.join(' -> ')}\n`);
      }
      const answer = await prompt!('Select workflow: ');
      if (!answer) throw new Error('Workflow is required');
      if (!WORKFLOW_ROLES[answer as WorkflowKind]) throw new Error(`Unknown workflow: ${answer}`);
      return answer as WorkflowKind;
    })();

    const roleConfig = WORKFLOW_ROLES[workflow];
    const participants: CrewParticipant[] = [];
    const agentList = VALID_AGENTS.join(', ');

    for (const role of roleConfig.required) {
      const agent = options.participants[role] ?? await (async () => {
        const answer = await prompt!(`  ${role} agent (${agentList}): `);
        if (!answer) throw new Error(`${role} agent is required`);
        if (!VALID_AGENTS.includes(answer as AgentKind)) throw new Error(`Unknown agent: ${answer}. Valid: ${agentList}`);
        return answer as AgentKind;
      })();
      participants.push({ id: `${agent}-${role}`, agent, role });
    }

    for (const role of roleConfig.optional) {
      if (options.participants[role]) {
        participants.push({ id: `${options.participants[role]!}-${role}`, agent: options.participants[role]!, role });
      }
    }

    const taskId = options.taskId ?? await (async () => {
      const answer = await prompt!('Task ID: ');
      if (!answer) throw new Error('Task ID is required');
      return answer;
    })();

    const goal = options.goal ?? await (async () => {
      const answer = await prompt!('Goal: ');
      if (!answer) throw new Error('Goal is required');
      return answer;
    })();

    const taskDraft = {
      taskId,
      goal,
      acceptanceCriteria: [goal],
      tests: [] as any[],
      implementationSummary: `Pending: ${goal}`,
      workflow,
      participants,
    };

    validateCrewTaskDraft(taskDraft);

    const paths = createStatePaths(options.workspace);
    fs.mkdirSync(paths.directory, { recursive: true });

    const taskInputPath = path.join(options.workspace, options.output ?? 'task-input.json');
    if (fs.existsSync(taskInputPath) && !options.force) {
      emit({ error: `${taskInputPath} already exists. Use --force to overwrite or --output to specify a different path.` }, options.json);
      return 1;
    }

    atomicWrite(taskInputPath, `${JSON.stringify(taskDraft, null, 2)}\n`);

    const result = {
      setup: true,
      directory: paths.directory,
      taskInput: taskInputPath,
      workflow,
      participants: participants.map((p) => `${p.role}: ${p.agent}`),
      nextSteps: [
        'Edit task-input.json to add acceptance criteria, tests, and implementation summary.',
        'Run: agents-crew prepare --task task-input.json --json',
      ],
    };
    emit(result, options.json);
    return 0;
  } finally {
    closePrompt();
  }
}
