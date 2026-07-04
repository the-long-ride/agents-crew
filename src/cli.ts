#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createStatePaths } from './state/paths';
import { JsonStateStore } from './state/json-store';
import { migrateAgentBridgeV1 } from './migration/agent-bridge-v1';
import { createWorkflow } from './workflows/workflow-registry';
import { atomicWrite, emit, readTurns } from './cli-utils';
import { runHook } from './cli-hook';
import { runRun } from './cli-run';
import { runSetup } from './cli-setup';
import { printHelp } from './cli-help';
import { prepareTask } from './cli-prepare';
import type { AgentKind, CrewRole, WorkflowKind } from './types';

export interface CliOptions {
  command: string;
  taskPath: string | null;
  workflow: string | null;
  adapter: AgentKind;
  participant: string | null;
  workspace: string;
  json: boolean;
  migrateTarget: string | null;
  setupImplementer: AgentKind | null;
  setupReviewer: AgentKind | null;
  setupPair: AgentKind | null;
  setupVerifier: AgentKind | null;
  setupTaskId: string | null;
  setupGoal: string | null;
  setupForce: boolean;
  setupOutput: string | null;
  setupPrepare: boolean;
}

export function parseArguments(argv: string[]): CliOptions {
  const options: CliOptions = {
    command: argv[0] || 'status',
    taskPath: null,
    workflow: null,
    adapter: 'antigravity',
    participant: null,
    workspace: process.cwd(),
    json: false,
    migrateTarget: null,
    setupImplementer: null,
    setupReviewer: null,
    setupPair: null,
    setupVerifier: null,
    setupTaskId: null,
    setupGoal: null,
    setupForce: false,
    setupOutput: null,
    setupPrepare: false,
  };

  const positional: string[] = [];

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--task') {
      i++;
      if (!argv[i]) throw new Error('--task requires a value');
      options.taskPath = argv[i];
    } else if (arg === '--workflow') {
      i++;
      if (!argv[i]) throw new Error('--workflow requires a value');
      options.workflow = argv[i];
    } else if (arg === '--adapter') {
      i++;
      if (!argv[i]) throw new Error('--adapter requires a value');
      options.adapter = argv[i] as AgentKind;
    } else if (arg === '--participant') {
      i++;
      if (!argv[i]) throw new Error('--participant requires a value');
      options.participant = argv[i];
    } else if (arg === '--workspace') {
      i++;
      if (!argv[i]) throw new Error('--workspace requires a value');
      options.workspace = argv[i];
    } else if (arg === '--implementer') {
      i++;
      if (!argv[i]) throw new Error('--implementer requires a value');
      options.setupImplementer = argv[i] as AgentKind;
    } else if (arg === '--reviewer') {
      i++;
      if (!argv[i]) throw new Error('--reviewer requires a value');
      options.setupReviewer = argv[i] as AgentKind;
    } else if (arg === '--pair-agent') {
      i++;
      if (!argv[i]) throw new Error('--pair-agent requires a value');
      options.setupPair = argv[i] as AgentKind;
    } else if (arg === '--verifier') {
      i++;
      if (!argv[i]) throw new Error('--verifier requires a value');
      options.setupVerifier = argv[i] as AgentKind;
    } else if (arg === '--task-id') {
      i++;
      if (!argv[i]) throw new Error('--task-id requires a value');
      options.setupTaskId = argv[i];
    } else if (arg === '--goal') {
      i++;
      if (!argv[i]) throw new Error('--goal requires a value');
      options.setupGoal = argv[i];
    } else if (arg === '--prepare') {
      options.setupPrepare = true;
    } else if (arg === '--force') {
      options.setupForce = true;
    } else if (arg === '--output') {
      i++;
      if (!argv[i]) throw new Error('--output requires a value');
      options.setupOutput = argv[i];
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  options.workspace = path.resolve(options.workspace);
  if (options.taskPath) options.taskPath = path.resolve(options.workspace, options.taskPath);

  if (options.command === 'migrate') {
    options.migrateTarget = positional[0] || null;
  }

  return options;
}

const VALID_COMMANDS = new Set(['init', 'prepare', 'hook', 'run', 'next', 'status', 'disable', 'enable', 'migrate', 'setup', 'help']);

async function runCommand(options: CliOptions): Promise<number> {
  const paths = createStatePaths(options.workspace);
  const store = new JsonStateStore(paths);

  switch (options.command) {
    case 'init': {
      fs.mkdirSync(paths.directory, { recursive: true });
      emit({ initialized: true, directory: paths.directory }, options.json);
      return 0;
    }

    case 'prepare': {
      const res = prepareTask({
        workspace: options.workspace,
        taskPath: options.taskPath,
        workflow: options.workflow,
      });
      emit(res.output, options.json);
      return res.code;
    }

    case 'hook':
      return runHook(options, paths, store);

    case 'run':
      return runRun(options, paths, store);

    case 'next': {
      const task = store.readTask();
      if (!task) throw new Error('No active task');
      const workflow = createWorkflow((task as any).workflow as WorkflowKind);
      const turns = readTurns(paths);
      const lastTurn = turns[turns.length - 1];
      if (!lastTurn) {
        emit({ action: 'continue', nextParticipantId: (task as any).participants?.[0]?.id }, options.json);
        return 0;
      }
      const decision = workflow.decideNext({ task, lastTurn });
      emit(decision, options.json);
      return 0;
    }

    case 'status': {
      const task = store.readTask();
      const status = {
        enabled: !fs.existsSync(paths.disabled),
        ready: fs.existsSync(paths.ready),
        taskId: (task as any)?.taskId ?? null,
        cycle: Number.isInteger((task as any)?.reviewCycle) ? (task as any).reviewCycle : 0,
      };
      emit(status, options.json);
      return 0;
    }

    case 'disable': {
      if (!fs.existsSync(paths.disabled)) atomicWrite(paths.disabled, `${new Date().toISOString()}\n`);
      const task = store.readTask();
      const status = {
        enabled: false,
        ready: fs.existsSync(paths.ready),
        taskId: (task as any)?.taskId ?? null,
        cycle: Number.isInteger((task as any)?.reviewCycle) ? (task as any).reviewCycle : 0,
      };
      emit(status, options.json);
      return 0;
    }

    case 'enable': {
      fs.rmSync(paths.disabled, { force: true });
      const task = store.readTask();
      const status = {
        enabled: true,
        ready: fs.existsSync(paths.ready),
        taskId: (task as any)?.taskId ?? null,
        cycle: Number.isInteger((task as any)?.reviewCycle) ? (task as any).reviewCycle : 0,
      };
      emit(status, options.json);
      return 0;
    }

    case 'migrate': {
      const target = options.migrateTarget;
      if (target === 'agent-bridge-v1') {
        const result = await migrateAgentBridgeV1(options.workspace);
        emit(result, options.json);
        return 0;
      }
      throw new Error(`Unknown migration target: ${target}`);
    }

    case 'setup': {
      const participants: Partial<Record<CrewRole, AgentKind>> = {};
      if (options.setupImplementer) participants.implementer = options.setupImplementer;
      if (options.setupReviewer) participants.reviewer = options.setupReviewer;
      if (options.setupPair) participants.pair = options.setupPair;
      if (options.setupVerifier) participants.verifier = options.setupVerifier;
      return runSetup({
        workspace: options.workspace,
        workflow: options.workflow as WorkflowKind | null,
        participants,
        taskId: options.setupTaskId,
        goal: options.setupGoal,
        json: options.json,
        force: options.setupForce,
        output: options.setupOutput,
        prepare: options.setupPrepare,
      });
    }

    default:
      throw new Error(`Unknown command: ${options.command}`);
  }
}

function isHelpToken(arg: string): boolean {
  return arg === '--help' || arg === '-h';
}

function main(): void {
  try {
    const argv = process.argv.slice(2);

    if (argv.length === 0) {
      process.exitCode = printHelp(null);
      return;
    }

    const helpFlagIndex = argv.findIndex(isHelpToken);
    if (helpFlagIndex !== -1) {
      const cmdIndex = argv.findIndex((arg) => !arg.startsWith('--') && arg !== '-h');
      const cmd = cmdIndex !== -1 ? argv[cmdIndex] : null;
      process.exitCode = printHelp(cmd);
      return;
    }

    if (argv[0] === 'help') {
      const target = argv[1] && !argv[1].startsWith('--') ? argv[1] : null;
      process.exitCode = printHelp(target);
      return;
    }

    const options = parseArguments(argv);
    if (!VALID_COMMANDS.has(options.command)) {
      throw new Error(`Unknown command: ${options.command}`);
    }
    runCommand(options).then((code) => {
      process.exitCode = code;
    }).catch((error: any) => {
      process.stderr.write(`agents-crew: ${error.message}\n`);
      process.exitCode = 1;
    });
  } catch (error: any) {
    process.stderr.write(`agents-crew: ${error.message}\n`);
    process.exitCode = 1;
  }
}

main();
