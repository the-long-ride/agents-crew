// @ts-nocheck
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { MANAGERS } from './args.js';

export async function selectManager(): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    output.write('Select the manager host:\n');
    MANAGERS.forEach((manager, index) => output.write(`  ${index + 1}. ${manager}\n`));
    const answer = (await rl.question('Manager [1]: ')).trim() || '1';
    const index = Number(answer) - 1;
    if (!Number.isInteger(index) || !MANAGERS[index]) throw new Error(`Invalid manager selection: ${answer}`);
    return MANAGERS[index];
  } finally {
    rl.close();
  }
}

export async function confirmInstall(summary: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    output.write(`${summary}\n`);
    const answer = (await rl.question('Continue? [Y/n] ')).trim().toLowerCase();
    return answer === '' || answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}
