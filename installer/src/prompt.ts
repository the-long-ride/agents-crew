import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { MANAGERS, type ManagerHost } from './args.js';

export interface PromptAdapter {
  write(value: string): void;
  question(message: string): Promise<string>;
  close(): void;
}

function createPromptAdapter(): PromptAdapter {
  const rl = createInterface({ input, output });
  return {
    write: (value) => output.write(value),
    question: async (message) => await rl.question(message),
    close: () => rl.close(),
  };
}

export async function selectManager(prompt: PromptAdapter = createPromptAdapter()): Promise<ManagerHost> {
  try {
    prompt.write('Select the manager host:\n');
    MANAGERS.forEach((manager, index) => prompt.write(`  ${index + 1}. ${manager}\n`));
    const answer = (await prompt.question('Manager [1]: ')).trim() || '1';
    const index = Number(answer) - 1;
    if (!Number.isInteger(index) || !MANAGERS[index]) {
      throw new Error(`Invalid manager selection: ${answer}`);
    }
    return MANAGERS[index];
  } finally {
    prompt.close();
  }
}

export async function confirmInstall(
  summary: string,
  prompt: PromptAdapter = createPromptAdapter(),
): Promise<boolean> {
  try {
    prompt.write(`${summary}\n`);
    const answer = (await prompt.question('Continue? [Y/n] ')).trim().toLowerCase();
    return answer === '' || answer === 'y' || answer === 'yes';
  } finally {
    prompt.close();
  }
}
