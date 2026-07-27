// @ts-nocheck
import { spawn } from 'node:child_process';

export interface CommandResult { stdout: string; stderr: string; code: number; }

export async function runCommand(command: string, args: string[], options: { cwd?: string; env?: Record<string, string>; quiet?: boolean } = {}): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; if (!options.quiet) process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { stderr += chunk; if (!options.quiet) process.stderr.write(chunk); });
    child.on('error', reject);
    child.on('close', (code) => {
      const result = { stdout, stderr, code: code ?? 1 };
      if (result.code !== 0) {
        reject(new Error(`${command} ${args.join(' ')} exited ${result.code}${stderr ? `: ${stderr.trim()}` : ''}`));
      } else resolve(result);
    });
  });
}
