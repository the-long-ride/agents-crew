import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export function assetPath(...parts: string[]): string { return join(packageRoot, ...parts); }
