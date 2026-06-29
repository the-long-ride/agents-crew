import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
export function assetPath(...parts: string[]): string { return join(packageRoot, ...parts); }
