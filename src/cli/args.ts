export interface ParsedArgs { workspace: string; json: boolean; command: string; args: Record<string, unknown> }

function takeValue(values: string[], index: number, flag: string): [string, number] {
  const value = values[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return [value, index + 1];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const values = [...argv];
  let workspace = '.';
  let json = false;
  const commandTokens: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] as string;
    if (value === '--workspace') { [workspace, index] = takeValue(values, index, value); continue; }
    if (value === '--json') { json = true; continue; }
    commandTokens.push(value);
  }
  const command = commandTokens.shift();
  if (!command) throw new Error('missing command');
  const args: Record<string, unknown> = {};
  const positional: string[] = [];
  const repeated: Record<string, string[]> = { expectation: [], acceptance: [], constraint: [] };
  for (let index = 0; index < commandTokens.length; index += 1) {
    const value = commandTokens[index] as string;
    if (!value.startsWith('--')) { positional.push(value); continue; }
    const key = value.slice(2).replaceAll('-', '_');
    if (['non_interactive', 'force', 'no_open', 'yes', 'binary_only'].includes(key)) { args[key] = true; continue; }
    const [next, consumed] = takeValue(commandTokens, index, value);
    index = consumed;
    if (key === 'expectation' || key === 'acceptance' || key === 'constraint') repeated[key]?.push(next);
    else args[key] = next;
  }
  if (command === 'start') {
    args.template_id = positional[0];
    args.goal = args.goal ?? positional.slice(1).join(' ');
    args.expectations = repeated.expectation;
    args.acceptance_criteria = repeated.acceptance;
    args.constraints = repeated.constraint;
  } else if (['run', 'plan'].includes(command)) args.goal = positional.join(' ');
  else if (['status', 'resume', 'pause', 'cancel'].includes(command)) args.run_id = args.run ?? positional[0];
  else if (['approve', 'reject'].includes(command)) { args.approval_id = positional[0]; args.run_id = args.run; }
  else if (command === 'ui') args.port = Number(args.port ?? 0);
  else if (['template', 'config', 'plugin', 'worker', 'manager', 'agent'].includes(command)) {
    args.subcommand = positional[0];
    args.positional = positional.slice(1);
  } else args.positional = positional;
  return { workspace, json, command, args };
}
