#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from './args.js';
import { dispatchCommand } from './commands.js';

const usage = `Agents Crew\n\nUsage: crew [--workspace <path>] [--json] <command>\n\nCommands: init, ui, start, run, plan, status, resume, pause, approve, reject, cancel, doctor, template, config, plugin, worker, manager`;

function human(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'run' in value) {
    const run = (value as { run: { id: string; status: string; original_goal: string; terminal_summary?: string } }).run;
    return `Run ${run.id}\nStatus: ${run.status}\nGoal: ${run.original_goal}${run.terminal_summary ? `\nSummary: ${run.terminal_summary}` : ''}`;
  }
  return JSON.stringify(value, null, 2);
}

try {
  if (process.argv.includes('--help') || process.argv.includes('-h')) process.stdout.write(`${usage}\n`);
  else if (process.argv.includes('--version') || process.argv.includes('-V')) {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    process.stdout.write(`${packageJson.version}\n`);
  } else {
    const parsed = parseArgs(process.argv.slice(2));
    const result = await dispatchCommand(parsed);
    if (parsed.command !== 'ui') process.stdout.write(`${parsed.json ? JSON.stringify(result) : human(result)}\n`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const json = process.argv.includes('--json');
  process.stderr.write(`${json ? JSON.stringify({ error: message }) : `Error: ${message}`}\n`);
  process.exitCode = 1;
}
