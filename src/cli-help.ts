export interface CommandSummary {
  name: string;
  summary: string;
}

export const COMMAND_SUMMARIES: CommandSummary[] = [
  { name: 'setup', summary: 'Scaffold a bridge and (optionally) prepare the task' },
  { name: 'init', summary: 'Create the .agents-crew/ state directory only' },
  { name: 'prepare', summary: 'Seal a task draft + git snapshot into state' },
  { name: 'run', summary: 'Run a single participant (implementer/reviewer/verifier)' },
  { name: 'next', summary: 'Decide which participant acts next' },
  { name: 'status', summary: 'Show workspace state (enabled/ready/task/cycle)' },
  { name: 'hook', summary: 'Antigravity automation entry (reads hook JSON from stdin)' },
  { name: 'disable', summary: 'Pause automation (creates DISABLED sentinel)' },
  { name: 'enable', summary: 'Resume automation' },
  { name: 'migrate', summary: 'Migrate from agent-bridge v1' },
  { name: 'help', summary: 'Show this help, or help for a command' },
];

interface CommandDoc {
  description: string;
  usage: string[];
  flags?: string[];
  examples?: string[];
}

const VALID_AGENTS_LINE =
  '  antigravity, codex, claude-code, opencode, github-copilot, process';

const COMMAND_DOCS: Record<string, CommandDoc> = {
  init: {
    description: 'Create the runtime state directory.',
    usage: ['agents-crew init [--workspace <path>] [--json]'],
    examples: [
      'agents-crew init --workspace . --json',
      '  -> {"initialized":true,"directory":"/.../.agents-crew"}',
    ],
  },
  setup: {
    description:
      'Scaffold a bridge: create .agents-crew/ and write a task-input.json template.\n' +
      'Pass --prepare to also seal the task into state in the same step.\n' +
      'Provide every flag to skip prompts, or omit any to be prompted interactively.',
    usage: [
      'agents-crew setup [--workspace <path>] [--json]',
      '         [--workflow <kind>] [--implementer <agent>] [--reviewer <agent>]',
      '         [--pair-agent <agent>] [--verifier <agent>]',
      '         [--task-id <id>] [--goal "<text>"] [--output <path>]',
      '         [--force] [--prepare]',
    ],
    flags: [
      '--workflow         implement-review | pair-implement | same-agent-loop',
      '--implementer      agent for the implementer role',
      '--reviewer         agent for the reviewer role',
      '--pair-agent       agent for the pair role (pair-implement)',
      '--verifier         agent for the verifier role (pair-implement)',
      '--task-id          unique task identifier',
      '--goal             task goal description',
      '--output <path>   write the template here (default: task-input.json)',
      '--force            overwrite an existing task-input.json',
      '--prepare          also prepare the task (skip the manual prepare step)',
    ],
    examples: [
      '# All flags, then prepare in one shot',
      'agents-crew setup --workspace . --workflow implement-review \\',
      '  --implementer claude-code --reviewer codex --task-id auth-001 \\',
      '  --goal "Add rate limiting" --prepare --json',
      '',
      '# Interactive (prompted for anything not supplied)',
      'agents-crew setup --workspace . --json',
      '',
      'Valid agents:',
      VALID_AGENTS_LINE,
    ],
  },
  prepare: {
    description:
      'Read a task draft, validate it, seal the current git diff hash into state,\n' +
      'then write TASK.json and READY.json. After prepare the task is active.',
    usage: [
      'agents-crew prepare --task <path> [--workspace <path>]',
      '         [--workflow <kind>] [--json]',
    ],
    flags: [
      '--task <path>     task draft JSON (required)',
      '--workflow <kind> override the workflow baked into the draft',
    ],
    examples: [
      'agents-crew prepare --task task-input.json --json',
      '  -> {"enabled":true,"ready":true,"taskId":"auth-001","cycle":0}',
    ],
  },
  run: {
    description:
      'Run the adapter for a participant (must match an id in the prepared task).\n' +
      'Implementer runs may change the tree; reviewer/verifier runs reject if the\n' +
      'diff changed mid-review. Appends a turn to TURNS.jsonl; reviewer/verifier\n' +
      'runs also write REVIEW.json and bump the review cycle.',
    usage: ['agents-crew run --participant <id> [--workspace <path>] [--json]'],
    flags: ['--participant <id>   participant id from the task (required)'],
    examples: ['agents-crew run --participant codex-reviewer --json'],
  },
  next: {
    description:
      'Decide which participant acts next, per workflow rules and the last turn.\n' +
      'With no prior turns, returns the first participant.',
    usage: ['agents-crew next [--workspace <path>] [--json]'],
    examples: [
      'agents-crew next --json',
      '  -> {"action":"continue","nextParticipantId":"impl"}',
    ],
  },
  status: {
    description:
      'Print enabled/disabled, whether a task is ready, the active task id, and\n' +
      'the current review cycle.',
    usage: ['agents-crew status [--workspace <path>] [--json]'],
    examples: [
      'agents-crew status --json',
      '  -> {"enabled":true,"ready":true,"taskId":"auth-001","cycle":0}',
    ],
  },
  hook: {
    description:
      'Read hook JSON from stdin and, if automation is enabled and a task is READY,\n' +
      'run the reviewer. Intended to be wired to the Antigravity desktop model_stop hook.',
    usage: ['agents-crew hook --adapter <kind> [--workspace <path>] [--json]'],
    flags: ['--adapter <kind>   adapter for the hook (default: antigravity)'],
    examples: [
      'echo \'{"terminationReason":"model_stop","fullyIdle":true}\' \\',
      '  | agents-crew hook --adapter antigravity --json',
    ],
  },
  disable: {
    description:
      'Create the .agents-crew/DISABLED sentinel. While present, `hook` returns\n' +
      '`stop` immediately and does not run a reviewer.',
    usage: ['agents-crew disable [--workspace <path>] [--json]'],
  },
  enable: {
    description: 'Remove the .agents-crew/DISABLED sentinel so `hook` can run again.',
    usage: ['agents-crew enable [--workspace <path>] [--json]'],
  },
  migrate: {
    description:
      'Copy TASK.json, READY.json, REVIEW.json, NEEDS_HUMAN.md, and DISABLED from\n' +
      '.agent-bridge/ into .agents-crew/. Does not remove legacy files.',
    usage: ['agents-crew migrate agent-bridge-v1 [--workspace <path>] [--json]'],
  },
  help: {
    description:
      'With no argument, print the top-level overview. With a command name, print\n' +
      'detailed help for that command. --help / -h after any command does the same.',
    usage: [
      'agents-crew help [command]',
      'agents-crew <command> --help',
      'agents-crew --help',
      'agents-crew -h',
    ],
  },
};

export function overview(): string {
  const lines: string[] = [];
  lines.push('agents-crew — Typed communication loops for AI agent crews.');
  lines.push('');
  lines.push('USAGE');
  lines.push('  agents-crew <command> [options]');
  lines.push('  agents-crew help [command]      show help (or per-command help)');
  lines.push('  agents-crew <command> --help     same as above');
  lines.push('  agents-crew -h                   same as above');
  lines.push('');
  lines.push('TIP');
  lines.push('  Run `agents-crew status` to see the current task, review cycle, and automation state.');
  lines.push('');
  lines.push('QUICKSTART (one step to a ready task)');
  lines.push('  agents-crew setup --workspace . --workflow implement-review \\');
  lines.push('    --implementer claude-code --reviewer codex --task-id my-task \\');
  lines.push('    --goal "Add rate limiting" --prepare --json');
  lines.push('  agents-crew run --participant codex-reviewer --json');
  lines.push('  agents-crew next --json');
  lines.push('');
  lines.push('COMMANDS');
  const width = Math.max(...COMMAND_SUMMARIES.map((c) => c.name.length));
  for (const cmd of COMMAND_SUMMARIES) {
    lines.push(`  ${cmd.name.padEnd(width)}  ${cmd.summary}`);
  }
  lines.push('');
  lines.push('GLOBAL OPTIONS');
  lines.push('  --workspace <path>   workspace root (default: current directory)');
  lines.push('  --json               machine-readable JSON output');
  lines.push('');
  lines.push('LEARN MORE');
  lines.push('  docs/tutorial.md     full walkthrough');
  lines.push('  docs/workflows/      workflow reference');
  lines.push('  docs/adapters/       adapter setup');
  lines.push('');
  return lines.join('\n');
}

export function commandHelp(command: string): string {
  const doc = COMMAND_DOCS[command];
  const lines: string[] = [];
  if (!doc) {
    lines.push(`Unknown command: ${command}`);
    lines.push('');
    lines.push('Run `agents-crew help` to list available commands.');
    return lines.join('\n');
  }
  lines.push(`agents-crew ${command} — ${doc.description.split('\n').slice(0, 1).join('')}`);
  lines.push('');
  if (doc.description.includes('\n')) {
    const rest = doc.description.split('\n').slice(1).join('\n');
    lines.push(rest);
    lines.push('');
  }
  lines.push('USAGE');
  for (const line of doc.usage) lines.push(`  ${line}`);
  lines.push('');
  if (doc.flags && doc.flags.length > 0) {
    lines.push('FLAGS');
    for (const line of doc.flags) lines.push(`  ${line}`);
    lines.push('');
  }
  if (doc.examples && doc.examples.length > 0) {
    lines.push('EXAMPLES');
    for (const line of doc.examples) lines.push(`  ${line}`);
    lines.push('');
  }
  lines.push('See also: agents-crew help, docs/tutorial.md');
  lines.push('');
  return lines.join('\n');
}

export function printHelp(command: string | null): number {
  if (command === null) {
    process.stdout.write(overview());
    return 0;
  }
  if (COMMAND_DOCS[command]) {
    process.stdout.write(commandHelp(command));
    return 0;
  }
  process.stderr.write(`${commandHelp(command)}\n`);
  return 1;
}
