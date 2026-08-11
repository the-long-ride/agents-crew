#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from './args.js';
import { dispatchCommand } from './commands.js';
import { presentError, presentHuman } from './presenter.js';

const usage = `Agents Crew\n\nUsage: crew [--workspace <path>] [--json] <command>\n\nCommands: init, ui, start, run, plan, status, resume, pause, approve, reject, cancel, doctor, template, config, plugin, worker, manager`;


try {
  if (process.argv.includes('--help') || process.argv.includes('-h')) process.stdout.write(`${usage}\n`);
  else if (process.argv.includes('--version') || process.argv.includes('-V')) {
    const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
    process.stdout.write(`${packageJson.version}\n`);
  } else {
    const parsed = parseArgs(process.argv.slice(2));
    const result = await dispatchCommand(parsed);
    if (parsed.command !== 'ui') {
      const color = Boolean((process.stdout as { isTTY?: boolean }).isTTY) && !('NO_COLOR' in process.env);
      process.stdout.write(`${parsed.json ? JSON.stringify(result) : presentHuman(result, { color })}\n`);
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const json = process.argv.includes('--json');
  const color = Boolean((process.stderr as { isTTY?: boolean }).isTTY) && !('NO_COLOR' in process.env);
  process.stderr.write(`${json ? JSON.stringify({ error: message }) : presentError(message, { color })}\n`);
  process.exitCode = 1;
}
